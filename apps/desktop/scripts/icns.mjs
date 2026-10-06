// WriteMind's macOS icon (.icns), written here rather than by `iconutil`, so
// that every platform builds the same file and a Windows run can test it.
//
// THE ART IS THE MAC APP'S OWN: WriteMind/Assets.xcassets/AppIcon.appiconset,
// the full-bleed cut tools/make-icons.sh renders from assets/logo-square.svg
// (macOS masks a bundle icon itself). So the Electron WriteMind and the Swift
// one look the same in the Dock and in Finder. A checkout without that folder
// falls back to packaging/icon.png (the rounded 512 px cut).
//
// THE FORMAT is the documented one, and every entry is a PNG (what macOS has
// read in an .icns since 10.7): "icns" + the file's length, then for each
// image its four-letter type, its own length (with these 8 bytes) and the PNG.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "../../..")
export const APP_ICON_SET = path.join(repo, "WriteMind/Assets.xcassets/AppIcon.appiconset")
export const ROUNDED_ICON = path.join(repo, "packaging/icon.png")

/** Each .icns slot and the pixel size it holds (16@2x is 32 px, and so on). */
export const ICNS_SLOTS = [
  ["icp4", 16], ["ic11", 32], ["icp5", 32], ["ic12", 64], ["ic07", 128],
  ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024],
]

/** A PNG's width and height, from its IHDR; null when the bytes are not a PNG. */
export function pngSize(png) {
  const signature = "89504e470d0a1a0a"
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) return null
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** The .icns of these PNGs, keyed by pixel size: every slot whose size is there, in ICNS_SLOTS order. */
export function icnsFromPngs(bySize) {
  const entries = []
  for (const [type, size] of ICNS_SLOTS) {
    const png = bySize.get(size)
    if (!png) continue
    const found = pngSize(png)
    if (!found || found.width !== size || found.height !== size) {
      throw new Error(`icns: the ${size} px image is ${found ? `${found.width}x${found.height}` : "not a PNG"}`)
    }
    const head = Buffer.alloc(8)
    head.write(type, 0, "latin1")
    head.writeUInt32BE(png.length + 8, 4)
    entries.push(head, png)
  }
  if (entries.length === 0) throw new Error("icns: no image of a size an .icns holds")
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write("icns", 0, "latin1")
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

/** The entries of an .icns, as [type, data] - for the tests and for checking a file before replacing it. */
export function readIcns(buffer) {
  if (buffer.length < 8 || buffer.toString("latin1", 0, 4) !== "icns") throw new Error("icns: no 'icns' header")
  const total = buffer.readUInt32BE(4)
  if (total !== buffer.length) throw new Error(`icns: header says ${total} bytes, file has ${buffer.length}`)
  const entries = []
  for (let at = 8; at < total;) {
    const length = buffer.readUInt32BE(at + 4)
    if (length < 8 || at + length > total) throw new Error(`icns: entry at ${at} runs past the end`)
    entries.push([buffer.toString("latin1", at, at + 4), buffer.subarray(at + 8, at + length)])
    at += length
  }
  return entries
}

/** WriteMind's .icns: the Mac app's icon set, or the rounded 512 px cut when that set is not in the checkout. */
export function writemindIcns({ set = APP_ICON_SET, fallback = ROUNDED_ICON } = {}) {
  const bySize = new Map()
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const file = path.join(set, `icon_${size}.png`)
    if (existsSync(file)) bySize.set(size, readFileSync(file))
  }
  if (bySize.size === 0) bySize.set(512, readFileSync(fallback))
  return icnsFromPngs(bySize)
}
