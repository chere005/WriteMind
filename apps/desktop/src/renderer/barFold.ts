/**
 * THE FOLD LADDER of the bar over the note (docs/PLAN-bars-2026-10.md P1, wireframe FinalToolbar.png, "A 460px pane: what
 * doesn't fit moves into the dots, which only appear then"). The bar is ONE 36px row that never wraps and never clips:
 * as the pane narrows, things leave the row in a fixed order and wait in the ⋯ menu instead.
 *
 *   level 0   everything                                    (the row is as wide as it needs: about 660px and up)
 *   level 1   the inserts and the section moves → ⋯          (Sean, 2026-10-10: the inserts stay SEPARATE buttons "since
 *                                                             there should be room"; they fold only when there is not)
 *   level 2   + list, quote and code → ⋯                     (what is left is Style, B I U S, Aa and the pen: the 460px
 *                                                             pane of the wireframe, which keeps the Style button's word)
 *   level 3   + the Style button becomes its glyph           (110px → 28px: the last thing to give, below about 360px)
 *
 * (The plan's text puts the glyph before the blocks and rounds the thresholds to 700 / 630 / 560 / 460; the wireframe it
 * calls the spec shows the 460px pane with the Style button's word and the blocks already in ⋯, so the order here is the
 * wireframe's and the thresholds are what the widths come to.)
 *
 * A pure function of the width and of which sections are shown: the widths here are the bar's own CSS (bars.css: 28px
 * buttons, 2px between them, 12px of air between groups, 6px of padding; the Style button is 110px, the pen's split
 * button is the button and a 16px caret) and the e2e suite checks them against the real row at every width from 460 up.
 * A section that is put away (Customize toolbar…) is not in the row and not in ⋯, so it takes no width and folds nothing.
 */

export type FoldLevel = 0 | 1 | 2 | 3

/** The sections of the bar, which Customize toolbar… puts away. */
export interface BarSections { text: boolean; blocks: boolean; insert: boolean; pen: boolean }

export const ALL_SECTIONS: BarSections = { text: true, blocks: true, insert: true, pen: true }

export const BAR_SIZES = { pad: 12, gap: 2, button: 28, air: 12, style: 110, caret: 16 } as const

/** One thing in the row, from the left: what it is and how wide. The spacer (`grow`) takes what is left over. */
export interface BarPart { id: string; width: number }

const button = (id: string): BarPart => ({ id, width: BAR_SIZES.button })
const air = (id: string): BarPart => ({ id, width: BAR_SIZES.air })

/** What folds at this level, for the one function that draws the row and the one that measures it. */
export interface BarFold {
  /** The inserts and the section moves are in ⋯. */
  inserts: boolean
  /** List, quote and code are in ⋯. */
  blocks: boolean
  /** The Style button is its glyph. */
  glyph: boolean
}

export const foldAt = (level: FoldLevel): BarFold => ({ inserts: level >= 1, blocks: level >= 2, glyph: level >= 3 })

/** The ⋯ button is there when something shown has folded into it. */
export const hasMore = (level: FoldLevel, sections: BarSections): boolean =>
  (foldAt(level).inserts && sections.insert) || (foldAt(level).blocks && sections.blocks)

/** Every part of the row at a level, in order (the spacer is not one: it has no width of its own). */
export function barParts(level: FoldLevel, sections: BarSections): BarPart[] {
  const fold = foldAt(level)
  const groups: BarPart[][] = []
  if (sections.text) {
    groups.push([{ id: "style", width: fold.glyph ? BAR_SIZES.button : BAR_SIZES.style }])
    groups.push(["bold", "italic", "underline", "strike", "font"].map(button))
  }
  if (sections.blocks && !fold.blocks) groups.push(["list", "quote", "code"].map(button))
  if (sections.insert && !fold.inserts) {
    groups.push(["textbox", "picture", "table", "maths", "shapes"].map(button))
    groups.push(["secup", "secdown"].map(button))
  }
  const parts: BarPart[] = []
  groups.forEach((group, index) => {
    if (index > 0) parts.push(air(`air${index}`))
    parts.push(...group)
  })
  parts.push({ id: "grow", width: 0 })
  if (sections.pen) parts.push({ id: "pen", width: BAR_SIZES.button + BAR_SIZES.caret })
  if (hasMore(level, sections)) parts.push(button("more"))
  return parts
}

/** The width the row needs at a level, padding and the gaps between its parts included. */
export function neededWidth(level: FoldLevel, sections: BarSections): number {
  const parts = barParts(level, sections)
  return BAR_SIZES.pad + parts.reduce((sum, part) => sum + part.width, 0) + BAR_SIZES.gap * Math.max(0, parts.length - 1)
}

/** The least folded level that fits `width` (the row's own width, padding included); the last level when none does. */
export function foldFor(width: number, sections: BarSections = ALL_SECTIONS): FoldLevel {
  for (const level of [0, 1, 2] as const) if (neededWidth(level, sections) <= width) return level
  return 3
}
