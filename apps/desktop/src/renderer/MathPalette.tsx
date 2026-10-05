/**
 * The maths button: the Mac's `MathMenu.swift`, one pane with everything in
 * it. All six groups (Calculus ... Greek) in ONE scrolled grid with a pinned
 * header per group -- not a row of tabs to go hunting through -- then a field
 * for each slot of the shape picked, the Wolfram Language line (editable: the
 * fields drive it until it is edited, and then what is in it is what goes in),
 * a typeset preview, an "On its own line" tick and Insert. What goes into the
 * note is Wolfram Language (`` `wl:...` `` or a ```` ```wl ```` fence); the
 * notebook typesets it (`@writemind/editor`'s `math.ts`).
 *
 * KEYBOARD (port-only; the Mac popover is mouse-first). Ctrl+Shift+M opens it
 * (`wm:math-open`, Insert > Maths...) with the picked shape focused. Arrows
 * pick a shape (Left/Right one, Up/Down a row, PageUp/PageDown a group,
 * Home/End the ends); Tab walks Slots > Wolfram Language > On its own line >
 * Insert and wraps; Enter inserts (as the tick says), Ctrl+Enter the other way;
 * Esc closes and gives the keyboard back to the note. Enter while an input
 * method is composing (Japanese) is the IME's, not Insert.
 *
 * It is one self-contained component so that the bar needs a single line to
 * mount it: `<MathPalette view={view} />`.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react"
import type { EditorView } from "@codemirror/view"
import {
  initialValues, insertMath, MATH_GROUPS, MATH_TEMPLATES, range, templatesIn, templateWL,
  type MathTemplate,
} from "@writemind/core"
import { applyEdit, mathElement } from "@writemind/editor"

/** The event the Insert > Maths... command (Ctrl+Shift+M) sends. */
export const MATH_OPEN_EVENT = "wm:math-open"

/** The preview: the typeset form, or the source as typed while it is not yet an expression. */
function Preview({ source }: { source: string }) {
  const host = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const target = host.current
    if (!target) return
    // The same two-dimensional form the note will show on its own line.
    const typeset = source.trim() === "" ? null : mathElement(source, { display: "block" })
    target.replaceChildren(typeset ?? document.createTextNode(source))
    target.dataset.ok = typeset ? "1" : source.trim() === "" ? "" : "0"
  }, [source])
  return <span className="math-preview" ref={host} />
}

export function MathPalette({ view, showButton = true }: { view: EditorView | null; showButton?: boolean }) {
  const first = MATH_TEMPLATES[0]!
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<MathTemplate>(first)
  const [values, setValues] = useState<string[]>(() => initialValues(first))
  const [wl, setWl] = useState(() => templateWL(first, initialValues(first)))
  const [ownLine, setOwnLine] = useState(true)
  const [at, setAt] = useState({ left: 0, top: 0 })
  const button = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  /** The fields drive the WL until the WL itself is edited -- then that is what gets inserted. */
  const choose = useCallback((template: MathTemplate) => {
    const next = initialValues(template)
    setSelected(template)
    setValues(next)
    setWl(templateWL(template, next))
  }, [])

  const show = useCallback(() => {
    // The Mac's popover starts afresh each time: the first shape, on its own line.
    choose(MATH_TEMPLATES[0]!)
    setOwnLine(true)
    const anchor = button.current ?? document.querySelector<HTMLElement>('[data-group="maths"]')
    const rect = anchor?.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 440)), top: (rect?.bottom ?? 40) + 4 })
    setOpen(true)
  }, [choose])

  // Insert > Maths... (Ctrl+Shift+M): open it, or put it away if it is already up.
  useEffect(() => {
    const toggle = () => (open ? setOpen(false) : show())
    window.addEventListener(MATH_OPEN_EVENT, toggle)
    return () => window.removeEventListener(MATH_OPEN_EVENT, toggle)
  }, [open, show])

  // Clicking anywhere else puts the palette away.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && (pop.current?.contains(event.target) || button.current?.contains(event.target))) return
      setOpen(false)
    }
    window.addEventListener("pointerdown", away, true)
    return () => window.removeEventListener("pointerdown", away, true)
  }, [open])

  /** The picked shape holds the keyboard (a roving tab stop): the arrows work from it. */
  const focusPicked = useCallback(() => {
    pop.current?.querySelector<HTMLElement>('[data-template][tabindex="0"]')?.focus({ preventScroll: true })
  }, [])

  // On opening, the picked shape has the keyboard: the arrows work at once.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(focusPicked)
    return () => cancelAnimationFrame(frame)
  }, [open, focusPicked])

  // A click on a bare part of the palette (its heading, a gap between the groups) must not lose the keyboard
  // to the note behind it -- the page's own focus-return would, and Esc would then close nothing. The popover
  // itself takes the focus on mousedown (`tabIndex={-1}`, so it stays "inside"), and this hands it to the picked shape.
  const onPopClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("input, button, label, textarea, select")) return
    focusPicked()
  }

  const close = (giveBack: boolean) => {
    setOpen(false)
    if (giveBack) viewRef.current?.focus()
  }

  const put = (display: boolean) => {
    const target = viewRef.current
    if (!target || wl.trim() === "") return
    const selection = target.state.selection.main
    applyEdit(target, insertMath(target.state.doc.toString(),
      range(selection.from, selection.to - selection.from), wl.trim(), display))
    setOpen(false)
  }

  /** Arrow keys pick a shape; the grid is one flat list, rows are wherever the layout wraps them. */
  const step = (key: string): MathTemplate | null => {
    const buttons = [...(pop.current?.querySelectorAll<HTMLElement>("[data-template]") ?? [])]
    const index = buttons.findIndex((one) => one.dataset.template === selected.id)
    if (index < 0) return null
    let next = index
    if (key === "ArrowRight") next = Math.min(index + 1, buttons.length - 1)
    else if (key === "ArrowLeft") next = Math.max(index - 1, 0)
    else if (key === "Home") next = 0
    else if (key === "End") next = buttons.length - 1
    else if (key === "PageDown" || key === "PageUp") {
      const here = selected.group
      const groups = MATH_GROUPS
      const gi = groups.indexOf(here)
      const startOf = (g: number) => buttons.findIndex((one) => MATH_TEMPLATES.find((t) => t.id === one.dataset.template)?.group === groups[g])
      if (key === "PageDown") next = gi + 1 < groups.length ? startOf(gi + 1) : index
      else next = index > startOf(gi) ? startOf(gi) : gi > 0 ? startOf(gi - 1) : 0
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      const box = (one: HTMLElement) => one.getBoundingClientRect()
      const here = box(buttons[index]!)
      const wanted = key === "ArrowDown" ? 1 : -1
      // The nearest row in that direction, and in it the shape closest across.
      let rowTop: number | null = null
      for (const one of buttons) {
        const top = box(one).top
        if ((top - here.top) * wanted > 2 && (rowTop === null || Math.abs(top - here.top) < Math.abs(rowTop - here.top))) rowTop = top
      }
      if (rowTop === null) return null
      let best = -1, bestDistance = Infinity
      buttons.forEach((one, i) => {
        const r = box(one)
        if (Math.abs(r.top - rowTop!) > 2) return
        const distance = Math.abs(r.left + r.width / 2 - (here.left + here.width / 2))
        if (distance < bestDistance) { best = i; bestDistance = distance }
      })
      if (best < 0) return null
      next = best
    } else return null
    const picked = MATH_TEMPLATES.find((t) => t.id === buttons[next]!.dataset.template)
    return picked ?? null
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229
    if (composing) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    // The open key, pressed inside the palette (an input does not pass keys to the bar): put it away.
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m") {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      put(event.ctrlKey || event.metaKey ? !ownLine : ownLine)
      return
    }
    const onGlyph = event.target instanceof HTMLElement && event.target.dataset.template !== undefined
    if (onGlyph && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const picked = step(event.key)
      if (picked) {
        event.preventDefault()
        if (picked.id !== selected.id) choose(picked)
        // Focus follows the pick once it has rendered (roving tab stop).
        requestAnimationFrame(() => {
          const one = pop.current?.querySelector<HTMLElement>(`[data-template="${picked.id}"]`)
          one?.focus({ preventScroll: true })
          one?.scrollIntoView({ block: "nearest" })
        })
        return
      }
    }
    if (event.key === "Tab") {
      // Wrap inside the palette: the bar behind it is not where Tab was going.
      const stops = [...(pop.current?.querySelectorAll<HTMLElement>(
        '[data-template][tabindex="0"], input, button[data-insert], button[data-cancel]') ?? [])]
        .filter((one) => !one.hasAttribute("disabled"))
      const here = stops.indexOf(event.target as HTMLElement)
      if (stops.length && here >= 0) {
        const next = event.shiftKey ? (here === 0 ? stops.length - 1 : here - 1)
          : (here === stops.length - 1 ? 0 : here + 1)
        if ((event.shiftKey && here === 0) || (!event.shiftKey && here === stops.length - 1)) {
          event.preventDefault()
          stops[next]!.focus()
        }
      }
    }
  }

  const slots = selected.slots
  const unparsed = wl.trim() !== "" && mathElement(wl, { display: "block" }) === null

  return (
    <>
      {showButton && (
        <button ref={button} className={`icon-button${open ? " on" : ""}`} data-math="button"
                title={"Maths  (Ctrl+Shift+M)\nIntegrals, sums, derivatives — written as Wolfram Language"}
                style={{ width: "auto", padding: "0 6px", fontSize: 12 }}
                onClick={() => (open ? setOpen(false) : show())}>ƒ(x)</button>
      )}
      {open && (
        <div className="math-pop" ref={pop} data-math="pop" role="dialog" aria-label="Maths" tabIndex={-1}
             style={{ left: at.left, top: at.top, maxHeight: `calc(100vh - ${at.top}px - 8px)`, outline: "none" }}
             onKeyDown={onKeyDown} onClick={onPopClick}>
          <div className="math-head">
            <span className="math-heading">Maths</span>
            <span className="math-sub">Wolfram Language</span>
          </div>
          <div className="math-scroll" ref={scroller}>
            {MATH_GROUPS.map((group) => (
              <section key={group} data-group-name={group}>
                <h4 className="math-group">{group}</h4>
                <div className="math-grid">
                  {templatesIn(group).map((template) => (
                    <button key={template.id} title={template.name} data-template={template.id}
                            className={template.id === selected.id ? "on" : ""}
                            aria-pressed={template.id === selected.id}
                            tabIndex={template.id === selected.id ? 0 : -1}
                            data-long={template.glyph.length > 3 ? "1" : undefined}
                            onClick={() => choose(template)}>{template.glyph}</button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {slots.length > 0 && (
            <div className="math-form">
              {slots.map((slot, index) => (
                <label key={index}>
                  <span>{slot.label}</span>
                  <input value={values[index] ?? ""} spellCheck={false} data-slot={index}
                         placeholder={slot.initial}
                         onChange={(event) => {
                           const next = values.map((v, i) => (i === index ? event.target.value : v))
                           setValues(next)
                           setWl(templateWL(selected, next))
                         }} />
                </label>
              ))}
            </div>
          )}
          <div className="math-custom">
            <input placeholder="Wolfram Language" value={wl} spellCheck={false} data-custom="1"
                   onChange={(event) => setWl(event.target.value)} />
          </div>
          <Preview source={wl} />
          {unparsed && <div className="math-note" data-math="unparsed">Not an expression yet: it stays as typed.</div>}
          <div className="math-foot">
            <label className="math-own" title="A ```wl block, set large. Off puts it inline in the sentence.">
              <input type="checkbox" checked={ownLine} data-own="1"
                     onChange={(event) => setOwnLine(event.target.checked)} />
              On its own line
            </label>
            <div className="spacer" />
            <button data-insert="1" className="default" disabled={wl.trim() === ""}
                    onClick={() => put(ownLine)}>Insert</button>
          </div>
          <div className="math-keys">Enter inserts · Ctrl+Enter the other way · Esc closes</div>
        </div>
      )}
    </>
  )
}
