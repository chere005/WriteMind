/**
 * What the video pane SAYS, as pure functions (the wireframes: docs/ui-2026-10/FinalMain.png, FinalTablet.png).
 *
 * The pane used to say everything in one grey sentence at the bottom: the standing hint, the result of the last
 * action and the errors, run together. Now there are three things and each has a place:
 *
 *   the STATUS LINE (the footer's left)  one short standing sentence about the pane as it is now:
 *                                        "Page found · drag a box for a part", "Pen writing · hold button 1 to erase"
 *   the FACT        (the footer's right) one thing that is true and useful: the picture's size, "mouse: box a part"
 *   the TOAST       (under the header)   what an action just did: "✓ Writing added to Demo note", or why it could not,
 *                                        in words, never a file path; the pane clears it by a timer
 */

/** What the pane knows when it words the camera's status line. */
export interface CameraLineInput {
  /** The kept page that is open (its name), or null on the live camera. */
  page: string | null
  straighten: boolean
  holding: boolean
  /** A picture is there to work on. */
  pictured: boolean
  /** The last look for a page in this picture: found it, did not, or has not looked. */
  found: boolean | null
  /** The platform can find the page by itself (capabilities.findsThePage); false means "drag a box over the writing". */
  findsThePage: boolean
}

const PART = "drag a box for a part"

export function cameraLine(input: CameraLineInput): string {
  const { page, straighten, holding, pictured, found, findsThePage } = input
  if (!pictured) return page ? `${page} · the picture is not there` : "No picture yet"
  if (straighten) return `${page ? `${page} · ` : ""}drag the four corners onto the page's corners`
  if (page) return `${page} · ${PART}, or take all of it`
  const lead = holding ? "Held still" : found === true ? "Page found" : findsThePage ? "Point it at a page" : "Drag a box over the writing"
  return holding || findsThePage || found === true ? `${lead} · ${PART}` : lead
}

/** The picture's size as the footer's fact ("1280×720"), or "" with no picture. */
export function pictureFact(size: { width: number; height: number } | null): string {
  return size && size.width > 0 && size.height > 0 ? `${Math.round(size.width)}×${Math.round(size.height)}` : ""
}

/** What the pane knows when it words the tablet's status line. */
export interface SheetLineInput {
  /** The sheet's own tools (penSettings `sheetTools`). */
  eraser: boolean
  select: boolean
  /** The pen button that rubs out when held ("first" or "second"), or null when none does. */
  rubButton: "first" | "second" | null
  /** The shown key for the pen's Erase Tool ("Cmd+Alt+2"), "" when it has none on this machine. */
  eraseKey: string
  /** A sheet bound to a drawing cell: the cell's note (its title), and whether that note is away (not open). */
  bound: { title: string; away: boolean } | null
  /** A one-off remark from the cell binding (cellSheets.ts `notice`). */
  notice: string | null
}

export function sheetLine(input: SheetLineInput): string {
  const { eraser, select, rubButton, eraseKey, bound, notice } = input
  const erasing = eraser ? `Erasing: touch a stroke${eraseKey ? ` (Erase Tool, ${eraseKey}, with the pen over the sheet turns it off)` : " (Select turns it off)"}` : ""
  const lead = notice ? `${notice} · ` : ""
  if (bound) {
    const cell = bound.away
      ? `Drawing cell of “${bound.title}” · that note is not open: what you write goes into the cell when it is`
      : `Drawing cell of “${bound.title}” · what you write is written into the note (Undo is the note's)`
    return erasing ? `${cell} · ${erasing}` : cell
  }
  if (eraser) return lead + erasing
  if (select) return `${lead}Selecting · the pen or the mouse boxes a part`
  const number = rubButton === "first" ? 1 : rubButton === "second" ? 2 : null
  return `${lead}Pen writing${number ? ` · hold button ${number} to erase` : ""}`
}

/** The footer's fact on the sheet. */
export const SHEET_FACT = "mouse: box a part"

export type ToastKind = "ok" | "error" | "busy" | "info"
export interface Toast { kind: ToastKind; text: string }

/**
 * Words with a path in them are not for the person ("could not read /Users/x/Application Support/…/cam.jpg"): a path
 * (a Windows drive or UNC, or slash-separated parts ending in a file name, spaces allowed in the parts, or three or more
 * parts) becomes "that file". A slash in ordinary words ("Writing / Image", "3/4") stays.
 */
export function plain(text: string): string {
  return text
    .replace(/(?:[A-Za-z]:|\\\\[^\\/\s]+)(?:[\\/][^\\/\n"]+)+?\.[A-Za-z0-9]{1,5}(?=[\s.,;:)"'\u201D]|$)/g, "that file")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\n"]+)+?\.[A-Za-z0-9]{1,5}(?=[\s.,;:)"'\u201D]|$)/g, "that file")
    .replace(/(?:\/[\w.@%+~-]+){3,}\/?/g, "that file")
}

/**
 * A camera's name for the live tab ("FaceTime HD Camera"): the label the browser gives, without a trailing vendor id
 * "(046d:0825)", and "" when the label is a path (a capture device that is a file, a virtual device) and not a name.
 */
export function deviceName(label: string): string {
  const name = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim()
  return /[\\/]/.test(name) ? "" : name
}

/** The first letter up, the closing full stop off, and no path (a toast is one short line). */
export function toastText(text: string): string {
  const one = plain(text).replace(/\s+/g, " ").trim().replace(/[.]+$/, "")
  return one.length === 0 ? one : one[0]!.toUpperCase() + one.slice(1)
}

/** What a capture is called in its toast. */
const WHAT = { ink: "Writing", page: "Image", raw: "Raw picture", cell: "Drawing cell", text: "Text" } as const
export type Took = keyof typeof WHAT

/**
 * "✓ Writing added to Demo note" (+ " · Read a flow chart: 3 nodes" when the reader found one). `note` is the note's
 * title; without one the toast just says it was added.
 */
export function capturedToast(took: Took, note: string | null, extras: (string | null | undefined)[] = []): Toast {
  const where = note && note.trim() !== "" ? ` to ${note.trim()}` : ""
  const more = extras.filter((one): one is string => !!one && one.trim() !== "").map((one) => toastText(one))
  return { kind: "ok", text: [`✓ ${WHAT[took]} added${where}`, ...more].join(" · ") }
}

/** A result that is not an error and not an addition ("Found the page", "Kept the page"): one tick and the words. */
export const doneToast = (text: string): Toast => ({ kind: "ok", text: `✓ ${toastText(text)}` })
export const errorToast = (text: string): Toast => ({ kind: "error", text: toastText(text) })
/** A result that is neither a success nor a failure ("No page found: drag the corners onto it"). */
export const infoToast = (text: string): Toast => ({ kind: "info", text: toastText(text) })
export const busyToast = (text: string): Toast => ({ kind: "busy", text: toastText(text).replace(/\.+$/, "") + "…" })

/** How long a toast stays: an error a little longer than a result; a busy one until it is replaced (with a ceiling). */
export const toastMs = (kind: ToastKind): number => (kind === "error" ? 6000 : kind === "busy" ? 30000 : 4500)
