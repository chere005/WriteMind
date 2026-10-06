/**
 * WHAT FILE ▸ LANGUAGE SETUP… ASKS A PROGRAM, AND WHAT ITS ANSWER MEANS. Port-only: the Mac has no such screen (its
 * override is `defaults write … evalTool.<name>`, read in `Evaluator.tool()`), so there is no Swift file behind this
 * one and its tests (`test/evalProbe.test.ts`) are the port's own.
 *
 * Two questions, both asked only from a press in that screen and never when it opens:
 *
 * - IDENTIFY (Choose… and Use): is the picked file the program it says it is? A version probe — `wolframscript
 *   -version` (it answers in a hundredth of a second without starting a kernel), `--version` from a compiler, and for
 *   Python a line of code that prints its version and where it is, because a Python 2, Windows' Store placeholder and
 *   Apple's stand-in that needs the Command Line Tools are all called `python3` and none of them can run a cell. The
 *   shell starts it (`Runner.identify`); this file only reads what came back.
 * - TEST: does a cell actually run? A fixed program (`TEST_SOURCE`, never a note's text) sent through the runner as a
 *   cell would be, so it meets every guard a cell meets, and what came back said in one sentence.
 *
 * Every failure is a sentence a person can act on, with the command to type when there is one.
 */

import { refusalMessage, type Evaluator } from "./evaluator"
import { wolframCommand, wolframNote, wolframTrouble, type EvalResult } from "./output"
import type { RunOutcome } from "./run"

/** Python's identity: the version on the first line, the interpreter's own path on the second. */
export const IDENTIFY_PYTHON = "import sys; print('%d.%d.%d' % sys.version_info[:3]); print(sys.executable)"

/** What Test runs, per language: the smallest program that shows the whole path a cell takes works. */
export const TEST_SOURCE: Record<Evaluator, string> = {
  wolfram: "$Version",
  python: "import sys\nprint('%d.%d.%d' % sys.version_info[:3])\nprint(sys.executable)\n",
  c: "#include <stdio.h>\nint main(void) { puts(\"ok\"); return 0; }\n",
  cpp: "#include <iostream>\nint main() { std::cout << \"ok\\n\"; }\n",
  rust: "fn main() { println!(\"ok\"); }\n",
}

/** What a version probe can come back as: it is never refused, because the file it asks was named by the person. */
export type ProbeOutcome = Exclude<RunOutcome, { kind: "refused" }>

/** A picked program, identified (`said`: how it describes itself; null when nothing was asked, as for `cl`) or not. */
export type Identified = { ok: true; said: string | null } | { ok: false; problem: string; command?: string }

/** What Test found. `said` is what follows "Works: " on the screen. */
export type TestAnswer =
  | { kind: "works"; said: string }
  | { kind: "failed"; problem: string; command?: string }
  | { kind: "cancelled" }

/** The lines of a child's output, whichever line ending it used (a Windows program writes CR LF). */
const lines = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim())
const firstLine = (text: string): string => lines(text).find((line) => line.length > 0) ?? ""

/** "exit 1: the first thing it said on stderr", as a person reads a failure. */
function exitWords(result: EvalResult, fallbackToStdout = false): string {
  const said = firstLine(result.stderr) || (fallbackToStdout ? firstLine(result.stdout) : "")
  return `exit ${result.status ?? "?"}${said ? `: ${said}` : ""}`
}

/**
 * WINDOWS' STORE PLACEHOLDER: an app execution alias called python.exe that prints "Python was not found" and exits
 * 9009 on a machine without the Store's Python. It is a file, it is called python, and it cannot run a cell.
 */
const STORE_PLACEHOLDER = "This is Windows' shortcut to the Microsoft Store, not a Python. Install Python, or choose a python.exe."
const isStorePlaceholder = (result: EvalResult): boolean =>
  result.status === 9009 || `${result.stdout}\n${result.stderr}`.includes("Python was not found")

/** APPLE'S STAND-IN: `/usr/bin/python3` on a Mac without the Command Line Tools runs xcrun, which says it has none. */
const APPLE_STAND_IN = "This is Apple's stand-in for python3, which needs Apple's Command Line Tools first."
const isAppleStandIn = (result: EvalResult): boolean =>
  result.stderr.includes("xcrun: error") || result.stderr.includes("CommandLineTools")

/** Python's answer to `IDENTIFY_PYTHON` / `TEST_SOURCE.python`: a Python 3's version and path, a Python 2's version, or neither. */
function pythonVersion(result: EvalResult): { three: string; where: string } | { two: string } | null {
  const [first = "", second = ""] = lines(result.stdout)
  if (result.status === 0 && /^3\.\d+\.\d+$/.test(first)) return { three: first, where: second }
  if (/^2\.\d+(\.\d+)?$/.test(first)) return { two: first }
  return null
}

const pythonSaid = (version: string, where: string): string => `Python ${version}${where ? ` (${where})` : ""}`

/** What the answer to a version probe means (Choose… and Use, before anything is saved). */
export function identified(evaluator: Evaluator, outcome: ProbeOutcome): Identified {
  if (outcome.kind === "cancelled") return { ok: false, problem: "The check was stopped before it finished." }
  if (outcome.kind === "couldNotStart") return { ok: false, problem: `WriteMind could not start it: ${outcome.why}.` }
  const result = outcome.result
  if (result.timedOut) return { ok: false, problem: "It did not answer within 10 seconds." }
  switch (evaluator) {
    case "python": {
      if (isStorePlaceholder(result)) return { ok: false, problem: STORE_PLACEHOLDER }
      if (isAppleStandIn(result)) return { ok: false, problem: APPLE_STAND_IN, command: "xcode-select --install" }
      const version = pythonVersion(result)
      if (version && "three" in version) return { ok: true, said: pythonSaid(version.three, version.where) }
      if (version) return { ok: false, problem: `This is Python ${version.two}. Python cells need Python 3.` }
      return { ok: false, problem: `It did not answer like Python 3 (${exitWords(result)}).` }
    }
    case "wolfram": {
      // `WolframScript 1.14.0 for Mac OS X ARM (64-bit)`: measured on 2026-10-06, at 0.02 s, with no kernel started.
      const first = firstLine(result.stdout)
      return /^WolframScript \d+(\.\d+)*/.test(first)
        ? { ok: true, said: first }
        : { ok: false, problem: "It did not answer like wolframscript." }
    }
    case "c": case "cpp": case "rust":
      return result.status === 0
        ? { ok: true, said: firstLine(result.stdout) || null }
        : { ok: false, problem: `It did not answer to --version (${exitWords(result, true)}).` }
  }
}

/**
 * Windows' STATUS_DLL_NOT_FOUND, as an unsigned and as a signed exit code: a program MinGW built that cannot find
 * `libstdc++-6.dll` (its compiler's folder is not on the PATH) stops with it before running a line.
 */
const DLL_NOT_FOUND = new Set([3221225781, -1073741515])

/** What Test found, from what the runner gave back for `TEST_SOURCE[evaluator]` run with `tool`. */
export function tested(evaluator: Evaluator, outcome: RunOutcome, tool: string | null): TestAnswer {
  switch (outcome.kind) {
    case "cancelled": return { kind: "cancelled" }
    case "refused": return { kind: "failed", problem: refusalMessage(outcome.refusal) }
    case "couldNotStart": return { kind: "failed", problem: `WriteMind could not start it: ${outcome.why}.` }
    case "ran": break
  }
  const result = outcome.result
  const failed = (problem: string, command?: string): TestAnswer =>
    ({ kind: "failed", problem, ...(command ? { command } : {}) })
  switch (evaluator) {
    case "wolfram": {
      if (result.timedOut) {
        return failed("It did not answer within 20 seconds. The engine's first start can be slow: press Test again.")
      }
      if (result.status === 0) {
        const first = firstLine(result.stdout)
        // Under an environment with no home in it, wolframscript prints NOTHING and exits 0 (measured on the Mac,
        // 2026-09-21): the one failure that looks like a cell that ran and had nothing to say.
        return first
          ? { kind: "works", said: `Wolfram Language ${first}` }
          : failed("wolframscript ran and printed nothing, which is what it does when it cannot find its licence or settings.")
      }
      const trouble = wolframTrouble(result)
      const note = wolframNote({ ...result, note: null }, "wolfram", tool ?? undefined)
      if (trouble === "notActivated" && note) return failed(note, `${wolframCommand(tool ?? undefined)} -activate`)
      if (trouble === "noKernel" && note) return failed(note, `${wolframCommand(tool ?? undefined)} -configure`)
      return failed(`The engine did not start (${exitWords(result)}).`)
    }
    case "python": {
      if (result.timedOut) return failed("It did not answer within 20 seconds.")
      if (isStorePlaceholder(result)) return failed(STORE_PLACEHOLDER)
      if (isAppleStandIn(result)) return failed(APPLE_STAND_IN, "xcode-select --install")
      const version = pythonVersion(result)
      if (version && "three" in version) return { kind: "works", said: pythonSaid(version.three, version.where) }
      if (version) return failed(`This is Python ${version.two}. Python cells need Python 3.`)
      return failed(`It stopped with ${exitWords(result)}.`)
    }
    case "c": case "cpp": case "rust": {
      // The runner's own notes say which half failed (runner.ts `compileAndRun`). Microsoft's cl writes its
      // diagnostics to stdout, the others to stderr.
      if (result.note === "it did not compile") {
        const said = firstLine(result.stderr) || firstLine(result.stdout)
        return failed(`It did not compile a test program${said ? `: ${said}` : "."}`)
      }
      if (result.note === "the compiler timed out") return failed("The compiler did not finish within 20 seconds.")
      if (result.timedOut) return failed("It did not answer within 20 seconds.")
      if (result.status !== null && DLL_NOT_FOUND.has(result.status)) {
        return failed("The test program could not start: a DLL it needs is not on the PATH.")
      }
      if (result.status === 0 && result.stdout.trim() === "ok") return { kind: "works", said: "it compiled and ran a test program." }
      return failed(`The test program stopped with ${exitWords(result, true)}.`)
    }
  }
}
