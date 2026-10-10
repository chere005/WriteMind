/**
 * The small dialogs the sidebar asks with — Rename (a name field and a line about what is renamed) and the
 * confirmation before something goes to the Trash (`SidebarView`'s `.alert` and `.confirmationDialog`). They
 * are the page's own, not the shell's, so a script can answer them and so the caret can be put back.
 *
 * A name field starts with its text selected, and Enter in it says yes. A confirmation starts on CANCEL when what it asks
 * is dangerous (Move to Trash), and Enter acts only on the button that has the keyboard (docs/PLAN-bars-2026-10.md, P6:
 * "Move to Trash defaults to Cancel"): a key held down from the sidebar's Delete cannot answer it. Escape says no, a
 * click outside says no. The shell around all this is `Modal` (Tab trapped, the page behind inert, the keyboard handed back).
 */

import { useEffect, useRef, useState } from "react"
import { Modal } from "./Modal"

export interface PromptSpec {
  title: string
  message?: string
  /** Present: a name field, starting with this text. Absent: a plain confirmation. */
  value?: string
  ok: string
  /** The OK button is the dangerous one (the Trash). */
  destructive?: boolean
  /**
   * What the OK button does. Returning a string (or a promise of one) says it did not work: the dialog stays
   * up with that sentence under the field, and the name can be changed. Nothing returned is success.
   */
  onSubmit(value: string): void | string | Promise<void | string>
}

export function Prompt({ spec, onClose }: { spec: PromptSpec; onClose(): void }) {
  const [value, setValue] = useState(spec.value ?? "")
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const ok = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const needsName = spec.value !== undefined

  useEffect(() => {
    const target = needsName ? field.current : spec.destructive ? cancel.current : ok.current
    target?.focus()
    if (needsName) field.current?.select()
  }, [needsName, spec.destructive])

  const submit = async () => {
    if (busy || (needsName && value.trim() === "")) return
    const result = spec.onSubmit(value.trim())
    if (result === undefined) { onClose(); return }
    setBusy(true)
    let answer: void | string
    try { answer = await result } catch (error) { answer = error instanceof Error ? error.message : String(error) }
    setBusy(false)
    if (typeof answer === "string") {
      setProblem(answer)
      window.setTimeout(() => { field.current?.focus(); field.current?.select() }, 0)
      return
    }
    onClose()
  }

  return (
    <Modal hook="prompt" label={spec.title} onClose={onClose}
           onKeyDown={(event) => {
             // Enter answers from the name field, and from a button it presses itself; never from the dialog at large.
             if (event.key === "Enter" && event.target === field.current) { event.preventDefault(); void submit() }
           }}>
      <h3>{spec.title}</h3>
      {spec.message && <p>{spec.message}</p>}
      {needsName && (
        <input ref={field} type="text" value={value} aria-label="Name" spellCheck={false}
               onChange={(event) => { setValue(event.target.value); setProblem(null) }} />
      )}
      {problem && <p className="problem" role="alert" data-modal="problem">{problem}</p>}
      <div className="buttons">
        <button ref={cancel} data-modal="cancel" onClick={onClose}>Cancel</button>
        <button ref={ok} data-modal="ok" className={spec.destructive ? "destructive" : "default"}
                disabled={busy || (needsName && value.trim() === "")} onClick={() => { void submit() }}>{spec.ok}</button>
      </div>
    </Modal>
  )
}
