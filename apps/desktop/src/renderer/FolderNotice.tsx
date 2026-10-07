/**
 * Two things the app says ONCE, in a quiet bar under the note, laid out as the save-problem bar is but in the page's own
 * colours (it is news, not an error), each gone with its ×:
 *
 *  - "Your notes stay in Documents\WriteMindCross, because a Documents\WriteMind folder already exists…" — on the launch
 *    that found both notes folders (main/notesFolderMove.ts decides, and remembers it was said);
 *  - "3 notes were converted to WriteMind's new .wm format. The originals are kept, unchanged, in …" — on the launch (or
 *    when a folder is added to the project) that converted the old .md notes (main/convert.ts; the same words are in the
 *    receipt it leaves in the backup folder).
 *
 * Nothing at all on every other launch.
 */

import { useEffect, useState } from "react"

/** Asked once per page load (the shell answers once per launch; StrictMode mounts twice). */
let asked: Promise<string | null> | null = null
const ask = (): Promise<string | null> =>
  (asked ??= (window.wm.notesFolderNotice?.() ?? Promise.resolve(null)).catch(() => null))
let askedConversion: Promise<string | null> | null = null
const askConversion = (): Promise<string | null> =>
  (askedConversion ??= (window.wm.conversionNotice?.() ?? Promise.resolve(null)).catch(() => null))

export function FolderNotice() {
  const [text, setText] = useState<string | null>(null)
  const [converted, setConverted] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void ask().then((said) => { if (live && said) setText(said) })
    void askConversion().then((said) => { if (live && said) setConverted(said) })
    const stop = window.wm.onConversionNotice?.((said) => { if (live) setConverted(said) })
    return () => { live = false; stop?.() }
  }, [])
  const bar = (said: string, kind: string, close: () => void) => (
    <div className="save-problem" role="status" data-footer={kind}
         style={{ color: "var(--wm-text)", background: "var(--wm-chrome)", borderTop: "1px solid var(--wm-rule)" }}>
      <span className="text">{said}</span>
      <button type="button" aria-label="Dismiss" title="Dismiss" onClick={close}
              style={{ color: "var(--wm-soft)", background: "transparent" }}>×</button>
    </div>
  )
  return (
    <>
      {converted ? bar(converted, "conversion-notice", () => setConverted(null)) : null}
      {text ? bar(text, "folder-notice", () => setText(null)) : null}
    </>
  )
}
