import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { Words } from "../src/main/helpers"
import { OcrService } from "../src/main/ocr"

/**
 * The queue / cache / cancel that keep the reader from ever making the app wait (main/ocr.ts), against a stand-in
 * reader so the rules run anywhere. The reader itself (the bundled one) is bundledOcr.test.ts and oneReader.test.ts.
 */
const aborted = (): Error => Object.assign(new Error("cancelled"), { name: "AbortError" })

describe("the service in front of the reader", () => {
  const picture = (n: number): Uint8Array => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n])
  const words = (text: string): Words => ({ lines: [{ text, confidence: 1 }] })

  /** A reader that answers when told to, and notices being stopped. */
  function slowReader() {
    const calls: { file: string; stopped: boolean; finish(): void }[] = []
    const read = (file: string, options: { signal?: AbortSignal }) => new Promise<Words>((resolve, reject) => {
      const call = { file, stopped: false, finish: () => resolve(words("read")) }
      calls.push(call)
      options.signal?.addEventListener("abort", () => { call.stopped = true; reject(aborted()) }, { once: true })
    })
    return { calls, read }
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
  /**
   * Wait until `ready()` holds (or give up after 3 s and let the expect say what is wrong). A request writes its
   * picture to a temporary file before the engine is asked, and on CI's runner that write can take longer than a
   * fixed tick: waiting for the thing itself keeps the test about order, not about the disk's speed.
   */
  const until = async (ready: () => boolean) => {
    for (let waited = 0; waited < 3000 && !ready(); waited += 10) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  it("reads a picture once however many times it is asked (the key is what is IN it)", async () => {
    let reads = 0
    const service = new OcrService(async () => { reads += 1; return words("hello") })
    const [a, b] = await Promise.all([
      service.request({ id: "1", source: { bytes: picture(1) } }),
      service.request({ id: "2", source: { bytes: picture(1) } }),
    ])
    expect(a.lines[0]!.text).toBe("hello")
    expect(b).toEqual(a)
    await service.request({ id: "3", source: { bytes: picture(1) } })
    expect(reads).toBe(1)
    await service.request({ id: "4", source: { bytes: picture(2) } })
    expect(reads).toBe(2)
    // The language asked for is part of the question.
    await service.request({ id: "5", source: { bytes: picture(1) }, languages: ["ja"] })
    expect(reads).toBe(3)
  })

  it("gives the reader a real file for bytes, and takes it away again", async () => {
    let seen = ""
    const folder = mkdtempSync(path.join(os.tmpdir(), "wm-ocr-test-"))
    const service = new OcrService(async (file) => { seen = file; return words("x") }, folder)
    await service.request({ id: "1", source: { bytes: picture(7) } })
    expect(seen.startsWith(folder)).toBe(true)
    expect(seen.endsWith(".png")).toBe(true)
    const { existsSync } = await import("node:fs")
    expect(existsSync(seen)).toBe(false)
  })

  it("stops the engine when the only asker takes the request back", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const asked = service.request({ id: "a", source: { bytes: picture(1) } })
    const caught = asked.catch((error: Error) => error.name)
    await until(() => calls.length >= 1)
    expect(calls).toHaveLength(1)
    service.cancel("a")
    expect(await caught).toBe("AbortError")
    await until(() => calls[0]!.stopped)
    expect(calls[0]!.stopped).toBe(true)
    // …and asking again starts a fresh read rather than inheriting the dead one.
    const again = service.request({ id: "b", source: { bytes: picture(1) } })
    await until(() => calls.length >= 2)
    expect(calls).toHaveLength(2)
    calls[1]!.finish()
    expect((await again).lines[0]!.text).toBe("read")
  })

  it("keeps the engine running while someone else still wants the same picture", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const first = service.request({ id: "a", source: { bytes: picture(1) } }).catch((error: Error) => error.name)
    const second = service.request({ id: "b", source: { bytes: picture(1) } })
    await until(() => calls.length >= 1)
    service.cancel("a")
    expect(await first).toBe("AbortError")
    expect(calls[0]!.stopped).toBe(false)
    calls[0]!.finish()
    expect((await second).lines[0]!.text).toBe("read")
  })

  it("a cancel that comes before the engine starts is not lost", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const asked = service.request({ id: "a", source: { bytes: picture(3) } }).catch((error: Error) => error.name)
    service.cancel("a")
    expect(await asked).toBe("AbortError")
    await tick()
    expect(calls).toHaveLength(0)
  })

  it("runs two engines at once and no more; a queued request can be taken back without ever running", async () => {
    const { calls, read } = slowReader()
    const service = new OcrService(read)
    const results = [1, 2, 3].map((n) => service.request({ id: String(n), source: { bytes: picture(n) } }).catch((error: Error) => error.name))
    await until(() => calls.length >= 2)
    await tick()
    expect(calls).toHaveLength(2)
    expect(service.busy).toBe(3)
    service.cancel("3")
    expect(await results[2]).toBe("AbortError")
    calls[0]!.finish()
    calls[1]!.finish()
    await Promise.all(results.slice(0, 2))
    await tick()
    expect(calls).toHaveLength(2)
    expect(service.busy).toBe(0)
  })

  it("does not remember a failure", async () => {
    let n = 0
    const service = new OcrService(async () => { n += 1; if (n === 1) throw new Error("engine fell over"); return words("ok") })
    await expect(service.request({ id: "a", source: { bytes: picture(9) } })).rejects.toThrow("engine fell over")
    expect((await service.request({ id: "b", source: { bytes: picture(9) } })).lines[0]!.text).toBe("ok")
  })
})
