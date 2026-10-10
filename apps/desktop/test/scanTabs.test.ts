// The live store behind the camera's page tabs (renderer/scanTabs.ts), against a stand-in for the preload's `wm.scans`
// (main/scans.ts). Port-only. What matters: a picture is on disk BEFORE its page is in the list, a page that cannot be
// kept is not added, closing takes the picture with it, nothing is written before the list has been read, and what
// was kept comes back (the list is read, pictures nobody names are swept, a page kept in the meantime is not lost).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ScanPage } from "../src/renderer/scanSet"

interface Files {
  load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>; drop: ReturnType<typeof vi.fn>; sweep: ReturnType<typeof vi.fn>
}

const meta = (extra: Partial<ScanPage> = {}): Omit<ScanPage, "id" | "name"> => ({
  width: 1920, height: 1080, rotation: 0, box: null, straighten: false, quad: null, shape: null, read: null, ...extra,
})

let files: Files
let events: string[]

/** A fresh copy of the store, with `list` as what the file held (null: no file), after the page's own start-up. */
async function open(list: string | null, answer: "now" | "later" = "now") {
  vi.resetModules()
  let release: (text: string | null) => void = () => undefined
  files = {
    load: vi.fn(() => (answer === "now" ? Promise.resolve(list) : new Promise<string | null>((resolve) => { release = resolve }))),
    save: vi.fn(), put: vi.fn(async (id: string) => { events.push(`put ${id}`); return true }),
    get: vi.fn(async () => Uint8Array.from([1])), drop: vi.fn((id: string) => { events.push(`drop ${id}`) }), sweep: vi.fn(),
  }
  ;(globalThis as unknown as { window: unknown }).window = { wm: { scans: files }, addEventListener: () => undefined }
  const store = await import("../src/renderer/scanTabs")
  await Promise.resolve()
  await Promise.resolve()
  return { store, release: (text: string | null) => { release(text); return Promise.resolve().then(() => Promise.resolve()) } }
}

beforeEach(() => { events = []; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); delete (globalThis as unknown as { window?: unknown }).window })

const bytes = Uint8Array.from([1, 2, 3])

describe("keeping a page", () => {
  it("writes the picture first, then the page joins the list and opens, and the list is saved after a quiet moment", async () => {
    const { store } = await open(null)
    const id = await store.keepPage(bytes, meta())
    expect(id).toMatch(/^p/)
    expect(events).toEqual([`put ${id}`])
    expect(store.scans().pages.map((page) => page.id)).toEqual([id])
    expect(store.scans().current).toBe(id)
    expect(files.save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(files.save).toHaveBeenCalledTimes(1)
    expect(JSON.parse(files.save.mock.calls[0]![0] as string).pages[0]).toMatchObject({ id, name: "Page 1", w: 1920, h: 1080 })
  })

  it("adds no page when its picture could not be written", async () => {
    const { store } = await open(null)
    files.put.mockResolvedValueOnce(false)
    expect(await store.keepPage(bytes, meta())).toBeNull()
    expect(store.scans().pages).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(files.save).not.toHaveBeenCalled()
  })

  it("closing a page takes its picture with it, and the camera opens when it was the last", async () => {
    const { store } = await open(null)
    const a = (await store.keepPage(bytes, meta()))!
    const b = (await store.keepPage(bytes, meta()))!
    expect(store.closeScan(b)).toBe(true)
    expect(events).toContain(`drop ${b}`)
    expect(store.scans().current).toBe(a)
    expect(store.closeScan(a)).toBe(true)
    expect(store.scans()).toEqual({ pages: [], current: null })
    expect(store.closeScan("nope")).toBe(false)
  })

  it("keeps what was done to a page (box, corners, turn, reading) and saves it", async () => {
    const { store } = await open(null)
    const id = (await store.keepPage(bytes, meta()))!
    vi.advanceTimersByTime(500)
    files.save.mockClear()
    expect(store.changeScan(id, { rotation: 90, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })).toBe(true)
    expect(store.changeScan(id, { rotation: 90 })).toBe(false)
    vi.advanceTimersByTime(500)
    expect(files.save).toHaveBeenCalledTimes(1)
    expect(JSON.parse(files.save.mock.calls[0]![0] as string).pages[0]).toMatchObject({ turn: 90, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })
    expect(store.renameScan(id, "Receipt")).toBe(true)
    expect(store.scans().pages[0]!.name).toBe("Receipt")
  })
})

describe("the pages come back", () => {
  const list = JSON.stringify({ pages: [{ id: "old1", name: "Receipt", w: 640, h: 480, turn: 90 }, { id: "old2", w: 800, h: 600 }] })

  it("reads the list, opens on the camera, and sweeps the pictures no page names", async () => {
    const { store } = await open(list)
    expect(store.scans().pages.map((page) => [page.id, page.name, page.rotation])).toEqual([["old1", "Receipt", 90], ["old2", "Page 1", 0]])
    expect(store.scans().current).toBeNull()
    expect(files.sweep).toHaveBeenCalledWith(["old1", "old2"])
    expect(await store.pageBytes("old1")).toEqual(Uint8Array.from([1]))
  })

  it("writes nothing before the list has been read, and a page kept meanwhile is kept with the rest", async () => {
    const { store, release } = await open(list, "later")
    const id = (await store.keepPage(bytes, meta()))!
    vi.advanceTimersByTime(2000)
    expect(files.save).not.toHaveBeenCalled()
    await release(list)
    expect(store.scans().pages.map((page) => page.id)).toEqual(["old1", "old2", id])
    vi.advanceTimersByTime(500)
    expect(JSON.parse(files.save.mock.calls[0]![0] as string).pages.map((page: { id: string }) => page.id)).toEqual(["old1", "old2", id])
    // The sweep names every page, the early one too.
    expect(files.sweep).toHaveBeenCalledWith(["old1", "old2", id])
  })

  it("starts empty from a file that is not a list, sweeps nothing and writes nothing until a change", async () => {
    const { store } = await open("garbage {")
    expect(store.scans().pages).toEqual([])
    expect(files.sweep).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(files.save).not.toHaveBeenCalled()
    await store.keepPage(bytes, meta())
    vi.advanceTimersByTime(500)
    expect(files.save).toHaveBeenCalledTimes(1)
  })
})
