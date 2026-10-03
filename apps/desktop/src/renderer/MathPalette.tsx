/**
 * The maths button: a popover of the templates (`MATH_GROUPS`), a field for
 * each slot of the one picked, a live typeset preview, and Insert — inline in
 * a line of prose, or as a block on its own line. What goes into the note is
 * Wolfram Language (`` `wl:…` `` or a ```` ```wl ```` fence); the notebook
 * typesets it (`mathView.ts`).
 *
 * It is one self-contained component so that the bar needs a single line to
 * mount it: `<MathPalette view={view} />`.
 */

import { useEffect, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import {
  initialValues, insertMath, MATH_GROUPS, range, templatesIn, templateWL, typesetInline,
  type MathGroup, type MathTemplate,
} from "@writemind/core"
import { applyEdit } from "@writemind/editor"
import { runsElement } from "./mathView"

/** The preview: the typeset form, or the source as typed while it is not yet an expression. */
function Preview({ source }: { source: string }) {
  const host = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const target = host.current
    if (!target) return
    const runs = typesetInline(source, 18)
    target.replaceChildren(runs ? runsElement(runs) : document.createTextNode(source))
    target.dataset.ok = runs ? "1" : "0"
  }, [source])
  return <span className="math-preview" ref={host} />
}

export function MathPalette({ view }: { view: EditorView | null }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState<MathGroup>("Calculus")
  const [picked, setPicked] = useState<MathTemplate | null>(null)
  const [values, setValues] = useState<string[]>([])
  const [custom, setCustom] = useState("")
  const [at, setAt] = useState({ left: 0, top: 0 })
  const button = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)

  // Clicking anywhere else puts the palette away.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && (pop.current?.contains(event.target) || button.current?.contains(event.target))) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", escape)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", escape)
    }
  }, [open])

  const put = (wl: string, display: boolean) => {
    if (!view || wl.trim() === "") return
    const selection = view.state.selection.main
    applyEdit(view, insertMath(view.state.doc.toString(),
      range(selection.from, selection.to - selection.from), wl.trim(), display))
    setOpen(false)
    setPicked(null)
  }

  const choose = (template: MathTemplate) => {
    if (template.slots.length === 0) { put(templateWL(template, []), false); return }
    setPicked(template)
    setValues(initialValues(template))
  }

  const wl = picked ? templateWL(picked, values) : custom

  return (
    <>
      <button ref={button} className={`icon-button${open ? " on" : ""}`} data-math="button"
              title="Maths: put an equation in the note"
              onClick={() => {
                const rect = button.current!.getBoundingClientRect()
                setAt({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 360)), top: rect.bottom + 4 })
                setOpen((was) => !was)
              }}>∑</button>
      {open && (
        <div className="math-pop" ref={pop} style={{ left: at.left, top: at.top }}>
          <div className="math-tabs">
            {MATH_GROUPS.map((one) => (
              <button key={one} className={one === group && !picked ? "on" : ""}
                      onClick={() => { setGroup(one); setPicked(null) }}>{one}</button>
            ))}
          </div>
          {!picked ? (
            <div className="math-grid">
              {templatesIn(group).map((template) => (
                <button key={template.id} title={template.name} data-template={template.id}
                        onClick={() => choose(template)}>{template.glyph}</button>
              ))}
            </div>
          ) : (
            <div className="math-form">
              <div className="math-title">{picked.name}</div>
              {picked.slots.map((slot, index) => (
                <label key={index}>
                  <span>{slot.label}</span>
                  <input value={values[index] ?? ""} spellCheck={false} data-slot={index}
                         onChange={(event) => setValues((was) => was.map((v, i) => (i === index ? event.target.value : v)))}
                         onKeyDown={(event) => { if (event.key === "Enter") put(wl, false) }} />
                </label>
              ))}
            </div>
          )}
          <div className="math-custom">
            <input placeholder="or type Wolfram Language, e.g. Sqrt[x^2 + 1]" value={picked ? wl : custom}
                   spellCheck={false} data-custom="1"
                   onChange={(event) => { setPicked(null); setCustom(event.target.value) }}
                   onKeyDown={(event) => { if (event.key === "Enter") put(wl, false) }} />
          </div>
          <div className="math-foot">
            <Preview source={wl} />
            <div className="spacer" />
            <button data-insert="inline" onClick={() => put(wl, false)}>Insert inline</button>
            <button data-insert="block" onClick={() => put(wl, true)}>As a block</button>
          </div>
        </div>
      )}
    </>
  )
}
