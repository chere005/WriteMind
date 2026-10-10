// Port-only: no XCTest. Copy and Cut of held cells tell the app what was copied (`cellsCopied`, keys.ts) — a cut before
// the cells leave the note — and a paste carrying WriteMind's own cells is never also a picture (`takesPastedPicture`).
import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { describe, expect, it } from "vitest"
import { CELLS_MIME, cellClipboardHandlers, cellsCopied } from "../src/keys"
import { notebookField } from "../src/notebook"
import { DRAWING_MIME, drawingPasted, takeDrawing, takesPastedPicture } from "../src/paste"
import { holdingField } from "../src/preview/hold"

type Told = { markdown: string; plain: string; doc: string }

/** Enough of an EditorView for the clipboard handlers: the state, a dispatch that applies, focus. */
function fakeView(doc: string, ranges: [number, number][], told: Told[]): EditorView {
  let view: { state: EditorState } & Record<string, unknown>
  const extensions: Extension = [notebookField, holdingField, EditorState.allowMultipleSelections.of(true),
    cellsCopied.of((copy) => told.push({ ...copy, doc: view.state.doc.toString() }))]
  view = {
    state: EditorState.create({
      doc, extensions,
      selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to))),
    }),
    dispatch(spec: TransactionSpec) { view.state = view.state.update(spec).state },
    focus() {},
  }
  return view as unknown as EditorView
}

function clipboardEvent(): ClipboardEvent & { data: Map<string, string>; prevented: boolean } {
  const data = new Map<string, string>()
  const event = {
    data, prevented: false,
    clipboardData: { setData: (type: string, value: string) => { data.set(type, value) } },
    preventDefault() { event.prevented = true },
  }
  return event as unknown as ClipboardEvent & { data: Map<string, string>; prevented: boolean }
}

describe("cellsCopied", () => {
  const doc = "# Head\n\n![ink](.drawings/media/ink-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f.svg)\n\nTail"
  const ink = [doc.indexOf("!["), doc.indexOf("\n\nTail")] as [number, number]

  it("is told of a copy, with the cells' markdown and the words the clipboard got", () => {
    const told: Told[] = []
    const event = clipboardEvent()
    expect(cellClipboardHandlers.copy(event, fakeView(doc, [[0, 6], ink], told))).toBe(true)
    expect(told).toHaveLength(1)
    expect(told[0]!.markdown).toBe(event.data.get(CELLS_MIME))
    expect(told[0]!.plain).toBe(event.data.get("text/plain"))
    expect(told[0]!.markdown).toBe("# Head\n\n![ink](.drawings/media/ink-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f.svg)")
  })

  it("is told of a cut while the cells are still in the note, and they go after", () => {
    const told: Told[] = []
    const view = fakeView(doc, [ink], told)
    expect(cellClipboardHandlers.cut(clipboardEvent(), view)).toBe(true)
    expect(told).toHaveLength(1)
    expect(told[0]!.doc).toBe(doc)
    expect(view.state.doc.toString()).toBe("# Head\n\nTail")
  })

  it("is told nothing when nothing is held: an ordinary selection copies as the editor copies", () => {
    const told: Told[] = []
    const event = clipboardEvent()
    expect(cellClipboardHandlers.copy(event, fakeView(doc, [[2, 4]], told))).toBe(false)
    expect(cellClipboardHandlers.cut(event, fakeView(doc, [[3, 3]], told))).toBe(false)
    expect(told).toEqual([])
    expect(event.data.size).toBe(0)
  })
})

describe("a pasted drawing cell (Copy Cell, the tablet box's button)", () => {
  const pasteOf = (data: Record<string, string>) => {
    const event = { prevented: false, clipboardData: { getData: (type: string) => data[type] ?? "" }, preventDefault() { event.prevented = true } }
    return event as unknown as ClipboardEvent & { prevented: boolean }
  }
  /** A view whose app claims a paste carrying DRAWING_MIME (as the app does), and lands it (`landed`) unless it will not. */
  const viewTold = (landed: DataTransfer[], claim = (data: DataTransfer) => data.getData(DRAWING_MIME) !== ""): EditorView =>
    ({ state: EditorState.create({ doc: "", extensions: [drawingPasted.of((data) => { if (!claim(data)) return false; landed.push(data); return true })] }) }) as unknown as EditorView

  it("hands the paste to the app and keeps the editor from pasting the words beside it", () => {
    const landed: DataTransfer[] = []
    const event = pasteOf({ "text/plain": "<svg/>", [DRAWING_MIME]: `{"a":1}` })
    expect(takeDrawing(event, viewTold(landed))).toBe(true)
    expect(landed).toHaveLength(1)
    expect(landed[0]!.getData(DRAWING_MIME)).toBe(`{"a":1}`)
    expect(event.prevented).toBe(true)
  })

  it("is the editor's own paste when the app does not claim it, and nothing is landed", () => {
    const landed: DataTransfer[] = []
    const event = pasteOf({ "text/plain": "words", [CELLS_MIME]: "# cells" })
    expect(takeDrawing(event, viewTold(landed))).toBe(false)
    expect(landed).toEqual([])
    expect(event.prevented).toBe(false)
  })

  it("is the editor's own paste when no app is listening, or there is no clipboard data", () => {
    const bare = { state: EditorState.create({ doc: "" }) } as unknown as EditorView
    expect(takeDrawing(pasteOf({ [DRAWING_MIME]: "{}" }), bare)).toBe(false)
    const event = { clipboardData: null, preventDefault() { throw new Error("no") } } as unknown as ClipboardEvent
    expect(takeDrawing(event, viewTold([]))).toBe(false)
  })
})

describe("takesPastedPicture", () => {
  it("takes a picture nothing else took", () => {
    expect(takesPastedPicture(["Files", "image/png"])).toBe(true)
  })
  it("never takes one beside a copied drawing cell (its SVG file may arrive as a picture too)", () => {
    expect(takesPastedPicture(["text/plain", DRAWING_MIME, "Files", "image/svg+xml"])).toBe(false)
  })
  it("never takes one beside WriteMind's own cells", () => {
    expect(takesPastedPicture(["text/plain", CELLS_MIME, "image/png"])).toBe(false)
  })
})
