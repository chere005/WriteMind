/**
 * The small dialogs the sidebar asks with — Rename (a name field and a line about what is renamed) and the
 * confirmation before something goes to the Trash (`SidebarView`'s `.alert` and `.confirmationDialog`). They
 * are the page's own, not the shell's, so a script can answer them and so the caret can be put back.
 *
 * Enter says yes, Escape says no, a click outside says no; a name field starts with its text selected.
 */

import { useEffect, useRef, useState } from "react"
import { returnFocus } from "./focusReturn"

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
  const needsName = spec.value !== undefined

  useEffect(() => {
    const target = needsName ? field.current : ok.current
    target?.focus()
    if (needsName) field.current?.select()
    return () => { window.setTimeout(returnFocus, 0) }
  }, [needsName])

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
    <div className="modal-backdrop" data-modal="prompt" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={spec.title}
           onKeyDown={(event) => {
             if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() }
             else if (event.key === "Enter" && event.target !== ok.current) { event.preventDefault(); void submit() }
           }}>
        <h3>{spec.title}</h3>
        {spec.message && <p>{spec.message}</p>}
        {needsName && (
          <input ref={field} type="text" value={value} aria-label="Name" spellCheck={false}
                 onChange={(event) => { setValue(event.target.value); setProblem(null) }} />
        )}
        {problem && <p className="problem" role="alert" data-modal="problem">{problem}</p>}
        <div className="buttons">
          <button data-modal="cancel" onClick={onClose}>Cancel</button>
          <button ref={ok} data-modal="ok" className={spec.destructive ? "destructive" : "default"}
                  disabled={busy || (needsName && value.trim() === "")} onClick={() => { void submit() }}>{spec.ok}</button>
        </div>
      </div>
    </div>
  )
}
