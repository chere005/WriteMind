/**
 * The bar over the note. It is a view inside the editor pane, never across
 * the sidebar — and it has to FIT the pane it lives in, because an HStack
 * that does not fit overflows in both directions. Hence small icons, no
 * spacing, and the whole thing clipped.
 *
 * Every button here calls the same core command its keyboard shortcut does.
 */

import type { EditorView } from "@codemirror/view"
import {
  BOLD, ITALIC, STRIKE, UNDERLINE_CLOSE, UNDERLINE_OPEN, HEADING_LADDER, headingName,
  LIST_STYLES, listTitle, MARK_KINDS, NODE_KINDS, PRESET_COLOURS, shapeTitle,
  type Heading, type ListStyle, type Placement, type ShapeKind,
} from "@writemind/core"
import { fence, heading, indentLines, list, outdentLines, quote, wrap } from "@writemind/editor"
import type { CanvasMode } from "./Canvas"

interface Props {
  view: EditorView | null
  onExportPDF(): void
  mode: CanvasMode
  onToggleMode(): void
  penColour: string
  onPenColour(hex: string): void
  penWidth: number
  onPenWidth(width: number): void
  placing: Placement | null
  onPlace(placing: Placement | null): void
  onAddPicture(): void
}

export function TopBar({
  view, onExportPDF, mode, onToggleMode, penColour, onPenColour, penWidth, onPenWidth,
  placing, onPlace, onAddPicture,
}: Props) {
  const run = (command: (view: EditorView) => boolean) => () => { if (view) command(view) }

  const Button = ({ label, title, onClick, wide }:
  { label: string; title: string; onClick(): void; wide?: boolean }) => (
    <button className="icon-button" title={title} onClick={onClick}
            style={wide ? { width: "auto", padding: "0 6px", fontSize: 11 } : undefined}>
      {label}
    </button>
  )

  return (
    <div className="top-bar">
      <select className="icon-button" style={{ width: "auto", padding: "0 4px", fontSize: 11 }}
              title="The heading ladder" value=""
              onChange={(event) => {
                const level = Number(event.target.value) as Heading
                run(heading(level))()
                event.currentTarget.value = ""
              }}>
        <option value="" disabled>Style</option>
        {HEADING_LADDER.map((level) => (
          <option key={level} value={level}>{headingName(level)}</option>
        ))}
      </select>
      <div className="bar-divider" />
      <Button label="B" title="Bold  ⌘B" onClick={run(wrap(BOLD))} />
      <Button label="I" title="Italic  ⌘I" onClick={run(wrap(ITALIC))} />
      <Button label="U" title="Underline  ⌘U" onClick={run(wrap(UNDERLINE_OPEN, UNDERLINE_CLOSE))} />
      <Button label="S" title="Strikethrough  ⇧⌘X" onClick={run(wrap(STRIKE))} />
      <div className="bar-divider" />
      <select className="icon-button" style={{ width: "auto", padding: "0 4px", fontSize: 11 }}
              title="Lists" value=""
              onChange={(event) => {
                run(list(event.target.value as ListStyle))()
                event.currentTarget.value = ""
              }}>
        <option value="" disabled>List</option>
        {LIST_STYLES.map((style) => (
          <option key={style} value={style}>{listTitle(style)}</option>
        ))}
      </select>
      <Button label="❝" title="Quote  ⌃⌘Q" onClick={run(quote)} />
      <Button label="{ }" title="Code Block  ⌘8" onClick={run(fence)} wide />
      <div className="bar-divider" />
      <Button label="⇤" title="Outdent  ⌘[" onClick={run(outdentLines)} />
      <Button label="⇥" title="Indent  ⌘]" onClick={run(indentLines)} />
      <div className="bar-divider" />
      <Button label="▣" title="Add a picture (⌘V pastes one, and so does a drop)"
              onClick={onAddPicture} />
      {/* ONE BUTTON FOR THE PANE: the pen, lit while it is down. ⌘ is the
          selector in either mode, so the marquee needs none of its own. */}
      <button className={`icon-button${mode === "pen" ? " on" : ""}`}
              title={mode === "pen"
                ? "Put the pen down and give the clicks back to the notebook"
                : "Draw over the note (hold ⌘ in either mode to pull a rectangle over what is on the page)"}
              onClick={onToggleMode}>✎</button>
      <input type="color" className="pen-colour" title="Pen colour" value={penColour}
             onChange={(event) => onPenColour(event.target.value)} />
      {PRESET_COLOURS.slice(0, 4).map((hex) => (
        <button key={hex} className="swatch" style={{ background: hex }} title={hex}
                onClick={() => onPenColour(hex)} />
      ))}
      <select className="icon-button" style={{ width: "auto", padding: "0 2px", fontSize: 11 }}
              title="Pen width" value={penWidth}
              onChange={(event) => onPenWidth(Number(event.target.value))}>
        {[1, 2, 3, 5, 8, 12].map((width) => <option key={width} value={width}>{width}</option>)}
      </select>
      <select className={`icon-button${placing ? " on" : ""}`}
              style={{ width: "auto", padding: "0 4px", fontSize: 11 }}
              title="Put a mark, a shape or a line on the page: pick one, then click where it goes"
              value=""
              onChange={(event) => {
                const value = event.target.value
                if (value === "line" || value === "arrow" || value === "both") {
                  onPlace({
                    kind: "line",
                    start: value === "both" ? "arrow" : "none",
                    end: value === "line" ? "none" : "arrow",
                  })
                } else if (value) {
                  onPlace({ kind: "shape", shape: value as ShapeKind })
                }
                event.currentTarget.value = ""
              }}>
        <option value="" disabled>Insert</option>
        <optgroup label="Marks">
          {MARK_KINDS.map((kind) => <option key={kind} value={kind}>{shapeTitle(kind)}</option>)}
        </optgroup>
        <optgroup label="Flow chart">
          {NODE_KINDS.map((kind) => <option key={kind} value={kind}>{shapeTitle(kind)}</option>)}
        </optgroup>
        <optgroup label="Lines">
          <option value="arrow">Arrow</option>
          <option value="both">Both Ways</option>
          <option value="line">Line</option>
        </optgroup>
      </select>
      <div style={{ flex: 1 }} />
      <Button label="PDF" title="Export this note as a PDF" onClick={onExportPDF} wide />
    </div>
  )
}
