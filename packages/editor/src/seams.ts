/**
 * The bar between two cells: the seam layer, the arming, and what typing at
 * an armed bar does.
 *
 * The rules are the core's (`seams`, `arm`, `openCell`) and are the same
 * ones the Mac draws from. What is different is how the cells are measured —
 * `view.lineBlockAt` instead of an NSLayoutManager — and that the caret
 * lands on the blank line by itself here, so arming mostly needs no click at
 * all: it is a reading of where the caret is, which is what it always was.
 *
 * An armed bar IS the cursor, so the caret is turned off while it is up.
 */

import {
  StateEffect, StateField, type Extension, type Transaction,
} from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import {
  arm, GAP_HEIGHT, onPlus, openCell, plus, seamAt, seams, type CellBox, type CellKind, type Seam,
} from "@writemind/core"
import { notebook } from "./notebook"

/** Arm a seam by hand — the two ends of the page, which no caret can name. */
export const armSeam = StateEffect.define<number | null>()
/** What kind of cell the next character at the bar opens. */
export const setArmedType = StateEffect.define<CellKind>()

export const armedField = StateField.define<number | null>({
  create() { return null },
  update(value, transaction: Transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(armSeam)) return effect.value
    }
    if (!transaction.docChanged && !transaction.selection) return value
    const head = transaction.state.selection.main
    return arm({ location: head.from, length: head.to - head.from },
      transaction.state.doc.toString(), value)
  },
})

export const armedTypeField = StateField.define<CellKind>({
  create() { return { kind: "text" } },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setArmedType)) return effect.value
    }
    // The choice rides with the bar and goes back to plain text the moment
    // it moves, so no path can leave a stale kind behind.
    const before = transaction.startState.field(armedField, false) ?? null
    const after = transaction.state.field(armedField, false) ?? null
    return before === after ? value : { kind: "text" }
  },
})

/** Where the note's left margin is, so the + sits outside the words. */
export const PLUS_LEADING = 6

/** The boxes the seams are built from, measured off the laid-out lines. */
export function cellBoxes(view: EditorView): CellBox[] {
  const { cells } = notebook(view.state)
  const length = view.state.doc.length
  return cells.map((cell) => {
    const from = Math.min(cell.range.location, length)
    const to = Math.min(Math.max(cell.range.location, cell.range.location + cell.range.length - 1), length)
    const top = view.lineBlockAt(from).top
    const bottom = view.lineBlockAt(to).bottom
    return { top, bottom, offset: cell.range.location }
  })
}

export function pageSeams(view: EditorView): Seam[] {
  return seams({
    cells: cellBoxes(view),
    pageTop: 0,
    pageBottom: Math.max(view.contentHeight, view.scrollDOM.clientHeight),
    noteLength: view.state.doc.length,
    firstCellTop: GAP_HEIGHT,
  })
}

/** The cursor is the bar, so no caret blinks anywhere else while it is up. */
const hideCaret = EditorView.theme({
  "&.wm-armed .cm-cursor, &.wm-armed .cm-cursor-primary": { display: "none" },
})

class SeamLayer {
  readonly dom: HTMLElement
  private hovered: number | null = null
  private all: Seam[] = []

  constructor(private readonly view: EditorView, private readonly onPlusPressed: (seam: Seam) => void) {
    this.dom = document.createElement("div")
    this.dom.className = "wm-seams"
    view.scrollDOM.appendChild(this.dom)
    view.scrollDOM.addEventListener("mousemove", this.move)
    view.scrollDOM.addEventListener("mouseleave", this.leave)
    view.scrollDOM.addEventListener("mousedown", this.press, true)
    this.draw()
  }

  private y(event: MouseEvent): number {
    const box = this.view.contentDOM.getBoundingClientRect()
    return event.clientY - box.top
  }

  private x(event: MouseEvent): number {
    const box = this.view.contentDOM.getBoundingClientRect()
    return event.clientX - box.left
  }

  private move = (event: MouseEvent) => {
    const seam = seamAt(this.y(event), this.all)
    const offset = seam ? seam.offset : null
    if (offset !== this.hovered) { this.hovered = offset; this.draw() }
    // The + is a button, so it takes the pointing hand — the same cursor
    // the brackets use, so the app says "this does something" one way.
    const onIt = seam ? onPlus(this.x(event), this.y(event), seam, PLUS_LEADING) : false
    this.view.scrollDOM.style.cursor = onIt ? "pointer" : (seam ? "row-resize" : "")
  }

  private leave = () => {
    if (this.hovered === null) return
    this.hovered = null
    this.view.scrollDOM.style.cursor = ""
    this.draw()
  }

  private press = (event: MouseEvent) => {
    if (event.button !== 0) return
    const seam = seamAt(this.y(event), this.all)
    if (!seam) return
    if (onPlus(this.x(event), this.y(event), seam, PLUS_LEADING)) {
      event.preventDefault()
      event.stopPropagation()
      this.onPlusPressed(seam)
      return
    }
    // The two ends of the page are seams no caret can name — there is no
    // blank line in them — so a click there arms them by hand. Everywhere
    // else the caret lands on the blank line and the arming is a reading
    // of where it is, exactly as on the Mac.
    const length = this.view.state.doc.length
    if (seam.offset === 0 || seam.offset === length) {
      event.preventDefault()
      this.view.dispatch({
        selection: { anchor: seam.offset },
        effects: armSeam.of(seam.offset),
      })
      this.view.focus()
    }
  }

  draw(): void {
    this.all = pageSeams(this.view)
    const armed = this.view.state.field(armedField, false) ?? null
    this.view.dom.classList.toggle("wm-armed", armed !== null)
    const marked = armed ?? this.hovered
    this.dom.style.height = `${this.view.contentHeight}px`
    this.dom.textContent = ""

    const bar = (seam: Seam, faint: boolean) => {
      const line = document.createElement("div")
      line.className = faint ? "wm-bar wm-bar-faint" : "wm-bar"
      line.style.top = `${Math.round(seam.line) - 1}px`
      this.dom.appendChild(line)
    }

    const armedSeam = armed === null ? null : this.all.find((seam) => seam.offset === armed) ?? null
    const hoveredSeam = this.hovered === null ? null
      : this.all.find((seam) => seam.offset === this.hovered) ?? null
    if (armedSeam) bar(armedSeam, false)
    // The faint bar shows even when a solid one is drawn elsewhere (Sean,
    // 2026-09-21), so the pointer always says where a click would go.
    if (hoveredSeam && hoveredSeam.offset !== armedSeam?.offset) bar(hoveredSeam, true)

    const markedSeam = this.all.find((seam) => seam.offset === marked)
    if (markedSeam) {
      const rect = plus(markedSeam.line, PLUS_LEADING)
      const dot = document.createElement("div")
      dot.className = "wm-plus"
      dot.style.left = `${rect.x}px`
      dot.style.top = `${rect.y}px`
      dot.style.width = `${rect.width}px`
      dot.style.height = `${rect.height}px`
      dot.textContent = "+"
      this.dom.appendChild(dot)
    }
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener("mousemove", this.move)
    this.view.scrollDOM.removeEventListener("mouseleave", this.leave)
    this.view.scrollDOM.removeEventListener("mousedown", this.press, true)
    this.dom.remove()
  }
}

/**
 * Typing at an armed bar opens a cell of the chosen kind and puts the
 * character in it — the funnel, and the only one: a caller that NAMES a
 * range means that range.
 */
const typingAtTheBar = EditorView.inputHandler.of((view, _from, _to, text) => {
  const armed = view.state.field(armedField, false) ?? null
  if (armed === null || text.length === 0) return false
  const kind = view.state.field(armedTypeField, false) ?? { kind: "text" as const }
  const opened = openCell(kind, view.state.doc.toString(), armed, text)
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: opened.markdown },
    selection: { anchor: opened.caret },
    effects: armSeam.of(null),
  })
  return true
})

export function seamLayer(onPlusPressed: (view: EditorView, seam: Seam) => void): Extension {
  return ViewPlugin.fromClass(
    class {
      layer: SeamLayer
      constructor(view: EditorView) {
        this.layer = new SeamLayer(view, (seam) => onPlusPressed(view, seam))
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged) {
          this.layer.draw()
        }
      }
      destroy() { this.layer.destroy() }
    },
  )
}

export const seamExtensions = (onPlusPressed: (view: EditorView, seam: Seam) => void): Extension => [
  armedField,
  armedTypeField,
  typingAtTheBar,
  hideCaret,
  seamLayer(onPlusPressed),
  // A bar that is the cursor LIGHTS NOTHING: the cell the caret is parked
  // against must not be drawn as the cell being typed in.
  EditorView.decorations.compute([armedField, "selection", "doc"], (state) => {
    if ((state.field(armedField, false) ?? null) !== null) return Decoration.none
    return Decoration.none
  }),
]
