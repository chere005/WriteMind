// A hostile or damaged archive is refused whole, BEFORE anything is inflated, and the file is left as it is
// (docs/SPEC-WM.md 1.3, 1.6, 6.2 vector 5): overlapping entries, a local header that is not what the directory says, an end
// record that counts something else, two end records, a short ZIP64 extra, a bomb of many entries that each fit the rule;
// and the ZIP64 end-record branch read both ways. The archives are made here byte by byte (`craft`), so each one breaks exactly
// one rule.
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { crc32, deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { WmError, entriesToWrite, newWmFile, openWm } from "@writemind/core"
import { LIMITS, ZipError, directoryPlace, findEnd, parseDirectory, readZip } from "../src/main/zip"
import { readEntryHead } from "../src/main/zipHead"
import { readText, writeText } from "../src/main/wmStore"

const NOW = new Date("2026-10-08T09:14:03Z")
const APP = { name: "WriteMind", version: "3.0.0" }

interface Raw {
  name: string
  data: Buffer
  method?: 0 | 8
  /** What the LOCAL header says instead of `name`. */
  localName?: string
  /** What the CENTRAL entry says instead of the true values. */
  central?: { crc?: number; size?: number; compressedSize?: number; offset?: number; extra?: Buffer; flags?: number }
  /** The bytes of the entry's data as they are in the file (instead of `data` stored or deflated). */
  packed?: Buffer
}

interface Craft {
  count?: number
  total?: number
  comment?: Buffer
  /** Write a ZIP64 end record and locator, and say 0xffff / 0xffffffff in the end record. */
  zip64?: { locator?: boolean; signature?: number; recordAt?: number; disk?: number }
  /** Bytes after the end record. */
  junk?: Buffer
}

const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
const u64 = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }

/** A ZIP archive, with every field in the hands of the test. */
function craft(entries: Raw[], options: Craft = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const method = entry.method ?? (entry.name === "mimetype" ? 0 : 8)
    const packed = entry.packed ?? (method === 0 ? entry.data : deflateRawSync(entry.data))
    const crc = crc32(entry.data) >>> 0
    const local = Buffer.from(entry.localName ?? entry.name, "utf8")
    const name = Buffer.from(entry.name, "utf8")
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(packed.length),
      u32(entry.data.length), u16(local.length), u16(0), local])
    const c = entry.central ?? {}
    const extra = c.extra ?? Buffer.alloc(0)
    centrals.push(Buffer.concat([u32(0x02014b50), u16(0x0314), u16(20), u16(c.flags ?? 0), u16(method), u16(0), u16(0),
      u32(c.crc ?? crc), u32(c.compressedSize ?? packed.length), u32(c.size ?? entry.data.length), u16(name.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0), u32(c.offset ?? offset), name, extra]))
    locals.push(header, packed)
    offset += header.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const parts: Buffer[] = [...locals, directory]
  const comment = options.comment ?? Buffer.alloc(0)
  let eocd: Buffer
  if (options.zip64) {
    const z = options.zip64
    const recordAt = offset + directory.length
    const record = Buffer.concat([u32(z.signature ?? 0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(entries.length), u64(entries.length),
      u64(directory.length), u64(offset)])
    parts.push(record)
    if (z.locator !== false) parts.push(Buffer.concat([u32(0x07064b50), u32(z.disk ?? 0), u64(z.recordAt ?? recordAt), u32(1)]))
    eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(comment.length), comment])
  } else {
    eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(options.total ?? entries.length), u16(options.count ?? entries.length),
      u32(directory.length), u32(offset), u16(comment.length), comment])
  }
  parts.push(eocd)
  if (options.junk) parts.push(options.junk)
  return Buffer.concat(parts)
}

/** The entries of a minimal note, as the writer makes them. */
const note = (text = "# T\n"): Raw[] => entriesToWrite(newWmFile(NOW, APP, text), null).entries
  .map((entry) => ({ name: entry.name, data: Buffer.from(entry.data) }))

describe("the crafted archive is itself sound (so each break below is the only fault in its file)", () => {
  it("reads like any other, with every field the test controls left alone", () => {
    const bytes = craft(note("# Crafted\n"))
    const file = openWm(readZip(bytes))
    expect(new TextDecoder().decode(file.entries.find((entry) => entry.name === "note.mdwm")!.data)).toBe("# Crafted\n")
    expect(readZip(craft(note(), { comment: Buffer.from("an archive comment") })).length).toBe(3)
  })
})

describe("16. the structure is refused before anything is inflated", () => {
  it("entries that share bytes (a local header placed inside another entry's data) are refused", () => {
    // B's local header and data sit INSIDE A's stored data; B's directory entry points there.
    const body = Buffer.from("bbbb")
    const bHeader = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc32(body) >>> 0), u32(body.length), u32(body.length),
      u16("media/b.bin".length), u16(0), Buffer.from("media/b.bin")])
    const a = Buffer.concat([Buffer.from("aaaa"), bHeader, body])
    const base = note()
    const aOffset = base.reduce((sum, entry) => sum + 30 + entry.name.length + deflateOrStore(entry).length, 0)
    const bytes = craft([...base,
      { name: "media/a.bin", data: a, method: 0 },
      { name: "media/b.bin", data: body, method: 0, central: { offset: aOffset + 30 + "media/a.bin".length + 4 } }])
    expect(() => readZip(bytes)).toThrow(/shares bytes with another entry/)
  })

  it("an entry whose data reaches into the central directory is refused", () => {
    const entries = note()
    const last = entries[entries.length - 1]!
    const bytes = craft(entries.map((entry) => (entry === last ? { ...entry, method: 0 as const, central: { compressedSize: last.data.length + 20, size: last.data.length + 20 } } : entry)))
    expect(() => readZip(bytes)).toThrow(/reaches into the central directory/)
  })

  it("the declared sizes of 128 entries that each fit the rule pass a thousand times the file together: a bomb, refused before the first inflate", () => {
    const zeros = Buffer.alloc(LIMITS.ratioFrom)
    const small = deflateRawSync(zeros)
    const entries: Raw[] = [...note(), ...Array.from({ length: 128 }, (_, i) => ({ name: `media/z${i}.bin`, data: zeros, method: 8 as const, packed: small }))]
    // (The first entry's checksum is wrong too: were anything inflated first, THAT would be what is reported.)
    entries[1] = { ...entries[1]!, central: { crc: 1 } }
    const bytes = craft(entries)
    expect(bytes.length * LIMITS.ratio + LIMITS.ratioSlack).toBeLessThan(128 * LIMITS.ratioFrom)
    const started = Date.now()
    expect(() => readZip(bytes)).toThrow(/a bomb/)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it("the names, mimetype and manifest are looked at before an entry is unpacked: a note with a bad name AND a bad checksum says the name", () => {
    const entries = note().map((entry) => (entry.name === "note.mdwm" ? { ...entry, central: { crc: 7 } } : entry))
    expect(() => readZip(craft([...entries, { name: "../x", data: Buffer.from("1") }]))).toThrow(WmError)
    expect(() => readZip(craft(entries))).toThrow(/checksum/)
    expect(() => readZip(craft(entries.filter((entry) => entry.name !== "manifest.json")))).toThrow(/no manifest\.json/)
    expect(() => readZip(craft(entries.filter((entry) => entry.name !== "mimetype")))).toThrow(/no mimetype entry/)
    expect(() => readZip(craft(entries.map((entry) => (entry.name === "mimetype" ? { ...entry, data: Buffer.from("application/zip") } : entry)))))
      .toThrow(/mimetype is another type/)
  })

  it("a directory read by the sidebar's head reader is not allocated on the end record's word", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wm-head-"))
    const file = path.join(dir, "Big.wm")
    // An end record that says the directory is 3 GiB, in a file of a few hundred bytes.
    const bytes = craft(note())
    bytes.writeUInt32LE(0x7fffffff, bytes.length - 22 + 12)
    writeFileSync(file, bytes)
    await expect(readEntryHead(file, "note.mdwm", 8192)).rejects.toThrow(ZipError)
    // ...and more entries than the limit is refused before the directory is read.
    const many = craft(note())
    many.writeUInt16LE(60000, many.length - 22 + 8)
    many.writeUInt16LE(60000, many.length - 22 + 10)
    writeFileSync(file, many)
    await expect(readEntryHead(file, "note.mdwm", 8192)).rejects.toThrow(/more than 20000 entries/)
    // The same file, sound, is read.
    writeFileSync(file, craft(note("# Sound\n")))
    expect((await readEntryHead(file, "note.mdwm", 8192))!.head.toString()).toBe("# Sound\n")
  })
})

describe("20. the local headers, the directory and the end record say one thing", () => {
  it("a local header that names another entry than the directory does is refused (a file one tool lists and another unpacks differently)", () => {
    const entries = note().map((entry) => (entry.name === "note.mdwm" ? { ...entry, localName: "note.mdwx" } : entry))
    expect(() => readZip(craft(entries))).toThrow(/named differently in its own header/)
  })

  it("an end record that counts fewer entries than the directory holds, or more, is refused", () => {
    expect(() => readZip(craft(note(), { count: 2, total: 2 }))).toThrow(/more than its end record counts/)
    expect(() => readZip(craft(note(), { count: 4, total: 4 }))).toThrow(/damaged central directory/)
  })

  it("two end records that both fit the end of the file (a fake one in the comment) are refused, and bytes after the end record are no archive", () => {
    const fake = craft([]).subarray(-22)
    expect(fake.length).toBe(22)
    expect(() => readZip(craft(note(), { comment: fake }))).toThrow(/two end records/)
    expect(findEnd(Buffer.concat([Buffer.alloc(10), craft(note()).subarray(-22)]))).toBeGreaterThanOrEqual(0)
    expect(() => readZip(craft(note(), { junk: Buffer.from("trailing junk") }))).toThrow(/no end record/)
    // A comment that only LOOKS like an end record (it does not run to the end of the file) is just a comment.
    const look = Buffer.concat([Buffer.from("PK\u0005\u0006"), Buffer.alloc(30)])
    expect(readZip(craft(note(), { comment: look })).length).toBe(3)
  })
})

describe("23. a name keeps its byte-order mark to be refused, and a short ZIP64 extra is a ZipError", () => {
  it("a name that begins with U+FEFF is not read as the name without it", () => {
    const entries = note().map((entry) => (entry.name === "note.mdwm" ? { ...entry, name: "\ufeffnote.mdwm" } : entry))
    expect(() => readZip(craft(entries))).toThrow(/control character/)
    // (the directory's own reading keeps the character)
    const bytes = craft(entries)
    const place = directoryPlace(bytes.subarray(-22), 0, () => new Uint8Array(0))
    const names = parseDirectory(bytes.subarray(place.offset, place.offset + place.size), place.count, true).map((entry) => entry.name)
    expect(names).toContain("\ufeffnote.mdwm")
  })

  it("a ZIP64 extra field with less in it than the sizes it stands for is refused as a ZipError, not a RangeError", () => {
    const short = Buffer.concat([u16(1), u16(0)])
    const entries = note().map((entry) => (entry.name === "note.mdwm" ? { ...entry, central: { size: 0xffffffff, extra: short } } : entry))
    let caught: unknown
    try { readZip(craft(entries)) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(ZipError)
    expect((caught as Error).message).toMatch(/ZIP64 extra field that is too short/)
    // ...and a record that runs past the end of the file is a ZipError too (never a bare RangeError).
    const cut = craft(note())
    cut.writeUInt16LE(0xffff, cut.length - 22 + 20)
    expect(() => readZip(cut)).toThrow(ZipError)
    const half = craft(note()).subarray(0, 40)
    expect(() => readZip(half)).toThrow(ZipError)
  })

  it("a ZIP64 extra field that holds what it says is read (the sizes come from it)", () => {
    const entries = note()
    const target = entries.find((entry) => entry.name === "note.mdwm")!
    const extra = Buffer.concat([u16(1), u16(16), u64(target.data.length), u64(deflateRawSync(target.data).length)])
    const bytes = craft(entries.map((entry) => (entry === target ? { ...entry, central: { size: 0xffffffff, compressedSize: 0xffffffff, extra } } : entry)))
    expect(Buffer.from(openWm(readZip(bytes)).entries.find((entry) => entry.name === "note.mdwm")!.data).toString("utf8")).toBe("# T\n")
  })
})

describe("24. the ZIP64 end record (directoryPlace)", () => {
  const sound = (extra: Craft["zip64"] = {}): Buffer => craft(note("# Sixty-four\n"), { zip64: extra })

  it("is read through its locator: the entries, the directory's place and size come from the ZIP64 record", () => {
    const bytes = sound()
    const place = directoryPlace(bytes.subarray(Math.max(0, bytes.length - 65_557)), 0, (offset, length) => bytes.subarray(offset, offset + length))
    expect(place.count).toBe(3)
    expect(Buffer.from(openWm(readZip(bytes)).entries.find((entry) => entry.name === "note.mdwm")!.data).toString("utf8")).toBe("# Sixty-four\n")
  })

  it("is refused when the locator is missing, the record is not one, the disk is not the only one, or the record is out of the file", () => {
    expect(() => readZip(sound({ locator: false }))).toThrow(/no ZIP64 locator/)
    expect(() => readZip(sound({ signature: 0x12345678 }))).toThrow(/damaged ZIP64 end record/)
    expect(() => readZip(sound({ disk: 2 }))).toThrow(/multi-disk/)
    expect(() => readZip(sound({ recordAt: 1 << 30 }))).toThrow(/damaged ZIP64 end record/)
  })
})

describe("vector 5 and 2(c) at the store: a refused file is never touched, and nothing is created beside it", () => {
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

  it("every hostile name (../x, /abs, a\\b, C:/x, media/../../x, a//b, a name twice) is refused on reading, writing is refused, the file is the same bytes and the folder holds nothing else", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wm-hostile-"))
    const names = ["../x", "/abs", "a\\b", "C:/x", "media/../../x", "a//b"]
    for (const [at, name] of names.entries()) {
      const file = path.join(dir, `Hostile ${at}.wm`)
      writeFileSync(file, craft([...note(), { name, data: Buffer.from("payload") }]))
      const before = sha(file)
      await expect(readText(file), name).rejects.toThrow(/cannot be opened as a WriteMind note/)
      expect((await writeText(file, "typed over it")).written, name).toBe(false)
      expect(sha(file), name).toBe(before)
    }
    const twice = path.join(dir, "Twice.wm")
    writeFileSync(twice, craft([...note(), { name: "media/a.png", data: Buffer.from("1") }, { name: "media/a.png", data: Buffer.from("2") }]))
    const was = sha(twice)
    await expect(readText(twice)).rejects.toThrow(/twice/)
    expect((await writeText(twice, "x")).written).toBe(false)
    expect(sha(twice)).toBe(was)
    expect(readdirSync(dir).sort()).toEqual([...names.map((_, at) => `Hostile ${at}.wm`), "Twice.wm"].sort())
  })

  it("a manifest whose format is not ours (vector 2c) is refused and untouched; a case twin opens read-only and is never written", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wm-epub-"))
    const epub = path.join(dir, "Epub.wm")
    writeFileSync(epub, craft(note().map((entry) => (entry.name === "manifest.json" ? { ...entry, data: Buffer.from(JSON.stringify({ format: "epub", version: 1 })) } : entry))))
    const before = sha(epub)
    await expect(readText(epub)).rejects.toThrow(/not a WriteMind note/)
    expect((await writeText(epub, "x")).written).toBe(false)
    expect(sha(epub)).toBe(before)
    const twins = path.join(dir, "Twins.wm")
    writeFileSync(twins, craft([...note(), { name: "media/A.png", data: Buffer.from("1") }, { name: "media/a.png", data: Buffer.from("2") }]))
    const twinBytes = sha(twins)
    expect(await readText(twins)).toBe("# T\n")
    expect(await writeText(twins, "typed")).toMatchObject({ written: false, refused: "unwritable" })
    expect(sha(twins)).toBe(twinBytes)
    expect(readdirSync(dir).sort()).toEqual(["Epub.wm", "Twins.wm"])
  })
})

function deflateOrStore(entry: Raw): Buffer {
  return (entry.method ?? (entry.name === "mimetype" ? 0 : 8)) === 0 ? entry.data : deflateRawSync(entry.data)
}
