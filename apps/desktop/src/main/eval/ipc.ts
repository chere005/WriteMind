/**
 * The page's three questions about evaluation cells, answered in the main process (`shared/eval.ts` names them):
 * run ONE cell, take a run back, and where each environment's tool is. Every run a window asked for is taken back
 * when that window's page goes away, and every run at all when the app quits.
 */

import type { IpcMain, WebContents } from "electron"
import { isEvaluator, type RunOutcome, type RunRequest } from "@writemind/core"
import { EVAL_CHANNELS } from "../../shared/eval"
import { createProcessRunner, type Runner } from "./runner"

/** Larger than any cell anybody types; a request past it is not a cell. */
const MAX_SOURCE = 1024 * 1024

export function validRequest(raw: unknown): RunRequest | null {
  if (typeof raw !== "object" || raw === null) return null
  const { id, evaluator, source } = raw as Record<string, unknown>
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return null
  if (!isEvaluator(evaluator)) return null
  if (typeof source !== "string" || source.length > MAX_SOURCE) return null
  return { id, evaluator, source }
}

export function registerEval(ipcMain: IpcMain, runner: Runner = createProcessRunner()): Runner {
  const owned = new Map<number, Set<string>>()
  const own = (sender: WebContents, id: string) => {
    let ids = owned.get(sender.id)
    if (!ids) {
      ids = new Set()
      owned.set(sender.id, ids)
      const senderId = sender.id
      // The page closed or reloaded: what it asked for is nobody's any more.
      sender.once("destroyed", () => {
        for (const run of owned.get(senderId) ?? []) runner.cancel(run)
        owned.delete(senderId)
      })
    }
    ids.add(id)
  }
  ipcMain.handle(EVAL_CHANNELS.run, async (event, raw: unknown): Promise<RunOutcome> => {
    const request = validRequest(raw)
    if (!request) return { kind: "refused", refusal: { kind: "notAnEvaluationCell" } }
    const senderId = event.sender.id
    own(event.sender, request.id)
    try { return await runner.run(request) } finally { owned.get(senderId)?.delete(request.id) }
  })
  ipcMain.handle(EVAL_CHANNELS.cancel, (_event, id: unknown) => { if (typeof id === "string") runner.cancel(id) })
  ipcMain.handle(EVAL_CHANNELS.tools, () => runner.tools())
  return runner
}
