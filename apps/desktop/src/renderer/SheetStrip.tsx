/**
 * SheetStrip.tsx - the button strip that used to live on the Grab overlay, now inside the sheet pane (docs/spikes/DESIGN-pen-capture.md 8.6).
 * Presentational: it slides down when `shown` (the `stripWanted` rule in tabletPage.ts decides), every handler is one the camera bar already
 * has, and the pen operates it through the synthesiser's click rule (a pen-up on the same `button` as its pen-down clicks it). IMPL-D mounts it
 * inside the sheet host (`position: relative`); the styles are in sheetStrip.css.
 */

import "./sheetStrip.css"

export interface SheetStripProps {
  /** Slid down (the `stripWanted` rule decides). */
  shown: boolean
  colour: string
  colours: readonly string[]
  boxTool: boolean
  eraser: boolean
  clearAfter: boolean
  canUndo: boolean
  hasInk: boolean
  orientationLabel: string
  /** "overlay" | "driver" | "clip" | null: the tag at the strip's corner. */
  contained: string | null
  onSend(mode: "ink" | "page"): void
  onBoxTool(): void
  onErase(): void
  onUndo(): void
  onClear(): void
  onClearAfter(): void
  onColour(hex: string): void
  onWidth(by: -1 | 1): void
  onOrientation(): void
  onRotateInk(): void
  onRelease(): void
}

/** The words of the corner tag. */
export function containedTag(contained: string | null): string {
  if (!contained) return "Pen not held to this sheet"
  return `Pen held to this sheet (${contained})`
}

export default function SheetStrip(p: SheetStripProps) {
  const button = (id: string, text: string, onClick: () => void, extra = "", disabled = false) => (
    <button key={id} type="button" data-tablet={`strip-${id}`} className={`sheet-strip-button ${extra}`.trim()} disabled={disabled} onClick={onClick}>{text}</button>
  )
  return (
    <div className={`sheet-strip${p.shown ? " shown" : ""}`} data-tablet="strip" role="toolbar" aria-label="Tablet sheet">
      {button("send-writing", "Send Writing", () => p.onSend("ink"), "primary")}
      {button("send-page", "Send Page", () => p.onSend("page"), "primary")}
      {button("box", "Box", p.onBoxTool, p.boxTool ? "on" : "")}
      {button("erase", "Erase", p.onErase, p.eraser ? "on" : "")}
      {button("undo", "Undo", p.onUndo, "", !p.canUndo)}
      {button("clear", "Clear", p.onClear, "", !p.hasInk)}
      {button("clear-after", "Clear after", p.onClearAfter, p.clearAfter ? "on" : "")}
      {p.colours.map((hex) => (
        <button key={hex} type="button" data-tablet="strip-colour" data-colour={hex} aria-label={`Colour ${hex}`}
                className={`sheet-strip-swatch${hex.toLowerCase() === p.colour.toLowerCase() ? " on" : ""}`}
                style={{ background: hex }} onClick={() => p.onColour(hex)} />
      ))}
      {button("thinner", "−", () => p.onWidth(-1), "small")}
      {button("thicker", "+", () => p.onWidth(1), "small")}
      {button("orientation", p.orientationLabel, p.onOrientation)}
      {button("rotate-ink", "Rotate ink", p.onRotateInk)}
      {button("release", "Release", p.onRelease, "release")}
      <span className={`sheet-strip-tag${p.contained ? " on" : ""}`} data-tablet="strip-tag">{containedTag(p.contained)}</span>
    </div>
  )
}
