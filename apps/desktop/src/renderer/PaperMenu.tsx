/**
 * The Paper menu in the sheet's header: the kind of paper, its spacing and its colour (tabletPaper.ts). One
 * button, one small menu the person opens; a choice applies at once; Esc or a click away closes it.
 */

import { useEffect, useRef, useState } from "react"
import {
  PAPER_COLOURS, PAPER_KINDS, PAPER_SPACINGS, pitchOf, setPaper, usePaper,
} from "./tabletPaper"

export function PaperMenu() {
  const paper = usePaper()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key, true)
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", key, true) }
  }, [open])

  const kind = PAPER_KINDS.find((one) => one.value === paper.kind)?.label ?? "Paper"
  return (
    <span className="paper-menu" ref={root} onPointerDown={(event) => event.stopPropagation()}>
      <button className={`icon-button${open ? " on" : ""}`} data-tablet="paper" aria-haspopup="menu" aria-expanded={open}
              title={`Paper: ${kind}. Dot grid, lines, squares, isometric dots, Cornell notes; spacing; white, cream or dark.`}
              onClick={() => setOpen((was) => !was)}
              style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>{"Paper ▾"}</button>
      {open && (
        <div className="paper-pop" role="menu" data-tablet="paper-menu">
          <div className="group" role="radiogroup" aria-label="Paper">
            {PAPER_KINDS.map((one) => (
              <button key={one.value} role="menuitemradio" aria-checked={paper.kind === one.value} data-paper-kind={one.value}
                      onClick={() => setPaper({ kind: one.value })}>{one.label}</button>
            ))}
          </div>
          <div className="group" role="radiogroup" aria-label="Spacing">
            <div className="group-title">Spacing</div>
            <div className="row">
              {PAPER_SPACINGS.map((one) => (
                <button key={one.value} role="menuitemradio" aria-checked={paper.spacing === one.value} data-paper-spacing={one.value}
                        disabled={pitchOf(paper.kind, one.value) === 0}
                        onClick={() => setPaper({ spacing: one.value })}>{one.label}</button>
              ))}
            </div>
          </div>
          <div className="group" role="radiogroup" aria-label="Paper colour">
            <div className="group-title">Colour</div>
            <div className="row">
              {PAPER_COLOURS.map((one) => (
                <button key={one.value} role="menuitemradio" aria-checked={paper.colour === one.value} data-paper-colour={one.value}
                        onClick={() => setPaper({ colour: one.value })}>
                  <span className="swatch" style={{ background: one.paper }} />{one.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </span>
  )
}
