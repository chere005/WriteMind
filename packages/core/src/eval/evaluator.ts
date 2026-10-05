/**
 * AN EVALUATION CELL IS NOT A CODE CELL. Ported from `WriteMind/Eval/Evaluator.swift`
 * (Mac commits 0bf52b5, 765195a, 859aa6c; Sean, 2026-09-21: "evaluation cells are completely different from code
 * cells").
 *
 * A code cell is code you are writing ABOUT — coloured, and that is all. An evaluation cell is code the note RUNS,
 * and it says so in the file: its fence is `eval` and then which environment, so the two kinds are never confused
 * by this app, by another markdown editor, or by anyone reading the file.
 *
 *     ```eval wl     ```eval python     ```eval c     ```eval c++     ```eval rust
 *
 * Ctrl+9 makes one, or turns the cell the caret is in into one. Shift+Enter runs it. The mark at its left says
 * which environment it is and changes it.
 *
 * `wl` inside the fence is safe: `isMathFence` compares the WHOLE info string to "wl", and "eval wl" is not that.
 *
 * Nothing here knows where a tool is or how a child is started: that is the shell's (`apps/desktop/src/main/eval`).
 * What a cell runs as, what its source file is called, whether it compiles and what a compiler is handed are the
 * model's, so adding an environment is adding a row here and nothing else (859aa6c).
 */

import { languageFrom, type CodeLanguage } from "../markdown/code"

/** WOLFRAM FIRST (Sean, 2026-09-22: "default to wolfram"). The order here is the order the menu offers them in. */
export type Evaluator = "wolfram" | "python" | "c" | "cpp" | "rust"
export const EVALUATORS: Evaluator[] = ["wolfram", "python", "c", "cpp", "rust"]

/**
 * What a NEW evaluation cell is until one has been picked (Sean, 2026-09-22, in the Mac's open TODO a608cc3:
 * "default to wolfram"; and then "remember last used cell type when inserting" — the shell remembers the pick).
 */
export const DEFAULT_EVALUATOR: Evaluator = "wolfram"

export const EVAL_FENCE_PREFIX = "eval"

interface Row { tag: string; language: CodeLanguage; badge: string; title: string; sourceFile: string | null; compiled: boolean }

const ROWS: Record<Evaluator, Row> = {
  // Wolfram takes its source as an argument (`-code`), so it writes no file.
  wolfram: { tag: "wl", language: "wolfram", badge: "WL", title: "Wolfram", sourceFile: null, compiled: false },
  python: { tag: "python", language: "python", badge: "PY", title: "Python", sourceFile: "cell.py", compiled: false },
  c: { tag: "c", language: "c", badge: "C", title: "C", sourceFile: "cell.c", compiled: true },
  cpp: { tag: "c++", language: "cpp", badge: "C++", title: "C++", sourceFile: "cell.cpp", compiled: true },
  rust: { tag: "rust", language: "rust", badge: "RS", title: "Rust", sourceFile: "cell.rs", compiled: true },
}

export const isEvaluator = (value: unknown): value is Evaluator =>
  typeof value === "string" && (EVALUATORS as string[]).includes(value)

/** What follows `eval` in the fence. */
export const evaluatorTag = (evaluator: Evaluator): string => ROWS[evaluator].tag
/** The whole info string an evaluation cell carries. */
export const evaluatorFence = (evaluator: Evaluator): string => `${EVAL_FENCE_PREFIX} ${ROWS[evaluator].tag}`
/** What the body is COLOURED as: an evaluation cell is still code to look at. */
export const evaluatorLanguage = (evaluator: Evaluator): CodeLanguage => ROWS[evaluator].language
/** What the mark on the cell's left shows — short, because it is drawn in the margin beside the code. */
export const evaluatorBadge = (evaluator: Evaluator): string => ROWS[evaluator].badge
export const evaluatorTitle = (evaluator: Evaluator): string => ROWS[evaluator].title

const words = (fence: string | null | undefined): string[] =>
  (fence ?? "").trim().toLowerCase().split(/[ \t]+/).filter((word) => word.length > 0)

/**
 * The environment an info string names, or null when the block is not an evaluation cell at all. A CODE cell —
 * `python`, `cpp`, `wl` on their own — is not one, and never runs.
 */
export function evaluatorFrom(fence: string | null | undefined): Evaluator | null {
  const all = words(fence)
  if (all[0] !== EVAL_FENCE_PREFIX || all.length < 2) return null
  const tag = all[1]!
  const exact = EVALUATORS.find((evaluator) => ROWS[evaluator].tag === tag)
  if (exact) return exact
  // `cpp`, `py` and `mathematica` are what somebody types by hand; the app always writes the canonical tag back.
  const language = languageFrom(tag)
  return EVALUATORS.find((evaluator) => ROWS[evaluator].language === language) ?? null
}

/** Whether this block is an evaluation cell, whatever environment it names — including one this app does not know. */
export const isEvaluation = (fence: string | null | undefined): boolean => words(fence)[0] === EVAL_FENCE_PREFIX

/**
 * WHAT A FENCE'S BODY IS COLOURED AS, whichever kind of cell it is (the Mac's `CodeLanguage.colouring(fence:)`).
 * One reader, so the markdown side, the rendered page and the PDF cannot disagree. An `eval` fence naming an
 * environment this app does not know is still not a code cell, and guessing a highlighter for it would make it look
 * like one: plain.
 */
export function colouring(fence: string | null | undefined): CodeLanguage | null {
  const evaluator = evaluatorFrom(fence)
  if (evaluator) return ROWS[evaluator].language
  if (isEvaluation(fence)) return "plain"
  return languageFrom(fence)
}

// MARK: - The two shapes a cell runs in

/** The file the source is written to — the extension is what tells a compiler what it is reading. */
export const sourceFile = (evaluator: Evaluator): string | null => ROWS[evaluator].sourceFile

/** A COMPILED cell is two processes and two exit codes; an interpreted one is a single child. */
export const isCompiled = (evaluator: Evaluator): boolean => ROWS[evaluator].compiled

/**
 * Which family of compiler was found. gcc, clang and rustc take `-o out in`; Microsoft's `cl` takes `/Fe:out in`
 * (port-only: a Mac has no `cl`).
 */
export type CompilerFlavor = "gnu" | "msvc"

/**
 * What the compiler is handed. The standard is named rather than left to the tool's default, so a cell means the
 * same thing on a machine with a different compiler on it.
 */
export function compileArguments(evaluator: Evaluator, source: string, output: string,
  flavor: CompilerFlavor = "gnu"): string[] {
  if (flavor === "msvc") {
    switch (evaluator) {
      case "c": return ["/nologo", "/std:c17", "/EHsc", `/Fe:${output}`, source]
      case "cpp": return ["/nologo", "/std:c++20", "/EHsc", `/Fe:${output}`, source]
      default: break
    }
  }
  switch (evaluator) {
    case "c": return ["-std=c17", "-o", output, source]
    case "cpp": return ["-std=c++20", "-o", output, source]
    // rustc warns loudly about a crate name it inferred from a file called `cell`; naming the binary is enough to
    // quiet it, and `-O` because a cell is run once and read once.
    case "rust": return ["-O", "-o", output, source]
    case "python": case "wolfram": return []
  }
}

/**
 * WHAT THE SHELL LOOKS FOR, by name, on the PATH (port-only: the Mac lists absolute paths because a GUI app there
 * inherits launchd's PATH; a Windows app inherits the person's). The order is the order they are tried in. Python
 * is the `py` launcher first, because `python.exe` on a stock Windows is the Microsoft Store's placeholder.
 */
export function toolNames(evaluator: Evaluator): string[] {
  switch (evaluator) {
    case "wolfram": return ["wolframscript"]
    case "python": return ["py", "python3", "python"]
    case "c": return ["gcc", "clang", "cl"]
    case "cpp": return ["g++", "clang++", "cl"]
    case "rust": return ["rustc"]
  }
}

// MARK: - What is refused, and why

/** Why a cell will not run. Every one is a sentence a person can act on; none spawns anything or writes a cell. */
export type Refusal =
  | { kind: "notAnEvaluationCell" }
  | { kind: "unknownEnvironment"; tag: string }
  | { kind: "missingTool"; evaluator: Evaluator; looked: string[] }
  /** An unclosed fence parses to the END OF THE NOTE, so the answer would close the cell it was meant to sit under. */
  | { kind: "unclosed" }

export function refusalMessage(refusal: Refusal): string {
  switch (refusal.kind) {
    case "notAnEvaluationCell":
      return "That is not an evaluation cell. Ctrl+9 makes one, or turns the cell the caret is in into one."
    case "unknownEnvironment": {
      // The list is GENERATED, so adding an environment cannot leave a sentence behind naming the old ones.
      const known = EVALUATORS.map(evaluatorTitle)
      return `This cell says it runs as “${refusal.tag}”, which is not one of `
        + `${known.slice(0, -1).join(", ")} or ${known[known.length - 1] ?? ""}. Pick one from the mark on its left.`
    }
    case "missingTool":
      return `${evaluatorTitle(refusal.evaluator)} is not installed where WriteMind looks (${refusal.looked.join(", ")}).`
    case "unclosed":
      return "That cell has no closing ``` yet, so there is nothing to run."
  }
}

/** What a cell's info string means for running it: an environment, or the reason there is not one. */
export function resolveEvaluator(fence: string | null | undefined):
  { ok: true; evaluator: Evaluator } | { ok: false; refusal: Refusal } {
  if (!isEvaluation(fence)) return { ok: false, refusal: { kind: "notAnEvaluationCell" } }
  const evaluator = evaluatorFrom(fence)
  if (!evaluator) {
    const all = (fence ?? "").trim().split(/[ \t]+/)
    return { ok: false, refusal: { kind: "unknownEnvironment", tag: all.length > 1 ? all[1]! : "" } }
  }
  return { ok: true, evaluator }
}

/**
 * SHIFT+ENTER RUNS AN EVALUATION CELL (Sean, 2026-09-21: "to evaluate this kind of cell, it's shift+enter"), and
 * nothing else with it held does: Ctrl, Alt or Meta with it is some other key.
 */
export function isRunKey(modifiers: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey
}
