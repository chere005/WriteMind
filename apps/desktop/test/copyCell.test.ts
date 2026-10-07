// Port-only: no XCTest. COPY CELL (the tablet box's button, renderer/BoxActions.tsx): the clipboard side
// (main/wolfram/clipboard.ts `cell`: the SVG file for the other apps, the kernel's types for Mathematica, never a PNG).
// The page side is in copiedCell.test.ts.
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { evalResult, wolframClipboardFor, type EngineState, type KernelJob, type WolframMedia } from "@writemind/core"
import { copyForWolfram, validWolframCopy, type CopyDeps, type WolframCopy } from "../src/main/wolfram/clipboard"
import type { KernelAnswers, KernelOptions } from "../src/main/wolfram/kernel"

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const INK = `![ink](.drawings/media/ink-${ID}.svg)`
const BOXES = `GraphicsBox[TagBox[RasterBox[CompressedData["1:eJx"], {{0, 100}, {200, 0}}], BoxForm\`ImageTag["Byte"]], ImageSize -> {100, 50}]`
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400"/>`
const FILE = "/tmp/WriteMind-copied/copy-x/Drawing.svg"
// The OS's own spelling of the path (a Windows runner turns "/tmp/x" into "D:\\tmp\\x"): what the code under test writes.
const URI = `${pathToFileURL(FILE).href}\r\n`
const URL_MAC = `electron application/osclipboard;format="public.file-url"`
const MEDIA: WolframMedia = { inks: { [ID]: { svg: SVG, shown: 400 } }, bands: [], column: 400 }
const OMEG = `electron application/osclipboard;format="dyn.ah62d4rv4gk8y8xnfk6"`
const SVG_MAC = `electron application/osclipboard;format="public.svg-image"`
const SVG_OTHER = `electron application/osclipboard;format="image/svg+xml"`
const CHROMIUM = "chromium/x-web-custom-data"

const cellCopy = (): WolframCopy => ({ plain: SVG, markdown: INK, media: MEDIA, noteFile: null, cell: true })
const answered = (names: Record<string, string>, pngs: Record<string, string> = {}, state: EngineState = { kind: "answered" }): KernelAnswers => ({
  answers: new Map(Object.entries(names)),
  pngs: new Map(Object.entries(pngs).map(([name, text]) => [name, new TextEncoder().encode(text)])),
  state,
})

/** The clipboard as the page's copy event left it (its words, and WriteMind's custom data), the engine and the file faked. */
function harness(platform: string, answer: () => KernelAnswers) {
  const state = { text: SVG, items: new Map<string, Blob>([["text/plain", new Blob([SVG])], [CHROMIUM, new Blob(["x-writemind-drawing"])]]) }
  const writes: Map<string, string>[] = []
  const runs: { jobs: KernelJob[]; options: KernelOptions }[] = []
  const saved: string[] = []
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
        for (const [type, blob] of Object.entries(entries)) written.set(type, await blob.text())
        writes.push(written)
        if (entries["text/plain"]) state.text = await entries["text/plain"].text()
      },
    },
    item: (entries) => ({ entries }),
    kinds: wolframClipboardFor(platform),
    platform,
    saveSvg: async (svg) => { saved.push(svg); return FILE },
    runKernel: async (jobs, options) => { runs.push({ jobs: [...jobs], options }); return answer() },
    sleep: async () => undefined,
    removeTemp: async () => undefined,
  }
  return { deps, state, writes, runs, saved }
}

const pngTypes = (writes: Map<string, string>[]) => writes.flatMap((written) => [...written.keys()]).filter((type) => /png/i.test(type))

describe("Copy Cell on a Mac", () => {
  it("writes the SVG file and markup beside the front end's cell at once, and again beside the image: never a PNG", async () => {
    const h = harness("darwin", () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "PNGDATA" }))
    await copyForWolfram(cellCopy(), h.deps)
    expect(h.saved).toEqual([SVG])
    expect(h.writes.length).toBe(2)
    for (const written of h.writes) {
      expect(written.get(URL_MAC)).toBe(`file://${FILE}`)
      expect(written.has("text/uri-list")).toBe(false)
      expect(written.get(SVG_MAC)).toBe(SVG)
      expect(written.get("text/plain")).toBe(SVG)
      // WriteMind's own paste still has its custom type.
      expect(written.get(CHROMIUM)).toBe("x-writemind-drawing")
    }
    expect(pngTypes(h.writes)).toEqual([])
    expect(h.writes[0]!.get(OMEG)).toMatch(/^Cell\[BoxData\["\(\* WriteMind: a drawing\./)
    expect(h.writes[1]!.get(OMEG)).toBe(`Cell[BoxData[${BOXES}], "Output", GeneratedCell -> False, CellAutoOverwrite -> False, TaggingRules -> {"WriteMind" -> "ink"}]`)
    // The kernel is not asked for a PNG: the file is the picture for the other apps.
    expect(h.runs[0]!.options.png).toBe(false)
  })

  it("with no engine the first write stands, file and all: the copy works without Mathematica", async () => {
    const missing: EngineState = { kind: "missing", refusal: { kind: "missingTool", evaluator: "wolfram", looked: ["a"] } }
    const silent: EngineState = { kind: "silent", path: "/w", result: evalResult({ stdout: "", stderr: "", status: 0, signal: null, timedOut: false, truncated: false }) }
    for (const state of [missing, silent]) {
      const h = harness("darwin", () => answered({}, {}, state))
      await copyForWolfram(cellCopy(), h.deps)
      expect(h.writes.length).toBe(1)
      expect(h.writes[0]!.get(URL_MAC)).toBe(`file://${FILE}`)
      expect(h.writes[0]!.get(SVG_MAC)).toBe(SVG)
    }
  })
})

describe("Copy Cell on Windows and Linux", () => {
  it("writes the file and markup at once, engine or none, and the engine's linear syntax follows in the words", async () => {
    for (const platform of ["win32", "linux"]) {
      const none = harness(platform, () => answered({}, {}, { kind: "failed", why: "x" }))
      await copyForWolfram(cellCopy(), none.deps)
      expect(none.writes.length, platform).toBe(1)
      expect(none.writes[0]!.get("text/uri-list")).toBe(URI)
      expect(none.writes[0]!.get(SVG_OTHER)).toBe(SVG)
      expect(none.writes[0]!.get(CHROMIUM)).toBe("x-writemind-drawing")
      const h = harness(platform, () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "PNGDATA" }))
      await copyForWolfram(cellCopy(), h.deps)
      expect(h.writes.length, platform).toBe(2)
      expect(h.writes[1]!.get("text/plain")).toBe(`\\!\\(\\*${BOXES}\\)`)
      expect(h.writes[1]!.get("text/uri-list")).toBe(URI)
      expect(pngTypes(h.writes), platform).toEqual([])
    }
  })
})

describe("what Copy Cell must not change", () => {
  it("writes nothing over a copy made since", async () => {
    const stale = harness("win32", () => answered({}))
    stale.state.text = "ANOTHER COPY"
    await copyForWolfram(cellCopy(), stale.deps)
    expect(stale.writes).toEqual([])
    expect(stale.saved.length).toBe(0)
  })

  it("a copy of held cells (not a cell copy) still makes no file, and still carries its PNG", async () => {
    const h = harness("win32", () => answered({ "ink-1.svg": BOXES }, { "ink-1.svg": "P" }))
    await copyForWolfram({ ...cellCopy(), cell: undefined }, h.deps)
    expect(h.saved).toEqual([])
    expect(h.writes[0]!.has("text/uri-list")).toBe(false)
    expect(h.writes[0]!.get("image/png")).toBe("P")
  })
})

describe("what crosses from the page for a copied cell (validWolframCopy)", () => {
  it("is exactly one drawing and nothing floating", () => {
    expect(validWolframCopy(cellCopy())).toEqual(cellCopy())
    expect(validWolframCopy({ ...cellCopy(), cell: false })).toEqual({ ...cellCopy(), cell: undefined })
    const two: WolframMedia = { ...MEDIA, inks: { ...MEDIA.inks, "0a2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f": { svg: "<svg/>", shown: 1 } } }
    expect(validWolframCopy({ ...cellCopy(), media: two })).toBeNull()
    expect(validWolframCopy({ ...cellCopy(), media: { ...MEDIA, bands: [{ svg: "x", shown: 3, after: null }] } })).toBeNull()
  })
})
