import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createNow, diskPorts, partialOf, writeNow, type WritePorts } from "../src/main/atomic"

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-atomicw-"))

/** The disk's ports with every call written down, in order. */
function recording(log: string[], over: Partial<WritePorts> = {}): WritePorts {
  return {
    access: async (file) => { log.push("access"); return diskPorts.access(file) },
    async create(file) {
      log.push("create")
      const temp = await diskPorts.create(file)
      return {
        write: async (parts) => { log.push("write"); await temp.write(parts) },
        sync: async () => { log.push("fsync temp"); await temp.sync() },
        close: async () => { log.push("close"); await temp.close() },
      }
    },
    rename: async (from, to) => { log.push("rename"); await diskPorts.rename(from, to) },
    syncFolder: async (folder) => { log.push("fsync folder"); await diskPorts.syncFolder(folder) },
    remove: async (file) => { log.push("remove temp"); await diskPorts.remove(file) },
    sleep: async () => undefined,
    ...over,
  }
}

describe("vector 6 (d): the order of calls for one save", () => {
  it("is: write the temporary file, flush it, guard, rename, flush the folder", async () => {
    const dir = scratch()
    const file = path.join(dir, "Note.wm")
    writeFileSync(file, "old")
    const log: string[] = []
    const wrote = await writeNow(file, [Buffer.from("new")], {
      durable: true, ports: recording(log),
      guard: async () => { log.push("guard"); return true },
    })
    expect(wrote).toBe(true)
    // (The guard is also asked once before the first byte, so that a refusal costs no work.)
    expect(log).toEqual(["access", "guard", "create", "write", "fsync temp", "close", "guard", "rename", "fsync folder"])
    expect(readFileSync(file, "utf8")).toBe("new")
    expect(readdirSync(dir)).toEqual(["Note.wm"])
  })

  it("does not flush anything for a write that is not durable (a session file written five times a second)", async () => {
    const dir = scratch()
    const log: string[] = []
    await writeNow(path.join(dir, "s.json"), "{}", { ports: recording(log) })
    expect(log).not.toContain("fsync temp")
    expect(log).not.toContain("fsync folder")
  })
})

describe("vector 6 (a), (b), (c): the target is whole, or as it was", () => {
  it("(a) a write that stops after the temporary file is written and before the rename leaves the target byte for byte as it was, and the .tmp is the only other file", async () => {
    const dir = scratch()
    const file = path.join(dir, "Note.wm")
    writeFileSync(file, "the old note")
    const dies = new Error("killed")
    const log: string[] = []
    await expect(writeNow(file, [Buffer.from("the new note")], {
      durable: true,
      ports: recording(log, { rename: async () => { throw dies } }),
    })).rejects.toBe(dies)
    expect(readFileSync(file, "utf8")).toBe("the old note")
    // (Taken away by the failure; a real kill leaves `Note.wm.tmp`, which is never listed as a note: see notes.test.ts.)
    expect(readdirSync(dir)).toEqual(["Note.wm"])
    expect(partialOf(file)).toBe(`${file}.tmp`)
  })

  it("(b) a guard that says no, immediately before the rename, writes nothing and takes the .tmp away", async () => {
    const dir = scratch()
    const file = path.join(dir, "Note.wm")
    writeFileSync(file, "mine")
    let asked = 0
    const log: string[] = []
    const wrote = await writeNow(file, [Buffer.from("ours")], {
      durable: true, ports: recording(log),
      // Yes the first time (before any work), no the second (somebody changed the file while the temporary file was written).
      guard: async () => ++asked === 1,
    })
    expect(wrote).toBe(false)
    expect(log).not.toContain("rename")
    expect(readFileSync(file, "utf8")).toBe("mine")
    expect(readdirSync(dir)).toEqual(["Note.wm"])
  })

  it("a guard that says no at once costs no work at all", async () => {
    const dir = scratch()
    const file = path.join(dir, "Note.wm")
    const log: string[] = []
    expect(await writeNow(file, "x", { ports: recording(log), guard: async () => false })).toBe(false)
    expect(log).toEqual(["access"])
    expect(readdirSync(dir)).toEqual([])
  })

  it("retries a rename that is refused for a moment (an antivirus, a sync client) and gives up on any other error", async () => {
    const dir = scratch()
    const file = path.join(dir, "Note.wm")
    let busy = 2
    await writeNow(file, "ok", {
      ports: recording([], {
        rename: async (from, to) => {
          if (busy-- > 0) throw Object.assign(new Error("busy"), { code: "EBUSY" })
          await diskPorts.rename(from, to)
        },
      }),
    })
    expect(readFileSync(file, "utf8")).toBe("ok")
    await expect(writeNow(file, "no", {
      ports: recording([], { rename: async () => { throw Object.assign(new Error("full"), { code: "ENOSPC" }) } }),
    })).rejects.toMatchObject({ code: "ENOSPC" })
    expect(readFileSync(file, "utf8")).toBe("ok")
    expect(readdirSync(dir)).toEqual(["Note.wm"])
  })
})

describe("a new file is never put over one that is there", () => {
  it("links the temporary file to the name, flushes, and says EEXIST when the name is taken", async () => {
    const dir = scratch()
    const file = path.join(dir, "New.wm")
    await createNow(file, [Buffer.from("first")])
    expect(readFileSync(file, "utf8")).toBe("first")
    expect(readdirSync(dir)).toEqual(["New.wm"])
    await expect(createNow(file, [Buffer.from("second")])).rejects.toMatchObject({ code: "EEXIST" })
    expect(readFileSync(file, "utf8")).toBe("first")
    expect(readdirSync(dir)).toEqual(["New.wm"])
  })
})
