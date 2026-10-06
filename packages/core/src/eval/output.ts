/**
 * What came back from a run, and what the Out cell says. Ported from `WriteMind/Eval/EvalOutput.swift` and the pure
 * parts of `WriteMind/Eval/CellRunner.swift` (`withoutTrailingNull`, `wolframNote`).
 *
 * THE OUT CELL is a fenced block written into the note under the cell that was run, and replaced by the next run of
 * that same cell. It is an `out` fence and nothing cleverer: `languageFrom` returns null for it, so it draws as plain
 * monospace everywhere already, and `isMathFence` is false for it. No new block kind, no parser change, and the
 * answer travels with the note into any other markdown editor.
 *
 * ONE CONVENTION INSIDE IT: a line in square brackets is the app talking; every other line came out of the process.
 */

import type { Block } from "../markdown/parser"
import type { Evaluator } from "./evaluator"

export interface EvalResult {
  stdout: string
  stderr: string
  /** Null when the run never finished — a timeout, or a tool that would not start. */
  status: number | null
  timedOut: boolean
  /** The output was longer than this app will put in a note. */
  truncated: boolean
  /** Something the app itself wants to say — a tool that would not start, an engine that is not activated. */
  note: string | null
}

export const evalResult = (fields: Partial<EvalResult> = {}): EvalResult => ({
  stdout: "", stderr: "", status: null, timedOut: false, truncated: false, note: null, ...fields,
})

/** The info string an Out cell carries. */
export const OUT_FENCE = "out"
/** How much of a run's output goes in a note. A cell that prints forever must not grow the file forever. */
export const OUTPUT_BYTE_LIMIT = 64 * 1024

export function isOut(block: Block): boolean {
  if (block.kind !== "code") return false
  return (block.language ?? "").trim().toLowerCase() === OUT_FENCE
}

/** The whole cell, fences and all. */
export const outCell = (result: EvalResult): string => "```" + OUT_FENCE + "\n" + outBody(result) + "\n```"

/** Leading and trailing newlines off, as `trimmingCharacters(in: .newlines)` does. */
const trimNewlines = (text: string): string => text.replace(/^[\r\n]+|[\r\n]+$/g, "")

/**
 * A Windows program ends its lines with CR LF (port-only: the Mac never sees one). The note's lines end with LF, so
 * a CR is taken off before anything else is asked of the output.
 */
const lf = (text: string): string => text.replace(/\r\n?/g, "\n")

/** What goes between the fences. */
export function outBody(result: EvalResult): string {
  const lines: string[] = []
  // Trailing newlines go, because every program ends with one and an Out cell should not end with a blank line.
  // WHETHER there is anything at all is asked of whitespace too: a program that printed three spaces has said
  // nothing, and a line of three spaces in the note looks like a bug rather than an answer.
  const out = trimNewlines(lf(result.stdout))
  if (out.trim().length > 0) lines.push(...out.split("\n").map(escapedOutLine))
  const errors = trimNewlines(lf(result.stderr))
  if (errors.trim().length > 0) {
    lines.push("[stderr]")
    lines.push(...errors.split("\n").map(escapedOutLine))
  }
  if (result.note !== null) lines.push(`[${result.note}]`)
  if (result.truncated) lines.push(`[output cut at ${OUTPUT_BYTE_LIMIT / 1024} KB]`)
  if (result.timedOut) lines.push("[timed out]")
  if (result.status !== null && result.status !== 0) lines.push(`[exit ${result.status}]`)
  // An Out cell is never an empty fence: a run that printed nothing still has to look like a run that happened.
  return lines.length === 0 ? "[no output]" : lines.join("\n")
}

/**
 * A line of a program's output that would CLOSE THE FENCE, made harmless. The parser ends a fenced block at any line
 * whose TRIMMED form begins with three backticks, so indenting does not save it; a backslash in front is markdown's
 * own escape and is what the parser no longer closes on.
 */
export const escapedOutLine = (line: string): string => (line.trim().startsWith("```") ? "\\" + line : line)

/**
 * `-code` prints the value of the last expression, and a cell whose last expression was a `Print` has the value
 * `Null`. That is Wolfram saying "nothing more", not an answer.
 */
export function withoutTrailingNull(out: string): string {
  const lines = out.split("\n")
  while (lines.length > 0 && lines[lines.length - 1]!.trim().length === 0) lines.pop()
  if (lines.length === 0 || lines[lines.length - 1]!.trim() !== "Null") return out
  lines.pop()
  return lines.join("\n")
}

/**
 * Wolfram Engine installed and NOT ACTIVATED fails TWO different ways that BOTH exit 255 with nothing on stdout — so
 * the status cannot tell them apart and stderr has to, MATCHED ON THE WORDS IT ACTUALLY SAYS. The app says which,
 * and never tries to activate anything or ask for a licence (the child's stdin is the null device, so the engine's
 * Wolfram ID prompt gets EOF instead of hanging).
 */
export function wolframNote(result: EvalResult, evaluator: Evaluator, tool?: string): string | null {
  if (evaluator !== "wolfram" || result.status === 0) return result.note
  const command = wolframCommand(tool)
  switch (wolframTrouble(result)) {
    case "notActivated":
      return `Wolfram Engine is installed but not activated — run \`${command} -activate\` once in a terminal (it asks for your Wolfram ID), then try again`
    case "noKernel":
      return `Wolfram Engine's kernel was not found — run \`${command} -configure\` once in a terminal`
    case null:
      return result.note
  }
}

/**
 * WHICH of the two not-activated failures stderr describes, by the words it actually says (see `wolframNote`), or
 * null for anything else. Port-only as a function of its own: File ▸ Language Setup…'s Test asks it too, so the two
 * cannot read one engine's complaint differently.
 */
export function wolframTrouble(result: EvalResult): "notActivated" | "noKernel" | null {
  const errors = result.stderr.toLowerCase()
  if (errors.includes("activat")) return "notActivated"
  if (errors.includes("kernel") && errors.includes("could not be determined")) return "noKernel"
  return null
}

/**
 * THE COMMAND AS IT CAN BE TYPED in the terminal of the machine it was found on (port-only). The Wolfram Engine's
 * installer puts wolframscript in its version folder and not on the PATH, so a bare `wolframscript` in a terminal is
 * "not recognized": the tool that was found is named. A Windows path goes in quotes with PowerShell's call operator
 * in front (Windows' default terminal: a quoted path alone is only a string there). A Mac or Linux path is typed
 * into zsh or bash, where `&` is a parse error, so it goes bare when nothing in it is special to a shell and in
 * single quotes when something is (a space in "Wolfram Engine.app"), each `'` in it closed, escaped and reopened.
 */
export function wolframCommand(tool?: string): string {
  if (!tool || !/[\\/]/.test(tool)) return "wolframscript"
  if (/^[A-Za-z]:/.test(tool) || tool.includes("\\")) return `& "${tool}"`
  if (/^[\w@%+=:,./-]+$/.test(tool)) return tool
  return `'${tool.replace(/'/g, "'\\''")}'`
}
