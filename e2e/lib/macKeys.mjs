/**
 * The suites were written on Windows, where "Ctrl+9" is a press of Control. On a Mac the same command is a different
 * chord (⌘9; ⌃⌘↑ for Ctrl+Up; Ctrl+Alt+F is ⌥⌘F...), and the app listens for THAT one (`shared/commands.ts` is the one
 * table both read). So on darwin `key()` turns a chord written the Windows way into the Mac's own chord of the same
 * command, from that same table, and leaves every chord the table does not know alone. A script that means the real
 * Control key (Ctrl+D split cell is the Mac's own ⌃D) is a command whose Mac chord IS Control, so it is unchanged.
 */
import { COMMANDS } from "../../apps/desktop/src/shared/commands.ts"

const CTRL = 2, SHIFT = 8, ALT = 1, META = 4

const NAMES = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }

/** "CmdOrCtrl+Alt+Shift+W" -> { key: "w", mods: bits } for the given side. */
function parse(accelerator, mac) {
  const parts = accelerator.split("+")
  const raw = parts.pop()
  let mods = 0
  for (const part of parts) {
    const p = part.toLowerCase()
    if (p === "cmdorctrl" || p === "commandorcontrol") mods |= mac ? META : CTRL
    else if (p === "ctrl" || p === "control") mods |= CTRL
    else if (p === "cmd" || p === "command" || p === "meta") mods |= META
    else if (p === "alt") mods |= ALT
    else if (p === "shift") mods |= SHIFT
  }
  const name = NAMES[raw.toLowerCase()] ?? (raw.length === 1 ? raw.toLowerCase() : raw)
  return { key: name.toLowerCase(), name, mods }
}

const table = new Map()
for (const command of COMMANDS) {
  if (!command.key) continue
  const windows = parse(command.key, false)
  const mac = parse(command.macKey ?? command.key, true)
  table.set(`${windows.key}:${windows.mods}`, mac)
}

/** The standard editing chords every Mac app has on ⌘ where a PC has Ctrl. */
const EDITING = new Set(["a", "c", "v", "x", "z", "y", "f", "g"])

/** The key and modifier bits the Mac sends for a chord a script wrote the Windows way (unchanged when it has no Mac twin). */
export function macChord(k, mods) {
  const found = table.get(`${String(k).toLowerCase()}:${mods & (CTRL | SHIFT | ALT)}`)
  if (found) return { k: found.name, mods: found.mods | (mods & META) }
  if ((mods & CTRL) && !(mods & (ALT | META)) && EDITING.has(String(k).toLowerCase())) return { k, mods: (mods & ~CTRL) | META }
  return { k, mods }
}
