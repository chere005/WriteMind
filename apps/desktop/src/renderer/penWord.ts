/**
 * penWord.ts - THE HOOKS for the pen's quiet status line. Nothing else about the pen is ever put on screen: no panel, no toast, no diagnostics.
 *
 *  - `usePenWord()`: the ONE status string for the sheet header ("Pen: tablet, mapped to sheet", "Pen: tablet", "Pen: window pointer", "Pen: none").
 *    It is "" unless a tablet is known: with no Wintab (another brand, no driver) the sheet says nothing.
 *  - `usePenWordNote()`: why Wintab is not the source (a tooltip at most), or null.
 */

import { usePenFeedStore } from "./penFeed"

export const usePenWord = (): string => {
  const status = usePenFeedStore().status
  return status && status.tablet ? status.text : ""
}

export const usePenWordNote = (): string | null => usePenFeedStore().status?.note ?? null
