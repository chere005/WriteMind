/**
 * A chord as the keys to press, one cap each, in the order the machine's own keyboard writes them.
 *
 * `shown()` (commands.ts) gives the chord as words ("Shift+Cmd+G", "Ctrl+Alt+Cmd+Up"), which is what the
 * tooltips and the generated lists print and what the tests hold to the key table. The key list is the one place a
 * chord is DRAWN as caps, and a Mac draws them in Apple's order and with Apple's symbols (docs/PLAN-bars-2026-10.md,
 * P6: "prints modifiers in Apple's order (⌃⌥⇧⌘)"): ⌃ ⌥ ⇧ ⌘ and then the key, so "Shift+Cmd+G" is ⇧ ⌘ G and "Alt+Cmd+F"
 * is ⌥ ⌘ F. A PC writes its words, Ctrl then Alt then Shift then the key. Pure: no platform but the name it is given.
 */

/** Apple's order (⌃⌥⇧⌘), which is also the order a PC writes the same four. */
const ORDER = ["Ctrl", "Alt", "Shift", "Cmd"] as const

const APPLE_SYMBOL: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" }

/** The named keys a Mac draws as symbols; every other key is drawn as it is. */
const APPLE_KEY: Record<string, string> = {
  Up: "↑", Down: "↓", Left: "←", Right: "→", Enter: "↩", Return: "↩", Backspace: "⌫", Delete: "⌦", Tab: "⇥", Escape: "⎋", Esc: "⎋",
}

/** "Ctrl+Shift+Up" → ["Ctrl", "Shift", "Up"]; a trailing "+" is the plus key. */
export function chordParts(chord: string): { modifiers: string[]; key: string } {
  const parts = chord.split("+")
  let key = parts.pop() ?? ""
  // "Ctrl++": the split leaves an empty last part and an empty one before it.
  if (key === "" && parts.length > 0 && parts[parts.length - 1] === "") { parts.pop(); key = "+" }
  const modifiers = parts.filter((part) => part !== "")
  return { modifiers, key }
}

/** The caps of a chord for this platform: ["⌃", "⌘", "↑"] on a Mac, ["Ctrl", "Shift", "Up"] elsewhere. */
export function chordCaps(chord: string, platform: string): string[] {
  const { modifiers, key } = chordParts(chord)
  const mac = platform === "darwin"
  const known = ORDER.filter((name) => modifiers.includes(name))
  const others = modifiers.filter((name) => !(ORDER as readonly string[]).includes(name))
  const caps = [...known, ...others].map((name) => (mac ? APPLE_SYMBOL[name] ?? name : name))
  caps.push(mac ? APPLE_KEY[key] ?? key : key)
  return caps
}

/**
 * The command key of this machine and one more key, as `shown()` words it: "Cmd+X" on a Mac, "Ctrl+X" elsewhere. For the keys
 * the table does not carry because the shell's own menu does them (Cut, Copy, Paste, Select All), so that no label in the
 * page types "Ctrl" by hand — on a Mac that is a key that does nothing.
 */
export const modChord = (platform: string, key: string): string => `${platform === "darwin" ? "Cmd" : "Ctrl"}+${key}`
