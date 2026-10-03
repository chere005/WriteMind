/**
 * How a floating text box looks and how it is sized — ONE description of it,
 * used by the canvas that draws it and by the field that edits it. Ported
 * from `WriteMind/Drawing/TextBoxStyle.swift`.
 *
 * Sean, 2026-09-19: "text boxes look like shit… just start over and do
 * better". What was wrong with the old one was all of it the two sides
 * disagreeing: the words were drawn one way and typed another, so they
 * jumped the moment the caret arrived; the box only grew to fit what had
 * been typed after the typing stopped; and the ink was whatever the pen was
 * set to, which on a dark fill was nothing at all.
 *
 * So: one font, one padding, one corner, one measurement — and the ink is
 * checked against the card it sits on before it is used.
 *
 * The one thing this file cannot do is lay text out, because that needs a
 * font: a caller hands in `measure`, which says how tall `text` is when
 * wrapped to a given width, and everything else is arithmetic.
 */

export const TEXT_BOX = {
  fontSize: 14,
  /** One line's height — the CSS line-height of the editor and the step of the painter. */
  lineHeight: 18,
  /** Room round the words. The editor uses exactly this, so nothing moves. */
  padding: { width: 10, height: 8 },
  cornerRadius: 6,
  /** Nothing narrower is worth typing into. */
  minimumWidth: 60,
  /** The aspect a box falls back to when it is too narrow to measure. */
  fallbackAspect: 0.3,
} as const

/** The height of `text` wrapped to `room` points of width (0 for none). */
export type Measure = (text: string, room: number) => number

// MARK: - Size

/** How tall the box has to be, in points, to hold `text` at `width`. */
export function textBoxHeight(text: string, width: number, measure: Measure): number {
  const room = width - TEXT_BOX.padding.width * 2
  if (room <= 10) return TEXT_BOX.lineHeight + TEXT_BOX.padding.height * 2
  // An empty box still has a line's worth of room, so the caret has
  // somewhere to sit and the card does not collapse.
  const measured = text.length === 0 ? "M" : text
  return Math.ceil(measure(measured, room)) + TEXT_BOX.padding.height * 2
}

/** The same, as height over width — what a shape's `aspect` holds. */
export function textBoxAspect(text: string, boxWidth: number, measure: Measure): number {
  if (boxWidth - TEXT_BOX.padding.width * 2 <= 10) return TEXT_BOX.fallbackAspect
  return Math.max(0.08, textBoxHeight(text, boxWidth, measure) / boxWidth)
}

// MARK: - Ink you can read

/** `#RRGGBB` (or `RRGGBB`, or `#RGB`) as 0…1 channels; null when it is not a colour. */
export function rgbFromHex(hex: string): [number, number, number] | null {
  const trimmed = hex.trim().replace(/^#/, "")
  const full = /^[0-9a-fA-F]{3}$/.test(trimmed)
    ? trimmed.split("").map((c) => c + c).join("") : trimmed
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255) as [number, number, number]
}

/** Relative luminance, gamma taken out the way WCAG says. */
export function luminance(rgb: [number, number, number]): number {
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/** WCAG's contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const one = luminance(a), other = luminance(b)
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)
}

/** Black or white, whichever stands out more on `fill`. */
export function contrastWith(fill: [number, number, number]): string {
  return contrastRatio([0, 0, 0], fill) >= contrastRatio([1, 1, 1], fill) ? "#000000" : "#FFFFFF"
}

/**
 * The pen's colour if it can be read on the card, and black or white if it
 * cannot (Sean, 2026-09-19: "be mindful of text color… it should always be
 * visible against the background"). No fill means the note's own paper,
 * which the pen was picked against, so it is left alone.
 */
export function readableInk(inkHex: string, fillHex: string | null): string {
  if (fillHex === null) return inkHex
  const fill = rgbFromHex(fillHex)
  if (!fill) return inkHex
  const ink = rgbFromHex(inkHex)
  if (!ink) return contrastWith(fill)
  return contrastRatio(ink, fill) >= 3 ? inkHex : contrastWith(fill)
}
