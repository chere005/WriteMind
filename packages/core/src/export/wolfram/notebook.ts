/**
 * The planned cells (plan.ts) with the kernel's answers put in: the `.nb` file, the clipboard's cells, and what an
 * export says when its drawings could not be made.
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * AN IMAGE THE KERNEL MADE IS AN OUTPUT CELL THAT IS NOT GENERATED (`GeneratedCell -> False, CellAutoOverwrite ->
 * False`): it is part of the note, so running the Input above it in the notebook does not delete it. An image it did
 * not make is the Input cell that makes it (`imageFallbackCell`), and a picture's bytes go into that cell only then
 * (`pictureData`), so a notebook the engine answered carries each picture once.
 */

import { refusalMessage, type Refusal } from "../../eval/evaluator"
import { wolframNote, wolframTrouble, type EvalResult } from "../../eval/output"
import { imageFallbackCell, pictureCode, type PlannedCell, type Slot, type WolframPlan } from "./plan"
import { linearSyntax, wlString } from "./text"

/** How the engine took the run: everything answered, or why the rest fell back. */
export type EngineState =
  | { kind: "answered" }
  /** Not found where WriteMind looks, or Language Setup's choice is not there (the refusal a Wolfram cell shows). */
  | { kind: "missing"; refusal: Refusal }
  /** It ran and never said it was done: not activated, no kernel, or it simply did not answer. */
  | { kind: "silent"; path: string; result: EvalResult }
  | { kind: "timedOut"; seconds: number }
  | { kind: "failed"; why: string }
  | { kind: "cancelled" }

const tagging = (tag: string): string => `TaggingRules -> {"WriteMind" -> "${tag}"}`

/** One slot, answered or not. */
function slotText(slot: Slot, answers: ReadonlyMap<string, string>, pictureData: ReadonlyMap<string, string>,
  use: "file" | "clipboard"): string {
  const answer = answers.get(slot.job)?.trim()
  if (answer) {
    switch (slot.as) {
      case "image":
        return `Cell[BoxData[${answer}], "Output", GeneratedCell -> False, CellAutoOverwrite -> False, ${tagging(slot.tag ?? "ink")}]`
      case "maths": return `Cell[BoxData[${answer}], "Input", ${tagging("maths")}]`
      case "inline": return `Cell[BoxData[${answer}], "InlineFormula"]`
    }
  }
  if (typeof slot.fallback === "string") return slot.fallback
  const data = pictureData.get(slot.fallback.picture)
  // A picture that could be found but not read when the file was written: its words, as when it is missing.
  if (data === undefined) {
    return `Cell[TextData[StyleBox[${wlString(slot.fallback.words)}, FontSlant -> "Italic"]], "Text", FontColor -> GrayLevel[0.55]]`
  }
  return imageFallbackCell(pictureCode(data, slot.fallback.format, slot.fallback.shown), "picture", use)
}

const cellText = (cell: PlannedCell, answers: ReadonlyMap<string, string>, pictureData: ReadonlyMap<string, string>,
  use: "file" | "clipboard"): string =>
  cell.pieces.map((piece) => (typeof piece === "string" ? piece : slotText(piece, answers, pictureData, use))).join("")

const imageSlot = (cell: PlannedCell): Slot | undefined =>
  cell.pieces.find((piece): piece is Slot => typeof piece !== "string" && piece.as === "image")

/**
 * The notebook file: the header the front end writes, then `Notebook[{…}]`. ASCII by construction, LF line endings.
 * No cache and no `NotebookFileLineBreakTest`: the front end makes both the first time it saves the file.
 */
export function notebookText(plan: WolframPlan, answers: ReadonlyMap<string, string>,
  pictureData: ReadonlyMap<string, string>, version: string): string {
  const cells = plan.cells.map((cell) => cellText(cell, answers, pictureData, plan.use))
  return "(* Content-type: application/vnd.wolfram.mathematica *)\n\n"
    + "(*** Wolfram Notebook File ***)\n(* http://www.wolfram.com/nb *)\n\n"
    + `(* Written by WriteMind ${version.replace(/[^\x20-\x7e]|\*\)/g, "")} *)\n\n`
    + "Notebook[{\n" + cells.join(",\n\n") + "\n},\n"
    + `TaggingRules -> {"WriteMind" -> {"Version" -> ${wlString(version)}}}\n]\n`
}

/**
 * Held cells as the front end's own clipboard holds them: one `Cell[…]`, or several as the list its Copy writes
 * (`{\nCell[…],\n\nCell[…]\n}`, recorded from the front end).
 */
export function clipboardCells(plan: WolframPlan, answers: ReadonlyMap<string, string>): string {
  const cells = plan.cells.map((cell) => cellText(cell, answers, new Map(), plan.use))
  return cells.length === 1 ? cells[0]! : "{\n" + cells.join(",\n\n") + "\n}"
}

/**
 * The plain text the front end puts on the clipboard for image cells — their boxes in linear syntax, which it turns
 * back into the image when that text is pasted — for a copy that is ONLY drawings, every one answered; null
 * otherwise (the words the copy wrote stay).
 */
export function drawingText(plan: WolframPlan, answers: ReadonlyMap<string, string>): string | null {
  if (plan.cells.length === 0) return null
  const texts: string[] = []
  for (const cell of plan.cells) {
    const slot = imageSlot(cell)
    const answer = slot ? answers.get(slot.job)?.trim() : undefined
    if (!cell.drawing || !answer) return null
    texts.push(linearSyntax(answer))
  }
  return texts.join("\n\n")
}

/** How many images and how many maths cells (and inline formulas) have no answer. */
export function fallbacks(plan: WolframPlan, answers: ReadonlyMap<string, string>): { images: number; maths: number } {
  let images = 0
  let maths = 0
  for (const cell of plan.cells) {
    for (const piece of cell.pieces) {
      if (typeof piece === "string" || answers.get(piece.job)?.trim()) continue
      if (piece.as === "image") images++
      else maths++
    }
  }
  return { images, maths }
}

const duration = (seconds: number): string =>
  seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? "" : "s"}` : `${seconds} seconds`

/**
 * What File ▸ Export… says after a notebook was written whose drawings could not all be made (null: there is
 * nothing to say — every image was made, or there were none; a maths cell without its answer is still a correct
 * Input cell and says nothing). The why is the engine's state, in the words a Wolfram cell would use.
 */
export function exportNotice(fileName: string, state: EngineState, missing: { images: number; maths: number }):
  { message: string; detail: string } | null {
  if (missing.images === 0) return null
  let why: string
  switch (state.kind) {
    case "missing":
      why = refusalMessage(state.refusal)
      // The sentence for an engine that is simply not there names no way forward; one about Language Setup does.
      if (!/Language Setup/.test(why)) why += " File ▸ Language Setup… can choose one."
      break
    case "silent": {
      const trouble = wolframTrouble(state.result) ? wolframNote(state.result, "wolfram", state.path) : null
      why = trouble ? `${trouble}.` : `The Wolfram Engine at ${state.path} did not answer.`
      break
    }
    case "timedOut":
      why = `WriteMind stopped waiting for the Wolfram Engine after ${duration(state.seconds)}; `
        + `${missing.images} of the drawings ${missing.images === 1 ? "was" : "were"} not made.`
      break
    case "failed":
      why = `The Wolfram Engine could not be started (${state.why}).`
      break
    case "cancelled":
      why = "The Wolfram Engine's run was stopped before it finished."
      break
    case "answered":
      why = `The Wolfram Engine could not make ${missing.images} of them.`
      break
  }
  return {
    message: `“${fileName}” is written. Its drawings appear when its cells are evaluated.`,
    detail: `${why} Each drawing and picture is a closed cell that makes it: in Mathematica, choose `
      + "Evaluation ▸ Evaluate Initialization Cells and they appear.",
  }
}
