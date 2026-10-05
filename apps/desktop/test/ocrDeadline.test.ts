import { afterEach, describe, expect, it, vi } from "vitest"

/** A reader that never answers must not hold a capture for the main process's own minute. */
describe("the reader's deadline (ocrClient ask)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

  it("a read that never answers is taken back after the deadline and gives no reading", async () => {
    vi.useFakeTimers()
    const cancelled: string[] = []
    vi.stubGlobal("window", {
      wm: {
        ocrRead: (request: { id: string }) => new Promise((_resolve, reject) => {
          // The main process rejects a request that was cancelled.
          const poll = setInterval(() => { if (cancelled.includes(request.id)) { clearInterval(poll); reject(new Error("cancelled")) } }, 50)
        }),
        ocrCancel: (id: string) => { cancelled.push(id); return Promise.resolve() },
      },
    })
    const { ask, CAPTURE_READ_DEADLINE_MS } = await import("../src/renderer/ocrClient")
    const pending = ask({ bytes: new Uint8Array([1]) }, undefined, CAPTURE_READ_DEADLINE_MS)
    let settled = false
    void pending.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(CAPTURE_READ_DEADLINE_MS - 500)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toBeNull()
    expect(cancelled).toHaveLength(1)
  })

  it("with no deadline asked for, nothing is taken back", async () => {
    vi.useFakeTimers()
    const cancelled: string[] = []
    vi.stubGlobal("window", {
      wm: { ocrRead: () => new Promise(() => undefined), ocrCancel: (id: string) => { cancelled.push(id); return Promise.resolve() } },
    })
    const { ask } = await import("../src/renderer/ocrClient")
    void ask({ bytes: new Uint8Array([1]) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cancelled).toHaveLength(0)
  })
})
