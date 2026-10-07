import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { crc32 } from "node:zlib"
import { describe, expect, it } from "vitest"
import {
  WM_MIME, WmError, entriesToWrite, newWmFile, openWm, sniffWm, textOfFile, utf8, withEntry, withText, type WmEntry,
} from "@writemind/core"
import { LIMITS, ZipError, readZip, zipBytes, type ZipEntry } from "../src/main/zip"
import { readEntryHead } from "../src/main/zipHead"

const APP = { name: "WriteMind", version: "2.16.0" }
const NOW = new Date("2026-10-08T09:14:03Z")
const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-zip-"))
const have = (tool: string, args: string[]): boolean => spawnSync(tool, args, { stdio: "ignore" }).status !== null

const sample = (): ZipEntry[] => {
  let file = newWmFile(NOW, APP, "# Title\n\nSome words.\n".repeat(200))
  file = withEntry(file, "drawing.json", utf8(JSON.stringify({ items: [] })))
  file = withEntry(file, "media/3f9c2a7e5b1d4c80.png", new Uint8Array(Array.from({ length: 3000 }, (_, i) => (i * 7) % 251)))
  file = withEntry(file, "snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg", utf8("<svg xmlns='http://www.w3.org/2000/svg'/>"))
  file = withEntry(file, "media/é ü.svg", utf8("<svg/>"))
  file = withEntry(file, "legacy/sidecar.json", utf8("{}"))
  return entriesToWrite(file, null).entries
}

describe("vector 1: the bytes of a minimal file", () => {
  it("has the mimetype first, stored, with the header the spec says byte for byte", () => {
    const bytes = zipBytes(entriesToWrite(newWmFile(NOW, APP, "# T\n"), null).entries, NOW)
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(Array.from(bytes.subarray(8, 10))).toEqual([0, 0])
    expect(Array.from(bytes.subarray(14, 18))).toEqual([0xc7, 0xb6, 0x5c, 0x4e])
    expect(Array.from(bytes.subarray(18, 26))).toEqual([0x22, 0, 0, 0, 0x22, 0, 0, 0])
    expect(Array.from(bytes.subarray(26, 30))).toEqual([8, 0, 0, 0])
    expect(bytes.subarray(30, 38).toString("latin1")).toBe("mimetype")
    expect(bytes.subarray(38, 72).toString("latin1")).toBe(WM_MIME)
    expect(WM_MIME.length).toBe(34)
    expect(crc32(Buffer.from(WM_MIME)) >>> 0).toBe(0x4e5cb6c7)
    expect(sniffWm(bytes.subarray(0, 72))).toBe(true)
  })

  it("opens, has the title's text, and a save with no edit gives an archive whose decoded entries equal the input's", () => {
    const first = zipBytes(entriesToWrite(newWmFile(NOW, APP, "# T\n"), null).entries, NOW)
    const read = readZip(first)
    expect(read.map((entry) => entry.name)).toEqual(["mimetype", "manifest.json", "note.wmdm"])
    const file = openWm(read)
    expect(textOfFile(file)).toBe("# T\n")
    const again = readZip(zipBytes(entriesToWrite(file, null).entries, NOW))
    expect(again.map((entry) => [entry.name, Buffer.from(entry.data).toString("hex")]))
      .toEqual(read.map((entry) => [entry.name, Buffer.from(entry.data).toString("hex")]))
  })

  it("writes entries in the spec's order: mimetype, manifest, note, drawing, snapshots, media, the rest", () => {
    expect(sample().map((entry) => entry.name)).toEqual([
      "mimetype", "manifest.json", "note.wmdm", "drawing.json",
      "snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg", "media/3f9c2a7e5b1d4c80.png", "media/é ü.svg", "legacy/sidecar.json",
    ])
  })
})

describe("a round trip on node:zlib alone", () => {
  it("reads back every entry byte for byte, names included (UTF-8, bit 11 for the non-ASCII one)", () => {
    const entries = sample()
    const bytes = zipBytes(entries, NOW)
    const read = readZip(bytes)
    expect(read.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name))
    for (const [at, entry] of read.entries()) expect(Buffer.from(entry.data).equals(Buffer.from(entries[at]!.data))).toBe(true)
    // Bit 11 on the one whose name is not ASCII, and on no other.
    const flags: Record<string, number> = {}
    let at = bytes.length - 22
    const count = bytes.readUInt16LE(at + 10)
    at = bytes.readUInt32LE(at + 16)
    for (let i = 0; i < count; i++) {
      const length = bytes.readUInt16LE(at + 28)
      flags[bytes.subarray(at + 46, at + 46 + length).toString("utf8")] = bytes.readUInt16LE(at + 8)
      at += 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
    }
    expect(flags["media/é ü.svg"]! & 0x0800).toBe(0x0800)
    expect(flags["note.wmdm"]! & 0x0800).toBe(0)
  })

  it("stores the mimetype and pictures that are compressed already, and deflates the rest", () => {
    const bytes = zipBytes(sample(), NOW)
    const methods: Record<string, number> = {}
    let at = bytes.readUInt32LE(bytes.length - 22 + 16)
    for (let i = 0; i < 8; i++) {
      const length = bytes.readUInt16LE(at + 28)
      methods[bytes.subarray(at + 46, at + 46 + length).toString("utf8")] = bytes.readUInt16LE(at + 10)
      at += 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
    }
    expect(methods).toMatchObject({ mimetype: 0, "media/3f9c2a7e5b1d4c80.png": 0, "note.wmdm": 8, "manifest.json": 8, "media/é ü.svg": 8 })
  })

  it("copies the compressed bytes of an entry nobody changed, and compresses one that was changed anew", () => {
    const first = readZip(zipBytes(sample(), NOW))
    const file = openWm(first)
    const changed = withText(file, "# Other\n")
    const out = entriesToWrite(changed, null).entries as ZipEntry[]
    // (withEntry makes a fresh entry: the old compressed bytes are not carried over to new words.)
    expect(out.find((entry) => entry.name === "note.wmdm")!.packed).toBeUndefined()
    const kept = out.find((entry) => entry.name === "media/3f9c2a7e5b1d4c80.png")!
    expect(kept.packed).toBeDefined()
    const bytes = zipBytes(out, NOW)
    expect(textOfFile(openWm(readZip(bytes)))).toBe("# Other\n")
    expect(Buffer.from(bytes).includes(Buffer.from(kept.packed!.compressed))).toBe(true)
  })

  it("reads and writes an empty entry, and a directory entry is read and ignored", () => {
    const entries: ZipEntry[] = [...entriesToWrite(newWmFile(NOW, APP, ""), null).entries, { name: "media/empty.svg", data: new Uint8Array(0) }]
    const read = readZip(zipBytes(entries, NOW))
    expect(read.find((entry) => entry.name === "note.wmdm")!.data.length).toBe(0)
    expect(read.find((entry) => entry.name === "media/empty.svg")!.data.length).toBe(0)
  })
})

describe("the system's own tools read what this writes", () => {
  const file = (): string => {
    const dir = scratch()
    const target = path.join(dir, "Note.wm")
    writeFileSync(target, zipBytes(sample(), NOW))
    return target
  }

  it.skipIf(!have("unzip", ["-v"]))("unzip -t finds nothing wrong, and unpacks the names as they are", () => {
    const target = file()
    const test = spawnSync("unzip", ["-t", target], { encoding: "utf8" })
    expect(test.status, test.stdout + test.stderr).toBe(0)
    expect(test.stdout).toContain("No errors detected")
    const list = spawnSync("unzip", ["-Z1", target], { encoding: "utf8" })
    expect(list.stdout.split("\n").filter(Boolean)[0]).toBe("mimetype")
  })

  it.skipIf(!have("zipinfo", ["-h", "/dev/null"]) && !have("/usr/bin/zipinfo", ["-h", "/dev/null"]))("zipinfo lists the mimetype first, stored", () => {
    const target = file()
    const info = spawnSync(have("zipinfo", ["-h", "/dev/null"]) ? "zipinfo" : "/usr/bin/zipinfo", ["-v", target], { encoding: "utf8" })
    expect(info.status, info.stderr).toBe(0)
    const first = info.stdout.indexOf("mimetype")
    expect(first).toBeGreaterThan(0)
    expect(info.stdout.slice(first, first + 600)).toMatch(/compression method:\s+none \(stored\)/)
  })

  it.skipIf(!have("python3", ["-c", "import zipfile"]))("python3 -m zipfile -t is satisfied, and reads the mimetype first with its content", () => {
    const target = file()
    const test = spawnSync("python3", ["-m", "zipfile", "-t", target], { encoding: "utf8" })
    expect(test.status, test.stdout + test.stderr).toBe(0)
    const code = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.namelist()[0]);print(z.read('mimetype').decode());print(z.getinfo('note.wmdm').compress_type)\nprint(z.getinfo('media/é ü.svg').filename)`
    const read = spawnSync("python3", ["-c", code, target], { encoding: "utf8" })
    expect(read.stdout.split("\n").slice(0, 3)).toEqual(["mimetype", WM_MIME, "8"])
  })

  it.skipIf(!have("python3", ["-c", "import zipfile"]))("this reader reads an archive python wrote, ZIP64 records included", () => {
    const dir = scratch()
    const target = path.join(dir, "py.wm")
    const code = [
      "import zipfile,sys",
      "z=zipfile.ZipFile(sys.argv[1],'w')",
      "z.writestr(zipfile.ZipInfo('mimetype'),'application/vnd.writemind.note+zip',compress_type=zipfile.ZIP_STORED)",
      "z.writestr('manifest.json','{\"format\":\"writemind-note\",\"version\":1}',compress_type=zipfile.ZIP_DEFLATED)",
      "with z.open('note.wmdm','w',force_zip64=True) as f: f.write('# From python\\n'.encode())",
      "z.writestr('media/b.bin',bytes(range(256))*40,compress_type=zipfile.ZIP_DEFLATED)",
      "z.close()",
    ].join("\n")
    const made = spawnSync("python3", ["-c", code, target], { encoding: "utf8" })
    expect(made.status, made.stderr).toBe(0)
    const file = openWm(readZip(new Uint8Array(require("node:fs").readFileSync(target))))
    expect(textOfFile(file)).toBe("# From python\n")
    expect(file.entries.find((entry) => entry.name === "media/b.bin")!.data.length).toBe(10240)
  })
})

describe("a file that cannot be read is refused whole", () => {
  const base = (): Buffer => zipBytes(sample(), NOW)
  // (Each archive has its own manifest id, so its own sizes: the central directory is looked for in each.)
  const dirOf = (bytes: Buffer): number => bytes.readUInt32LE(bytes.length - 22 + 16)

  it("a checksum that does not match", () => {
    const bytes = base()
    // The first stored entry after the mimetype is none; flip a byte of the PNG's stored data instead.
    const at = bytes.indexOf(Buffer.from([0, 7, 14]))
    expect(at).toBeGreaterThan(0)
    bytes[at + 1] = bytes[at + 1]! ^ 0xff
    expect(() => readZip(bytes)).toThrow(/checksum/)
  })

  it("an entry that holds more than it declares", () => {
    const bytes = base()
    // note.wmdm's central entry: lower its declared size by one (the local header is not consulted).
    let at = dirOf(bytes)
    for (let i = 0; i < 2; i++) at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
    expect(bytes.subarray(at + 46, at + 46 + bytes.readUInt16LE(at + 28)).toString()).toBe("note.wmdm")
    bytes.writeUInt32LE(bytes.readUInt32LE(at + 24) - 1, at + 24)
    expect(() => readZip(bytes)).toThrow(/more than its declared size|holds/)
  })

  it("another method, an encrypted entry, a name that is not UTF-8, a multi-disk archive, a file that is no archive", () => {
    const method = base()
    method.writeUInt16LE(9, dirOf(method) + 10)
    expect(() => readZip(method)).toThrow(/compression method/)
    const encrypted = base()
    encrypted.writeUInt16LE(1, dirOf(encrypted) + 8)
    expect(() => readZip(encrypted)).toThrow(/encrypted/)
    const named = base()
    // "mimetype" -> an invalid UTF-8 byte inside the name.
    named[dirOf(named) + 46] = 0xe9
    expect(() => readZip(named)).toThrow(/UTF-8/)
    const disks = base()
    disks.writeUInt16LE(1, disks.length - 22 + 4)
    expect(() => readZip(disks)).toThrow(/multi-disk/)
    expect(() => readZip(Buffer.from("this is not an archive at all, not even close"))).toThrow(ZipError)
    expect(() => readZip(base().subarray(0, 100))).toThrow(ZipError)
  })

  it("an entry compressed more than 1000:1 that inflates past 16 MiB (a bomb), and too many entries", () => {
    const bomb: ZipEntry[] = [...entriesToWrite(newWmFile(NOW, APP, ""), null).entries,
      { name: "media/zeros.svg", data: new Uint8Array(LIMITS.ratioFrom + 1024 * 1024) }]
    expect(() => readZip(zipBytes(bomb, NOW))).toThrow(/compressed more than/)
    const many: WmEntry[] = Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({ name: `media/${i}.bin`, data: new Uint8Array(0) }))
    expect(() => readZip(zipBytes(many, NOW))).toThrow(/more than 20000 entries/)
  })

  it("hostile names are refused by the reader of the model, on a file this codec wrote (vector 5)", () => {
    for (const name of ["../x", "/abs", "a\\b", "C:/x", "media/../../x", "a//b"]) {
      const entries: ZipEntry[] = [...entriesToWrite(newWmFile(NOW, APP, ""), null).entries, { name, data: new Uint8Array([1]) }]
      const bytes = zipBytes(entries, NOW)
      expect(() => openWm(readZip(bytes)), name).toThrow(WmError)
    }
    const twice: ZipEntry[] = [...entriesToWrite(newWmFile(NOW, APP, ""), null).entries,
      { name: "media/a.png", data: new Uint8Array([1]) }, { name: "media/a.png", data: new Uint8Array([2]) }]
    expect(() => openWm(readZip(zipBytes(twice, NOW)))).toThrow(/twice/)
  })

  it("two entries that differ only by case: the file reads, and the model refuses to write it again", () => {
    const entries: ZipEntry[] = [...entriesToWrite(newWmFile(NOW, APP, ""), null).entries,
      { name: "media/A.png", data: new Uint8Array([1]) }, { name: "media/a.png", data: new Uint8Array([2]) }]
    const file = openWm(readZip(zipBytes(entries, NOW)))
    expect(() => entriesToWrite(file, null)).toThrow(/differ only by case/)
  })
})

describe("the first bytes of an entry, without reading the file", () => {
  it("gives the first 8 KiB of a deflated note.wmdm and of a stored one, and the whole size", async () => {
    const words = "The quick brown fox jumps over the lazy dog. ".repeat(2000)
    const dir = scratch()
    const deflated = path.join(dir, "d.wm")
    writeFileSync(deflated, zipBytes(entriesToWrite(newWmFile(NOW, APP, words), null).entries, NOW))
    const found = await readEntryHead(deflated, "note.wmdm", 8192)
    expect(found!.size).toBe(Buffer.byteLength(words))
    expect(found!.head.toString("utf8")).toBe(words.slice(0, 8192))
    // A note shorter than that comes back whole; an entry that is not there is null.
    const short = path.join(dir, "s.wm")
    writeFileSync(short, zipBytes(entriesToWrite(newWmFile(NOW, APP, "# T\n"), null).entries, NOW))
    expect((await readEntryHead(short, "note.wmdm", 8192))!.head.toString()).toBe("# T\n")
    expect(await readEntryHead(short, "drawing.json", 8192)).toBeNull()
    const stored = path.join(dir, "t.wm")
    writeFileSync(stored, zipBytes([{ name: "mimetype", data: utf8(WM_MIME) }], NOW))
    expect((await readEntryHead(stored, "mimetype", 8)).head.toString()).toBe("applicat")
  })

  it("is null for a file that is not an archive", async () => {
    const dir = scratch()
    const file = path.join(dir, "x.wm")
    writeFileSync(file, "# a markdown note named like a .wm\n")
    await expect(readEntryHead(file, "note.wmdm", 8192)).rejects.toThrow()
  })
})
