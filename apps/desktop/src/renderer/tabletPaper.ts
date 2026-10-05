/**
 * The paper the tablet sheet is written on: blank, a dot grid, ruled lines, squares, isometric dots, Cornell
 * notes; three spacings; white, cream or dark paper. No React and no DOM beyond a 2D context passed in, so the
 * geometry and the colour rules are tested with numbers.
 *
 * THE PAPER IS A BACKGROUND, NEVER INK. It is painted on its own canvas under the ink, it is not in
 * `TabletPage.strokes`, and `takeFromSheet` never gives it to the writing or to the flow-chart reader (they
 * are made from strokes alone): printed dots are not text. Only the Page picture includes it.
 *
 * The Mac has no paper chooser: its dotted notebook is the physical paper the camera recognises
 * (WriteMind/Camera/NotebookCapture.swift). This list is a sensible standard set pending the Mac's real one.
 *
 * Everything is measured in the sheet's REFERENCE units (`SHEET_REF` across, as the strokes are), so the same
 * paper is the same size on a 500 px pane and on a 1500 px one, and in the Page picture. The painter snaps
 * lines to whole DEVICE pixels, so they are one crisp pixel at 100, 125 and 150 percent.
 */

import { useSyncExternalStore } from "react"
import type { Point, Rect, Size } from "@writemind/core"

export type PaperKind = "blank" | "dots" | "lines" | "grid" | "isometric" | "cornell"
export type PaperSpacing = "small" | "medium" | "large"
export type PaperColour = "white" | "cream" | "dark"

export interface Paper { kind: PaperKind; spacing: PaperSpacing; colour: PaperColour }

/** The notebook's dotted paper, as the Mac's camera knows it; white. */
export const DEFAULT_PAPER: Paper = { kind: "dots", spacing: "medium", colour: "white" }

export const PAPER_KINDS: { value: PaperKind; label: string }[] = [
  { value: "blank", label: "Blank" },
  { value: "dots", label: "Dot grid" },
  { value: "lines", label: "Lines" },
  { value: "grid", label: "Grid" },
  { value: "isometric", label: "Isometric dots" },
  { value: "cornell", label: "Cornell notes" },
]
export const PAPER_SPACINGS: { value: PaperSpacing; label: string }[] = [
  { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" },
]
export const PAPER_COLOURS: { value: PaperColour; label: string; paper: string; mark: string; strong: string }[] = [
  { value: "white", label: "White", paper: "#ffffff", mark: "#c9cfdb", strong: "#a6aebf" },
  { value: "cream", label: "Cream", paper: "#f7f0dc", mark: "#d6cba9", strong: "#b8aa80" },
  { value: "dark", label: "Dark", paper: "#1e2025", mark: "#3b4049", strong: "#5f6676" },
]
export const colourOfPaper = (colour: PaperColour) => PAPER_COLOURS.find((one) => one.value === colour) ?? PAPER_COLOURS[0]!

/** The pitch of the marks, in reference units, for each kind at small / medium / large. */
const PITCH: Record<Exclude<PaperKind, "blank">, [number, number, number]> = {
  dots: [18, 26, 38],
  grid: [20, 30, 44],
  lines: [30, 42, 58],
  isometric: [20, 28, 40],
  cornell: [30, 42, 58],
}
export function pitchOf(kind: PaperKind, spacing: PaperSpacing): number {
  if (kind === "blank") return 0
  return PITCH[kind][spacing === "small" ? 0 : spacing === "medium" ? 1 : 2]
}

export interface Segment { x0: number; y0: number; x1: number; y1: number; strong: boolean }
export interface PaperMarks {
  /** Dots' centres. */
  dots: Point[]
  /** Dot radius, reference units. */
  dotRadius: number
  /** Axis-aligned lines (a ruling, a square, a Cornell frame). */
  lines: Segment[]
}

/** Cornell's frame, as fractions of the sheet: the title strip, the cue column, the summary strip. */
export const CORNELL = { header: 0.1, cue: 0.3, summary: 0.82 }

/** Where the paper's marks are, on a sheet of `sheet` reference units. Pure. */
export function paperMarks(paper: Paper, sheet: Size): PaperMarks {
  const none: PaperMarks = { dots: [], dotRadius: 0, lines: [] }
  const s = pitchOf(paper.kind, paper.spacing)
  if (s <= 0 || sheet.width <= 0 || sheet.height <= 0) return none
  const { width: W, height: H } = sheet
  const dots: Point[] = []
  const lines: Segment[] = []
  const across = (from: number, to: number, step: number, fn: (v: number) => void) => {
    for (let v = from; v <= to + 1e-9; v += step) fn(v)
  }
  switch (paper.kind) {
    case "dots":
      across(s / 2, W - s / 4, s, (x) => across(s / 2, H - s / 4, s, (y) => dots.push({ x, y })))
      return { dots, dotRadius: s * 0.06, lines }
    case "isometric": {
      // A triangular lattice: rows sqrt(3)/2 of the pitch apart, every other row shifted half a pitch.
      const row = s * Math.sqrt(3) / 2
      let j = 0
      across(row / 2, H - row / 4, row, (y) => {
        const shift = j % 2 === 1 ? s / 2 : 0
        across(s / 2 + shift, W - s / 4, s, (x) => dots.push({ x, y }))
        j++
      })
      return { dots, dotRadius: s * 0.06, lines }
    }
    case "lines":
      across(2 * s, H - s / 2, s, (y) => lines.push({ x0: 0, y0: y, x1: W, y1: y, strong: false }))
      return { dots, dotRadius: 0, lines }
    case "grid":
      across(s, W - s / 2, s, (x) => lines.push({ x0: x, y0: 0, x1: x, y1: H, strong: false }))
      across(s, H - s / 2, s, (y) => lines.push({ x0: 0, y0: y, x1: W, y1: y, strong: false }))
      return { dots, dotRadius: 0, lines }
    case "cornell": {
      const top = H * CORNELL.header, bottom = H * CORNELL.summary, cue = W * CORNELL.cue
      // The ruling of the notes area, between the title strip and the summary strip, right of the cue column.
      across(top + s, bottom - s / 2, s, (y) => lines.push({ x0: cue, y0: y, x1: W, y1: y, strong: false }))
      lines.push({ x0: 0, y0: top, x1: W, y1: top, strong: true })
      lines.push({ x0: 0, y0: bottom, x1: W, y1: bottom, strong: true })
      lines.push({ x0: cue, y0: top, x1: cue, y1: bottom, strong: true })
      return { dots, dotRadius: 0, lines }
    }
    default: return none
  }
}

/**
 * The paper painted onto a canvas of `px` device pixels that shows the part `view` of a sheet of `sheet`
 * reference units (the whole sheet on screen; the boxed part for a Page picture). `ratio` is the device
 * pixel ratio, so a hairline is one device pixel. Lines are filled rectangles on whole pixels (crisp), dots
 * are filled circles centred on pixel centres.
 */
export function paintPaper(context: CanvasRenderingContext2D, paper: Paper, sheet: Size, view: Rect, px: Size, ratio = 1): void {
  const colours = colourOfPaper(paper.colour)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = colours.paper
  context.fillRect(0, 0, px.width, px.height)
  const marks = paperMarks(paper, sheet)
  const dx = px.width / Math.max(1e-6, view.width), dy = px.height / Math.max(1e-6, view.height)
  const X = (x: number): number => Math.round((x - view.x) * dx)
  const Y = (y: number): number => Math.round((y - view.y) * dy)
  for (const strong of [false, true]) {
    context.fillStyle = strong ? colours.strong : colours.mark
    const weight = Math.max(1, Math.round((strong ? 1.5 : 1) * ratio))
    for (const line of marks.lines) {
      if (line.strong !== strong) continue
      const x0 = X(line.x0), x1 = X(line.x1), y0 = Y(line.y0), y1 = Y(line.y1)
      if (x1 < 0 || y1 < 0 || x0 > px.width || y0 > px.height) continue
      if (line.y0 === line.y1) context.fillRect(x0, y0 - Math.floor(weight / 2), x1 - x0, weight)
      else context.fillRect(x0 - Math.floor(weight / 2), y0, weight, y1 - y0)
    }
  }
  if (marks.dots.length > 0) {
    const radius = Math.max(0.5 + 0.5 * ratio, marks.dotRadius * Math.min(dx, dy))
    context.fillStyle = colours.strong
    context.beginPath()
    for (const dot of marks.dots) {
      const cx = X(dot.x) + 0.5, cy = Y(dot.y) + 0.5
      if (cx < -radius || cy < -radius || cx > px.width + radius || cy > px.height + radius) continue
      context.moveTo(cx + radius, cy)
      context.arc(cx, cy, radius, 0, Math.PI * 2)
    }
    context.fill()
  }
}

// MARK: - Ink on the paper

/** The app's default pen colour and its black preset: the two inks that are dark on purpose. */
export const DEFAULT_PEN_COLOUR = "#2D7DD2"
const BLACKS = ["#1c1c1e", "#000000"]

export const isDarkPaper = (colour: PaperColour): boolean => colour === "dark"

function luminance(hex: string): number {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!value) return 0
  const channel = (at: number): number => {
    const c = parseInt(value.slice(at, at + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** WCAG contrast ratio between two #rrggbb colours (1...21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The colour a stroke is SHOWN in on this paper (the stroke keeps its own colour; this is only the look, and the
 * Page picture's). On dark paper the app's own default blue is lifted to a lighter blue, and its black preset
 * becomes near-white, so what you write stays visible; a colour the person chose is shown as chosen.
 */
export function inkOn(paper: Pick<Paper, "colour">, colourHex: string): string {
  if (!isDarkPaper(paper.colour)) return colourHex
  const hex = colourHex.toLowerCase()
  if (hex === DEFAULT_PEN_COLOUR.toLowerCase()) return "#6DA9F0"
  if (BLACKS.includes(hex)) return "#F2F2F7"
  return colourHex
}

// MARK: - Remembered per user

const KEY = "writemind.sheetPaper"
const isKind = (v: unknown): v is PaperKind => PAPER_KINDS.some((one) => one.value === v)
const isSpacing = (v: unknown): v is PaperSpacing => PAPER_SPACINGS.some((one) => one.value === v)
const isColour = (v: unknown): v is PaperColour => PAPER_COLOURS.some((one) => one.value === v)

/** What was kept, made safe: anything unknown falls back to the default for that part. */
export function parsePaper(raw: unknown): Paper {
  const given = (typeof raw === "string" ? safeParse(raw) : raw) as Partial<Record<keyof Paper, unknown>> | null
  return {
    kind: isKind(given?.kind) ? given.kind : DEFAULT_PAPER.kind,
    spacing: isSpacing(given?.spacing) ? given.spacing : DEFAULT_PAPER.spacing,
    colour: isColour(given?.colour) ? given.colour : DEFAULT_PAPER.colour,
  }
}
function safeParse(text: string): unknown { try { return JSON.parse(text) } catch { return null } }

let current: Paper = (() => {
  try { return parsePaper(localStorage.getItem(KEY)) } catch { return { ...DEFAULT_PAPER } }
})()
const listeners = new Set<() => void>()

export const paper = (): Paper => current
export function setPaper(patch: Partial<Paper>): void {
  const next = parsePaper({ ...current, ...patch })
  if (next.kind === current.kind && next.spacing === current.spacing && next.colour === current.colour) return
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* the choice lasts the session */ }
  listeners.forEach((listener) => listener())
}
export const subscribePaper = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const usePaper = (): Paper => useSyncExternalStore(subscribePaper, paper)
