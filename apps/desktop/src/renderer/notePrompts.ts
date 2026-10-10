/**
 * The two questions a note's menu asks before it acts — Rename… and Move to the Trash — as the dialog's own spec, so a
 * menu that is not the sidebar's (the tab's) asks in the same words and the same way. The sidebar's rows ask them from
 * their own state because the sidebar may not be on screen; the page's handlers they call are the same ones
 * (`renameNoteTo`, `trashNote` in App.tsx), so the answer is the same whichever surface asked.
 */

import { stem, type Note } from "@writemind/core"
import type { PromptSpec } from "./Prompt"

/** Rename…: the file keeps its extension. A string back says why it did not work and the dialog stays up. */
export function renamePrompt(note: Note, rename: (name: string) => void | string | Promise<void | string>): PromptSpec {
  return {
    title: "Rename", message: "The file keeps its extension.", value: stem(note.path), ok: "Rename",
    onSubmit: rename,
  }
}

/** Move to the Trash…: a menu item has no second click to give, so it asks (`bin` is "Trash" or "Recycle Bin"). */
export function trashPrompt(note: Note, bin: string, trash: () => void): PromptSpec {
  return {
    title: `Move “${note.title}” to the ${bin}?`, message: `It goes to the ${bin}, where you can put it back.`,
    ok: `Move to ${bin}`, destructive: true, onSubmit: () => trash(),
  }
}
