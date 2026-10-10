// Port-only: no XCTest. A copy of held cells with a drawing cell among them, written again for Mathematica
// (main/wolfram/clipboard.ts): the clipboard, the engine and the files all faked, a platform at a time.
import { describe, expect, it } from "vitest"
import { evalResult, wolframClipboardFor, type EngineState, type KernelJob, type WolframMedia } from "@writemind/core"
import { copyForWolfram, validWolframCopy, type CopyDeps, type WolframCopy } from "../src/main/wolfram/clipboard"
import type { KernelAnswers, KernelOptions } from "../src/main/wolfram/kernel"

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const ID2 = "0a2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const INK = `![ink](.drawings/media/ink-${ID}.svg)`
const INK2 = `![ink](.drawings/media/ink-${ID2}.svg)`
const BOXES = `GraphicsBox[TagBox[RasterBox[CompressedData["1:eJx"], {{0, 100}, {200, 0}}], BoxForm\`ImageTag["Byte"]], ImageSize -> {100, 50}]`
const MEDIA: WolframMedia = {
  inks: { [ID]: { svg: `<svg width="400"/>`, shown: 400 }, [ID2]: { svg: `<svg id="2"/>`, shown: 300 } }, bands: [], column: 700,
}
const OMEG = `electron application/osclipboard;format="dyn.ah62d4rv4gk8y8xnfk6"`
const LEGACY_OMEG = `electron application/osclipboard;format="CorePasteboardFlavorType 0x4F4D4547"`
const CHROMIUM = "chromium/x-web-custom-data"

/** The clipboard as the DOM copy left it: WriteMind's words and cells (and the types Chromium adds on a Mac). */
function clipboardAfterDomCopy(plain: string, extra: Record<string, string> = {}): Map<string, Blob> {
  return new Map<string, Blob>([
    ["text/plain", new Blob([plain])], [CHROMIUM, new Blob(["x-writemind-cells"])],
    ...Object.entries(extra).map(([type, value]) => [type, new Blob([value])] as [string, Blob]),
  ])
}

function harness(platform: string, plain: string, answer: (jobs: KernelJob[], options: KernelOptions) => KernelAnswers | (() => KernelAnswers),
  start: Map<string, Blob> = clipboardAfterDomCopy(plain)) {
  const state = { text: plain, items: start }
  const writes: Map<string, string>[] = []
  const runs: { jobs: KernelJob[]; options: KernelOptions }[] = []
  const logs: string[] = []
  const deps: CopyDeps = {
    findMedia: async () => null, stat: async () => null, readFile: async () => new Uint8Array(),
    pdfPicture: async () => null, bitmap: async () => null, tempPng: async () => "/tmp/x.png",
    clipboard: {
      readText: async () => state.text,
      read: async () => [{ types: [...state.items.keys()], getType: async (type: string) => state.items.get(type) }],
      write: async (items) => {
        const entries = (items[0] as { entries: Record<string, Blob> }).entries
        state.items = new Map(Object.entries(entries))
        const written = new Map<string, string>()
        for (const [type, blob] of Object.entries(entries)) written.set(type, type.includes("png") ? `png:${await blob.text()}` : await blob.text())
        writes.push(written)
        if (entries["text/plain"]) state.text = await entries["text/plain"].text()
      },
    },
    item: (entries) => ({ entries }),
    kinds: wolframClipboardFor(platform),
    runKernel: async (jobs, options) => {
      runs.push({ jobs: [...jobs], options })
      const out = answer([...jobs], options)
      return typeof out === "function" ? out() : out
    },
    sleep: async () => undefined,
    removeTemp: async () => undefined,
    log: (message) => { logs.push(message) },
  }
  return { deps, state, writes, runs, logs }
}

const copy = (markdown: string, plain = "DRAWING"): WolframCopy => ({ plain, markdown, media: MEDIA, noteFile: "/notes/a.md" })
const answered = (names: Record<string, string>, pngs: Record<string, string> = {}, state: EngineState = { kind: "answered" }): KernelAnswers => ({
  answers: new Map(Object.entries(names)),
  pngs: new Map(Object.entries(pngs).map(([name, text]) => [name, new TextEncoder().encode(text)])),
  state,
})
const silentState = (): EngineState => ({ kind: "silent", path: "/w", result: evalResult({ stdout: "", stderr: "", status: 0, signal: null, timedOut: false, truncated: false }) })

describe("a Mac copy (the front end's own clipboard type)", () => {
  it("writes the open Input cell at once, keeping only WriteMind's own types, then the image when the engine answers", async () => {
    const stale = { [OMEG]: "old", [LEGACY_OMEG]: "old", "public.png": "old", "public.tiff": "old" }
    const h = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "PNGDATA" }), clipboardAfterDomCopy("DRAWING", stale))
    await copyForWolfram(copy(INK), h.deps)
    expect(h.runs[0]!.options.removeBackground).toBe(true)
    expect(h.writes.length).toBe(2)
    const [first, second] = h.writes
    // At once: no kernel yet, so the cell is the Input cell that makes the drawing (open, without InitializationCell).
    expect([...first!.keys()].sort()).toEqual(["text/plain", CHROMIUM, OMEG].sort())
    expect(first!.get(OMEG)).toMatch(/^Cell\[BoxData\["\(\* WriteMind: a drawing\./)
    expect(first!.get(OMEG)).not.toContain("InitializationCell")
    // Then the image: the same type, now the image itself, and the PNG under the raw type, for one drawing.
    expect([...second!.keys()].sort()).toEqual(["text/plain", CHROMIUM, OMEG, `electron application/osclipboard;format="public.png"`].sort())
    expect(second!.get(OMEG)).toBe(`Cell[BoxData[${BOXES}], "Output", GeneratedCell -> False, CellAutoOverwrite -> False, TaggingRules -> {"WriteMind" -> "ink"}]`)
    expect(second!.get(`electron application/osclipboard;format="public.png"`)).toBe("png:PNGDATA")
    // The words and the cells of WriteMind's own copy are what they were.
    expect(second!.get("text/plain")).toBe("DRAWING")
    expect(second!.get(CHROMIUM)).toBe("x-writemind-cells")
  })

  it("asks for a PNG only for exactly one drawing cell, and the kernel with the copy's own fixed id and 20 seconds", async () => {
    const one = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "P" }))
    await copyForWolfram(copy(INK), one.deps)
    expect(one.runs[0]!.options).toMatchObject({ id: "wolfram:copy", png: true, timeoutMs: 20_000 })
    const two = harness("darwin", "TWO", () => answered({ "ink-1.svg": BOXES, "ink-2.svg": BOXES }))
    await copyForWolfram(copy(`${INK}\n\n${INK2}`, "TWO"), two.deps)
    expect(two.runs[0]!.options.png).toBe(false)
    expect(two.runs[0]!.jobs.map((job) => job.name)).toEqual(["ink-1.svg", "ink-2.svg"])
    // Two cells go as the front end's own list, and no PNG is guessed at.
    expect(two.writes[1]!.get(OMEG)!.startsWith("{\nCell[")).toBe(true)
    expect([...two.writes[1]!.keys()].some((type) => type.includes("public.png"))).toBe(false)
    // A heading with a drawing is not a lone drawing either.
    const mixed = harness("darwin", "MIXED", () => answered({ "ink-1.svg": BOXES }))
    await copyForWolfram(copy(`# Title\n\n${INK}`, "MIXED"), mixed.deps)
    expect(mixed.runs[0]!.options.png).toBe(false)
    expect(mixed.writes[1]!.get(OMEG)).toContain(`Cell["Title", "Title"]`)
  })

  it("with no engine the first write stands and no second is made", async () => {
    const missing: EngineState = { kind: "missing", refusal: { kind: "missingTool", evaluator: "wolfram", looked: ["a"] } }
    for (const state of [missing, silentState(), { kind: "failed", why: "x" } as EngineState]) {
      const h = harness("darwin", "DRAWING", () => answered({}, {}, state))
      await copyForWolfram(copy(INK), h.deps)
      expect(h.writes.length).toBe(1)
    }
  })

  it("a run that was taken back (a newer copy) writes nothing more, and says nothing", async () => {
    const h = harness("darwin", "DRAWING", () => answered({}, {}, { kind: "cancelled" }))
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes.length).toBe(1)
    expect(h.logs).toEqual([])
  })

  it("a run that timed out still writes what it did answer", async () => {
    const h = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }, {}, { kind: "timedOut", seconds: 20 }))
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes.length).toBe(2)
  })

  it("writes nothing over a copy made since: not the second write, and not the first", async () => {
    // Somebody copies something else while the engine is working.
    const h = harness("darwin", "DRAWING", () => () => { h.state.text = "SOMETHING ELSE"; return answered({ "ink-1.svg": BOXES }) })
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes.length).toBe(1)
    const stale = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }))
    stale.state.text = "ANOTHER COPY"
    await copyForWolfram(copy(INK), stale.deps)
    expect(stale.writes).toEqual([])
    expect(stale.runs).toEqual([])
  })

  it("a newer copy of WriteMind's own takes the older one's second write back", async () => {
    const first = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }))
    const slow = copyForWolfram(copy(INK), { ...first.deps, runKernel: async (jobs, options) => {
      // While the first is waiting for its engine, a second copy starts (it bumps the copy count).
      await copyForWolfram(copy(INK), first.deps)
      return first.deps.runKernel(jobs, options)
    } })
    await slow
    // The outer one wrote its first write only; the inner one wrote both.
    expect(first.writes.length).toBe(3)
  })

  it("waits for the page's own copy to land, a second at most, and gives up on a copy that never did", async () => {
    let looks = 0
    const h = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }))
    h.deps.clipboard.readText = async () => (++looks < 4 ? "OLD CLIPBOARD" : "DRAWING")
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes.length).toBe(2)
    const never = harness("darwin", "DRAWING", () => answered({ "ink-1.svg": BOXES }))
    never.state.text = "OLD CLIPBOARD"
    let sleeps = 0
    never.deps.sleep = async () => { sleeps++ }
    await copyForWolfram(copy(INK), never.deps)
    expect(never.writes).toEqual([])
    expect(sleeps).toBe(20)
  })
})

describe("a Windows or Linux copy (the front end's own type is not known)", () => {
  it("changes nothing until the engine has answered, and with none it never does", async () => {
    for (const platform of ["win32", "linux"]) {
      const h = harness(platform, "DRAWING", () => answered({}, {}, { kind: "failed", why: "x" }))
      await copyForWolfram(copy(INK), h.deps)
      expect(h.writes, platform).toEqual([])
    }
  })

  it("then the plain text is the linear syntax for the image, when every held cell is a drawing, and the PNG is the standard one", async () => {
    const h = harness("win32", "DRAWING", () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "PNGDATA" }))
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes.length).toBe(1)
    const [written] = h.writes
    expect(written!.get("text/plain")).toBe(`\\!\\(\\*${BOXES}\\)`)
    expect(written!.get("image/png")).toBe("png:PNGDATA")
    // WriteMind's own cells stay, so a paste back into WriteMind is the cells.
    expect(written!.get(CHROMIUM)).toBe("x-writemind-cells")
    expect([...written!.keys()].some((type) => type.includes("osclipboard"))).toBe(false)
  })

  it("leaves the words alone when something other than drawings was copied, and writes no PNG for several drawings", async () => {
    const mixed = harness("win32", "MIXED", () => answered({ "ink-1.svg": BOXES }))
    await copyForWolfram(copy(`# Title\n\n${INK}`, "MIXED"), mixed.deps)
    // Not a lone drawing (no PNG) and not only drawings (no linear syntax): nothing to write.
    expect(mixed.writes).toEqual([])
    const several = harness("linux", "TWO", () => answered({ "ink-1.svg": BOXES, "ink-2.svg": BOXES }))
    await copyForWolfram(copy(`${INK}\n\n${INK2}`, "TWO"), several.deps)
    expect(several.writes[0]!.get("text/plain")).toBe(`\\!\\(\\*${BOXES}\\)\n\n\\!\\(\\*${BOXES}\\)`)
    expect([...several.writes[0]!.keys()].some((type) => type.includes("png"))).toBe(false)
  })

  it("keeps the words as they were without WriteMind's own custom data on the clipboard", async () => {
    const h = harness("win32", "DRAWING", () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "PNGDATA" }), new Map([["text/plain", new Blob(["DRAWING"])]]))
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes[0]!.get("text/plain")).toBe("DRAWING")
    expect(h.writes[0]!.get("image/png")).toBe("png:PNGDATA")
  })

  it("a second write is not made over a clipboard that changed in the meantime", async () => {
    const h = harness("win32", "DRAWING", () => () => { h.state.text = "ELSEWHERE"; return answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "P" }) })
    await copyForWolfram(copy(INK), h.deps)
    expect(h.writes).toEqual([])
  })
})

describe("what crosses from the page (validWolframCopy)", () => {
  const good = { plain: "p", markdown: INK, media: MEDIA, noteFile: "/n/a.md" }

  it("takes a well-formed copy as it is", () => {
    expect(validWolframCopy(good)).toEqual(good)
    expect(validWolframCopy({ ...good, noteFile: undefined })).toEqual({ ...good, noteFile: null })
  })

  it("refuses what is not one", () => {
    for (const bad of [null, "x", 3, [], {}, { ...good, plain: 3 }, { ...good, markdown: null }, { ...good, media: null },
      { ...good, media: { ...MEDIA, column: 0 } }, { ...good, media: { ...MEDIA, column: "700" } },
      { ...good, media: { ...MEDIA, inks: { "../etc/passwd": { svg: "x", shown: 1 } } } },
      { ...good, media: { ...MEDIA, inks: { [ID]: { svg: 5, shown: 1 } } } },
      { ...good, media: { ...MEDIA, inks: { [ID]: { svg: "x", shown: NaN } } } },
      { ...good, media: { ...MEDIA, bands: [{ svg: "x", shown: 3, after: "no" }] } }]) {
      expect(validWolframCopy(bad), JSON.stringify(bad)?.slice(0, 80)).toBeNull()
    }
  })

  it("refuses more than 2 MB of markdown and 16 MB of svg", () => {
    expect(validWolframCopy({ ...good, markdown: "x".repeat(2 * 1024 * 1024 + 1) })).toBeNull()
    expect(validWolframCopy({ ...good, markdown: "x".repeat(2 * 1024 * 1024) })).not.toBeNull()
    const big = "x".repeat(9 * 1024 * 1024)
    expect(validWolframCopy({ ...good, media: { ...MEDIA, inks: { [ID]: { svg: big, shown: 1 }, [ID2]: { svg: big, shown: 1 } } } })).toBeNull()
  })
})
