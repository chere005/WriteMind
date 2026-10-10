/**
 * A ZIP reader and writer on `node:zlib` and nothing else (docs/SPEC-WM.md 1.3): methods STORE and DEFLATE, entries
 * found through the central directory, sizes and CRCs taken from it and CHECKED, names read as UTF-8 and refused when
 * they are not. No library: a note's container must be readable by this code alone for as long as the format lives.
 *
 * READING refuses (with a `ZipError`) anything it cannot do faithfully — another method, an encrypted entry, a
 * multi-disk archive, a name that is not UTF-8, a CRC that does not match, an entry that inflates past its declared
 * size, a file over the limits of 1.6 — and the caller leaves the file as it is. ZIP64 is read (the end record, the
 * extra field of an entry); this writer does not produce it and says so when a note is that big (4 GiB or 65 535
 * entries).
 *
 * THE STRUCTURE IS VETTED BEFORE ANYTHING IS INFLATED (a hostile file must not cost memory to be refused): the end record
 * must be the only one that fits the end of the file, the central directory must hold exactly the entries it is said to,
 * every name must be valid and unique and every local header must say what the directory says, no two entries may share
 * bytes and none may reach into the directory (a 20 KB file whose 64 entries all pointed at one block asked for 1.13 GiB),
 * the declared sizes together may not pass a thousand times the file (and a little), and `mimetype` and `manifest.json`
 * must be there. Only then is an entry inflated, never past what it declares.
 *
 * WRITING never edits in place: `zipParts` returns the whole archive as a list of buffers and wmStore writes them to a
 * temporary file beside the note and renames it. An entry that was read and not changed carries its compressed bytes
 * (`packed`), which are copied as they are instead of being compressed again.
 */

import { crc32, deflateRawSync, inflateRawSync } from "node:zlib"
import { MIMETYPE_BYTES, WM_MANIFEST, WM_MIMETYPE, WmError, methodFor, readNamesError, type WmEntry } from "@writemind/core"

export class ZipError extends Error {
  constructor(message: string) { super(message); this.name = "ZipError" }
}

/** What reading an entry knew about its stored form: written back as it is while the entry's bytes are untouched. */
export interface Packed { method: 0 | 8; crc: number; compressed: Uint8Array }
export interface ZipEntry extends WmEntry { packed?: Packed }

/** The limits of 1.6 a reader enforces (it MUST accept up to these). */
export const LIMITS = {
  entries: 20_000,
  text: 256 * 1024 * 1024,
  other: 2 * 1024 * 1024 * 1024,
  total: 8 * 1024 * 1024 * 1024,
  ratio: 1000,
  ratioFrom: 16 * 1024 * 1024,
  /** The declared sizes of all entries together may not pass `ratio` times the file, plus this (1.6). */
  ratioSlack: 16 * 1024 * 1024,
}
const TEXT_ENTRIES = new Set(["note.mdwm", "drawing.json", "manifest.json"])

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50
const SIG_END64 = 0x06064b50
const SIG_LOC64 = 0x07064b50

// (`ignoreBOM: true` is the spelling of "do NOT strip a byte-order mark": a name that starts with U+FEFF must keep it, to be refused.)
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

// MARK: - The directory

export interface CentralEntry {
  name: string
  method: 0 | 8
  crc: number
  compressedSize: number
  size: number
  /** Where its local header is. */
  offset: number
  flags: number
}

interface Reader { u16(at: number): number; u32(at: number): number; u64(at: number): number }
const readerOf = (view: Uint8Array): Reader => {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength)
  return {
    u16: (at) => dv.getUint16(at, true),
    u32: (at) => dv.getUint32(at, true),
    u64: (at) => Number(dv.getBigUint64(at, true)),
  }
}

/**
 * Where the end-of-central-directory record is in the last bytes of an archive, or -1. A record is the one that ends the
 * file when its comment runs to the end; a SECOND such record before it (a fake one inside the real one's comment, or the
 * other way round) makes the file ambiguous, and different tools would read different directories: refused.
 */
export function findEnd(tail: Uint8Array): number {
  const r = readerOf(tail)
  let found = -1
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tail[at] === 0x50 && r.u32(at) === SIG_END && at + 22 + r.u16(at + 20) === tail.length) {
      if (found >= 0) throw new ZipError("this archive has two end records (one inside the other's comment), so it does not say which directory is meant")
      found = at
    }
  }
  return found
}

/** The central directory's place and the entry count, from the end record (and the ZIP64 records it points to). */
export function directoryPlace(tail: Uint8Array, tailStart: number, readAt: (offset: number, length: number) => Uint8Array):
  { offset: number; size: number; count: number } {
  const end = findEnd(tail)
  if (end < 0) throw new ZipError("this is not a ZIP archive (no end record)")
  const r = readerOf(tail)
  if (r.u16(end + 4) !== 0 || r.u16(end + 6) !== 0) throw new ZipError("a multi-disk archive")
  let count = r.u16(end + 10)
  let size = r.u32(end + 12)
  let offset = r.u32(end + 16)
  const total = r.u16(end + 8)
  if (total !== count) throw new ZipError("a multi-disk archive")
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    // ZIP64: the locator just before the end record points to the ZIP64 end record.
    const loc = end - 20
    if (loc < 0 || r.u32(loc) !== SIG_LOC64) throw new ZipError("a ZIP64 archive with no ZIP64 locator")
    if (r.u32(loc + 4) !== 0 || r.u32(loc + 16) > 1) throw new ZipError("a multi-disk archive")
    const at = r.u64(loc + 8)
    const record = readAt(at, 56)
    const z = readerOf(record)
    if (record.length < 56 || z.u32(0) !== SIG_END64) throw new ZipError("a damaged ZIP64 end record")
    count = z.u64(32)
    size = z.u64(40)
    offset = z.u64(48)
  }
  void tailStart
  return { offset, size, count }
}

/**
 * The entries a central directory lists, in its order. `exact`: the directory must hold exactly `count` entries and
 * nothing after them (an end record that counts fewer entries than the directory holds is two readings of one file).
 */
export function parseDirectory(directory: Uint8Array, count: number, exact = false): CentralEntry[] {
  if (count > LIMITS.entries) throw new ZipError(`more than ${LIMITS.entries} entries (the limit)`)
  const r = readerOf(directory)
  const out: CentralEntry[] = []
  let at = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.length || r.u32(at) !== SIG_CENTRAL) throw new ZipError("a damaged central directory")
    const flags = r.u16(at + 8)
    const method = r.u16(at + 10)
    const crc = r.u32(at + 16)
    let compressedSize = r.u32(at + 20)
    let size = r.u32(at + 24)
    const nameLength = r.u16(at + 28)
    const extraLength = r.u16(at + 30)
    const commentLength = r.u16(at + 32)
    const disk = r.u16(at + 34)
    let offset = r.u32(at + 42)
    const next = at + 46 + nameLength + extraLength + commentLength
    if (next > directory.length) throw new ZipError("a damaged central directory")
    let name: string
    try { name = utf8.decode(directory.subarray(at + 46, at + 46 + nameLength)) } catch { throw new ZipError("an entry name is not UTF-8") }
    if (flags & 1 || flags & 0x40) throw new ZipError(`“${name}” is encrypted`)
    if (method !== 0 && method !== 8) throw new ZipError(`“${name}” uses a compression method this reader does not have (${method})`)
    if (disk !== 0) throw new ZipError("a multi-disk archive")
    if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff) {
      // ZIP64 extra field (id 1): the fields that did not fit, in this order.
      let e = at + 46 + nameLength
      const stop = e + extraLength
      let found = false
      while (e + 4 <= stop) {
        const id = r.u16(e)
        const length = r.u16(e + 2)
        if (id === 1) {
          let p = e + 4
          const need = (size === 0xffffffff ? 8 : 0) + (compressedSize === 0xffffffff ? 8 : 0) + (offset === 0xffffffff ? 8 : 0)
          if (length < need || e + 4 + length > stop) throw new ZipError(`“${name}” has a ZIP64 extra field that is too short`)
          if (size === 0xffffffff) { size = r.u64(p); p += 8 }
          if (compressedSize === 0xffffffff) { compressedSize = r.u64(p); p += 8 }
          if (offset === 0xffffffff) { offset = r.u64(p); p += 8 }
          found = true
          break
        }
        e += 4 + length
      }
      if (!found) throw new ZipError(`“${name}” has no ZIP64 sizes`)
    }
    out.push({ name, method: method as 0 | 8, crc, compressedSize, size, offset, flags })
    at = next
  }
  if (exact && at !== directory.length) throw new ZipError("the central directory holds more than its end record counts")
  return out
}

/** Whether `entry` is over the limits (1.6): the message, or null. */
function overLimit(entry: CentralEntry, running: number): string | null {
  const limit = TEXT_ENTRIES.has(entry.name) ? LIMITS.text : LIMITS.other
  if (entry.size > limit) return `“${entry.name}” is larger than the ${Math.round(limit / 1048576)} MiB limit`
  if (running + entry.size > LIMITS.total) return "the note is larger than the 8 GiB limit"
  if (entry.size > LIMITS.ratioFrom && entry.compressedSize > 0 && entry.size / entry.compressedSize > LIMITS.ratio) {
    return `“${entry.name}” is compressed more than ${LIMITS.ratio}:1`
  }
  return null
}

/**
 * Where an entry's compressed bytes start, from its local header — which must say what the central directory says: the
 * same name (a different one is a file that shows one thing to a tool that lists the directory and another to one that
 * unpacks as it goes) and the same method.
 */
function dataStart(file: Uint8Array, entry: CentralEntry): number {
  const r = readerOf(file)
  const at = entry.offset
  if (at + 30 > file.length || r.u32(at) !== SIG_LOCAL) throw new ZipError(`“${entry.name}” has a damaged header`)
  const nameLength = r.u16(at + 26)
  const start = at + 30 + nameLength + r.u16(at + 28)
  if (start > file.length) throw new ZipError(`“${entry.name}” has a damaged header`)
  const local = file.subarray(at + 30, at + 30 + nameLength)
  const wanted = encoder.encode(entry.name)
  if (local.length !== wanted.length || local.some((byte, i) => byte !== wanted[i])) {
    throw new ZipError(`“${entry.name}” is named differently in its own header than in the directory`)
  }
  if (r.u16(at + 8) !== entry.method) throw new ZipError(`“${entry.name}” has another method in its own header than in the directory`)
  if (start + entry.compressedSize > file.length) throw new ZipError(`“${entry.name}” is cut short`)
  return start
}

/** The entry's bytes, decoded and checked against the directory (size and CRC). */
export function entryBytes(file: Uint8Array, entry: CentralEntry): { data: Uint8Array; packed: Packed } {
  const start = dataStart(file, entry)
  const compressed = file.subarray(start, start + entry.compressedSize)
  let data: Uint8Array
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ZipError(`“${entry.name}” has two sizes`)
    data = compressed
  } else {
    try {
      // (One byte more than declared would be an overflow: `maxOutputLength` stops an entry that inflates past its size.)
      data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new ZipError(code === "ERR_BUFFER_TOO_LARGE" ? `“${entry.name}” holds more than its declared size` : `“${entry.name}” cannot be unpacked`)
    }
    if (data.length !== entry.size) throw new ZipError(`“${entry.name}” holds ${data.length} bytes, not the ${entry.size} it declares`)
  }
  if ((crc32(data) >>> 0) !== entry.crc) throw new ZipError(`“${entry.name}” does not match its checksum`)
  return { data, packed: { method: entry.method, crc: entry.crc, compressed } }
}

/**
 * Everything that can be known about the archive WITHOUT inflating a byte (see the top): the names, `mimetype` and
 * `manifest.json`, the limits of 1.6 (each entry's, the sum's, the sum against the file's own size), every local header
 * against the directory, and that no two entries share bytes and none reaches into the directory.
 */
function vet(file: Uint8Array, entries: readonly CentralEntry[], directoryAt: number): void {
  const problem = readNamesError(entries.map((entry) => entry.name))
  if (problem) throw new WmError(problem)
  const real = entries.filter((entry) => !entry.name.endsWith("/"))
  const mime = real.find((entry) => entry.name === WM_MIMETYPE)
  if (!mime) throw new WmError("this is not a WriteMind note (it has no mimetype entry)")
  if (mime.size !== MIMETYPE_BYTES.length) throw new WmError("this is not a WriteMind note (its mimetype is another type)")
  if (!real.some((entry) => entry.name === WM_MANIFEST)) throw new WmError("this note has no manifest.json")
  let running = 0
  for (const entry of entries) {
    const why = overLimit(entry, running)
    if (why) throw new ZipError(why)
    running += entry.size
  }
  if (running > LIMITS.ratio * file.length + LIMITS.ratioSlack) {
    throw new ZipError(`the entries declare ${Math.round(running / 1048576)} MiB, more than a thousand times the file's own size: a bomb`)
  }
  const spans = entries.map((entry) => ({ entry, from: entry.offset, to: dataStart(file, entry) + entry.compressedSize }))
    .sort((a, b) => a.from - b.from)
  let end = 0
  for (const span of spans) {
    if (span.from < end) throw new ZipError(`“${span.entry.name}” shares bytes with another entry`)
    end = span.to
  }
  if (end > directoryAt) throw new ZipError("an entry's data reaches into the central directory")
}

/** Every entry of an archive held in memory, unpacked and checked. A directory entry (a name ending `/`) is returned too. */
export function readZip(file: Uint8Array): ZipEntry[] {
  try {
    return readChecked(file)
  } catch (error) {
    // (A record that runs past the end of the file: the DataView says so with a RangeError, and the person is owed a ZipError.)
    if (error instanceof RangeError) throw new ZipError("this archive is damaged: a record runs past the end of the file")
    throw error
  }
}

function readChecked(file: Uint8Array): ZipEntry[] {
  const tailStart = Math.max(0, file.length - (65_535 + 22))
  const place = directoryPlace(file.subarray(tailStart), tailStart, (offset, length) => file.subarray(offset, offset + length))
  if (place.offset + place.size > file.length) throw new ZipError("a damaged central directory")
  const entries = parseDirectory(file.subarray(place.offset, place.offset + place.size), place.count, true)
  vet(file, entries, place.offset)
  // The mimetype first and by itself: it is thirty-odd bytes, and a file whose first word is wrong is refused before the rest is unpacked.
  const mime = entries.find((entry) => entry.name === WM_MIMETYPE)!
  const first = entryBytes(file, mime)
  const got = first.data
  if (got.length !== MIMETYPE_BYTES.length || got.some((byte, at) => byte !== MIMETYPE_BYTES[at])) {
    throw new WmError("this is not a WriteMind note (its mimetype is another type)")
  }
  const out: ZipEntry[] = []
  for (const entry of entries) {
    if (entry.name.endsWith("/")) { out.push({ name: entry.name, data: new Uint8Array(0) }); continue }
    const { data, packed } = entry === mime ? first : entryBytes(file, entry)
    out.push({ name: entry.name, data, packed })
  }
  return out
}

// MARK: - Writing

const dosTime = (when: Date): { time: number; date: number } => {
  const year = Math.max(1980, when.getFullYear())
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  }
}

const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text)

/** The archive for `entries`, in order, as buffers to be written one after the other. Entries are given in the order they are to be in the file. */
export function zipParts(entries: readonly ZipEntry[], when: Date = new Date()): Buffer[] {
  if (entries.length >= 0xffff) throw new ZipError("this note has more than 65 535 entries, which this writer cannot write (no ZIP64)")
  const { time, date } = dosTime(when)
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(entry.name))
    const wanted = methodFor(entry.name)
    let method: 0 | 8
    let compressed: Uint8Array
    let crc: number
    if (entry.packed && entry.packed.method === (wanted === "store" ? 0 : 8)) {
      ;({ method, compressed, crc } = entry.packed)
    } else {
      crc = crc32(entry.data) >>> 0
      method = wanted === "store" ? 0 : 8
      compressed = method === 0 ? entry.data : deflateRawSync(entry.data, { level: 6 })
      // Kept with the entry, so the next archive written with these bytes copies them instead of compressing again. (An entry
      // whose bytes change is a new entry object: core's `withEntry` never edits one in place.)
      ;(entry as ZipEntry).packed = { method, crc, compressed }
    }
    if (entry.data.length >= 0xffffffff || compressed.length >= 0xffffffff || offset >= 0xffffffff) {
      throw new ZipError("this note is larger than 4 GiB, which this writer cannot write (no ZIP64)")
    }
    const flags = isAscii(entry.name) ? 0 : 0x0800
    const header = Buffer.alloc(30)
    header.writeUInt32LE(SIG_LOCAL, 0)
    header.writeUInt16LE(method === 0 ? 10 : 20, 4)
    header.writeUInt16LE(flags, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(entry.data.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(SIG_CENTRAL, 0)
    directory.writeUInt16LE(0x0314, 4)
    directory.writeUInt16LE(method === 0 ? 10 : 20, 6)
    directory.writeUInt16LE(flags, 8)
    directory.writeUInt16LE(method, 10)
    directory.writeUInt16LE(time, 12)
    directory.writeUInt16LE(date, 14)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(compressed.length, 20)
    directory.writeUInt32LE(entry.data.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(((0o100644 << 16) >>> 0), 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    parts.push(header, name, Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength))
    offset += 30 + name.length + compressed.length
  }
  const size = central.reduce((sum, one) => sum + one.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(SIG_END, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return [...parts, ...central, end]
}

export const zipBytes = (entries: readonly ZipEntry[], when?: Date): Buffer => Buffer.concat(zipParts(entries, when))
