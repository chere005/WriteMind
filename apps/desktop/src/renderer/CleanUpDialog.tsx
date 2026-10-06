/**
 * File ▸ Clean Up Unused Files… (main/housekeeping.ts): the app's own small dialog. It looks first ("Looking…"), then
 * says what it found — "3 unused files (1.2 MB) will go to the Recycle Bin", the files in a list that scrolls — and
 * waits: [Cancel] or [Move to Recycle Bin] (Trash on a Mac). Nothing goes anywhere without that click, and what goes,
 * goes to the bin, where it can be put back. Escape or a click outside is Cancel; Cancel has the focus.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { returnFocus } from "./focusReturn"
import { trashWord } from "./SidebarProject"
import { cleanUpTitle, formatBytes, type Held, type TrashResult, type UnusedFile, type UnusedScan } from "../shared/housekeeping"
import "./cleanUp.css"

interface Props {
  platform: string
  /** What the window holds right now (renderer/cleanUp.ts): asked again just before the bin. */
  held(): Held
  onClose(): void
}

const kindOf = (file: UnusedFile): string =>
  file.kind === "drawing" ? "drawing" : /^ink-/i.test(file.relative.split("/").pop() ?? "") ? "ink cell" : "picture"

const folderName = (folder: string): string => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder

export function CleanUpDialog({ platform, held, onClose }: Props) {
  const [scan, setScan] = useState<UnusedScan | null>(null)
  const [done, setDone] = useState<TrashResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const bin = trashWord(platform)
  const heldNow = useRef(held)
  heldNow.current = held

  useEffect(() => {
    let live = true
    window.wm.findUnused(heldNow.current()).then(
      (found) => { if (live) setScan(found) },
      (error: unknown) => { if (live) setProblem(error instanceof Error ? error.message : String(error)) },
    )
    return () => { live = false; window.setTimeout(returnFocus, 0) }
  }, [])
  useEffect(() => { first.current?.focus() }, [scan, done, problem])

  const close = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
  const move = async () => {
    if (!scan || busy || scan.files.length === 0) return
    setBusy(true)
    try {
      const result = await window.wm.trashUnused(scan.files.map((one) => one.path), heldNow.current())
      // A problem after some files went (the drawings go first): say what went, and where, as well as the problem.
      if (result.problem && result.moved.length === 0) setProblem(result.problem)
      else setDone(result)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
    setBusy(false)
  }

  const several = scan ? new Set(scan.files.map((one) => one.folder)).size > 1 : false
  const later = scan && scan.recent > 0
    ? ` ${scan.recent === 1 ? "One more file" : `${scan.recent} more files`} changed in the last ten minutes and ${scan.recent === 1 ? "is" : "are"} left alone for now.`
    : ""

  let title: string
  let body: ReactNode = null
  let buttons: ReactNode
  const ok = <button ref={first} data-modal="ok" className="default" onClick={onClose}>OK</button>
  if (problem) {
    title = "Clean Up Unused Files"
    body = <p className="problem" role="alert" data-modal="problem">{problem} Nothing was moved.</p>
    buttons = ok
  } else if (done) {
    title = done.moved.length === 0 ? "Nothing was moved" : `${done.moved.length} ${done.moved.length === 1 ? "file" : "files"} moved to the ${bin}`
    body = <><p data-cleanup="done">
      {done.failed.length > 0 ? `${done.failed.length} could not be moved and ${done.failed.length === 1 ? "is" : "are"} where ${done.failed.length === 1 ? "it was" : "they were"}. ` : ""}
      {done.moved.length > 0 ? `You can put ${done.moved.length === 1 ? "it" : "them"} back from the ${bin}.` : ""}
      {done.problem ? <span className="problem" role="alert" data-modal="problem"> Then: {done.problem} The rest were not moved.</span> : null}
    </p>
    {done.problem && done.moved.length > 0 && (
      <ul className="cleanup-list" data-cleanup="moved">
        {done.moved.map((file) => <li key={file} title={file}><span className="cleanup-name">{file}</span></li>)}
      </ul>
    )}</>
    buttons = ok
  } else if (!scan) {
    title = "Clean Up Unused Files"
    body = <p data-cleanup="looking">Looking at every note and drawing in the project…</p>
    buttons = <button ref={first} data-modal="cancel" onClick={onClose}>Cancel</button>
  } else if (scan.files.length === 0) {
    title = "No unused files"
    body = <p data-cleanup="none">Every drawing and picture in this project is in use.{later}</p>
    buttons = ok
  } else {
    title = cleanUpTitle(scan.files.length, scan.bytes, bin)
    body = <>
      <p>Drawings whose note is gone, and pictures no note or drawing uses. You can put them back from the {bin}.{later}</p>
      <ul className="cleanup-list" data-cleanup="list">
        {scan.files.map((one) => (
          <li key={one.path} data-cleanup-file={one.path} title={one.path}>
            <span className="cleanup-name">{several ? `${folderName(one.folder)}/` : ""}{one.relative}</span>
            <span className="cleanup-kind">{kindOf(one)}</span>
            <span className="cleanup-size">{formatBytes(one.size)}</span>
          </li>
        ))}
      </ul>
    </>
    buttons = <>
      <button ref={first} data-modal="cancel" disabled={busy} onClick={close}>Cancel</button>
      <button data-modal="ok" className="destructive" disabled={busy} onClick={() => { void move() }}>Move to {bin}</button>
    </>
  }

  return (
    <div className="modal-backdrop" data-modal="cleanup" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="modal cleanup" role="dialog" aria-modal="true" aria-label={title}
           onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() } }}>
        <h3>{title}</h3>
        {body}
        <div className="buttons">{buttons}</div>
      </div>
    </div>
  )
}
