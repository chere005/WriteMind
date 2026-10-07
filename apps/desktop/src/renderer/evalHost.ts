/**
 * What the notebook's evaluation cells are given by the app (`EvalHost` in `@writemind/editor`): the shell's runner
 * through `window.wm.evaluate`, and the environment a new cell is — Wolfram until one has been picked, then
 * whichever was picked last (Sean, 2026-09-22, the Mac's open TODO a608cc3: "default to wolfram", "remember last
 * used cell type when inserting"). Remembered per person in localStorage, like the list style beside it.
 *
 * And File ▸ Language Setup… (port-only): every open note follows what is in use (`onToolsChanged`, the shell's
 * push), and the Runs As menu's Language Setup… opens the screen at the cell's language through the opener App
 * registers (`setLanguageSetupOpener`).
 */

import { DEFAULT_EVALUATOR, isEvaluator, type Evaluator } from "@writemind/core"
import type { EvalHost } from "@writemind/editor"

export const EVALUATOR_KEY = "writemind.evaluator"

export function rememberedEvaluator(): Evaluator {
  try {
    const raw = localStorage.getItem(EVALUATOR_KEY)
    const value = raw === null ? null : JSON.parse(raw) as unknown
    return isEvaluator(value) ? value : DEFAULT_EVALUATOR
  } catch { return DEFAULT_EVALUATOR }
}

export function rememberEvaluator(evaluator: Evaluator): void {
  try { localStorage.setItem(EVALUATOR_KEY, JSON.stringify(evaluator)) } catch { /* a private window: this launch only */ }
}

/** How App opens Language Setup (null while App is not mounted). */
let opener: ((evaluator: Evaluator | null) => void) | null = null

/** App's way to open File ▸ Language Setup… at a language; null takes it back. */
export function setLanguageSetupOpener(open: ((evaluator: Evaluator | null) => void) | null): void {
  opener = open
}

export const evalHostOfApp: EvalHost = {
  run: (request) => window.wm.evaluate.run(request),
  cancel: (id) => { void window.wm.evaluate.cancel(id) },
  tools: () => window.wm.evaluate.tools(),
  evaluator: rememberedEvaluator,
  remember: rememberEvaluator,
  onToolsChanged: (listener) => window.wm.languages?.onChanged((report) => listener(report.tools)) ?? (() => {}),
  openLanguageSetup: (evaluator) => opener?.(evaluator),
}
