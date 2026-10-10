// The Mac's hot exit in the window (renderer/hotExit.ts): text that was typed and never written is never dropped. What the
// file refuses, what has no note to go into, and what cannot be copied beside it is kept as a Recovered copy.
import { describe, expect, it } from "vitest"
import { textFingerprint } from "@writemind/core"
import { applyBuffers, keepDropped, type HotExitApi } from "../src/renderer/hotExit"

function fake(over: Partial<HotExitApi> & { disk?: Record<string, string> } = {}) {
  const disk: Record<string, string> = { ...(over.disk ?? {}) }
  const rescued: { file: string; text: string }[] = []
  const written: { file: string; text: string }[] = []
  const api: HotExitApi = {
    readNote: async (file) => { if (file in disk) return disk[file]!; throw new Error("ENOENT") },
    writeNote: async (file, text) => { written.push({ file, text }); return { written: true } },
    existing: async (files) => files.filter((file) => file in disk),
    rescue: async (file, text) => { rescued.push({ file, text }); return `/recovered/${file}` },
    ...over,
  }
  return { api, rescued, written }
}

describe("applyBuffers", () => {
  it("puts the text back into the file it is an edit of", async () => {
    const { api, written, rescued } = fake({ disk: { "/n/A.wm": "old" } })
    const applied = await applyBuffers({ "/n/A.wm": { text: "old, and more", base: textFingerprint("old") } }, api)
    expect([...applied]).toEqual([["/n/A.wm", "old, and more"]])
    expect(written).toEqual([{ file: "/n/A.wm", text: "old, and more" }])
    expect(rescued).toEqual([])
  })

  it("keeps the text as a Recovered copy when the file REFUSES it (a newer WriteMind's note, read-only, a full disk, changed under us)", async () => {
    const { api, rescued } = fake({ disk: { "/n/Newer.wm": "old" }, writeNote: async () => ({ written: false }) })
    const applied = await applyBuffers({ "/n/Newer.wm": { text: "typed in a note that is read-only here", base: null } }, api)
    expect(applied.size).toBe(0)
    expect(rescued).toEqual([{ file: "/n/Newer.wm", text: "typed in a note that is read-only here" }])
    // ...and when the write throws
    const throwing = fake({ disk: { "/n/Full.wm": "old" }, writeNote: async () => { throw new Error("ENOSPC") } })
    await applyBuffers({ "/n/Full.wm": { text: "disk full", base: null } }, throwing.api)
    expect(throwing.rescued).toEqual([{ file: "/n/Full.wm", text: "disk full" }])
  })

  it("keeps the text of a file that has moved on beside it, and in Recovered when even that copy is refused", async () => {
    const copy = fake({ disk: { "/n/A.wm": "somebody else's words" } })
    await applyBuffers({ "/n/A.wm": { text: "mine", base: textFingerprint("what I started from") } }, copy.api)
    expect(copy.written).toEqual([{ file: "/n/A (unsaved copy).wm", text: "mine" }])
    expect(copy.rescued).toEqual([])
    const refused = fake({ disk: { "/n/A.wm": "somebody else's words" }, writeNote: async () => ({ written: false }) })
    await applyBuffers({ "/n/A.wm": { text: "mine", base: textFingerprint("what I started from") } }, refused.api)
    expect(refused.rescued).toEqual([{ file: "/n/A.wm", text: "mine" }])
  })

  it("keeps the text of a note that cannot be read at all (gone, or no longer a note), and nothing of a note that already has it", async () => {
    const { api, rescued } = fake({ disk: { "/n/Same.wm": "same words" } })
    await applyBuffers({
      "/n/Gone.wm": { text: "typed, and the file was deleted", base: null },
      "/n/Same.wm": { text: "same words", base: null },
    }, api)
    expect(rescued).toEqual([{ file: "/n/Gone.wm", text: "typed, and the file was deleted" }])
  })
})

describe("keepDropped", () => {
  it("keeps the text of a note that is not a note of the project any more (a .md left as it was, a .txt) before the session drops it", async () => {
    const { api, rescued } = fake()
    const buffers = {
      "/n/Left.md": { text: "typed in a note that could not be converted", base: null },
      "/n/Plain.txt": { text: "typed in a text file", base: null },
      "/n/Here.wm": { text: "a note that is still there", base: null },
    }
    const kept = await keepDropped(buffers, (path) => path === "/n/Here.wm", api)
    expect(kept).toEqual(["/n/Left.md", "/n/Plain.txt"])
    expect(rescued.map((one) => one.file)).toEqual(["/n/Left.md", "/n/Plain.txt"])
    expect(rescued[0]!.text).toBe("typed in a note that could not be converted")
  })
})
