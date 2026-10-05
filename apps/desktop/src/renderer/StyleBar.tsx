/**
 * The bar that comes up under an arrow once it is drawn (the Mac's
 * `ConnectorStyleBar`: a head at either end, or none, and the line between
 * them), grown into the one place to change what is picked: its colour, its
 * width, a shape's fill, where it sits in the stack, and a copy of it.
 *
 * Nothing here knows about the drawing. It is handed the picked items and
 * says what it wants changed, and the canvas does the editing (and the undo).
 */

import "./styleBar.css"
import { PRESET_COLOURS, type CanvasItem, type ConnectorHead, type ConnectorLine, type Order, type StylePatch } from "@writemind/core"

interface Props {
  items: CanvasItem[]
  left: number
  top: number
  onPatch(patch: StylePatch): void
  onOrder(how: Order): void
  onDuplicate(): void
  onClose(): void
}

const WIDTHS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24]

const lineWidthOf = (item: CanvasItem): number | null => {
  switch (item.kind) {
    case "stroke": return item.stroke.width
    case "shape": return item.shape.lineWidth
    case "connector": return item.connector.lineWidth
    case "image": return null
  }
}

const colourOf = (item: CanvasItem): string | null => {
  switch (item.kind) {
    case "stroke": return item.stroke.colorHex
    case "shape": return item.shape.colorHex
    case "connector": return item.connector.colorHex
    case "image": return null
  }
}

/** Some browsers only take six-digit colours in a colour input. */
const sixDigits = (hex: string | null | undefined, fallback: string): string =>
  hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback

export function StyleBar({ items, left, top, onPatch, onOrder, onDuplicate, onClose }: Props) {
  const connectors = items.flatMap((item) => item.kind === "connector" ? [item.connector] : [])
  const shapes = items.flatMap((item) => item.kind === "shape" ? [item.shape] : [])
  const inked = items.filter((item) => colourOf(item) !== null)
  const widthed = items.filter((item) => lineWidthOf(item) !== null)
  const colour = inked.length > 0 ? colourOf(inked[0]!) : null
  const width = widthed.length > 0 ? lineWidthOf(widthed[0]!) : null
  const fill = shapes.length > 0 ? shapes[0]!.fillHex : null
  const first = connectors[0]

  const press = (action: () => void) => (event: React.PointerEvent) => {
    // The layer under this listens for presses on the page: a press on the
    // bar is the bar's.
    event.preventDefault(); event.stopPropagation()
    action()
  }

  const stepWidth = (direction: 1 | -1) => {
    if (width === null) return
    const next = direction > 0
      ? WIDTHS.find((one) => one > width + 1e-6) ?? WIDTHS[WIDTHS.length - 1]!
      : [...WIDTHS].reverse().find((one) => one < width - 1e-6) ?? WIDTHS[0]!
    onPatch({ lineWidth: next })
  }

  const head = (which: "startHead" | "endHead", value: ConnectorHead, glyph: string, title: string) => (
    <button className={`wm-style-btn${first?.[which] === value ? " on" : ""}`}
            data-style={`${which}:${value}`} title={title}
            onPointerDown={press(() => onPatch({ [which]: value }))}>{glyph}</button>
  )
  const lineButton = (value: ConnectorLine, title: string) => (
    <button className={`wm-style-btn${first?.line === value ? " on" : ""}`}
            data-style={`line:${value}`} title={`${title} line`}
            onPointerDown={press(() => onPatch({ line: value }))}>{title}</button>
  )

  return (
    <div className="wm-style-bar" data-bar="style" style={{ left, top }}
         onPointerDown={(event) => { event.stopPropagation() }}>
      {first && (
        <div className="wm-style-row">
          {head("startHead", "none", "—", "No head at the start")}
          {head("startHead", "arrow", "◀", "A head at the start")}
          <span className="wm-style-gap" />
          {lineButton("solid", "Solid")}
          {lineButton("dashed", "Dashed")}
          {lineButton("dotted", "Dotted")}
          <span className="wm-style-gap" />
          {head("endHead", "arrow", "▶", "A head at the end")}
          {head("endHead", "none", "—", "No head at the end")}
        </div>
      )}
      {colour !== null && (
        <div className="wm-style-row" data-row="colour">
          <span className="wm-style-label">Colour</span>
          {PRESET_COLOURS.map((one) => (
            <button key={one} className={`wm-swatch${colour.toLowerCase() === one.toLowerCase() ? " on" : ""}`}
                    style={{ background: one }} data-colour={one} title={one}
                    onPointerDown={press(() => onPatch({ colorHex: one }))} />
          ))}
          <input type="color" className="wm-style-colour" title="Another colour"
                 value={sixDigits(colour, "#000000")}
                 onChange={(event) => onPatch({ colorHex: event.target.value })} />
        </div>
      )}
      {width !== null && (
        <div className="wm-style-row" data-row="width">
          <span className="wm-style-label">Width</span>
          <button className="wm-style-btn" title="Thinner" data-style="thinner"
                  onPointerDown={press(() => stepWidth(-1))}>−</button>
          <span className="wm-style-value" data-style="width">{Math.round(width * 10) / 10}</span>
          <button className="wm-style-btn" title="Thicker" data-style="thicker"
                  onPointerDown={press(() => stepWidth(1))}>+</button>
        </div>
      )}
      {shapes.length > 0 && (
        <div className="wm-style-row" data-row="fill">
          <span className="wm-style-label">Fill</span>
          <button className={`wm-swatch none${fill === null ? " on" : ""}`} data-colour="none" title="No fill"
                  onPointerDown={press(() => onPatch({ fillHex: null }))}>∅</button>
          {["#FFFFFF", ...PRESET_COLOURS.slice(0, 5)].map((one) => (
            <button key={one} className={`wm-swatch${fill?.toLowerCase() === one.toLowerCase() ? " on" : ""}`}
                    style={{ background: one }} data-fill={one} title={`Fill ${one}`}
                    onPointerDown={press(() => onPatch({ fillHex: one }))} />
          ))}
          <input type="color" className="wm-style-colour" title="Another fill"
                 value={sixDigits(fill, "#FFFFFF")}
                 onChange={(event) => onPatch({ fillHex: event.target.value })} />
        </div>
      )}
      <div className="wm-style-row">
        <button className="wm-style-btn" title="Bring to the front" data-style="front"
                onPointerDown={press(() => onOrder("front"))}>Front</button>
        <button className="wm-style-btn" title="One step forward" data-style="forward"
                onPointerDown={press(() => onOrder("forward"))}>↑</button>
        <button className="wm-style-btn" title="One step back" data-style="backward"
                onPointerDown={press(() => onOrder("backward"))}>↓</button>
        <button className="wm-style-btn" title="Send to the back" data-style="back"
                onPointerDown={press(() => onOrder("back"))}>Back</button>
        <span className="wm-style-gap" />
        <button className="wm-style-btn" title="Make a copy beside it (Ctrl+C then Ctrl+V does too)" data-style="duplicate"
                onPointerDown={press(onDuplicate)}>Copy</button>
        <button className="wm-style-btn" title="Done (Esc)" data-style="done"
                onPointerDown={press(onClose)}>✓</button>
      </div>
    </div>
  )
}
