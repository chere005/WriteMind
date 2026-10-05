/**
 * Help ▸ Keyboard Shortcuts (F1): every key the app binds, by menu, read from
 * the one command table (`shared/keyList.ts`, which `docs/KEYS.md` is held
 * to by a test). The Mac keeps the same list in its README (2026-09-21); on a
 * PC a list you can open from Help is where people look for it.
 *
 * Escape, F1 again, Close or a click outside put it away, and the keyboard
 * goes back to the notes.
 */

import { useEffect, useRef } from "react"
import { keyList } from "../shared/keyList"
import { withNumberKeysFirst } from "../shared/keyGroups"
import { returnFocus } from "./focusReturn"
import "./keyList.css"

/** "Ctrl+Shift+Up" → the keys to press, one cap each. */
function Chord({ keys }: { keys: string }) {
  const parts = keys.split("+").map((part, index, all) =>
    // "Ctrl++" would be a plus key; none is bound today, but keep it whole if one ever is.
    part === "" && index === all.length - 1 ? "+" : part).filter((part) => part !== "")
  return (
    <span className="chord">
      {parts.map((part, index) => <kbd key={index}>{part}</kbd>)}
    </span>
  )
}

export function KeyList({ platform, onClose }: { platform: string; onClose(): void }) {
  const sheet = useRef<HTMLDivElement>(null)
  // The ten number keys (the cell kinds) first, as one group; then every other key by its menu.
  const groups = withNumberKeysFirst(keyList(platform), platform)

  useEffect(() => {
    sheet.current?.focus()
    return () => { window.setTimeout(returnFocus, 0) }
  }, [])

  return (
    <div className="modal-backdrop" data-modal="keys" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={sheet} className="modal key-list" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts" tabIndex={-1}
           onKeyDown={(event) => {
             if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() }
           }}>
        <h3>Keyboard Shortcuts</h3>
        <p>Every key WriteMind binds: the number keys that make cells first, then the rest by the menu they are in. A command with no key is in its menu only.</p>
        <div className="key-groups">
          {groups.map((group) => (
            <section key={group.menu} className="key-group" data-menu={group.menu}>
              <h4>{group.menu}</h4>
              <table>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id} data-command={row.id}>
                      <td className="key-name">{row.name}</td>
                      <td className="key-keys"><Chord keys={row.keys} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="buttons">
          <button data-modal="ok" className="default" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
