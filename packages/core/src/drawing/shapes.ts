/**
 * A drawn figure: a flow-chart node — rectangle, oval, diamond, triangle —
 * or one of the marks people draw all the time, a check, a cross, a star, a
 * query. Ported from `WriteMind/Drawing/Shapes.swift`.
 *
 * The outline is drawn in a unit square and scaled into the item's box, so a
 * diamond and a check mark are the same kind of thing, and the box is what
 * the handles hold.
 */

export type ShapeKind =
  | "rectangle" | "roundedRectangle" | "oval" | "diamond" | "triangle" | "parallelogram"
  | "check" | "cross" | "star" | "question"
  /** A box of text with no outline of its own: a node for every other purpose. */
  | "text"

export interface Point { x: number; y: number }

export const NODE_KINDS: ShapeKind[] =
  ["rectangle", "roundedRectangle", "oval", "diamond", "triangle", "parallelogram"]
export const MARK_KINDS: ShapeKind[] = ["check", "cross", "question", "star"]

/** Nodes carry a label and are what arrows land on; marks are marks. */
export function isNode(kind: ShapeKind): boolean {
  return !MARK_KINDS.includes(kind)
}

/** A closed outline is hit anywhere inside it; an open one only on the line. */
export function isClosed(kind: ShapeKind): boolean {
  return !(kind === "check" || kind === "cross" || kind === "question")
}

export function shapeTitle(kind: ShapeKind): string {
  return {
    rectangle: "Rectangle", roundedRectangle: "Rounded Rectangle", oval: "Oval",
    diamond: "Diamond", triangle: "Triangle", parallelogram: "Parallelogram",
    check: "Check Mark", cross: "Cross", star: "Star", question: "Question Mark",
    text: "Text Box",
  }[kind]
}

/** Height over width when the shape is first put down. */
export function defaultAspect(kind: ShapeKind): number {
  switch (kind) {
    case "rectangle": case "roundedRectangle": case "parallelogram": return 0.55
    case "oval": return 0.6
    case "diamond": return 0.7
    case "triangle": return 0.8
    case "text": return 0.3
    default: return 1
  }
}

/** The app's own preset swatches, which the marks take their colours from. */
export const PRESET_COLOURS = ["#F2542D", "#F5B700", "#2FBF71", "#2D7DD2", "#8E44AD", "#1C1C1E"]

/**
 * The colour the mark MEANS, whatever the pen is holding — a tick is green,
 * a cross is red and a query is yellow, because a tick in the pen's black
 * beside a red cross says nothing. Null is "the pen's": a node is the note's
 * drawing, and so is a star.
 */
export function inkHex(kind: ShapeKind): string | null {
  switch (kind) {
    case "check": return PRESET_COLOURS[2]!
    case "cross": return PRESET_COLOURS[0]!
    case "question": return PRESET_COLOURS[1]!
    default: return null
  }
}

/**
 * How big a mark is when it is simply put down: one line of the note's own
 * text tall. POINTS, not a fraction of the pane — what it has to match is
 * the writing beside it.
 */
export const MARK_SIDE = 18

/**
 * The outline in a unit square, y down as on screen — several polylines for
 * a mark drawn in more than one stroke (the cross).
 */
export function unitPolylines(kind: ShapeKind): Point[][] {
  switch (kind) {
    case "rectangle": case "roundedRectangle": case "text":
      return [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]
    case "oval":
      return [Array.from({ length: 32 }, (_, step) => {
        const angle = (step / 32) * 2 * Math.PI
        return { x: 0.5 + 0.5 * Math.cos(angle), y: 0.5 + 0.5 * Math.sin(angle) }
      })]
    case "diamond":
      return [[{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }]]
    case "triangle":
      return [[{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]
    case "parallelogram":
      return [[{ x: 0.2, y: 0 }, { x: 1, y: 0 }, { x: 0.8, y: 1 }, { x: 0, y: 1 }]]

    // The MARKS are drawn to look like the thing, not like a polyline that
    // happens to be near it. Each is inset from the unit square so a round
    // cap does not hang out of the box the handles are drawn round.
    case "check":
      // A tick's short arm is about two fifths of its long one, and the two
      // meet low and left of centre.
      return [[{ x: 0.12, y: 0.52 }, { x: 0.40, y: 0.80 }, { x: 0.88, y: 0.16 }]]
    case "cross":
      return [[{ x: 0.16, y: 0.16 }, { x: 0.84, y: 0.84 }],
              [{ x: 0.84, y: 0.16 }, { x: 0.16, y: 0.84 }]]
    case "star": {
      // A five-pointed star's inner radius is the outer one over phi
      // squared — 0.382 — and anything much under it is a spider.
      const outer = 0.45, inner = outer * 0.382
      return [Array.from({ length: 10 }, (_, step) => {
        const angle = -Math.PI / 2 + step * Math.PI / 5
        const radius = step % 2 === 0 ? outer : inner
        return { x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) }
      })]
    }
    case "question": {
      // Two strokes, like the glyph: the bowl and the dot. The bowl is a
      // 235-degree arc — from low on the left, over the top, round the
      // right — and then the tail curves back in to a stem on the middle
      // line. The dot is a segment too short to see, drawn by the round cap
      // on the end of it; not a zero-length one, which some renderers drop.
      const centre = { x: 0.5, y: 0.31 }, radius = 0.21
      const bowl = Array.from({ length: 13 }, (_, step) => {
        const angle = (160 + (step / 12) * 235) * Math.PI / 180
        return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) }
      })
      return [[...bowl, { x: 0.57, y: 0.53 }, { x: 0.5, y: 0.62 }, { x: 0.5, y: 0.68 }],
              [{ x: 0.497, y: 0.86 }, { x: 0.503, y: 0.86 }]]
    }
  }
}

export interface Rect { x: number; y: number; width: number; height: number }

/** The polylines scaled into a box. */
export function polylines(kind: ShapeKind, box: Rect): Point[][] {
  return unitPolylines(kind).map((line) =>
    line.map((point) => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height })))
}
