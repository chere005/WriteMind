/**
 * The update dialogs: the page's own small sheet (the .modal of Rename and Keyboard Shortcuts), not the system's.
 * Main (main/updater.ts) says which one is up; this draws it and sends the answer back.
 *
 * "Updates available" — "WriteMind 0.5.1 is available (you have 0.5.0). Update now?", a "Check on startup" box
 * (userData/update.json through main, the same setting as Help ▸ Check for Updates on Startup), [Later] and
 * [Update now] (the default). Update now: a quiet progress line, then the notes are written and the app restarts
 * into the new version; Later (Cancel during the download) puts that version off until the next launch.
 * Help ▸ Check for Updates… also answers here: "You're up to date (0.5.0)." or "Couldn't check for updates: …".
 * A Mac (how: "download"): the same sheet with [Download] for [Update now] and one line, "Drag the new WriteMind into
 * Applications to replace this one."; Download has main open the release's page and close the sheet.
 *
 * The launch look can bring the sheet up while somebody is typing: it takes the keyboard on itself, not on a
 * button, a key in its first moments is not an answer, and Enter on it never is (only the sheet Help ▸ Check for
 * Updates… brought up takes Enter as Update now).
 */

import { useEffect, useRef, useState } from "react"
import { progressLine, updateDialogText, type UpdateAnswer, type UpdateDialog as Dialog, type UpdateView } from "../shared/update"
import { Modal } from "./Modal"
import "./updateDialog.css"

/** Keys this soon after the sheet appeared were meant for the note, not for it. */
const ARMED_AFTER_MS = 700

export function UpdateDialog() {
  const [view, setView] = useState<UpdateView | null>(null)
  useEffect(() => {
    const api = window.wm.update
    if (!api) return
    let live = true
    void api.view().then((first) => { if (live) setView(first) }, () => {})
    const off = api.onView((next) => setView(next))
    return () => { live = false; off() }
  }, [])
  const dialog = view?.dialog
  if (!view || !dialog) return null
  return <UpdateSheet key={dialog.kind === "available" ? `available ${dialog.version}` : dialog.kind} view={view} dialog={dialog} />
}

function UpdateSheet({ view, dialog }: { view: UpdateView; dialog: Dialog }) {
  const sheet = useRef<HTMLDivElement>(null)
  const shownAt = useRef(Date.now())
  const text = updateDialogText(dialog)
  const offer = dialog.kind === "available"
  const unasked = dialog.kind === "available" && !dialog.asked
  const download = dialog.kind === "available" && dialog.how === "download"
  const { phase } = view.status
  const line = offer ? progressLine(view.status) : null
  const downloading = offer && phase === "downloading"
  const restarting = offer && phase === "ready"
  // The box answers at once on screen; main has the last word (and pushes it back).
  const [startup, setStartup] = useState(view.checkOnStartup)
  useEffect(() => { setStartup(view.checkOnStartup) }, [view.checkOnStartup])

  useEffect(() => {
    sheet.current?.focus()
  }, [])

  const answer = (choice: UpdateAnswer) => { void window.wm.update?.answer(choice) }
  const dismiss = () => {
    if (restarting) return
    answer(offer ? "later" : "close")
  }
  const primary = () => {
    if (!offer) { answer("close"); return }
    if (!downloading && !restarting) answer("now")
  }

  return (
    <Modal hook="update" label={text.title} sheetRef={sheet} dialogData={{ "data-update": dialog.kind }}
           onClose={dismiss}
           // A key in the sheet's first moments was meant for the note, not for it: Escape does nothing yet.
           onEscape={() => { if (Date.now() - shownAt.current >= ARMED_AFTER_MS) dismiss() }}
           onBackdrop={downloading ? null : dismiss}
           onKeyDown={(event) => {
             // Enter only when the sheet itself has the keyboard: a focused button or the box answers for itself.
             if (event.key !== "Enter" || event.target !== sheet.current) return
             // The sheet the launch look brought up by itself wants a deliberate answer (a click, or Tab to a button):
             // an Enter typed for the note must not start an update and a restart.
             event.preventDefault()
             event.stopPropagation()
             if (unasked || Date.now() - shownAt.current < ARMED_AFTER_MS) return
             primary()
           }}>
      <h3>{text.title}</h3>
      <p data-update="message">{text.message}</p>
      {text.detail && <p className="update-detail">{text.detail}</p>}
      {line && (
        <p className={line.problem ? "problem" : "update-progress"} data-update="progress" role={line.problem ? "alert" : "status"}>
          {line.text}
        </p>
      )}
      <div className="update-row">
        {offer ? (
          <label className="update-startup">
            <input type="checkbox" data-update="startup" checked={startup}
                   onChange={(event) => {
                     const on = event.target.checked
                     setStartup(on)
                     void window.wm.update?.setCheckOnStartup(on)
                   }} />
            Check on startup
          </label>
        ) : <span />}
        <div className="buttons">
          {offer && (
            <button data-modal="cancel" data-update="later" disabled={restarting} onClick={dismiss}>
              {downloading ? "Cancel" : "Later"}
            </button>
          )}
          <button data-modal="ok" data-update={offer ? (download ? "download" : "now") : "ok"} className="default"
                  disabled={downloading || restarting} onClick={primary}>
            {offer ? (download ? "Download" : "Update now") : "OK"}
          </button>
        </div>
      </div>
    </Modal>
  )
}
