/**
 * Ctrl+Z while the pen is over (or has focus in) the tablet surface takes back
 * a STROKE ON THE SHEET, not something in the note. `useUndo` asks here first;
 * the surface registers itself while it is mounted. Nothing to take back on
 * the sheet means the key falls through to the note's own undo.
 */

type Handler = (which: "undo" | "redo") => boolean

let handler: Handler | null = null

export const setTabletUndo = (next: Handler | null): void => { handler = next }
export const tabletUndo = (which: "undo" | "redo"): boolean => handler?.(which) ?? false
