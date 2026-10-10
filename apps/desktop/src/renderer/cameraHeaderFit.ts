/**
 * How much of the camera's header fits (docs/PLAN-bars-2026-10.md P4: "screenshots ... at 438px and at the 280px
 * minimum"). The pane is 280px at its narrowest and the header is one 36px row that never wraps and never clips, so
 * what does not fit gives way in a fixed order, as a pure function of the pane's width and what the header holds:
 *
 *   1. the zoom's percentage is read out only while there is room (the menu and the tooltip say it always)
 *   2. Writing | Image | Raw lose their words and show their icons (the percentage may come back if it fits then)
 *
 * Nothing else folds: the five tools and the close button are 28px each and fit 280px with the icons.
 */

export const BAR_BTN = 28
const GAP = 2
const PAD = 12
/** The segmented control with its words (Writing | Image | Raw) and with icons only. */
const SEG_WORDS = 142
const SEG_ICONS = 84
/** The zoom's percentage, "62%". */
const READOUT = 34
/** "Back to Side by Side" as a labelled button (only while the notes pane is hidden: the pane is wide then). */
const BACK = 150

export interface HeaderFitInput {
  /** The pane's width. */
  width: number
  /** The zoom is set (its percentage can be read out). */
  zoomed: boolean
  /** The notes pane is hidden, so the header carries the way back. */
  backToNotes: boolean
}

export interface HeaderFit {
  /** Writing | Image | Raw with their words (false: icons). */
  words: boolean
  /** The zoom's percentage beside its icon. */
  readout: boolean
}

/** The header's content width for a choice, in px. */
export function headerWidth(words: boolean, readout: boolean, backToNotes: boolean): number {
  const left = 5 * BAR_BTN + 4 * GAP + (readout ? READOUT : 0) + (backToNotes ? BACK + GAP : 0)
  const right = (words ? SEG_WORDS : SEG_ICONS) + GAP + BAR_BTN
  return PAD + left + right
}

export function headerFit({ width, zoomed, backToNotes }: HeaderFitInput): HeaderFit {
  const fits = (words: boolean, readout: boolean): boolean => headerWidth(words, readout, backToNotes) <= width
  if (fits(true, zoomed)) return { words: true, readout: zoomed }
  if (fits(true, false)) return { words: true, readout: false }
  if (zoomed && fits(false, true)) return { words: false, readout: true }
  return { words: false, readout: false }
}
