/**
 * Evaluation cells across the page / shell boundary: the channel names, spelled once, and the API the preload
 * exposes as `window.wm.evaluate`. The runner itself is in the main process (`main/eval/runner.ts`), the only place a
 * cell's code is started; the page asks for ONE cell, by a press, and gets the outcome back in memory.
 */

import type { RunOutcome, RunRequest, ToolReport } from "@writemind/core"

export const EVAL_CHANNELS = {
  run: "eval:run",
  cancel: "eval:cancel",
  tools: "eval:tools",
} as const

export interface EvalApi {
  /** Run ONE cell's source. Only ever called from Shift+Enter in that cell (`packages/editor/src/eval`). */
  run(request: RunRequest): Promise<RunOutcome>
  /** Take a run back: its child (and the child's own children) are killed and its scratch folder removed. */
  cancel(id: string): Promise<void>
  /** Where each environment's tool is on this machine — what the cell's mark says about a missing one. */
  tools(): Promise<ToolReport>
}
