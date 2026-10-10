/**
 * THE PEN'S LOOK, once: the colours and the widths the pen's menu offers (docs/PLAN-bars-2026-10.md P1, Sean 2026-10-10:
 * "8 should be under this dropdown to choose pen dot and width"). The drawing layer's inspector (P5) imports these
 * rather than keeping a second list, so a colour picked there and one picked on the bar are the same swatch.
 *
 * The swatches are the core's presets (`PRESET_COLOURS`, the ink the app draws marks in) in the wireframe's order —
 * black first, then red, blue, green, amber, purple — and one more, the custom colour, which the menu's rainbow ring
 * opens the system's picker for. The widths are the ladder the keys step along (⌥⌘6 wider, ⌥⌘7 thinner: penButtons.ts).
 */

import { PRESET_COLOURS } from "@writemind/core"
import { PEN_WIDTHS } from "./penButtons"

export { PEN_WIDTHS }

/** The preset ink, by name, in the order the menu shows it. */
export const PEN_SWATCHES: { hex: string; name: string }[] = [
  { hex: PRESET_COLOURS[5]!, name: "Black" },
  { hex: PRESET_COLOURS[0]!, name: "Red" },
  { hex: PRESET_COLOURS[3]!, name: "Blue" },
  { hex: PRESET_COLOURS[2]!, name: "Green" },
  { hex: PRESET_COLOURS[1]!, name: "Amber" },
  { hex: PRESET_COLOURS[4]!, name: "Purple" },
]

/** Whether two colours are the same ink (a picker answers in lower case, the presets are upper). */
export const sameInk = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The preset a colour is, or null for a custom one. */
export const swatchOf = (hex: string): { hex: string; name: string } | null =>
  PEN_SWATCHES.find((one) => sameInk(one.hex, hex)) ?? null

/** A width as the menu's dot: its diameter in px, drawn to scale up to a cap that fits the row. */
export const dotSize = (width: number): number => Math.max(2, Math.min(width, 12))

/** The width on the ladder nearest to `width` (a stored width that is not on it still shows a mark). */
export function nearestWidth(width: number): number {
  return PEN_WIDTHS.reduce((best, one) => (Math.abs(one - width) < Math.abs(best - width) ? one : best), PEN_WIDTHS[0]!)
}
