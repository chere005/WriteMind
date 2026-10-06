/**
 * EVALUATION CELLS in the notebook: Shift+Enter runs the cell the caret is in, Ctrl+Shift+8 makes one, the answer is
 * written under it as an `out` cell and the bar is left under the answer, and the mark at the cell's left says what
 * it runs as — or, once it has run, `In[n]` over the code and `Out[n]` over the answer.
 *
 * The Mac's `NoteStoreEval.swift`, `CellMark.swift` and the evaluation parts of `EditorBridge.swift` /
 * `MarkdownPreview.swift` (commits 0bf52b5, 765195a, 4fad93e, 799b13b, fe14417, 29149b9, df166db). Every RULE is
 * the core's (`packages/core/src/eval`); this file is the measuring, the drawing and the keys.
 *
 * A RUN ONLY EVER STARTS FROM A PRESS: `runCellAt` is reached from Shift+Enter in the cell and from nothing else
 * (`apps/desktop/test/evalRunner.test.ts` reads the sources to keep it that way). The shell does the running; this
 * file only asks, through the `evalHost` the app provides.
 *
 * THE MARK SITS IN THE PAGE'S OWN LEFT MARGIN, an overlay, so an evaluation cell starts at the same x as every other
 * cell (Sean, 2026-09-22, the Mac's open TODO a608cc3: "align further to the left but keep the cell start the
 * same" — the Mac's mark is a 44-point column in front of the cell; here it never was). It is drawn whether the
 * cell is open for typing or not, and in both modes, because it is outside both (fe14417). A note that holds an
 * evaluation cell has a wider margin for it (`EVAL_MARGIN`), so `In[n]` / `Out[n]` are one size and right-aligned
 * on one column, with the language under `In[n]` (Sean, 2026-10-05).
 */

import { Facet, Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { BlockType, EditorView, ViewPlugin, keymap, type Command, type ViewUpdate } from "@codemirror/view"
import { isolateHistory } from "@codemirror/commands"
import {
  caretUnder, DEFAULT_EVALUATOR, end, EVALUATORS, evaluatorFrom, evaluatorTitle, fenced, fenceLanguage,
  firstCellFromBy, groupsOf, isAnswerCell, isEvaluation, isOut, landingFor, landingOf, makeEvaluation, markLanguage, markTitle,
  openCell, outAfter, pairNumber, refusalMessage, resolveEvaluator, setEnvironment, substring, writeAnswer,
  type EvalGroup, type Evaluator, type MarkRole, type PositionedBlock, type RunOutcome, type RunRequest,
  type ToolReport,
} from "@writemind/core"
import { notebook, notebookField } from "../notebook"
import { PAGE_LEFT, PAGE_RIGHT } from "../theme"
import { armedField, armSeam } from "../seams"
import { insideHidden } from "../fold"

/** What the app gives the notebook: the runner (in the shell), and the remembered environment. */
export interface EvalHost {
  run(request: RunRequest): Promise<RunOutcome>
  cancel(id: string): void
  tools(): Promise<ToolReport>
  /** What a NEW evaluation cell is: Wolfram until one has been picked, then whichever was picked last. */
  evaluator(): Evaluator
  /** An environment was picked from a cell's mark: it is what the next new cell is. */
  remember(evaluator: Evaluator): void
}

export const evalHost = Facet.define<EvalHost, EvalHost | null>({ combine: (values) => values[0] ?? null })

// MARK: - State

interface Running { id: string; at: number; evaluator: Evaluator }
interface Notice { at: number; text: string }
interface EvalState { running: Running | null; notice: Notice | null; tools: ToolReport | null }

const setRunning = StateEffect.define<Running | null>()
const setNotice = StateEffect.define<Notice | null>()
const setTools = StateEffect.define<ToolReport>()

export const evalField = StateField.define<EvalState>({
  create: () => ({ running: null, notice: null, tools: null }),
  update(value, transaction) {
    let next = value
    if (transaction.docChanged && (next.running || next.notice)) {
      next = {
        ...next,
        // The cell that is running is followed through the edits made while it runs.
        running: next.running ? { ...next.running, at: transaction.changes.mapPos(next.running.at, 1) } : null,
        // A sentence about the cell goes on the next edit: it was about the note as it was.
        notice: null,
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setRunning)) next = { ...next, running: effect.value }
      else if (effect.is(setNotice)) next = { ...next, notice: effect.value }
      else if (effect.is(setTools)) next = { ...next, tools: effect.value }
    }
    return next
  },
})

/** The cell the caret is in — at the very end of its last line too, where a caret sits after typing. */
function cellAt(state: EditorState, at: number): PositionedBlock | null {
  const cells = notebook(state).cells
  const index = firstCellFromBy(cells, at + 1, (cell) => cell.range) - 1
  const cell = index >= 0 ? cells[index]! : null
  return cell && at <= end(cell.range) ? cell : null
}

/** The In/Out pairs of the whole note, read once per parse (the cells array is new only when the note changed). */
const groupCache = new WeakMap<readonly PositionedBlock[], EvalGroup[]>()
export function groupsIn(state: EditorState): EvalGroup[] {
  const cells = notebook(state).cells
  let groups = groupCache.get(cells)
  if (!groups) { groups = groupsOf(cells as PositionedBlock[]); groupCache.set(cells, groups) }
  return groups
}

/** Whether Shift+Enter means "run" where the caret is: an evaluation cell, and nothing else. */
export function evaluatesHere(state: EditorState): boolean {
  const cell = cellAt(state, state.selection.main.head)
  if (!cell || cell.block.kind !== "code") return false
  const parts = fenced(state.doc.sliceString(cell.range.location, end(cell.range)))
  return parts !== null && isEvaluation(fenceLanguage(parts.open))
}

// MARK: - Running a cell

let runs = 0
const nextId = () => `eval-${Date.now().toString(36)}-${(runs++).toString(36)}`

/**
 * RUN THE CELL THE CARET IS IN AND PUT THE ANSWER UNDER IT (`NoteStore.runCell`). Every refusal is a sentence beside
 * the cell; none of them starts anything or writes a cell. Returns whether the key was the run's.
 */
function runCellAt(view: EditorView, plugin: EvalPlugin): boolean {
  const state = view.state
  const cell = cellAt(state, state.selection.main.head)
  if (!cell || cell.block.kind !== "code") return false
  const text = state.doc.toString()
  const opening = substring(text, cell.range)
  const parts = fenced(opening)
  if (!parts || !isEvaluation(fenceLanguage(parts.open))) return false
  const host = state.facet(evalHost)
  // One at a time, as on the Mac: the key is still the cell's, it just does nothing more.
  if (!host || state.field(evalField).running) return true
  // AN UNCLOSED FENCE IS NOT A CELL YET: it parses to the end of the note, and the answer would close it.
  if (parts.close === "") { plugin.say(view, cell.range.location, refusalMessage({ kind: "unclosed" })); return true }
  const resolved = resolveEvaluator(fenceLanguage(parts.open))
  if (!resolved.ok) { plugin.say(view, cell.range.location, refusalMessage(resolved.refusal)); return true }
  const evaluator = resolved.evaluator
  const running: Running = { id: nextId(), at: cell.range.location, evaluator }
  view.dispatch({ effects: [setRunning.of(running), setNotice.of(null)] })
  void host.run({ id: running.id, evaluator, source: parts.body }).then(
    (outcome) => plugin.landed(view, running, opening, outcome),
    (error: unknown) => plugin.landed(view, running, opening,
      { kind: "couldNotStart", why: error instanceof Error ? error.message : String(error) }),
  )
  return true
}

/** Shift+Enter: run the evaluation cell the caret is in. Anywhere else it is not this key's. */
export const runCell: Command = (view) => {
  const plugin = view.plugin(evalPlugin)
  return plugin ? runCellAt(view, plugin) : false
}

/** Apply a whole-document rewrite as the one change it really is (the seams' own `rewrite`, for Ctrl+Shift+8 at a bar). */
function rewrite(view: EditorView, markdown: string, caret: number): void {
  const old = view.state.doc.toString()
  let from = 0
  const most = Math.min(old.length, markdown.length)
  while (from < most && old.charCodeAt(from) === markdown.charCodeAt(from)) from++
  let tail = 0
  while (tail < most - from && old.charCodeAt(old.length - 1 - tail) === markdown.charCodeAt(markdown.length - 1 - tail)) tail++
  view.dispatch({
    changes: { from, to: old.length - tail, insert: markdown.slice(from, markdown.length - tail) },
    selection: { anchor: caret },
    effects: armSeam.of(null),
    scrollIntoView: true,
    userEvent: "input",
  })
}

/**
 * Ctrl+Shift+8 — AN EVALUATION CELL HERE, of whichever environment was picked last (Wolfram until one has been).
 * AT A BAR THE CELL IS MADE THERE, caret inside it (29149b9: the caret at a bar is parked against the cell BELOW
 * it, so asking for "the caret's cell" turned that cell into one instead). Anywhere else the caret's own fenced cell
 * becomes one, keeping its code; any other cell gets a new one after it.
 */
export const evaluationCell: Command = (view) => {
  const state = view.state
  const evaluator = state.facet(evalHost)?.evaluator() ?? DEFAULT_EVALUATOR
  const text = state.doc.toString()
  const armed = state.field(armedField, false) ?? null
  if (armed !== null) {
    const opened = openCell({ kind: "evaluation", evaluator }, text, armed, "")
    rewrite(view, opened.markdown, opened.caret)
    view.focus()
    return true
  }
  const cell = cellAt(state, state.selection.main.head)
  const edit = makeEvaluation(evaluator, cell ? cell.range : null, text)
  const converting = cell !== null && edit.range.location === cell.range.location && edit.replacement.indexOf("\n") < 0
  view.dispatch({
    changes: { from: edit.range.location, to: end(edit.range), insert: edit.replacement },
    // A converted cell keeps the caret where it was; a new one takes it, ready to be typed into.
    ...(converting ? {} : { selection: { anchor: edit.selection.location } }),
    scrollIntoView: true,
    userEvent: "input",
  })
  view.focus()
  return true
}

// MARK: - The marks, the menu, the notice

/**
 * THE PAGE'S LEFT MARGIN IN A NOTE THAT HOLDS AN EVALUATION CELL, and only there (Sean, 2026-10-05: "show language
 * "WL" or "PY" next to In[] and keep the In/Out indentation clean"). The ordinary margin (`PAGE_LEFT`, 30) holds five
 * characters of the 9-pixel mark, and `Out[10]` is seven: the marks used to SHRINK to fit, so no two were one size.
 * Now the margin is wide enough for `Out[100]` at full size, with a little air on its left — about the Mac's own
 * `CellMark.width` (44) and the gap — and every line of the note (paragraphs and both cells of a pair) still starts
 * at one x, just further in. Not every note: a drawing over the words is placed on the page, not on the words, so
 * moving the text of notes that have no evaluation cell would move it out from under their ink.
 */
export const EVAL_MARGIN = 48
/** Between a mark's right edge and its cell. */
const MARK_GAP = 5
const MARK_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
/** The first row of a mark (`In[n]`, `Out[n]`, or the language of a cell that has not run) and the second (the language under `In[n]`). */
const ROW = 14
const SECOND_ROW = 12
const STYLE_ID = "wm-eval-style"
const CSS = `
.wm-eval-marks { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 3; }
.wm-eval-mark { position: absolute; display: flex; flex-direction: column; align-items: flex-end;
  pointer-events: none; }
.wm-eval-row { display: flex; align-items: center; justify-content: flex-end; gap: 3px; height: ${ROW}px;
  white-space: nowrap; }
.wm-eval-row.wm-eval-second { height: ${SECOND_ROW}px; }
.wm-eval-badge, .wm-eval-label, .wm-eval-lang { font: 600 9px/${ROW}px ${MARK_FONT_FAMILY};
  white-space: nowrap; color: var(--wm-faint, #8a8a94); height: ${ROW}px; }
.wm-eval-badge { pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;
  padding: 0 3px; border-radius: 4px; border: 0.75px solid color-mix(in srgb, currentColor 45%, transparent);
  background: color-mix(in srgb, currentColor 14%, transparent); }
.wm-eval-badge:hover, .wm-eval-lang:hover { color: var(--wm-accent, #2563eb); }
.wm-eval-badge .wm-eval-chev { font-size: 7px; line-height: ${ROW}px; }
.wm-eval-lang { pointer-events: auto; cursor: pointer; border: 0; background: none; padding: 0; margin: 0;
  line-height: ${SECOND_ROW}px; height: ${SECOND_ROW}px; opacity: 0.8; }
.wm-eval-missing { color: #d97706; border-style: dashed; }
.wm-eval-spin { pointer-events: auto; cursor: pointer; width: 9px; height: 9px; border-radius: 50%; box-sizing: border-box;
  border: 1.5px solid color-mix(in srgb, var(--wm-faint, #8a8a94) 40%, transparent);
  border-top-color: var(--wm-accent, #2563eb); animation: wm-eval-spin 0.8s linear infinite; }
.cm-editor.wm-eval-note .cm-content { padding-left: ${EVAL_MARGIN}px; }
.cm-editor.wm-eval-note .cm-selectionLayer { clip-path: polygon(${EVAL_MARGIN}px 0, calc(100% - ${PAGE_RIGHT}px) 0,
  calc(100% - ${PAGE_RIGHT}px) 100000000px, ${EVAL_MARGIN}px 100000000px); }
.cm-editor.wm-eval-note .wm-wash-cell { left: ${EVAL_MARGIN}px; }
@keyframes wm-eval-spin { to { transform: rotate(360deg); } }
.wm-eval-notice { position: absolute; pointer-events: auto; cursor: default; width: max-content; max-width: 620px;
  font-size: 12px; white-space: normal; overflow-wrap: anywhere;
  line-height: 1.4; color: var(--wm-text, #1c1c1e); background: var(--wm-page, #fff);
  border: 1px solid var(--wm-rule, #d4d4d8); border-left: 3px solid #d97706; border-radius: 4px; padding: 4px 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.wm-eval-menu { position: fixed; z-index: 1000; min-width: 150px; padding: 4px 0; font-size: 13px;
  background: var(--wm-page, #fff); color: var(--wm-text, #1c1c1e); border: 1px solid var(--wm-rule, #d4d4d8);
  border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,0.18); }
.wm-eval-menu button { display: flex; width: 100%; gap: 8px; align-items: baseline; border: 0; background: none;
  color: inherit; font: inherit; text-align: left; padding: 4px 12px 4px 8px; cursor: pointer; }
.wm-eval-menu button:hover { background: color-mix(in srgb, var(--wm-accent, #2563eb) 14%, transparent); }
.wm-eval-menu .wm-eval-tick { width: 12px; flex: none; }
.wm-eval-menu .wm-eval-gone { color: var(--wm-faint, #8a8a94); font-size: 11px; margin-left: auto; padding-left: 12px; }
.wm-eval-menu .wm-eval-title { padding: 2px 12px 4px; font-size: 11px; color: var(--wm-faint, #8a8a94); }
.cm-editor .wm-bracket.wm-bracket-pair:not(.wm-bracket-lit) { border-width: 1.5px; }
`

function installStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Whether the note holds an evaluation cell, and so has the marks' column (`EVAL_MARGIN`). Read once per parse. */
const holdsCache = new WeakMap<readonly PositionedBlock[], boolean>()
export function holdsEvaluation(state: EditorState): boolean {
  const cells = notebook(state).cells
  let holds = holdsCache.get(cells)
  if (holds === undefined) {
    holds = cells.some((cell) => cell.block.kind === "code" && isEvaluation(cell.block.language))
    holdsCache.set(cells, holds)
  }
  return holds
}

/**
 * HOW WIDE THE MARKS' COLUMN IS IN THIS NOTE: the wide margin's, or — in a note whose only pairs are older ones
 * (```python over ```out, written before the `eval ` fence) — the ordinary margin's, so an `Out[n]` there shrinks to
 * fit instead of running over its cell's words. Those notes keep the ordinary margin: their text, and the ink drawn
 * over it, stay where they were.
 */
export const markColumn = (state: EditorState): number => (holdsEvaluation(state) ? EVAL_MARGIN : PAGE_LEFT) - MARK_GAP

const evalMargin = EditorView.editorAttributes.compute([notebookField],
  (state): Record<string, string> => (holdsEvaluation(state) ? { class: "wm-eval-note" } : {}))

/**
 * WHERE A LINE'S BASELINE IS, below the top of its line box, for a font and a line height: read off a probe once per
 * font, so a mark's first row sits on the same baseline as the first line of its cell whatever the fonts resolve to.
 */
const baselines = new Map<string, number>()
function baselineOf(family: string, size: string, weight: string, lineHeight: string): number {
  const key = `${family}|${size}|${weight}|${lineHeight}`
  let y = baselines.get(key)
  if (y === undefined) {
    const box = document.createElement("div")
    box.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;margin:0;padding:0"
    Object.assign(box.style, { fontFamily: family, fontSize: size, fontWeight: weight, lineHeight })
    box.textContent = "In"
    const probe = document.createElement("span")
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline"
    box.appendChild(probe)
    document.body.appendChild(box)
    y = probe.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.remove()
    baselines.set(key, y)
  }
  return y
}
const baselineOfElement = (element: Element): number => {
  const style = getComputedStyle(element)
  return baselineOf(style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight)
}
/** The baseline of a mark's first row, inside the row. */
const markBaseline = (): number => baselineOf(MARK_FONT_FAMILY, "9px", "600", `${ROW}px`)

interface Mark {
  key: string; at: number; role: MarkRole; evaluator: Evaluator | null; language: string | null; running: boolean
  top: number
}

class EvalPlugin {
  readonly layer: HTMLElement
  private readonly elements = new Map<string, HTMLElement>()
  private noticeElement: HTMLElement | null = null
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private menu: HTMLElement | null = null
  private destroyed = false
  readonly measure = { key: "wm-eval-marks", read: () => null, write: () => this.draw() }

  constructor(private readonly view: EditorView) {
    installStyle()
    this.layer = document.createElement("div")
    this.layer.className = "wm-eval-marks"
    view.scrollDOM.appendChild(this.layer)
    // A NOTE COMING BACK TO THE FRONT is built from the state it was put away with (Notebook's stash), and that state
    // may still say a cell is running: the run was taken back, its child killed, when the note closed (`destroy`),
    // and a closing view cannot dispatch. Nothing runs now, so nothing may say so — a stale `running` would keep the
    // spinner turning and swallow every Shift+Enter in the note.
    const stale = view.state.field(evalField)
    if (stale.running || stale.notice) {
      if (stale.running) view.state.facet(evalHost)?.cancel(stale.running.id)
      queueMicrotask(() => {
        if (!this.destroyed) this.view.dispatch({ effects: [setRunning.of(null), setNotice.of(null)] })
      })
    }
    this.refreshTools()
    view.requestMeasure(this.measure)
  }

  /** Nothing to draw and nothing drawn: a note with no evaluation cell or answer measures nothing on a keystroke. */
  private quiet(state: EditorState): boolean {
    const value = state.field(evalField)
    return this.elements.size === 0 && this.noticeElement === null && !value.running && !value.notice
      && !holdsEvaluation(state) && groupsIn(state).length === 0
  }

  update(update: ViewUpdate): void {
    const before = update.startState.field(evalField)
    const after = update.state.field(evalField)
    if (update.docChanged || update.geometryChanged || update.viewportChanged || before !== after
      || update.transactions.some((t) => t.reconfigured)) {
      if (!this.quiet(update.state)) this.view.requestMeasure(this.measure)
    }
  }

  /** Where each environment's tool is, asked of the shell (once, and again whenever the menu opens). */
  refreshTools(): void {
    const host = this.view.state.facet(evalHost)
    if (!host) return
    void host.tools().then((tools) => {
      if (!this.destroyed) this.view.dispatch({ effects: setTools.of(tools) })
    }, () => undefined)
  }

  /** A sentence beside the cell, for a refusal; it goes by itself, on the next edit, or on a click. */
  say(view: EditorView, at: number, text: string): void {
    view.dispatch({ effects: setNotice.of({ at, text }) })
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => {
      if (!this.destroyed && view.state.field(evalField).notice?.text === text) view.dispatch({ effects: setNotice.of(null) })
    }, 9000)
  }

  /** `NoteStore.landed`: the answer under the cell that ran, found again by its text, and the bar under the answer. */
  landed(view: EditorView, running: Running, opening: string, outcome: RunOutcome): void {
    if (this.destroyed) return
    const now = view.state.field(evalField).running
    // Something else took this run back (the note closed, another run replaced it): nothing to say.
    if (!now || now.id !== running.id) return
    const where = now.at
    view.dispatch({ effects: setRunning.of(null) })
    const landing = landingFor(outcome, running.evaluator)
    if (landing.kind === "nothing") return
    if (landing.kind === "say") {
      this.say(view, where, landing.message)
      if (outcome.kind === "refused" && outcome.refusal.kind === "missingTool") this.refreshTools()
      return
    }
    const text = view.state.doc.toString()
    const cell = landingOf(opening, text, where)
    if (!cell) {
      this.say(view, where, "The cell that was running is not there any more, so its answer was dropped.")
      return
    }
    const edit = writeAnswer(landing.result, cell.range, text)
    // The answer goes in WITHOUT taking the caret (it may land while somebody is typing elsewhere), as its own
    // step of Undo.
    view.dispatch({
      changes: { from: edit.range.location, to: end(edit.range), insert: edit.replacement },
      annotations: isolateHistory.of("full"),
      userEvent: "input.eval",
    })
    // AND THE BAR GOES UNDER THE ANSWER — the one write a run makes that does take the caret: Shift+Enter is "run
    // this and let me carry on", and carrying on happens after the answer (4fad93e). Scrolled to only if it is
    // off the page, by the least that shows it (799b13b).
    const after = view.state.doc.toString()
    const answered = outAfter(cell.range, after)
    if (!answered) return
    const caret = caretUnder(answered.range, after)
    view.dispatch({
      selection: { anchor: caret },
      effects: [
        ...(caret === after.length ? [armSeam.of(caret)] : []),
        EditorView.scrollIntoView(caret, { y: "nearest", yMargin: 48 }),
      ],
    })
    view.focus()
  }

  /**
   * Where the first line of code is in a cell the rendered page DRAWS (a widget, not lines): read off the drawn box
   * itself, so the mark stays level with the code whatever padding the page gives a code box.
   */
  private drawnCode(): { top: number; pre: HTMLElement }[] {
    const view = this.view
    const origin = view.scrollDOM.getBoundingClientRect().top - view.scrollDOM.scrollTop
    return Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".wm-pv-code pre"))
      .map((pre) => ({ top: pre.getBoundingClientRect().top - origin, pre }))
  }

  /** The `.cm-line` a cell's first line is drawn as, when it is drawn as lines. */
  private lineElement(at: number): Element | null {
    try {
      const { node, offset } = this.view.domAtPos(at)
      let element: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
      if (element === this.view.contentDOM) element = (node.childNodes[offset] as Element | undefined) ?? null
      return element && element.nodeType === 1 ? element.closest(".cm-line") : null
    } catch { return null }
  }

  private marks(): Mark[] {
    const view = this.view
    const state = view.state
    const cells = notebook(state).cells
    const evalState = state.field(evalField)
    const groups = groupsIn(state)
    const { from, to } = view.viewport
    const pad = view.documentPadding.top
    const out: Mark[] = []
    let drawn: { top: number; pre: HTMLElement }[] | null = null
    const markLine = markBaseline()
    for (let i = Math.max(0, firstCellFromBy(cells, from, (c) => c.range) - 1); i < cells.length; i++) {
      const cell = cells[i]!
      if (cell.range.location > to) break
      if (cell.block.kind !== "code" || end(cell.range) < from || insideHidden(state, cell.range)) continue
      let role: MarkRole | null = null
      let evaluator: Evaluator | null = null
      const number = pairNumber(cell.range, groups)
      if (isOut(cell.block)) {
        if (number !== null && isAnswerCell(cell.range, groups)) role = { kind: "output", number }
      } else if (isEvaluation(cell.block.language)) {
        role = { kind: "input", fence: cell.block.language, number }
        evaluator = evaluatorFrom(cell.block.language)
      }
      if (!role) continue
      let block = view.lineBlockAt(cell.range.location)
      // A cell that touches one it stands apart from has the air of a blank line in front of it (apart.ts), and that
      // air is part of its line block: the cell is the last part of it.
      if (Array.isArray(block.type)) block = block.type[block.type.length - 1] ?? block
      // ON THE BASELINE OF THE CELL'S FIRST LINE: a drawn cell's first line of code (its box's padding above it), an
      // open one's fence line. In and Out are measured the same way, so the two marks of a pair sit the same.
      let top: number
      if (block.type !== BlockType.Text) {
        drawn ??= this.drawnCode()
        const boxTop = block.top + pad
        const code = drawn.find((d) => d.top >= boxTop - 1 && d.top <= block.bottom + pad)
        top = code ? code.top + baselineOfElement(code.pre) - markLine : boxTop + 12
      } else {
        const line = this.lineElement(cell.range.location)
        top = block.top + pad + (line
          ? baselineOfElement(line) - markLine
          : Math.max(0, (Math.min(block.height, 22) - ROW) / 2))
      }
      out.push({
        key: `${role.kind}:${cell.range.location}`, at: cell.range.location, role, evaluator,
        language: markLanguage(role), running: evalState.running?.at === cell.range.location, top,
      })
    }
    return out
  }

  draw(): void {
    if (this.destroyed) return
    const view = this.view
    const contentLeft = view.contentDOM.getBoundingClientRect().left - view.scrollDOM.getBoundingClientRect().left
      + view.scrollDOM.scrollLeft
    const tools = view.state.field(evalField).tools
    const column = markColumn(view.state)
    const marks = this.marks()
    const seen = new Set(marks.map((mark) => mark.key))
    for (const [key, element] of this.elements) {
      if (!seen.has(key)) { element.remove(); this.elements.delete(key) }
    }
    for (const mark of marks) {
      let element = this.elements.get(mark.key)
      if (!element) {
        element = document.createElement("div")
        element.className = "wm-eval-mark"
        element.dataset.evalMark = mark.role.kind
        element.dataset.evalAt = String(mark.at)
        this.layer.appendChild(element)
        this.elements.set(mark.key, element)
      }
      // On whole device pixels, so the right edges of every mark — and the text of their rows — fall on one column
      // at 1.5x as at 1x.
      const pixel = window.devicePixelRatio || 1
      const snap = (value: number) => Math.round(value * pixel) / pixel
      element.style.left = `${snap(contentLeft)}px`
      element.style.width = `${column}px`
      element.style.top = `${snap(mark.top)}px`
      const title = markTitle(mark.role)
      const missing = mark.evaluator !== null && tools !== null && tools[mark.evaluator].path === null
      const choosing = mark.role.kind === "input" && mark.role.number === null
      const signature = `${title}|${mark.language}|${mark.role.kind}|${choosing}|${missing}|${mark.running}|${column}`
      if (element.dataset.signature === signature) continue
      element.dataset.signature = signature
      element.textContent = ""
      const first = document.createElement("div")
      first.className = "wm-eval-row"
      element.appendChild(first)
      const looked = mark.evaluator && tools ? tools[mark.evaluator].looked : []
      const choiceTitle = mark.evaluator === null
        ? "No language this app can run: pick what this cell runs as"
        : missing
          ? refusalMessage({ kind: "missingTool", evaluator: mark.evaluator, looked })
          : `Runs as ${evaluatorTitle(mark.evaluator)} — Shift+Enter to run it, or pick another here`
      const at = mark.at
      const opensMenu = (control: HTMLElement) => control.addEventListener("mousedown", (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.openMenu(control, at)
      })
      let second: HTMLElement | null = null
      if (choosing) {
        // A CELL THAT HAS NOT RUN CARRIES THE CHOICE, drawn as a button (df166db): its language is the whole mark.
        const button = document.createElement("button")
        button.type = "button"
        button.className = "wm-eval-badge" + (missing ? " wm-eval-missing" : "")
        button.dataset.evalBadge = mark.evaluator ?? ""
        const label = document.createElement("span")
        label.textContent = title
        const chevron = document.createElement("span")
        chevron.className = "wm-eval-chev"
        chevron.textContent = "▾"
        button.append(label, chevron)
        button.title = choiceTitle
        opensMenu(button)
        first.appendChild(button)
        this.fit(label, column - 12)
      } else {
        // One that has: `In[n]` / `Out[n]`, a record of what ran, right-aligned on the column every mark shares.
        const label = document.createElement("span")
        label.className = "wm-eval-label"
        label.dataset.evalLabel = title
        label.textContent = title
        first.appendChild(label)
        this.fit(label, column)
        if (mark.language !== null) {
          // AND THE LANGUAGE UNDER IN[n] — "show language WL or PY next to In[]" (Sean, 2026-10-05). Under it, not
          // after it: `In[3] PY` beside `Out[3]` puts the two numbers' brackets three characters apart, and the
          // margin would have to be wide enough for `In[100] C++`. It is still the menu, quietly.
          second = document.createElement("div")
          second.className = "wm-eval-row wm-eval-second"
          const language = document.createElement("button")
          language.type = "button"
          language.className = "wm-eval-lang" + (missing ? " wm-eval-missing" : "")
          language.dataset.evalLang = mark.evaluator ?? ""
          language.textContent = mark.language
          language.title = choiceTitle
          opensMenu(language)
          second.appendChild(language)
          element.appendChild(second)
        }
      }
      if (mark.running) {
        // The spinner goes on the second row, beside the language, so `In[n]` never moves while a cell runs.
        if (!second) {
          second = document.createElement("div")
          second.className = "wm-eval-row wm-eval-second"
          element.appendChild(second)
        }
        const spin = document.createElement("div")
        spin.className = "wm-eval-spin"
        spin.dataset.evalRunning = "1"
        spin.title = "Running — click to stop it"
        spin.addEventListener("mousedown", (event) => {
          event.preventDefault()
          event.stopPropagation()
          this.stop()
        })
        second.prepend(spin)
      }
    }
    this.drawNotice(contentLeft)
  }

  /**
   * A mark is never shrunk while the column holds it — and it holds `Out[100]`. Past that (a note of a thousand
   * runs) it shrinks rather than runs off the page (the Mac's minimumScaleFactor).
   */
  private fit(text: HTMLElement, room: number): void {
    text.style.fontSize = ""
    const wide = text.scrollWidth
    if (wide > room) text.style.fontSize = `${Math.max(6.5, (9 * room) / wide)}px`
  }

  private drawNotice(contentLeft: number): void {
    const notice = this.view.state.field(evalField).notice
    if (!notice) { this.noticeElement?.remove(); this.noticeElement = null; return }
    const cell = cellAt(this.view.state, notice.at)
    const bottom = cell
      ? this.view.lineBlockAt(Math.max(cell.range.location, end(cell.range) - 1)).bottom
      : this.view.lineBlockAt(Math.min(notice.at, this.view.state.doc.length)).bottom
    if (!this.noticeElement) {
      this.noticeElement = document.createElement("div")
      this.noticeElement.className = "wm-eval-notice"
      this.noticeElement.setAttribute("role", "status")
      this.noticeElement.dataset.evalNotice = "1"
      this.noticeElement.addEventListener("mousedown", (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.view.dispatch({ effects: setNotice.of(null) })
      })
      this.layer.appendChild(this.noticeElement)
    }
    this.noticeElement.textContent = notice.text
    this.noticeElement.style.left = `${Math.round(contentLeft + markColumn(this.view.state) + MARK_GAP)}px`
    this.noticeElement.style.top = `${Math.round(bottom + this.view.documentPadding.top + 4)}px`
  }

  private stop(): void {
    const running = this.view.state.field(evalField).running
    if (!running) return
    this.view.state.facet(evalHost)?.cancel(running.id)
    this.view.dispatch({ effects: setRunning.of(null) })
  }

  /** The environments, as a menu at the mark; picking one rewrites the fence and is remembered for the next cell. */
  private openMenu(anchor: HTMLElement, at: number): void {
    this.closeMenu()
    this.refreshTools()
    const view = this.view
    const cell = cellAt(view.state, at)
    if (!cell || cell.block.kind !== "code") return
    const current = evaluatorFrom(cell.block.language)
    const tools = view.state.field(evalField).tools
    const menu = document.createElement("div")
    menu.className = "wm-eval-menu"
    menu.dataset.evalMenu = "1"
    const heading = document.createElement("div")
    heading.className = "wm-eval-title"
    heading.textContent = "Runs As"
    menu.appendChild(heading)
    for (const evaluator of EVALUATORS) {
      const item = document.createElement("button")
      item.type = "button"
      item.dataset.evaluator = evaluator
      const tick = document.createElement("span")
      tick.className = "wm-eval-tick"
      tick.textContent = evaluator === current ? "✓" : ""
      const name = document.createElement("span")
      name.textContent = evaluatorTitle(evaluator)
      item.append(tick, name)
      if (tools && tools[evaluator].path === null) {
        // SAID PLAINLY, where the choice is made: this one is not on this machine.
        const gone = document.createElement("span")
        gone.className = "wm-eval-gone"
        gone.textContent = "not installed"
        item.appendChild(gone)
        item.title = refusalMessage({ kind: "missingTool", evaluator, looked: tools[evaluator].looked })
      }
      item.addEventListener("mousedown", (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.closeMenu()
        this.pick(evaluator, at)
      })
      menu.appendChild(item)
    }
    document.body.appendChild(menu)
    const box = anchor.getBoundingClientRect()
    const size = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - size.width - 6))}px`
    menu.style.top = `${Math.max(4, Math.min(box.bottom + 2, window.innerHeight - size.height - 6))}px`
    this.menu = menu
    const away = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return
      if (event instanceof MouseEvent && menu.contains(event.target as Node)) return
      this.closeMenu()
    }
    this.menuAway = away
    window.addEventListener("mousedown", away, true)
    window.addEventListener("keydown", away, true)
    window.addEventListener("blur", away)
  }

  private menuAway: ((event: Event) => void) | null = null

  private closeMenu(): void {
    if (this.menuAway) {
      window.removeEventListener("mousedown", this.menuAway, true)
      window.removeEventListener("keydown", this.menuAway, true)
      window.removeEventListener("blur", this.menuAway)
      this.menuAway = null
    }
    this.menu?.remove()
    this.menu = null
  }

  /** Change what a cell runs as: its fence is rewritten and nothing else is — not the body, not its answer. */
  private pick(evaluator: Evaluator, at: number): void {
    const view = this.view
    view.state.facet(evalHost)?.remember(evaluator)
    const cell = cellAt(view.state, at)
    if (!cell) return
    const edit = setEnvironment(evaluator, cell.range, view.state.doc.toString())
    if (edit) {
      view.dispatch({
        changes: { from: edit.range.location, to: end(edit.range), insert: edit.replacement },
        userEvent: "input",
      })
    }
    view.focus()
  }

  destroy(): void {
    this.destroyed = true
    // THE NOTE CLOSED: whatever it was running is taken back, and its child killed.
    const running = this.view.state.field(evalField, false)?.running
    if (running) this.view.state.facet(evalHost)?.cancel(running.id)
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.closeMenu()
    this.layer.remove()
  }
}

const evalPlugin = ViewPlugin.fromClass(EvalPlugin)

/**
 * The keys. Shift+Enter is NOT a menu shortcut — a menu accelerator would take it away from every text field in the
 * app — and it declines anywhere but an evaluation cell, so it means what it always meant everywhere else.
 */
const evalKeys = Prec.highest(keymap.of([
  { key: "Shift-Enter", run: runCell },
  // Ctrl+Shift+8 (docs/PLAN-text-cells.md: it was Ctrl+9, the Mac's ⌘9; Ctrl+9 is the maths cell now, keys.ts).
  { key: "Shift-Mod-8", run: evaluationCell, preventDefault: true },
]))

export const evaluationCells: Extension = [evalField, evalPlugin, evalKeys, evalMargin]
