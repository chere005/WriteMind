/**
 * The words in hand while they are being typed, WITHOUT a copy of the whole note on every keystroke.
 *
 * The editor's document is a rope (CodeMirror's `Text`); turning it into one string is a pass over the whole note,
 * and the window used to do it for every key to keep `textRef.current` current (a tenth of a keystroke's cost at
 * 500 KB, a quarter at 2 MB) — for a copy that is read by a timer a quarter of a second after the typing stops. So
 * the editor now hands over the document SNAPSHOT (immutable, so later keys do not change it) as a function, and the
 * string is made the first time somebody reads it and kept until the next edit.
 */
export interface TextHolder {
  /** The note's words. Reading makes the string if the last edit left it unmade. */
  current: string
  /** Hold text that is already a string, or the snapshot of an edit as a function that makes it. */
  hold(next: string | (() => string)): void
}

export function lazyText(initial = ""): TextHolder {
  let value: string | (() => string) = initial
  return {
    get current(): string {
      if (typeof value === "function") value = value()
      return value
    },
    set current(next: string) { value = next },
    hold(next) { value = next },
  }
}
