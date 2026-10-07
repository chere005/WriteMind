/**
 * Help ▸ About WriteMind: ONE dialog on every platform (Sean, 2026-10-07: "give attribution in the about page ... as
 * well as attribution to all libraries i'm using" and "make it clear i'm using Wolfram as a user"). Port-only; the
 * Mac's About was Apple's panel, and the menu's About item (menu.ts, "about") now opens this.
 *
 * It is the page's own sheet, shaped as Language Setup is: the shared .modal, the keyboard goes to it when it opens
 * and back to the notes when it closes, Escape or a click outside is Done, Tab stays inside it. It shows the app (its
 * icon, name and version), WriteMind's own licence line, the Wolfram statement, and a scrolling list of every library
 * that ships, each expandable to its full licence text. All of it comes from `window.wm.about.info()`
 * (main/about.ts reading out/notices.json), so the page holds no list of its own. The one button besides Done opens
 * the project page in the browser, which main does: the page names no URL.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { NOTICES_MISSING, type AboutInfo, type AboutLibrary } from "../shared/about"
import { returnFocus } from "./focusReturn"
import "./about.css"

/** The keyboard's tab stops inside the sheet, in order. */
const STOPS = "button:not(:disabled), summary"

function Library({ library }: { library: AboutLibrary }) {
  return (
    <details className="about-library" data-library={library.name}>
      <summary>
        <span className="about-library-name">{library.name}</span>
        <span className="about-library-version">{library.version}</span>
        <span className="about-library-license">{library.license}</span>
        <span className="about-library-copyright">{library.copyright}</span>
      </summary>
      <div className="about-library-body">
        <div className="about-library-url">{library.url}</div>
        {library.note && <div className="about-library-note">{library.note}</div>}
        <pre data-license-text>{library.text}</pre>
      </div>
    </details>
  )
}

export function AboutDialog({ platform, onClose }: { platform: string; onClose(): void }) {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const done = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    void window.wm.about?.info().then((got) => { if (live) setInfo(got) }, () => undefined)
    done.current?.focus()
    return () => { live = false; window.setTimeout(returnFocus, 0) }
  }, [])

  /** Escape closes; Tab goes round inside the sheet and never out to the page behind it. */
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== "Tab") return
    const stops = [...(sheet.current?.querySelectorAll<HTMLElement>(STOPS) ?? [])]
    if (stops.length === 0) return
    const first = stops[0]!
    const last = stops[stops.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !sheet.current?.contains(active))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="modal-backdrop" data-modal="about" data-platform={platform}
         onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={sheet} className="modal about" role="dialog" aria-modal="true" aria-label="About WriteMind" onKeyDown={keys}>
        <div className="about-head">
          <img className="about-icon" src="./icon.png" alt="" width={56} height={56} draggable={false} />
          <div>
            <h3 data-about="name">{info?.name ?? "WriteMind"}</h3>
            <div className="about-version" data-about="version">{info ? `Version ${info.version}` : ""}</div>
          </div>
        </div>
        {info && (
          <>
            <p className="about-license" data-about="license">
              {info.copyright}. Released under the BSD 3-Clause licence.
            </p>
            {info.licenseText && (
              <details className="about-own" data-library="WriteMind">
                <summary>WriteMind's licence</summary>
                <pre data-license-text>{info.licenseText}</pre>
              </details>
            )}
            {info.wolfram.short && (
              <section className="about-wolfram" data-about="wolfram">
                <h4>Wolfram</h4>
                <p>{info.wolfram.short}</p>
              </section>
            )}
            <section className="about-libraries">
              <h4>Libraries{info.libraries.length > 0 ? ` (${info.libraries.length})` : ""}</h4>
              {info.missing
                ? <p data-about="missing">{NOTICES_MISSING}</p>
                : (
                  <div className="about-list" data-about="libraries" tabIndex={-1}>
                    {info.libraries.map((library) => <Library key={library.name} library={library} />)}
                  </div>
                )}
            </section>
          </>
        )}
        <div className="buttons">
          <button type="button" data-about-action="project" onClick={() => { void window.wm.about?.openProject() }}>Project Page</button>
          <button ref={done} type="button" data-modal="ok" className="default" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
