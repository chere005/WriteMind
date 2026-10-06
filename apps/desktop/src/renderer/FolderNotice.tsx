/**
 * "Your notes stay in Documents\WriteMindCross, because a Documents\WriteMind folder already exists…" — said ONCE,
 * on the launch that found both notes folders (main/notesFolderMove.ts decides, and remembers it was said). A quiet
 * bar under the note, laid out as the save-problem bar is but in the page's own colours (it is news, not an error),
 * gone with its ×. Nothing at all on every other launch.
 */

import { useEffect, useState } from "react"

/** Asked once per page load (the shell answers once per launch; StrictMode mounts twice). */
let asked: Promise<string | null> | null = null
const ask = (): Promise<string | null> =>
  (asked ??= (window.wm.notesFolderNotice?.() ?? Promise.resolve(null)).catch(() => null))

export function FolderNotice() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void ask().then((said) => { if (live && said) setText(said) })
    return () => { live = false }
  }, [])
  if (!text) return null
  return (
    <div className="save-problem" role="status" data-footer="folder-notice"
         style={{ color: "var(--wm-text)", background: "var(--wm-chrome)", borderTop: "1px solid var(--wm-rule)" }}>
      <span className="text">{text}</span>
      <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => setText(null)}
              style={{ color: "var(--wm-soft)", background: "transparent" }}>×</button>
    </div>
  )
}
