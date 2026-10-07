/**
 * THE LANGUAGE ICONS an evaluation cell's mark shows in place of letters (Sean, a608cc3: "use icons for WL, CPP,
 * Python"). Port-only: the Mac's mark is still letters.
 *
 * DRAWN HERE, FROM NOTHING: each icon is a few shapes on a 16 x 16 grid, our own simple drawings of what the
 * language is known by (Wolfram's spiky star, Python's two snakes, C and C++ as a letter in a hexagon, Rust's cog),
 * not anybody's artwork and not a file. They are MONOCHROME — a shape is either filled or stroked and the page paints
 * it `currentColor`, so the mark's own colour (grey, the accent on hover, amber for a missing tool) is the icon's, in
 * the light and the dark theme alike. The page turns the shapes into an `<svg>` (`packages/editor/src/eval`), which
 * the core does not know how to do: this file has no DOM in it, only the numbers and the rules the numbers keep
 * (`icons.test`'s checks).
 *
 * The LETTERS STAY: `evaluatorBadge` is still the mark's accessible name and its tooltip; an environment this app
 * does not know has no icon at all and keeps its text (`languageIcon` is null for it).
 */

import { evaluatorFrom, type Evaluator } from "./evaluator"

/** One shape on the 16 x 16 grid. */
export interface IconShape {
  /** SVG path data: absolute `M L H V A Z` only, so a test can read every point it names. */
  d: string
  /** Filled solid, or drawn as a line `width` thick. */
  paint: "fill" | "stroke"
  /** The line's width, for `stroke`. */
  width?: number
  /** Round the ends and the corners of a line (the default is square ends and sharp corners). */
  round?: boolean
}

export interface LanguageIcon {
  /** The grid every shape is drawn on. */
  size: 16
  shapes: IconShape[]
}

/** A pointy-topped hexagon, the outline C and C++ share. */
const HEXAGON = "M8 1 L14.2 4.5 V11.5 L8 15 L1.8 11.5 V4.5 Z"

const ICONS: Record<Evaluator, LanguageIcon> = {
  // Wolfram: the eight-pointed spikey, one solid star.
  wolfram: {
    size: 16,
    shapes: [{
      paint: "fill",
      d: "M8 0.4 L8.88 5.88 L13.37 2.63 L10.12 7.12 L15.6 8 L10.12 8.88 L13.37 13.37 L8.88 10.12 L8 15.6 L7.12 10.12 "
        + "L2.63 13.37 L5.88 8.88 L0.4 8 L5.88 7.12 L2.63 2.63 L7.12 5.88 Z",
    }],
  },
  // Python: two snakes, one over the other, each turned half way round from the other.
  python: {
    size: 16,
    shapes: [
      { paint: "stroke", width: 1.9, round: true, d: "M12.4 6.6 V4.6 A2.6 2.6 0 0 0 9.8 2 H6.4 A2.6 2.6 0 0 0 3.8 4.6 V5.6 A1.5 1.5 0 0 0 5.3 7.1 H6.9" },
      { paint: "stroke", width: 1.9, round: true, d: "M3.6 9.4 V11.4 A2.6 2.6 0 0 0 6.2 14 H9.6 A2.6 2.6 0 0 0 12.2 11.4 V10.4 A1.5 1.5 0 0 0 10.7 8.9 H9.1" },
    ],
  },
  // C: a letter C in a hexagon.
  c: {
    size: 16,
    shapes: [
      { paint: "stroke", width: 1.3, d: HEXAGON },
      { paint: "stroke", width: 1.9, d: "M10.6 6 A3.1 3.1 0 1 0 10.6 10" },
    ],
  },
  // C++: the same hexagon, a smaller C, and two pluses.
  cpp: {
    size: 16,
    shapes: [
      { paint: "stroke", width: 1.3, d: HEXAGON },
      { paint: "stroke", width: 1.6, d: "M7.25 6.4 A2.3 2.3 0 1 0 7.25 9.6" },
      { paint: "stroke", width: 1, d: "M8.55 8 H10.25 M9.4 7.15 V8.85 M11.15 8 H12.85 M12 7.15 V8.85" },
    ],
  },
  // Rust: a cog — a ring with eight teeth.
  rust: {
    size: 16,
    shapes: [
      { paint: "stroke", width: 1.7, d: "M3.7 8 A4.3 4.3 0 0 1 12.3 8 A4.3 4.3 0 0 1 3.7 8 Z" },
      {
        paint: "stroke", width: 2.3,
        d: "M12.6 8 H14.9 M11.25 11.25 L12.88 12.88 M8 12.6 V14.9 M4.75 11.25 L3.12 12.88 M3.4 8 H1.1 "
          + "M4.75 4.75 L3.12 3.12 M8 3.4 V1.1 M11.25 4.75 L12.88 3.12",
      },
    ],
  },
}

/** The icon an environment's mark shows. */
export const evaluatorIcon = (evaluator: Evaluator): LanguageIcon => ICONS[evaluator]

/**
 * The icon for an info string (`eval python`…), or null for a fence this app cannot run — the mark keeps a dash
 * there, which is text because there is no language to draw.
 */
export function languageIcon(fence: string | null | undefined): LanguageIcon | null {
  const evaluator = evaluatorFrom(fence)
  return evaluator ? ICONS[evaluator] : null
}
