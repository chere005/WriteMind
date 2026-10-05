/**
 * WHOSE KEY IS IT? The drawing layer never has the keyboard — the notebook's
 * editor does — so the layer WATCHES keys (the Mac's `watchKeys` monitor),
 * and every key it takes must be taken COMPLETELY: a key the layer answers
 * and the editor also hears is two edits for one press (Backspace removed
 * the shape AND a letter of the note).
 *
 * This is the whole rule, pure, so it can be tested without a browser:
 *
 *   - Something picked and drawn (handles on it) is answered, in the capture
 *     phase and swallowed, by: the arrows (nudge 1, Shift 10), Backspace /
 *     Delete (on their own), Ctrl/Cmd+C and +X.
 *   - A key that WORKS ON THE WORDS — a letter typed, Enter, Tab, Home / End,
 *     Ctrl+A, a word-wise arrow, an input method — is the notebook's, and it
 *     is also the end of the pick: the person went back to the text, so the
 *     keys (arrows, Backspace) go back to the text with them.
 *   - An open crop box is confirmed by Enter (Esc drops it; that one is the
 *     layer's bubble handler).
 *   - A field of the layer's own (a label, a text box) or any input has
 *     every key.
 *   - Everything else (Ctrl+Z, Ctrl+G, F-keys, a modifier going down on its
 *     own) is no business of this rule.
 */

export interface KeyFacts {
  key: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** AltGr, which Windows reports as Ctrl+Alt: a letter, not a command. */
  altGraph: boolean
  /** An input method is composing (the key says "Process", or the event says so). */
  composing: boolean
  /** The target is an input or a textarea: every key is theirs. */
  inField: boolean
  /**
   * The target is a <select> (the toolbar's palettes keep the focus after a choice): its arrows change the
   * choice, so those are its own -- but Backspace and Delete mean nothing to it, and the picked object's
   * handles are on the screen.
   */
  inSelect: boolean
  /** The target is the notebook (an editable region). */
  inNotebook: boolean
  /** Something is picked, still on the layer and drawn: the handles are up. */
  picked: boolean
  /** A crop box is open on a picture that is still there. */
  cropOpen: boolean
  /** The notebook holds selected WORDS (not just a caret): Ctrl+C / Ctrl+X on those are the words', not the picked objects'. */
  textSelected?: boolean
}

export type KeyVerdict =
  /** The layer answers, and the key goes no further. */
  | { take: "nudge"; dx: number; dy: number }
  | { take: "delete" }
  | { take: "copy" }
  | { take: "cut" }
  | { take: "confirmCrop" }
  /** The key is the notebook's, and the objects are let go of. */
  | { take: "letGo" }
  | null

const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "NumLock", "ScrollLock", "Fn", "Hyper", "Super"])

/** A key that on its own writes in the notebook or moves its caret (modifiers other than the arrows' own are asked of the caller). */
function worksOnWords(f: KeyFacts): boolean {
  if (f.composing || f.key === "Process" || f.key === "Dead") return true
  const command = (f.ctrl || f.meta) && !f.altGraph
  if (f.key.length === 1) {
    // A letter, a digit, a space; Ctrl+A is select-all; Ctrl+V / Ctrl+B ... are not asked here
    // (the paste is heard by its own event, and a style command leaves the objects alone).
    return !command || f.key.toLowerCase() === "a"
  }
  switch (f.key) {
    case "Enter": case "Tab": case "Home": case "End": case "PageUp": case "PageDown":
      return true
    case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown":
    case "Backspace": case "Delete":
      // On their own (or with Shift, for the arrows) the layer has taken them already; what reaches here
      // carries Ctrl / Alt / Meta (a word-wise move or delete), which is the caret's.
      return true
    default:
      return false
  }
}

export function layerKey(f: KeyFacts): KeyVerdict {
  if (f.inField) return null
  if (MODIFIERS.has(f.key)) return null
  if (f.inSelect) {
    return f.picked && !f.cropOpen && !f.ctrl && !f.meta && !f.alt && !f.shift
      && (f.key === "Backspace" || f.key === "Delete") ? { take: "delete" } : null
  }
  if (f.cropOpen) {
    // Enter confirms the crop; nothing else on the layer answers while the box is up (the arrows would
    // nudge a picture that is being cropped).
    return f.key === "Enter" && !f.ctrl && !f.meta && !f.alt && !f.shift ? { take: "confirmCrop" } : null
  }
  if (!f.picked) return null

  const plain = !f.ctrl && !f.meta && !f.alt
  if (plain && f.key.startsWith("Arrow")) {
    const step = f.shift ? 10 : 1
    return {
      take: "nudge",
      dx: f.key === "ArrowLeft" ? -step : f.key === "ArrowRight" ? step : 0,
      dy: f.key === "ArrowUp" ? -step : f.key === "ArrowDown" ? step : 0,
    }
  }
  // ⌫ and ⌦ on their own, as on the Mac (Shift+Backspace in a note is a Backspace the finger was late
  // letting go of Shift for: the notebook's).
  if (plain && !f.shift && (f.key === "Backspace" || f.key === "Delete")) return { take: "delete" }
  const command = (f.ctrl || f.meta) && !f.alt && !f.shift
  const letter = f.key.toLowerCase()
  // Words selected in the note and Ctrl+C / Ctrl+X: the person is copying the words; the pick is let go.
  if (command && (letter === "c" || letter === "x") && f.inNotebook && f.textSelected) return { take: "letGo" }
  if (command && letter === "c") return { take: "copy" }
  if (command && letter === "x") return { take: "cut" }

  // Not the layer's. If it works on the words, the person has gone back to the text.
  return f.inNotebook && worksOnWords(f) ? { take: "letGo" } : null
}
