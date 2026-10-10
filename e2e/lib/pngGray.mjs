// A PNG as grey levels, in plain node (no dependencies): for the camera feed of real writing (fixtures.mjs `text`).
// 8-bit, not interlaced; grey, RGB, palette, grey+alpha and RGBA (alpha over white).
import fs from "node:fs"
import zlib from "node:zlib"

export function readPngGray(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`)
  let at = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0
  const data = [], palette = [], alphas = []
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at), name = buffer.toString("latin1", at + 4, at + 8), body = buffer.subarray(at + 8, at + 8 + length)
    if (name === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12] }
    else if (name === "PLTE") for (let i = 0; i + 2 < body.length; i += 3) palette.push([body[i], body[i + 1], body[i + 2]])
    else if (name === "tRNS") for (const a of body) alphas.push(a)
    else if (name === "IDAT") data.push(body)
    at += 12 + length
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`${file}: only 8-bit PNGs that are not interlaced`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= channels ? out[y * stride + x - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0
      let p = 0
      if (filter === 1) p = a; else if (filter === 2) p = b; else if (filter === 3) p = (a + b) >> 1
      else if (filter === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[y * stride + x] = (v + p) & 255
    }
  }
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    let r, g, b, alpha = 255
    if (type === 0) r = g = b = out[i]
    else if (type === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2] }
    else if (type === 3) { [r, g, b] = palette[out[i]] ?? [0, 0, 0]; alpha = alphas[out[i]] ?? 255 }
    else if (type === 4) { r = g = b = out[i * 2]; alpha = out[i * 2 + 1] }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; alpha = out[i * 4 + 3] }
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    gray[i] = Math.round(luma * alpha / 255 + 255 * (1 - alpha / 255))
  }
  return { width, height, gray }
}

/** Area-averaged resize of grey levels. */
export function resizeGray({ width, height, gray }, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = (y * height) / h, y1 = ((y + 1) * height) / h
    for (let x = 0; x < w; x++) {
      const x0 = (x * width) / w, x1 = ((x + 1) * width) / w
      let sum = 0, weight = 0
      for (let j = Math.floor(y0); j < Math.min(height, Math.ceil(y1)); j++) {
        const wy = Math.min(j + 1, y1) - Math.max(j, y0)
        for (let i = Math.floor(x0); i < Math.min(width, Math.ceil(x1)); i++) {
          const wx = Math.min(i + 1, x1) - Math.max(i, x0)
          sum += gray[j * width + i] * wx * wy; weight += wx * wy
        }
      }
      out[y * w + x] = Math.round(sum / weight)
    }
  }
  return { width: w, height: h, gray: out }
}
