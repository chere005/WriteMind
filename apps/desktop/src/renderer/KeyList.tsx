/**
 * Help ▸ Keyboard Shortcuts (F1): every key the app binds, by menu, read from
 * the one command table (`shared/keyList.ts`, which `docs/KEYS.md` is held
 * to by a test). The Mac keeps the same list in its README (2026-09-21); on a
 * PC a list you can open from Help is where people look for it.
 *
 * SEARCHABLE (docs/PLAN-bars-2026-10.md, P6; the wireframe's "Search keys…"): the field has the keyboard when the list
 * opens, every word typed must be in a row's name, its menu or its key (`searchKeys`: "save", "cmd shift", "⌥").
 * Escape clears the field first and closes the list on the second press. The keys are drawn as caps in the order the
 * machine writes them — on a Mac ⌃⌥⇧⌘ and then the key (`chordCaps`). The list scrolls with a gutter kept for its bar,
 * so no keycap is ever under it.
 *
 * Close, Escape on an empty field, or a click outside put it away (the `Modal` around it), and the keyboard goes back to the notes.
 */

import { useMemo, useRef, useState } from "react"
import { chordCaps } from "../shared/chord"
import { commandForKey } from "../shared/commands"
import { keyList } from "../shared/keyList"
import { searchKeys, withNumberKeysFirst } from "../shared/keyGroups"
import { Modal } from "./Modal"
import "./keyList.css"

/** "Ctrl+Shift+Up" → the keys to press, one cap each. */
function Chord({ keys, platform }: { keys: string; platform: string }) {
  return (
    <span className="chord">
      {chordCaps(keys, platform).map((cap, index) => <kbd key={index}>{cap}</kbd>)}
    </span>
  )
}

export function KeyList({ platform, onClose }: { platform: string; onClose(): void }) {
  const [query, setQuery] = useState("")
  const field = useRef<HTMLInputElement>(null)
  // The ten number keys (the cell kinds) first, as one group; then every other key by its menu.
  const all = useMemo(() => withNumberKeysFirst(keyList(platform), platform), [platform])
  const groups = useMemo(() => searchKeys(all, query, platform), [all, query, platform])

  return (
    <Modal hook="keys" className="key-list" label="Keyboard Shortcuts" onClose={onClose}
           // The list's own key again puts it away, from the search field too (the page's own key handler leaves a field's
           // keys alone). It is asked of the command table, not hard-coded: F1 on a PC, ⇧⌘/ on a Mac (a press of F1 on a Mac
           // laptop is brightness, and the e2e harness sends a Mac the chord the Mac listens for).
           onKeyDown={(event) => { if (commandForKey(event.nativeEvent, platform)?.id === "keyList") { event.preventDefault(); onClose() } }}
           onEscape={() => { if (query !== "") { setQuery(""); field.current?.focus() } else onClose() }}>
      <div className="key-head">
        <h3>Keyboard Shortcuts</h3>
        <input ref={field} type="search" className="key-search" placeholder="Search keys…" aria-label="Search keys" value={query}
               autoFocus spellCheck={false} data-keys="search" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <p>Every key WriteMind binds: the number keys that make cells first, then the rest by the menu they are in. A command with no key is in its menu only.</p>
      <div className="key-groups" data-keys="groups">
        {groups.map((group) => (
          <section key={group.menu} className="key-group" data-menu={group.menu}>
            <h4>{group.menu}</h4>
            <table>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id} data-command={row.id}>
                    <td className="key-name">{row.name}</td>
                    <td className="key-keys"><Chord keys={row.keys} platform={platform} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {groups.length === 0 && <p className="key-none" data-keys="none" role="status">No key matches “{query.trim()}”.</p>}
      </div>
      <div className="buttons">
        <button data-modal="ok" className="default" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
