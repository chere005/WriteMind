/**
 * The first bytes of one entry of an archive, without reading the file (docs/SPEC-WM.md 1.6's note): the sidebar needs
 * a note's title and snippet, which come from the first 8 KiB of `note.mdwm`, and a folder holds hundreds of notes.
 * The end record, the central directory and one inflate are all it takes.
 */

import { promises as fs } from "node:fs"
import { constants as zlibConstants, inflateRawSync } from "node:zlib"
import { directoryPlace, parseDirectory } from "./zip"

const SIG_LOCAL = 0x04034b50

/**
 * The first `limit` bytes of the entry `name` of the archive at `file`, and the entry's whole size. Null when the file
 * has no such entry or is not an archive this can read (the caller then shows the file's name).
 */
export async function readEntryHead(file: string, name: string, limit: number): Promise<{ head: Buffer; size: number } | null> {
  const handle = await fs.open(file, "r")
  try {
    const total = (await handle.stat()).size
    const readAt = async (offset: number, length: number): Promise<Buffer> => {
      const buffer = Buffer.alloc(Math.max(0, Math.min(length, total - offset)))
      if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, offset)
      return buffer
    }
    const tailStart = Math.max(0, total - (65_535 + 22))
    const tail = await readAt(tailStart, total - tailStart)
    // (A ZIP64 end record is only in a note over 4 GiB: the sidebar does not read those for a title.)
    const place = directoryPlace(tail, tailStart, () => { throw new Error("ZIP64") })
    const directory = await readAt(place.offset, place.size)
    const entry = parseDirectory(directory, place.count).find((one) => one.name === name)
    if (!entry) return null
    const header = await readAt(entry.offset, 30)
    if (header.length < 30 || header.readUInt32LE(0) !== SIG_LOCAL) return null
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    const want = Math.min(limit, entry.size)
    if (entry.method === 0) return { head: await readAt(start, want), size: entry.size }
    // Deflated: read a little more compressed data until that much has come out (a truncated stream gives what it has).
    let chunk = Math.max(16_384, want)
    for (;;) {
      const take = Math.min(chunk, entry.compressedSize)
      const compressed = await readAt(start, take)
      const out = inflateRawSync(compressed, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
      if (out.length >= want || take >= entry.compressedSize) return { head: out.subarray(0, want), size: entry.size }
      chunk *= 4
    }
  } finally {
    await handle.close()
  }
}
