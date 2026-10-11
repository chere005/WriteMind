/**
 * WHAT SWITCHES THE PAGE TO THE RENDERED ONE (Sean, 2026-10-10: "switch to rendered mode if bringing in text or switching to
 * pen mode on the notebook"). The page has ONE mode switch for every note (App.tsx `rendered`; the Quick Reference remembers
 * the mode the other notes were in, welcomeView.ts), and two ACTS put it on the rendered side by themselves:
 *
 *   - TEXT IS BROUGHT IN: words the reader read (a picture's Read, the pen's handwriting, the camera's Text, the Wacom sheet's
 *     As Text and Text) are landing in the note, and the person should see them land;
 *   - THE PEN IS PUT DOWN ON THE NOTEBOOK: the ink layer (`.wm-canvas`) belongs to the rendered page, so a pen that is down
 *     on the markdown draws nowhere. That is the pen button, its menu's Pen, the pen's key and menu item (they all end in
 *     App.tsx `penButton`), and "Pen always draws" turned on. NOT the Tablet sheet being the video source: it has its own pen.
 *
 * An ACT switches, a state never does: a person who turns the rendered page off by hand with the pen already down, or after
 * a reading, is not fought for the same act twice. Nothing here is stored, and nothing about it touches the note's text or
 * its undo (the page's own toggle keeps the caret and the cell at the top, `setPreview`). Pure, and test/pageActs.test.ts.
 */

import type { PenButtonState, PenPress } from "./penSettings"

/** Whether this press of the pen button (its click, its menu, its key) PUT THE PEN DOWN: it is down after it, and it was lifted before or the press chose the pen. */
export function putsPenDown(press: PenPress, before: PenButtonState, after: PenButtonState): boolean {
  return after.down && (!before.down || press === "choosePen" || press === "keyPen")
}

/** "Pen always draws" was just turned ON (it was off): the pen's tip draws on the page whatever the mode is. */
export const turnsOnPenDraws = (was: boolean, now: boolean): boolean => !was && now

/** The page has to be switched for an act: there is a note on it, and it is not the rendered page already. */
export const needsRenderedPage = (hasNote: boolean, rendered: boolean): boolean => hasNote && !rendered
