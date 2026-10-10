/**
 * A PNG decoder in plain TypeScript, so the bundled reader can open the pictures the app hands it (a capture's cut
 * and the tablet's sheet are PNGs from a canvas) in its worker, where Electron's `nativeImage` does not exist, and so
 * the tests can read a fixture without Electron. Every colour type, bit depths 1-16, interlaced or not; the result
 * is 8-bit RGBA. Anything that is not a PNG is the caller's to decode (main/bundledOcr.ts uses `nativeImage`).
 */

import { inflateSync } from "node:zlib"

export interface Rgba {
  width: number
  height: number
  /** width * height * 4 bytes, top row first. */
  data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export const isPng = (bytes: Uint8Array): boolean => SIGNATURE.every((value, at) => bytes[at] === value)

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Undo the per-row filters of one (sub)image, in place; returns the raw rows. */
function unfilter(data: Uint8Array, offset: number, width: number, height: number, bpp: number,
  bitsPerPixel: number): { rows: Uint8Array; next: number } {
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const rows = new Uint8Array(stride * height)
  let at = offset
  for (let y = 0; y < height; y += 1) {
    const filter = data[at++]!
    const row = y * stride, prior = row - stride
    for (let x = 0; x < stride; x += 1) {
      const raw = data[at++]!
      const left = x >= bpp ? rows[row + x - bpp]! : 0
      const up = y > 0 ? rows[prior + x]! : 0
      const upLeft = y > 0 && x >= bpp ? rows[prior + x - bpp]! : 0
      let value: number
      switch (filter) {
        case 0: value = raw; break
        case 1: value = raw + left; break
        case 2: value = raw + up; break
        case 3: value = raw + ((left + up) >> 1); break
        case 4: value = raw + paeth(left, up, upLeft); break
        default: throw new Error(`PNG: unknown filter ${filter}`)
      }
      rows[row + x] = value & 0xff
    }
  }
  return { rows, next: at }
}

/** Decode a PNG to 8-bit RGBA. Throws on anything it cannot read. */
export function decodePng(bytes: Uint8Array): Rgba {
  if (!isPng(bytes)) throw new Error("not a PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0
  let palette: Uint8Array | null = null
  let alphaTable: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    const body = bytes.subarray(at + 8, at + 8 + length)
    at += 12 + length
    if (type === "IHDR") {
      const header = new DataView(body.buffer, body.byteOffset, body.byteLength)
      width = header.getUint32(0); height = header.getUint32(4)
      depth = body[8]!; colour = body[9]!; interlace = body[12]!
    } else if (type === "PLTE") palette = body
    else if (type === "tRNS") alphaTable = body
    else if (type === "IDAT") idat.push(body)
    else if (type === "IEND") break
  }
  if (width <= 0 || height <= 0) throw new Error("PNG: no header")
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 3 ? 1 : colour === 4 ? 2 : colour === 6 ? 4 : 0
  if (channels === 0) throw new Error(`PNG: unknown colour type ${colour}`)
  const bitsPerPixel = channels * depth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const data = new Uint8Array(inflateSync(Buffer.concat(idat)))
  const out = new Uint8Array(width * height * 4)
  const max = (1 << Math.min(depth, 8)) - 1

  /** One sample (channel c of pixel x) of a row, scaled to 0-255. */
  const sample = (rows: Uint8Array, row: number, x: number, c: number): number => {
    if (depth === 8) return rows[row + x * channels + c]!
    if (depth === 16) return rows[row + (x * channels + c) * 2]!
    const bit = (x * channels + c) * depth
    const value = (rows[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max
    return colour === 3 ? value : Math.round((value * 255) / max)
  }
  const transparentGray = alphaTable && colour === 0 && alphaTable.length >= 2
    ? new DataView(alphaTable.buffer, alphaTable.byteOffset).getUint16(0) : -1

  const place = (rows: Uint8Array, w: number, h: number, put: (x: number, y: number) => number) => {
    const stride = Math.ceil((w * bitsPerPixel) / 8)
    for (let y = 0; y < h; y += 1) {
      const row = y * stride
      for (let x = 0; x < w; x += 1) {
        const o = put(x, y) * 4
        if (colour === 3) {
          const index = sample(rows, row, x, 0)
          out[o] = palette?.[index * 3] ?? 0
          out[o + 1] = palette?.[index * 3 + 1] ?? 0
          out[o + 2] = palette?.[index * 3 + 2] ?? 0
          out[o + 3] = alphaTable && index < alphaTable.length ? alphaTable[index]! : 255
        } else if (channels <= 2) {
          const g = sample(rows, row, x, 0)
          out[o] = out[o + 1] = out[o + 2] = g
          out[o + 3] = channels === 2 ? sample(rows, row, x, 1)
            : transparentGray >= 0 && depth <= 8 && Math.round((transparentGray * 255) / max) === g ? 0 : 255
        } else {
          out[o] = sample(rows, row, x, 0)
          out[o + 1] = sample(rows, row, x, 1)
          out[o + 2] = sample(rows, row, x, 2)
          out[o + 3] = channels === 4 ? sample(rows, row, x, 3) : 255
        }
      }
    }
  }

  if (interlace === 0) {
    place(unfilter(data, 0, width, height, bpp, bitsPerPixel).rows, width, height, (x, y) => y * width + x)
  } else {
    // Adam7: seven passes, each a small image of its own.
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    let offset = 0
    for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
      const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy)
      if (w <= 0 || h <= 0) continue
      const { rows, next } = unfilter(data, offset, w, h, bpp, bitsPerPixel)
      offset = next
      place(rows, w, h, (x, y) => (y0 + y * dy) * width + x0 + x * dx)
    }
  }
  return { width, height, data: out }
}
