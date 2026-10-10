/**
 * THE LANGUAGE ICONS an evaluation cell's mark shows in place of letters (Sean, a608cc3: "use icons for WL, CPP,
 * Python"). Port-only: the Mac's mark is still letters.
 *
 * DRAWN HERE, FROM NOTHING (except Wolfram's, which is the real logo): each icon is a few shapes on a 16 x 16 grid, our own simple drawings of what the
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
  /** A fixed colour (a logo's own); absent, the shape is `currentColor`. */
  colour?: string
}

export interface LanguageIcon {
  /** The grid every shape is drawn on. */
  size: number
  shapes: IconShape[]
}

/** A pointy-topped hexagon, the outline C and C++ share. */
const HEXAGON = "M8 1 L14.2 4.5 V11.5 L8 15 L1.8 11.5 V4.5 Z"

const ICONS: Record<Evaluator, LanguageIcon> = {
  // Wolfram: the company's own spikey, the one drawn in full colour (Sean, 2026-10-07: "use the actual logo"). The one
  // icon that is not monochrome and not on the 16 grid: its path is the logo's, on a 200 x 200 one.
  wolfram: {
    size: 200,
    shapes: [{ paint: "fill", colour: "#dd1100", d: "M102.4,195.2l-19.9-34L46.4,177l3.9-39.2l-38.5-8.4L38.1,100L11.8,70.5l38.5-8.4l-3.9-39.2l36.1,15.9l19.9-34l19.9,34l36.1-15.8l-3.9,39.2l38.5,8.4L166.8,100l26.2,29.4l-38.5,8.4l3.9,39.2l-36.1-15.9L102.4,195.2z M89.1,153.9l8.7,14.8v-14.9l-9-13.1L89.1,153.9z M107.1,153.9v14.9l8.7-14.8l0.3-13.2L107.1,153.9z M125.1,152.2l22.4,9.8l-2.4-24.4l-19.5-6.2L125.1,152.2z M59.7,137.7l-2.4,24.4l22.4-9.8l-0.5-20.7L59.7,137.7z M89.4,125.3l13,18.9l13-18.9l-13-17.6L89.4,125.3z M137,125.3l12.6,4l17.2-3.8l-14.2-4.9L137,125.3z M38,125.6l17.2,3.8l12.6-4l-15.6-4.6L38,125.6z M110,102.2l13,17.6l22-6.5l-14-18.2L110,102.2z M59.9,113.3l22,6.5l13-17.6l-21-7.1L59.9,113.3z M155.6,111.9l13.3,4.5L157.8,104l-11.6-4.3L155.6,111.9z M47,103.9l-11.1,12.5l13.3-4.5l9.4-12.2L47,103.9z M139.9,87.4l19.2,7.1l16.3-18.2l-24-5.2L139.9,87.4z M29.4,76.3l16.2,18.2l19.2-7.1L53.4,71L29.4,76.3z M107.1,71v22.4l21-7.1l0.6-23L107.1,71z M76.8,86.3l21,7.1V71l-21.6-7.7L76.8,86.3z M138.2,58.2l-0.4,16.1l7.2-10.2l1.7-17.4L138.2,58.2z M59.9,64.1l7.2,10.2l-0.4-16.1l-8.5-11.4L59.9,64.1z M90.1,44.3l12.3,15.8l12.3-15.8l-12.3-21.1L90.1,44.3z M74.2,52.7l14.7,5.2l-7.3-9.4l-15.4-6.8L74.2,52.7z M123.3,48.5l-7.3,9.4l14.7-5.2l8.1-10.9L123.3,48.5z" }],
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
