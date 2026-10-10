/**
 * What this window holds that the disk does not know about yet, for File ▸ Clean Up Unused Files…
 * (main/housekeeping.ts): a picture taken out of a note is still in its Undo, a note deleted outside the app can
 * still be open and be saved again. Nothing such a state names is ever offered for the bin.
 */

import { historyField } from "@codemirror/commands"
import type { EditorState } from "@codemirror/state"
import { drawingMediaFiles, mediaFiles, type Drawing } from "@writemind/core"
import { closedHistories, historyOf } from "./noteHistory"
import { namesIn, type Held } from "../shared/housekeeping"

export interface WindowHolding {
  /** The editor in front: its words and its undo history. */
  state: EditorState | null
  /** The words in hand (the same note's, as the app keeps them). */
  text: string
  /** The drawing in front, one on its way into it, and the objects on the window's own clipboard (Canvas.tsx). */
  drawings: (Drawing | null)[]
  /** Every open tab's note. */
  open: string[]
}

/** The words and the whole undo history of an editor state, as one text to look for names in. */
const wordsAndHistory = (state: EditorState): string => {
  try { return JSON.stringify(state.toJSON({ history: historyField })) } catch { return state.doc.toString() }
}

export function heldBy(holding: WindowHolding): Held {
  const names = new Set<string>()
  const texts = [holding.text]
  if (holding.state) texts.push(wordsAndHistory(holding.state))
  const drawings = holding.drawings.filter((one): one is Drawing => one !== null)
  for (const file of holding.open) {
    // Each open note's own history (noteHistory.ts): the editor state of a tab behind another, and the drawing's
    // Undo and Redo.
    const held = historyOf(file)
    if (held.text) texts.push(wordsAndHistory(held.text))
    drawings.push(...held.drawing.snapshots())
  }
  // The notes closed lately keep their undo too (noteHistory.ts): a picture one of those Undos could bring back is held.
  for (const held of closedHistories()) {
    if (held.text) texts.push(wordsAndHistory(held.text))
    drawings.push(...held.drawing.snapshots())
  }
  for (const text of texts) {
    for (const name of mediaFiles(text)) names.add(name)
    for (const name of namesIn(text)) names.add(name)
  }
  for (const drawing of drawings) for (const name of drawingMediaFiles(drawing)) names.add(name)
  return { openNotes: [...holding.open], held: [...names] }
}
