/**
 * What a run asks for and what comes back across the boundary between the page and the shell — the shape of the
 * Mac's `CellRunner.run(_:as:) -> Result<EvalResult, Failure>` and of `NoteStore.landed`, as plain data so it can
 * cross an IPC channel. Port-only file; the Swift keeps these as enums in `CellRunner.swift` / `NoteStoreEval.swift`.
 */

import { evaluatorTitle, refusalMessage, type ChosenProblem, type Evaluator, type Refusal } from "./evaluator"
import { evalResult, type EvalResult } from "./output"

export interface RunRequest {
  /** Chosen by the page; the same id cancels it. */
  id: string
  evaluator: Evaluator
  source: string
}

export type RunOutcome =
  | { kind: "ran"; result: EvalResult }
  /** Nothing was started: a sentence for the person, and NO Out cell. */
  | { kind: "refused"; refusal: Refusal }
  /** The tool was there and would not start: that IS an answer, written into the Out cell. */
  | { kind: "couldNotStart"; why: string }
  /** Taken back — the note closed, the app quit, or the page asked. Nothing is written and nothing is said. */
  | { kind: "cancelled" }

/**
 * Where ONE environment's tool is on this machine, or null with what was looked for. `chosen` is there only when a
 * program was chosen in File ▸ Language Setup… (port-only): its path, and why it cannot be used (null: it can, and
 * `path` is it). An entry with no choice has no `chosen` key at all, so a report from before the choice existed
 * reads the same.
 */
export interface ToolEntry { path: string | null; looked: string[]; chosen?: { path: string; problem: ChosenProblem | null } }

/** Where each environment's tool is on this machine, or null with the names that were looked for. */
export type ToolReport = Record<Evaluator, ToolEntry>

/**
 * THE ONE BUILDER of "this language's tool is not there": the runner's refusal, the cell mark's tooltip and the Runs
 * As menu's all come from here, so the three cannot tell a person three different things about one missing program.
 */
export function missingToolRefusal(evaluator: Evaluator, entry: ToolEntry): Refusal {
  const chosen = entry.chosen
  return {
    kind: "missingTool", evaluator, looked: entry.looked,
    ...(chosen && chosen.problem !== null ? { chosen: { path: chosen.path, problem: chosen.problem } } : {}),
  }
}

/**
 * What lands in the note for an outcome: an Out cell's result, or a sentence for the person, or nothing at all.
 * (`NoteStore.landed` on the Mac.)
 */
export function landingFor(outcome: RunOutcome, evaluator: Evaluator):
  { kind: "write"; result: EvalResult } | { kind: "say"; message: string } | { kind: "nothing" } {
  switch (outcome.kind) {
    case "ran": return { kind: "write", result: outcome.result }
    case "refused": return { kind: "say", message: refusalMessage(outcome.refusal) }
    case "cancelled": return { kind: "nothing" }
    case "couldNotStart":
      return { kind: "write", result: evalResult({ note: `could not start ${evaluatorTitle(evaluator)}: ${outcome.why}` }) }
  }
}
