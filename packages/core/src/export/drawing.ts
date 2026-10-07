/**
 * The drawing layer, painted onto paper — as VECTORS. Ported from
 * `WriteMind/Export/DrawingInk.swift`: one object at a time, each in its own
 * box, in the document's own points with y running down, so an object lands
 * exactly where it sits on the pane. Strokes, shapes and connectors are SVG
 * paths (so they stay sharp however a printer scales them), a picture is an
 * SVG image, and the words of a text box or a node's label are real text.
 *
 * Every colour is put through `readableInk` against the paper first. A pen
 * picked to read on a dark window is not a colour that exists on white
 * paper (Sean, 2026-09-19: "be mindful of text color... it should always be
 * visible against the background").
 *
 * A string comes out and no DOM is touched, so the main process builds it and
 * the tests read it.
 */

import { applyMatrix, baseBounds, baseCenter, bounds, matrixOf, route, type Size } from "../drawing/geometry"
import { connectorPaths, dashPattern, strokeCurve } from "../drawing/ink"
import { visibleItems, type CanvasItem, type Drawing, type ShapeItem } from "../drawing/model"
import { pressureScale } from "../drawing/pen"
import { isClosed, polylines, type Point, type Rect } from "../drawing/shapes"
import { readableInk, TEXT_BOX } from "../drawing/textBox"
import { escapeHtml, PAPER_HEX } from "./inline"

export interface InkPiece {
  /** Where it sits, in document points. */
  frame: Rect
  /** Positioned in document coordinates; draws itself. */
  html: string
}

/**
 * Words broken into lines the way the screen breaks them: `text` in a box `room` px wide, at `font.size` px with lines
 * `font.line` px apart. The canvas's own wrapper is the one handed in (it needs a font to measure with, and the core
 * has none).
 */
export type WordBreaker = (text: string, room: number, font: { size: number; line: number }) => string[]

export interface InkOptions {
  paper?: string
  /** A picture's file name → a URL the printing page can load. */
  mediaUrl(file: string): string
  /**
   * Port-only (the Wolfram export, export/wolfram/): with it, a text box's and a node's words are SVG `<text>`, one
   * `<tspan>` per line broken where the screen broke them, instead of a `<foreignObject>` — an SVG reader that is not a
   * browser (the Wolfram Engine's importer) drops a `<foreignObject>` and the words with it.
   */
  words?: WordBreaker
}

const n = (value: number): string => String(Math.round(value * 100) / 100)

const FONT = `"Segoe UI", -apple-system, "Helvetica Neue", Cantarell, "Noto Sans", Arial, sans-serif`

const svg = (size: Size, body: string): string =>
  `<svg class="ink" xmlns="http://www.w3.org/2000/svg" width="${n(size.width)}" height="${n(size.height)}" `
  + `viewBox="0 0 ${n(size.width)} ${n(size.height)}" style="position:absolute;left:0;top:0;overflow:visible">${body}</svg>`

const polyline = (points: Point[], close = false): string =>
  points.map((p, index) => `${index === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join("") + (close ? "Z" : "")

/** The transform an object carries, as CSS about the centre of its own box. */
function boxStyle(item: CanvasItem, size: Size, box: Rect, transform: { dx: number; dy: number; scale: number; rotation: number }): string {
  const centre = baseCenter(item, size)
  return `position:absolute;left:${n(box.x)}px;top:${n(box.y)}px;width:${n(box.width)}px;height:${n(box.height)}px;`
    + `transform-origin:${n(centre.x - box.x)}px ${n(centre.y - box.y)}px;`
    + `transform:translate(${n(transform.dx * size.width)}px,${n(transform.dy * size.height)}px) `
    + `rotate(${transform.rotation}rad) scale(${transform.scale})`
}

function strokeHtml(item: Extract<CanvasItem, { kind: "stroke" }>, size: Size, paper: string): string {
  const body = strokeBody(item, size, paper)
  return body ? svg(size, body) : ""
}

/** A stroke's SVG elements, in the px of `size`; "" when it has no ink. */
function strokeBody(item: Extract<CanvasItem, { kind: "stroke" }>, size: Size, paper: string): string {
  const stroke = item.stroke
  const place = matrixOf(item, size)
  const points = stroke.points.map((p) => place({ x: p.x * size.width, y: p.y * size.height }))
  if (points.length === 0) return ""
  const colour = readableInk(stroke.colorHex, paper)
  const width = stroke.width * stroke.transform.scale
  const common = `fill="none" stroke="${colour}" stroke-linecap="round" stroke-linejoin="round"`
  const pressures = stroke.pressures
  if (pressures && pressures.length === points.length && points.length > 1) {
    // A pen stroke: each segment at the mean of its ends' pressure, runs of equal width as one path.
    const paths: string[] = []
    let run = ""
    let runWidth = -1
    for (let i = 1; i < points.length; i++) {
      const w = Math.max(0.25, Math.round(width * pressureScale((pressures[i - 1]! + pressures[i]!) / 2) * 4) / 4)
      if (w !== runWidth) {
        if (run) paths.push(`<path d="${run}" ${common} stroke-width="${n(runWidth)}"/>`)
        run = ""
        runWidth = w
      }
      run += `M${n(points[i - 1]!.x)} ${n(points[i - 1]!.y)}L${n(points[i]!.x)} ${n(points[i]!.y)}`
    }
    if (run) paths.push(`<path d="${run}" ${common} stroke-width="${n(runWidth)}"/>`)
    return paths.join("")
  }
  const curve = strokeCurve({ width }, points)
  if (!curve) return ""
  if ("dot" in curve) {
    return `<circle cx="${n(curve.dot.centre.x)}" cy="${n(curve.dot.centre.y)}" r="${n(curve.dot.diameter / 2)}" fill="${colour}"/>`
  }
  const d = curve.steps.map((step) => step.op === "Q"
    ? `Q${n(step.control.x)} ${n(step.control.y)} ${n(step.to.x)} ${n(step.to.y)}`
    : `${step.op}${n(step.to.x)} ${n(step.to.y)}`).join("")
  return `<path d="${d}" ${common} stroke-width="${n(width)}"/>`
}

function connectorHtml(item: Extract<CanvasItem, { kind: "connector" }>, size: Size, paper: string): string {
  const body = connectorBody(item, size, paper)
  return body ? svg(size, body) : ""
}

function connectorBody(item: Extract<CanvasItem, { kind: "connector" }>, size: Size, paper: string): string {
  const c = item.connector
  const place = matrixOf(item, size)
  const placed = route(c).map((p) => place({ x: p.x * size.width, y: p.y * size.height }))
  const { line, heads } = connectorPaths(c, placed)
  if (line.length < 2) return ""
  const colour = readableInk(c.colorHex, paper)
  const scale = c.transform.scale
  const dash = dashPattern(c).map((v) => v * scale)
  const body = `<path d="${polyline(line)}" fill="none" stroke="${colour}" stroke-width="${n(c.lineWidth * scale)}" `
    + `stroke-linecap="${c.line === "dotted" ? "round" : "butt"}" stroke-linejoin="round"`
    + `${dash.length ? ` stroke-dasharray="${dash.map(n).join(" ")}"` : ""}/>`
    + heads.map((head) => `<path d="${polyline(head, true)}" fill="${colour}"/>`).join("")
  return body
}

function imageHtml(item: Extract<CanvasItem, { kind: "image" }>, size: Size, options: InkOptions): string {
  const body = imageBody(item, size, options)
  return body ? svg(size, body) : ""
}

function imageBody(item: Extract<CanvasItem, { kind: "image" }>, size: Size, options: InkOptions): string {
  const image = item.image
  if (!image.file) return ""
  const box = baseBounds(item, size)
  const centre = baseCenter(item, size)
  const t = image.transform
  const transform = `translate(${n(centre.x + t.dx * size.width)} ${n(centre.y + t.dy * size.height)}) `
    + `rotate(${n(t.rotation * 180 / Math.PI)}) scale(${t.scale}) translate(${n(-centre.x)} ${n(-centre.y)})`
  // A file that has gone missing leaves nothing on the paper — the dashed box the
  // canvas shows in its place is a message to the person editing, not part of the note.
  return `<image href="${escapeHtml(options.mediaUrl(image.file))}" x="${n(box.x)}" y="${n(box.y)}" `
    + `width="${n(box.width)}" height="${n(box.height)}" preserveAspectRatio="none" transform="${transform}"/>`
}

/** What a node's label is set in, on the canvas and here: 13 px type on 16 px lines, and no more than six of them. */
const LABEL = { size: 13, line: 16, lines: 6, padX: 6 } as const

/**
 * Words as the Wolfram Engine's SVG importer can take them. Checked against the engine (12.x, Mac): a code point above
 * U+FFFF (an emoji) sets the WHOLE line in tofu boxes, ASCII included; a character outside XML 1.0's Char production
 * (a vertical tab from Word, a form feed from a PDF, U+0001, U+FFFE) makes the whole import fail, and the drawing
 * with it. So an astral code point (or a lone surrogate) becomes U+25A1 — a box the importer does draw — and an
 * illegal control becomes a space, which is what a soft break or a page break read as. Tab, LF and CR are legal and
 * stay (the breaker takes the lines apart before they get here).
 */
export function importable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, " ")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, "□")
}

/**
 * A shape's words as SVG `<text>` (`InkOptions.words`): the lines the screen broke them into, in the shape's own
 * transform. A text box's start inside its padding, each on the baseline the canvas puts it on (the canvas sets a
 * line's TOP, half the leading down; an em's top is about 0.8 of the size above its baseline), and a line whose
 * baseline falls past the box is cut, as the box's own edge cuts it on screen. A node's label is centred on the box.
 */
function shapeText(shape: ShapeItem, box: Rect, colour: string, turn: string, words: WordBreaker): string {
  const family = FONT.replace(/"/g, "'")
  const tspans = (lines: string[], x: number, baseline: (index: number) => number): string =>
    lines.map((line, index) => line === "" ? "" : `<tspan x="${n(x)}" y="${n(baseline(index))}">${escapeHtml(line)}</tspan>`).join("")
  if (shape.kind === "text") {
    const room = Math.max(1, box.width - TEXT_BOX.padding.width * 2)
    const top = box.y + TEXT_BOX.padding.height + (TEXT_BOX.lineHeight - TEXT_BOX.fontSize) / 2 + 0.8 * TEXT_BOX.fontSize
    const baseline = (index: number) => top + index * TEXT_BOX.lineHeight
    const lines = words(importable(shape.label), room, { size: TEXT_BOX.fontSize, line: TEXT_BOX.lineHeight })
      .filter((_line, index) => index === 0 || baseline(index) <= box.y + box.height)
    const body = tspans(lines, box.x + TEXT_BOX.padding.width, baseline)
    return body ? `<text font-family="${family}" font-size="${TEXT_BOX.fontSize}" fill="${colour}" transform="${turn}">${body}</text>` : ""
  }
  const room = Math.max(10, box.width - LABEL.padX * 2)
  const lines = words(importable(shape.label), room, { size: LABEL.size, line: LABEL.line }).slice(0, LABEL.lines)
  // The canvas centres each line's middle on the box's (`textBaseline = "middle"`): an em's middle is 0.3 of the
  // size above its baseline.
  const middle = box.y + box.height / 2 + 0.3 * LABEL.size
  const baseline = (index: number) => middle + (index - (lines.length - 1) / 2) * LABEL.line
  const body = tspans(lines, box.x + box.width / 2, baseline)
  return body ? `<text font-family="${family}" font-size="${LABEL.size}" fill="${colour}" text-anchor="middle" transform="${turn}">${body}</text>` : ""
}

/**
 * A shape as SVG elements alone (for a drawing written as ONE svg, such as an ink cell's snapshot): its outline as
 * paths, and its words (a text box's, a node's label) in a `<foreignObject>` holding the same box the page draws —
 * or, given `words`, as SVG text (`shapeText`).
 */
function shapeBody(item: Extract<CanvasItem, { kind: "shape" }>, size: Size, paper: string, wordBreaker?: WordBreaker): string {
  const shape = item.shape
  const box = baseBounds(item, size)
  const colour = readableInk(shape.colorHex, shape.fillHex ?? paper)
  const centre = baseCenter(item, size)
  const t = shape.transform
  const turn = `translate(${n(centre.x + t.dx * size.width)} ${n(centre.y + t.dy * size.height)}) `
    + `rotate(${n(t.rotation * 180 / Math.PI)}) scale(${t.scale}) translate(${n(-centre.x)} ${n(-centre.y)})`
  const words = (style: string): string => `<foreignObject x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" `
    + `height="${n(box.height)}" transform="${turn}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;`
    + `box-sizing:border-box;${style}">${escapeHtml(shape.label)}</div></foreignObject>`
  if (shape.kind === "text") {
    if (!shape.fillHex && shape.label === "") return ""
    if (wordBreaker) {
      // The card (its fill and its corner) and then the words on it.
      const card = shape.fillHex ? `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" `
        + `rx="${TEXT_BOX.cornerRadius}" fill="${shape.fillHex}" transform="${turn}"/>` : ""
      return card + (shape.label === "" ? "" : shapeText(shape, box, colour, turn, wordBreaker))
    }
    return words(`border-radius:${TEXT_BOX.cornerRadius}px;${shape.fillHex ? `background:${shape.fillHex};` : ""}`
      + `padding:${TEXT_BOX.padding.height}px ${TEXT_BOX.padding.width}px;font:${TEXT_BOX.fontSize}px/${TEXT_BOX.lineHeight}px ${FONT.replace(/"/g, "'")};`
      + `color:${colour};white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden`)
  }
  const place = matrixOf(item, size)
  const lines = polylines(shape.kind, box).map((one) => one.map(place))
  const closed = isClosed(shape.kind)
  const width = shape.lineWidth * shape.transform.scale
  let body = lines.map((line) => line.length === 0 ? "" :
    `<path d="${polyline(line, closed && lines.length === 1)}" `
    + `fill="${shape.fillHex && closed && lines.length === 1 ? shape.fillHex : "none"}" stroke="${colour}" `
    + `stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join("")
  if (shape.label) {
    body += wordBreaker ? shapeText(shape, box, colour, turn, wordBreaker)
      : words(`display:flex;align-items:center;justify-content:center;padding:4px 6px;font:13px/16px ${FONT.replace(/"/g, "'")};`
        + `color:${colour};text-align:center;white-space:pre-wrap;overflow-wrap:break-word`)
  }
  return body
}

function shapeHtml(item: Extract<CanvasItem, { kind: "shape" }>, size: Size, paper: string): string {
  const shape = item.shape
  const box = baseBounds(item, size)
  const colour = readableInk(shape.colorHex, shape.fillHex ?? paper)

  if (shape.kind === "text") {
    // A text box: the card, then the words inside the same padding the editor types into. An EMPTY
    // box prints nothing but its fill — the outline and the grey word "Text" are there to be
    // clicked, and paper cannot be clicked.
    if (!shape.fillHex && shape.label === "") return ""
    return `<div style="${boxStyle(item, size, box, shape.transform)};box-sizing:border-box;`
      + `border-radius:${TEXT_BOX.cornerRadius}px;${shape.fillHex ? `background:${shape.fillHex};` : ""}`
      + `padding:${TEXT_BOX.padding.height}px ${TEXT_BOX.padding.width}px;font:${TEXT_BOX.fontSize}px/${TEXT_BOX.lineHeight}px ${FONT};`
      + `color:${colour};white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden">${escapeHtml(shape.label)}</div>`
  }

  const place = matrixOf(item, size)
  const lines = polylines(shape.kind, box).map((one) => one.map(place))
  const closed = isClosed(shape.kind)
  const width = shape.lineWidth * shape.transform.scale
  const paths = lines.map((line) => line.length === 0 ? "" :
    `<path d="${polyline(line, closed && lines.length === 1)}" `
    + `fill="${shape.fillHex && closed && lines.length === 1 ? shape.fillHex : "none"}" stroke="${colour}" `
    + `stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join("")
  let html = svg(size, paths)
  if (shape.label) {
    html += `<div style="${boxStyle(item, size, box, shape.transform)};display:flex;align-items:center;justify-content:center;`
      + `padding:4px 6px;box-sizing:border-box;font:13px/16px ${FONT};color:${colour};text-align:center;`
      + `white-space:pre-wrap;overflow-wrap:break-word">${escapeHtml(shape.label)}</div>`
  }
  return html
}

/** One object, as HTML positioned in document coordinates, or "" when it paints nothing. */
export function itemHtml(item: CanvasItem, size: Size, options: InkOptions): string {
  const paper = options.paper ?? PAPER_HEX
  switch (item.kind) {
    case "stroke": return strokeHtml(item, size, paper)
    case "connector": return connectorHtml(item, size, paper)
    case "image": return imageHtml(item, size, options)
    case "shape": return shapeHtml(item, size, paper)
    // An ink cell is printed with the words, as a cell (blocks.ts), never as a floating object.
    case "cell": return ""
  }
}

/**
 * One object as SVG ELEMENTS (no `<svg>` round it), in the px of `size`, or "" when it paints nothing: for a drawing
 * written as one svg, such as an ink cell (`inkSnapshot.ts`). A cell inside is nothing (a cell never holds one).
 */
export function itemSvg(item: CanvasItem, size: Size, options: InkOptions): string {
  const paper = options.paper ?? PAPER_HEX
  switch (item.kind) {
    case "stroke": return strokeBody(item, size, paper)
    case "connector": return connectorBody(item, size, paper)
    case "image": return item.image.file ? imageBody(item, size, options) : ""
    case "shape": return shapeBody(item, size, paper, options.words)
    case "cell": return ""
  }
}

/** Every visible object, back to front, each with the box the page plan keeps whole. */
export function inkPieces(drawing: Drawing, size: Size, options: InkOptions): InkPiece[] {
  const pieces: InkPiece[] = []
  for (const item of visibleItems(drawing)) {
    const frame = bounds(item, size)
    if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || !(frame.height > 0)) continue
    const html = itemHtml(item, size, options)
    if (html) pieces.push({ frame, html })
  }
  return pieces
}
