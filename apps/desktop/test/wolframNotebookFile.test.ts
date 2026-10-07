// Port-only: no XCTest. File ▸ Export… ▸ Wolfram Notebook (main/wolfram/notebookFile.ts, media.ts), the process and the
// files faked: no engine is started and no Electron is loaded.
import { describe, expect, it } from "vitest"
import type { EngineState, KernelJob, WolframMedia } from "@writemind/core"
import { evalResult } from "@writemind/core"
import type { ExportRequest } from "../src/main/exportPdf"
import type { KernelAnswers, KernelOptions } from "../src/main/wolfram/kernel"
import type { MediaDeps } from "../src/main/wolfram/media"
import { writeWolframNotebook, type NotebookFileDeps } from "../src/main/wolfram/notebookFile"

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const INK = `![ink](.drawings/media/ink-${ID}.svg)`
const BOXES = `GraphicsBox[TagBox[RasterBox[CompressedData["1:eJx"], {{0, 100}, {200, 0}}], BoxForm\`ImageTag["Byte"]], ImageSize -> {100, 50}]`
const bytes = (text: string) => new TextEncoder().encode(text)
const b64 = (text: string) => Buffer.from(text).toString("base64")

const request = (markdown: string, wolfram?: WolframMedia): ExportRequest => ({
  noteFile: "/notes/Lecture 3.md", title: "Lecture 3", markdown, drawing: null, pane: { width: 760, height: 900 },
  ...(wolfram ? { wolfram } : {}),
})
const media = (svg = `<svg width="400" height="200"/>`): WolframMedia => ({ inks: { [ID]: { svg, shown: 400 } }, bands: [], column: 700 })

interface Log {
  kernel: { jobs: KernelJob[]; options: KernelOptions }[]
  progress: boolean[]
  written: { file: string; text: string }[]
  bitmaps: { file: string; maxWidth: number | null }[]
  temps: string[]
  removed: string[]
}

function harness(answer: (jobs: KernelJob[]) => KernelAnswers | Error, files: Record<string, string> = {}, over: Partial<NotebookFileDeps> = {}) {
  const log: Log = { kernel: [], progress: [], written: [], bitmaps: [], temps: [], removed: [] }
  const found: Record<string, string> = { "cat.png": "/m/cat.png", "page.pdf": "/m/page.pdf", "big.png": "/m/big.png", "odd.webp": "/m/odd.webp", ...Object.fromEntries(Object.keys(files).map((name) => [name, `/m/${name}`])) }
  const stats = new Set(Object.values(found))
  const deps: NotebookFileDeps = {
    findMedia: async (name) => found[name] ?? null,
    stat: async (file) => (stats.has(file) ? { mtimeMs: 5, size: 9 } : null),
    readFile: async (file) => bytes(files[file.replace("/m/", "")] ?? `bytes of ${file}`),
    pdfPicture: async () => ({ svg: "<svg><path d='M0 0'/></svg>", width: 300, height: 400 }),
    bitmap: async (file, maxWidth) => { log.bitmaps.push({ file, maxWidth }); return { png: bytes("PNG:" + file), width: file.includes("big") ? 4000 : 100 } },
    tempPng: async () => { const file = `/tmp/wm-${log.temps.length}/picture.png`; log.temps.push(file); return file },
    runKernel: async (jobs, options) => {
      log.kernel.push({ jobs: [...jobs], options })
      const out = answer([...jobs])
      if (out instanceof Error) throw out
      return out
    },
    progress: (on) => { log.progress.push(on) },
    version: "2.9.0",
    write: async (file, text) => { log.written.push({ file, text }) },
    removeTemp: async (file) => { log.removed.push(file) },
    ...over,
  }
  return { deps, log }
}

const answers = (state: EngineState, names: Record<string, string> = {}): KernelAnswers => ({ answers: new Map(Object.entries(names)), pngs: new Map(), state })
const silent = (): EngineState => ({ kind: "silent", path: "/w/wolframscript", result: evalResult({ stdout: "", stderr: "", status: 0, signal: null, timedOut: false, truncated: false }) })

describe("writing the notebook (main/wolfram/notebookFile.ts)", () => {
  it("asks the kernel ONCE for every drawing, then writes the file whole, with its pictures in it", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "ink-1.svg": BOXES }))
    const notice = await writeWolframNotebook("/out/Lecture 3.nb", request(`# Hi\n\n${INK}`, media()), deps)
    expect(notice).toBeNull()
    expect(log.kernel.length).toBe(1)
    expect(log.kernel[0]!.jobs).toEqual([{ name: "ink-1.svg", text: `<svg width="400" height="200"/>` }])
    expect(log.kernel[0]!.options).toMatchObject({ png: false, timeoutMs: 120_000 })
    expect(log.kernel[0]!.options.id).toMatch(/^wolfram:export:\d+$/)
    expect(log.written.length).toBe(1)
    expect(log.written[0]!.file).toBe("/out/Lecture 3.nb")
    expect(log.written[0]!.text).toMatch(/^\(\* Content-type: application\/vnd\.wolfram\.mathematica \*\)/)
    expect(log.written[0]!.text).toContain(`Cell[BoxData[${BOXES}], "Output", GeneratedCell -> False`)
    expect(log.written[0]!.text).toContain("Written by WriteMind 2.9.0")
  })

  it("the progress bar is on while the kernel runs and off after, even when it throws, and the file is not written", async () => {
    const { deps, log } = harness(() => new Error("boom"))
    await expect(writeWolframNotebook("/out/a.nb", request(INK, media()), deps)).rejects.toThrow("boom")
    expect(log.progress).toEqual([true, false])
    expect(log.written).toEqual([])
  })

  it("a note with nothing for the kernel starts none and shows no progress", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }))
    expect(await writeWolframNotebook("/out/a.nb", request("# Just words\n\nand more", media()), deps)).toBeNull()
    expect(log.kernel).toEqual([])
    expect(log.progress).toEqual([])
    expect(log.written[0]!.text).toContain(`Cell["Just words", "Title"]`)
  })

  it("tells what is missing when the engine did not answer: closed initialization cells, and the notice", async () => {
    const { deps, log } = harness(() => answers({ kind: "missing", refusal: { kind: "missingTool", evaluator: "wolfram", looked: ["wolframscript on the PATH"] } }))
    const notice = await writeWolframNotebook("/out/Lecture 3.nb", request(INK, media()), deps)
    expect(log.written[0]!.text).toContain("CellOpen -> False, InitializationCell -> True")
    expect(notice!.message).toBe("“Lecture 3.nb” is written. Its drawings appear when its cells are evaluated.")
    expect(notice!.detail).toContain("Wolfram is not installed where WriteMind looks (wolframscript on the PATH).")
    expect(notice!.detail).toContain("Evaluation ▸ Evaluate Initialization Cells")
  })

  it("says each of the other states in its words", async () => {
    const say = async (state: EngineState) => (await writeWolframNotebook("/out/a.nb", request(INK, media()), harness(() => answers(state)).deps))!.detail
    expect(await say(silent())).toContain("The Wolfram Engine at /w/wolframscript did not answer.")
    expect(await say({ kind: "timedOut", seconds: 120 })).toContain("stopped waiting for the Wolfram Engine after 2 minutes; 1 of the drawings was not made.")
    expect(await say({ kind: "failed", why: "spawn EACCES" })).toContain("could not be started (spawn EACCES)")
    expect(await say({ kind: "answered" })).toContain("could not make 1 of them")
  })

  it("keeps what a timed-out run answered: only the rest falls back", async () => {
    const { deps, log } = harness(() => answers({ kind: "timedOut", seconds: 120 }, { "ink-1.svg": BOXES }))
    const two = `${INK}\n\n![ink](.drawings/media/ink-0a2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f.svg)`
    const both: WolframMedia = { ...media(), inks: { ...media().inks, "0a2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f": { svg: "<svg id='2'/>", shown: 300 } } }
    const notice = await writeWolframNotebook("/out/a.nb", request(two, both), deps)
    expect(log.kernel[0]!.jobs.map((job) => job.name)).toEqual(["ink-1.svg", "ink-2.svg"])
    expect(log.written[0]!.text.match(/InitializationCell -> True/g)?.length).toBe(1)
    expect(notice!.detail).toContain("1 of the drawings was not made")
  })

  it("a maths cell without its answer is still a correct Input cell, and says nothing", async () => {
    const { deps, log } = harness(() => answers(silent()))
    const notice = await writeWolframNotebook("/out/a.nb", request("```wl\ny = 2x\n```", media()), deps)
    expect(notice).toBeNull()
    expect(log.written[0]!.text).toContain(`Cell[BoxData["y == 2*x"], "Input"`)
  })

  it("puts a picture's file where the kernel is told, and its bytes in the file only when the kernel did not make it", async () => {
    const markdown = "![](.drawings/media/cat.png)\n\n![](.drawings/media/big.png)"
    const without = harness(() => answers({ kind: "answered" }, { "pic-1.txt": BOXES }), { "cat.png": "CATBYTES", "big.png": "BIGBYTES" })
    await writeWolframNotebook("/out/a.nb", request(markdown, media()), without.deps)
    expect(without.log.kernel[0]!.jobs).toEqual([
      { name: "pic-1.txt", text: `{"/m/cat.png", 640}` }, { name: "pic-2.txt", text: `{"/m/big.png", 640}` },
    ])
    const text = without.log.written[0]!.text
    // cat was answered: no bytes. big was not: its bytes ride in its own cell.
    expect(text).not.toContain(b64("CATBYTES"))
    expect(text).toContain(b64("BIGBYTES"))
    expect(text).toContain(`\\"PNG\\"`)
  })

  it("asks the kernel with the picture's file stamp, so a changed file is made again", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "pic-1.txt": BOXES }))
    await writeWolframNotebook("/out/a.nb", request("![](.drawings/media/cat.png)", media()), deps)
    expect(log.kernel[0]!.options.stamps?.get("pic-1.txt")).toBe("5:9")
  })

  it("a Mac PDF capture becomes an svg job, its paths inside an svg of ours on white", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "pdf-1.svg": BOXES }))
    await writeWolframNotebook("/out/a.nb", request("![](.drawings/media/page.pdf)", media()), deps)
    const [job] = log.kernel[0]!.jobs
    expect(job!.name).toBe("pdf-1.svg")
    expect(job!.text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="100%" height="100%" fill="#FFFFFF"\/><image href="data:image\/svg\+xml;base64,/)
  })

  it("a format the engine may not import goes as a temporary PNG, and the temp file goes after", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "pic-1.txt": BOXES }))
    await writeWolframNotebook("/out/a.nb", request("![](.drawings/media/odd.webp)", media()), deps)
    expect(log.kernel[0]!.jobs[0]!.text).toBe(`{"/tmp/wm-0/picture.png", 640}`)
    expect(log.removed).toEqual(["/tmp/wm-0/picture.png"])
  })

  it("a picture that is not there is its words, and starts no kernel", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }))
    await writeWolframNotebook("/out/a.nb", request("![holiday](.drawings/media/lost.png)", media()), deps)
    expect(log.kernel).toEqual([])
    expect(log.written[0]!.text).toContain(`Cell[TextData[StyleBox["holiday", FontSlant -> "Italic"]], "Text", FontColor -> GrayLevel[0.55]]`)
  })

  it("puts the pictures a drawing links to INSIDE its svg, and shrinks a bitmap far bigger than it is drawn", async () => {
    const svg = `<svg width="400"><image href="big.png" x="0" y="0" width="100" height="50"/><image href="cat.png" width="100" height="50"/><image href="lost.png" width="9" height="9"/></svg>`
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "ink-1.svg": BOXES }), { "cat.png": "CATBYTES" })
    await writeWolframNotebook("/out/a.nb", request(INK, media(svg)), deps)
    const sent = log.kernel[0]!.jobs[0]!.text
    // Drawn 100 wide: twice that is all it can show. The 4000-wide photo is shrunk to it; the 100-wide cat is as it is.
    expect(log.bitmaps).toEqual([{ file: "/m/big.png", maxWidth: 200 }, { file: "/m/cat.png", maxWidth: 200 }])
    expect(sent).toContain(`href="data:image/png;base64,${b64("PNG:/m/big.png")}"`)
    expect(sent).toContain(`href="data:image/png;base64,${b64("CATBYTES")}"`)
    // A picture that is not there is left out.
    expect(sent).not.toContain("lost.png")
    expect(sent).not.toContain("<image href=\"lost")
  })

  it("an ink line the page sent nothing for is a picture of its snapshot file", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "pic-1.txt": BOXES }), { [`ink-${ID}.svg`]: "SNAP" })
    await writeWolframNotebook("/out/a.nb", request(INK), deps)
    expect(log.kernel[0]!.jobs).toEqual([{ name: "pic-1.txt", text: `{"/m/ink-${ID}.svg", 640}` }])
  })

  it("a request from an old page (no drawings measured) still writes the notebook", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }))
    await writeWolframNotebook("/out/a.nb", request("# Hi"), deps)
    expect(log.written.length).toBe(1)
  })

  it("two exports never share a run id", async () => {
    const { deps, log } = harness(() => answers({ kind: "answered" }, { "ink-1.svg": BOXES }))
    await writeWolframNotebook("/out/a.nb", request(INK, media()), deps)
    await writeWolframNotebook("/out/b.nb", request(INK, media()), deps)
    expect(new Set(log.kernel.map((run) => run.options.id)).size).toBe(2)
  })
})
