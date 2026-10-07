// Port-only: no XCTest. The planned cells with the kernel's answers put in (src/export/wolfram/notebook.ts): the .nb
// file, the clipboard's cells and linear syntax, and what an export says when its drawings fell back.
import { describe, expect, it } from "vitest"
import { evalResult } from "../src/eval/output"
import {
  clipboardCells, drawingText, exportNotice, fallbacks, notebookText,
} from "../src/export/wolfram/notebook"
import { wolframPlan, type ResolvedPicture, type WolframMedia } from "../src/export/wolfram/plan"

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
const INK = `![ink](.drawings/media/ink-${ID}.svg)`
const MEDIA: WolframMedia = { inks: { [ID]: { svg: `<svg width="400"/>`, shown: 400 } }, bands: [], column: 700 }
const BOXES = `GraphicsBox[TagBox[RasterBox[CompressedData["1:eJx"], {{0, 100}, {200, 0}}], BoxForm\`ImageTag["Byte"]], ImageSize -> {100, 50}]`
const CAT: ResolvedPicture = { kind: "file", path: "/m/cat.png", format: "PNG" }

/**
 * A small reader of WL text, enough to say a file will load: every string closed, every bracket closed by its own
 * kind, and nothing but 7-bit ASCII.
 */
function balanced(text: string): boolean {
  const stack: string[] = []
  const pairs: Record<string, string> = { "]": "[", "}": "{", ")": "(" }
  if (/[^\x00-\x7f]/.test(text)) return false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === "(" && text[i + 1] === "*") { const close = text.indexOf("*)", i + 2); if (close < 0) return false; i = close + 1; continue }
    if (c === "\"") {
      i++
      while (i < text.length && text[i] !== "\"") i += text[i] === "\\" ? 2 : 1
      if (i >= text.length) return false
      continue
    }
    if (c === "[" || c === "{" || c === "(") stack.push(c)
    else if (c in pairs && stack.pop() !== pairs[c]) return false
  }
  return stack.length === 0
}

describe("the notebook file", () => {
  it("opens with the front end's own header, and says who wrote it", () => {
    const text = notebookText(wolframPlan("# Hi", MEDIA, new Map(), "file"), new Map(), new Map(), "2.9.0")
    expect(text).toBe(`(* Content-type: application/vnd.wolfram.mathematica *)\n\n(*** Wolfram Notebook File ***)\n(* http://www.wolfram.com/nb *)\n\n`
      + `(* Written by WriteMind 2.9.0 *)\n\nNotebook[{\nCell["Hi", "Title"]\n},\nTaggingRules -> {"WriteMind" -> {"Version" -> "2.9.0"}}\n]\n`)
  })

  it("puts each answer in: an image an Output cell that re-running the Input above it keeps, maths typeset", () => {
    const plan = wolframPlan(`${INK}\n\n\`\`\`wl\nx^2\n\`\`\`\n\n<!-- markdown -->\nand \`wl:a\``, MEDIA, new Map(), "file")
    const text = notebookText(plan, new Map([["ink-1.svg", BOXES + "\n"], ["wl-1.wl", `SuperscriptBox["x", "2"]`], ["wl-2.wl", `"a"`]]), new Map(), "1")
    expect(text).toContain(`Cell[BoxData[${BOXES}], "Output", GeneratedCell -> False, CellAutoOverwrite -> False, TaggingRules -> {"WriteMind" -> "ink"}]`)
    expect(text).toContain(`Cell[BoxData[SuperscriptBox["x", "2"]], "Input", TaggingRules -> {"WriteMind" -> "maths"}]`)
    expect(text).toContain(`Cell[TextData[{"and ", Cell[BoxData["a"], "InlineFormula"]}], "Text"]`)
    expect(balanced(text)).toBe(true)
  })

  it("makes an image without its answer a closed initialization cell, and maths its source", () => {
    const plan = wolframPlan(`${INK}\n\n\`\`\`wl\ny = 1\n\`\`\``, MEDIA, new Map(), "file")
    const text = notebookText(plan, new Map(), new Map(), "1")
    expect(text).toContain(`"Input", CellOpen -> False, InitializationCell -> True, TaggingRules -> {"WriteMind" -> "ink"}]`)
    expect(text).toContain(`ImportString[\\"<svg width=\\\\\\"400\\\\\\"/>\\", {\\"SVG\\", \\"Image\\"}, ImageResolution -> 144], ImageSize -> 400]`)
    expect(text).toContain(`Cell[BoxData["y == 1"], "Input", TaggingRules -> {"WriteMind" -> "maths"}]`)
    expect(balanced(text)).toBe(true)
  })

  it("carries a picture's bytes only when it has no answer, in the format it is", () => {
    const plan = wolframPlan("![](.drawings/media/cat.png)", MEDIA, new Map([["cat.png", CAT]]), "file")
    const without = notebookText(plan, new Map(), new Map([["/m/cat.png", "iVBORw0K"]]), "1")
    expect(without).toContain(`With[{i = ImportByteArray[ByteArray[\\"iVBORw0K\\"], \\"PNG\\"]}, Image[i, ImageSize -> Min[640, First[ImageDimensions[i]]]]]`)
    expect(without).toContain(`TaggingRules -> {"WriteMind" -> "picture"}`)
    const svg = wolframPlan("![](.drawings/media/d.svg)", MEDIA, new Map([["d.svg", { kind: "file", path: "/m/d.svg", format: "SVG" }]]), "file")
    expect(notebookText(svg, new Map(), new Map([["/m/d.svg", "PHN2Zz4="]]), "1")).toContain(`ImportByteArray[ByteArray[\\"PHN2Zz4=\\"], {\\"SVG\\", \\"Image\\"}]`)
    const answered = notebookText(plan, new Map([["pic-1.txt", BOXES]]), new Map(), "1")
    expect(answered).not.toContain("ImportByteArray")
    expect(answered).toContain(`"WriteMind" -> "picture"`)
    // Found but not readable when the file was written: its words.
    expect(notebookText(plan, new Map(), new Map(), "1")).toContain(`Cell[TextData[StyleBox["cat.png", FontSlant -> "Italic"]], "Text", FontColor -> GrayLevel[0.55]]`)
  })

  it("is ASCII and balanced whatever the note held", () => {
    const plan = wolframPlan("# α 中文 😀\n\n- \"quoted\" \\ back\n\n```python\nprint(\"]\")\n```", MEDIA, new Map(), "file")
    const text = notebookText(plan, new Map(), new Map(), "1")
    expect(balanced(text)).toBe(true)
    expect(text).toContain(`Cell["\\:03b1 \\:4e2d\\:6587 \\|01f600", "Title"]`)
    // (and the reader can say no)
    expect(balanced(`Cell["x", "Text"`)).toBe(false)
    expect(balanced(`Cell["x]`)).toBe(false)
    expect(balanced(`Cell["é"]`)).toBe(false)
  })
})

describe("the clipboard", () => {
  it("is one Cell for one held cell, and the front end's own list for several", () => {
    const one = wolframPlan(INK, MEDIA, new Map(), "clipboard")
    const answers = new Map([["ink-1.svg", BOXES]])
    expect(clipboardCells(one, answers)).toBe(
      `Cell[BoxData[${BOXES}], "Output", GeneratedCell -> False, CellAutoOverwrite -> False, TaggingRules -> {"WriteMind" -> "ink"}]`)
    const two = wolframPlan(`Hello\n\n${INK}`, MEDIA, new Map(), "clipboard")
    expect(clipboardCells(two, answers)).toBe(`{\nCell["Hello", "Text"],\n\n`
      + `Cell[BoxData[${BOXES}], "Output", GeneratedCell -> False, CellAutoOverwrite -> False, TaggingRules -> {"WriteMind" -> "ink"}]\n}`)
  })

  it("holds the open Input cell that makes a drawing before the engine has answered", () => {
    const text = clipboardCells(wolframPlan(INK, MEDIA, new Map(), "clipboard"), new Map())
    expect(text).toMatch(/^Cell\[BoxData\["\(\* WriteMind: a drawing\. Evaluate this cell to see it\. \*\)\\nImage\[ImportString/)
    expect(text).toMatch(/"Input", TaggingRules -> \{"WriteMind" -> "ink"\}\]$/)
    expect(text).not.toContain("InitializationCell")
  })

  it("has linear syntax only when every cell is a drawing with its answer", () => {
    const answers = new Map([["ink-1.svg", BOXES]])
    expect(drawingText(wolframPlan(INK, MEDIA, new Map(), "clipboard"), answers)).toBe(`\\!\\(\\*${BOXES}\\)`)
    expect(drawingText(wolframPlan(`${INK}\n\n${INK}`, MEDIA, new Map(), "clipboard"), answers)).toBe(`\\!\\(\\*${BOXES}\\)\n\n\\!\\(\\*${BOXES}\\)`)
    expect(drawingText(wolframPlan(INK, MEDIA, new Map(), "clipboard"), new Map())).toBeNull()
    expect(drawingText(wolframPlan(`Hi\n\n${INK}`, MEDIA, new Map(), "clipboard"), answers)).toBeNull()
    expect(drawingText(wolframPlan("![](.drawings/media/cat.png)", MEDIA, new Map([["cat.png", CAT]]), "clipboard"), new Map([["pic-1.txt", BOXES]]))).toBeNull()
  })
})

describe("what fell back", () => {
  const plan = wolframPlan(`${INK}\n\n![](.drawings/media/cat.png)\n\n\`\`\`wl\nx\n\`\`\`\n\n<!-- markdown -->\n\`wl:y\``, MEDIA, new Map([["cat.png", CAT]]), "file")

  it("counts the images and the maths without an answer", () => {
    expect(fallbacks(plan, new Map())).toEqual({ images: 2, maths: 2 })
    expect(fallbacks(plan, new Map([["ink-1.svg", BOXES], ["wl-1.wl", "x"]]))).toEqual({ images: 1, maths: 1 })
    expect(fallbacks(plan, new Map([["ink-1.svg", BOXES], ["pic-1.txt", BOXES], ["wl-1.wl", "x"], ["wl-2.wl", "y"]]))).toEqual({ images: 0, maths: 0 })
  })

  const DETAIL = " Each drawing and picture is a closed cell that makes it: in Mathematica, choose Evaluation ▸ Evaluate Initialization Cells and they appear."

  it("says nothing when every image was made, maths or not", () => {
    expect(exportNotice("Note.nb", { kind: "answered" }, { images: 0, maths: 3 })).toBeNull()
  })

  it("names an engine that is not installed, and Language Setup", () => {
    const notice = exportNotice("Lecture 3.nb", { kind: "missing", refusal: { kind: "missingTool", evaluator: "wolfram", looked: ["wolframscript on the PATH", "/Applications/Wolfram.app"] } }, { images: 2, maths: 0 })
    expect(notice).toEqual({
      message: "“Lecture 3.nb” is written. Its drawings appear when its cells are evaluated.",
      detail: "Wolfram is not installed where WriteMind looks (wolframscript on the PATH, /Applications/Wolfram.app). File ▸ Language Setup… can choose one." + DETAIL,
    })
  })

  it("names a program chosen in Language Setup that has gone, in a Wolfram cell's own words", () => {
    const notice = exportNotice("N.nb", { kind: "missing", refusal: { kind: "missingTool", evaluator: "wolfram", looked: [], chosen: { path: "/x/wolframscript", problem: "gone" } } }, { images: 1, maths: 0 })
    expect(notice!.detail).toBe("Wolfram is set to “/x/wolframscript” in Language Setup, which is not there any more. Choose another in File ▸ Language Setup…, or press Find Automatically there." + DETAIL)
  })

  it("names an engine that is not activated, and one that simply did not answer", () => {
    const locked = evalResult({ stderr: "The Wolfram Engine requires one-time activation on this computer.", status: 255 })
    expect(exportNotice("N.nb", { kind: "silent", path: "/opt/homebrew/bin/wolframscript", result: locked }, { images: 1, maths: 0 })!.detail)
      .toBe("Wolfram Engine is installed but not activated — run `/opt/homebrew/bin/wolframscript -activate` once in a terminal (it asks for your Wolfram ID), then try again." + DETAIL)
    expect(exportNotice("N.nb", { kind: "silent", path: "/w/wolframscript", result: evalResult({ status: 0 }) }, { images: 1, maths: 0 })!.detail)
      .toBe("The Wolfram Engine at /w/wolframscript did not answer." + DETAIL)
  })

  it("names a timeout, an engine that would not start, and drawings it could not make", () => {
    expect(exportNotice("N.nb", { kind: "timedOut", seconds: 120 }, { images: 3, maths: 0 })!.detail)
      .toBe("WriteMind stopped waiting for the Wolfram Engine after 2 minutes; 3 of the drawings were not made." + DETAIL)
    expect(exportNotice("N.nb", { kind: "failed", why: "spawn EACCES" }, { images: 1, maths: 0 })!.detail)
      .toBe("The Wolfram Engine could not be started (spawn EACCES)." + DETAIL)
    expect(exportNotice("N.nb", { kind: "answered" }, { images: 2, maths: 0 })!.detail)
      .toBe("The Wolfram Engine could not make 2 of them." + DETAIL)
  })
})
