// A .wm (docs/SPEC-WM.md) read and written with node:zlib alone, for the suites: what a script puts in a notes folder before
// the app looks, and what it reads back to check what the app wrote. It is NOT the app's codec (apps/desktop/src/main/zip.ts):
// a check that used the code under test to read its own output would prove nothing. Writes STORE only (a test file is small),
// reads STORE and DEFLATE through the central directory, and checks every CRC.

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const MIME = "application/vnd.writemind.note+zip"

function zipOf(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8")
    const crc = zlib.crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(10, 4)
    local.writeUInt16LE(/^[\x20-\x7e]*$/.test(name) ? 0 : 0x0800, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(0x0314, 4)
    dir.writeUInt16LE(10, 6)
    dir.writeUInt16LE(/^[\x20-\x7e]*$/.test(name) ? 0 : 0x0800, 8)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    dir.writeUInt32LE(offset, 42)
    parts.push(local, nameBytes, data)
    central.push(dir, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const size = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

/** The bytes of a .wm holding `text`, and `drawing` (JSON text) and `entries` ({ "media/a.png": Buffer | string }) when given. */
export function wmBytes(text, { drawing, entries = {}, manifest = {} } = {}) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  const full = {
    format: "writemind-note", version: 1, id: crypto.randomUUID(), created: now, modified: now,
    app: { name: "WriteMind e2e", version: "0" }, ...manifest,
  }
  const list = [["mimetype", Buffer.from(MIME)], ["manifest.json", Buffer.from(JSON.stringify(full, null, 2))], ["note.mdwm", Buffer.from(text, "utf8")]]
  if (drawing !== undefined) list.push(["drawing.json", Buffer.from(drawing, "utf8")])
  for (const [name, data] of Object.entries(entries)) list.push([name, Buffer.isBuffer(data) ? data : Buffer.from(data)])
  return zipOf(list)
}

/** Write a .wm file (the folder is made). */
export function writeWm(file, text, extras) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, wmBytes(text, extras))
  return file
}

/** Every entry of a .wm by name (decoded, CRC-checked), in the order the central directory has them. Throws when it is not a note. */
export function readWm(file) {
  const bytes = fs.readFileSync(file)
  let at = bytes.length - 22
  while (at >= 0 && bytes.readUInt32LE(at) !== 0x06054b50) at--
  if (at < 0) throw new Error(`${file} is not a ZIP archive`)
  const count = bytes.readUInt16LE(at + 10)
  let cursor = bytes.readUInt32LE(at + 16)
  const entries = {}
  const names = []
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(cursor + 10)
    const crc = bytes.readUInt32LE(cursor + 16)
    const packed = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32)
    const local = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8")
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    const raw = bytes.subarray(start, start + packed)
    const data = method === 0 ? raw : zlib.inflateRawSync(raw)
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`${name} of ${file} does not match its checksum`)
    entries[name] = data
    names.push(name)
    cursor = next
  }
  if (names[0] !== "mimetype" || entries.mimetype.toString() !== MIME) throw new Error(`${file} does not start with the mimetype entry`)
  return {
    entries, names,
    text: (entries["note.mdwm"] ?? Buffer.alloc(0)).toString("utf8").replace(/^﻿/, ""),
    drawing: entries["drawing.json"] ? entries["drawing.json"].toString("utf8") : null,
    manifest: JSON.parse(entries["manifest.json"].toString("utf8")),
  }
}
