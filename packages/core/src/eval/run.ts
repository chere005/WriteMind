/**
 * What a run asks for and what comes back across the boundary between the page and the shell — the shape of the
 * Mac's `CellRunner.run(_:as:) -> Result<EvalResult, Failure>` and of `NoteStore.landed`, as plain data so it can
 * cross an IPC channel. Port-only file; the Swift keeps these as enums in `CellRunner.swift` / `NoteStoreEval.swift`.
 */

import { evaluatorTitle, refusalMessage, type Evaluator, type Refusal } from "./evaluator"
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

/** Where each environment's tool is on this machine, or null with the names that were looked for. */
export type ToolReport = Record<Evaluator, { path: string | null; looked: string[] }>

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
