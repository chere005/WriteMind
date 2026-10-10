/**
 * THE INSPECTOR over a picked object (Sean's wireframe, 2026-10-10): its name, colour, width, fill, words (Aa), order,
 * dock, copy and delete in ONE bar, in place of the six glyph discs and the old style bar. What it holds and where it
 * stands are `inspectorRules.ts`; this draws it and says what is wanted changed. It knows nothing of the drawing: the canvas
 * does the editing (and the undo).
 *
 * A press on the bar is the bar's, never the page's, and it never takes the keyboard from the note: pointerdown is
 * cancelled (the caret stays where it was; a text box being typed in keeps its field). Every control that CHANGES
 * something acts on a click — a press and a lift on the same button — so a press that wanders off the button and lets
 * go elsewhere does nothing: the delete above all (Sean: "Delete fires on click (pointer-up inside the button), reads
 * red"). The one exception is the dock button, which is a drag by nature.
 *
 * Its popovers (colour, width, fill, order) are portalled to the page, so the pane's edge never clips them; Escape and
 * a press anywhere else close them, and Escape closes ONLY them.
 */

import "./inspector.css"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  nearestWidth, PRESET_COLOURS, WIDTH_LADDER,
  type CanvasItem, type ConnectorHead, type ConnectorLine, type Order, type Size, type StylePatch,
} from "@writemind/core"
import { Icon, type IconName } from "./icons"
import type { Control, InspectorPlan } from "./inspectorRules"

interface Props {
  plan: InspectorPlan
  items: CanvasItem[]
  left: number
  top: number
  /** Which popover is open (its control), if any. */
  pop: Control | null
  onPop(next: Control | null): void
  grouping: "group" | "ungroup" | "nothing"
  onPatch(patch: StylePatch): void
  onOrder(how: Order): void
  onDuplicate(): void
  onDelete(): void
  onGroup(): void
  onLabel(): void
  onCrop(): void
  onRead(): void
  /** The dock button is pressed: a drag that ends in the note (Canvas starts the gesture). */
  onDockPress(event: React.PointerEvent): void
  /** The bar's measured size, so the canvas can stand it where it fits. */
  onMeasure(size: Size): void
}

const colourOf = (item: CanvasItem): string | null => {
  switch (item.kind) {
    case "stroke": return item.stroke.colorHex
    case "shape": return item.shape.colorHex
    case "connector": return item.connector.colorHex
    case "image": case "cell": return null
  }
}

const lineWidthOf = (item: CanvasItem): number | null => {
  switch (item.kind) {
    case "stroke": return item.stroke.width
    case "shape": return item.shape.lineWidth
    case "connector": return item.connector.lineWidth
    case "image": case "cell": return null
  }
}

/** Some browsers only take six-digit colours in a colour input. */
const sixDigits = (hex: string | null | undefined, fallback: string): string =>
  hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback

const same = (a: string | null | undefined, b: string): boolean => !!a && a.toLowerCase() === b.toLowerCase()

/** Cancel the press: the page under the bar must not hear it, and the note keeps the keyboard. */
const hold = (event: React.PointerEvent) => { event.preventDefault(); event.stopPropagation() }

const ORDER_LABELS: Record<Order, string> = {
  front: "Bring to Front", forward: "Bring Forward", backward: "Send Backward", back: "Send to Back",
}

export function Inspector(props: Props) {
  const { plan, items, left, top, pop, onPop, grouping, onPatch, onOrder } = props
  const bar = useRef<HTMLDivElement>(null)
  const only = items.length === 1 ? items[0]! : null
  const colour = only ? colourOf(only) : null
  const width = only ? lineWidthOf(only) : null
  const fill = only?.kind === "shape" ? only.shape.fillHex : null
  const connector = only?.kind === "connector" ? only.connector : null
  /** An arrow just drawn: the heads row alone, with no name over it. */
  const compact = plan.groups.length === 1 && plan.groups[0]![0] === "heads"

  // The bar's size, once it is up and whenever what it holds changes: the canvas places it from that.
  const measured = useRef<string>("")
  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    const key = `${size.width}x${size.height}`
    if (key !== measured.current) { measured.current = key; props.onMeasure(size) }
  })

  const button = (control: Control, icon: IconName | null, title: string, children?: ReactNode, extra: React.ButtonHTMLAttributes<HTMLButtonElement> = {}) => (
    <button key={control} type="button"
            className={`wm-insp-btn${pop === control ? " on" : ""}${control === "delete" ? " danger" : ""}`}
            data-insp={control} title={title} aria-label={title}
            aria-haspopup={popular(control) ? "menu" : undefined} aria-expanded={popular(control) ? pop === control : undefined}
            {...extra}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )

  const toggle = (control: Control) => () => onPop(pop === control ? null : control)

  const head = (which: "startHead" | "endHead", value: ConnectorHead, icon: IconName, title: string) => (
    <button type="button" key={`${which}:${value}`} className={`wm-insp-btn${connector?.[which] === value ? " on" : ""}`}
            data-style={`${which}:${value}`} title={title} aria-label={title} aria-pressed={connector?.[which] === value}
            onClick={() => onPatch({ [which]: value })}><Icon name={icon} /></button>
  )
  const line = (value: ConnectorLine, icon: IconName, title: string) => (
    <button type="button" key={`line:${value}`} className={`wm-insp-btn${connector?.line === value ? " on" : ""}`}
            data-style={`line:${value}`} title={`${title} line`} aria-label={`${title} line`} aria-pressed={connector?.line === value}
            onClick={() => onPatch({ line: value })}><Icon name={icon} /></button>
  )

  const render = (control: Control): ReactNode => {
    switch (control) {
      case "colour":
        return button("colour", null, "Colour", <span className="wm-insp-dot" style={{ background: colour ?? "transparent" }} />,
          { onClick: toggle("colour") })
      case "width":
        return button("width", null, "Line width", (
          <><span className="wm-insp-value" data-style="width">{Math.round((width ?? 0) * 10) / 10}</span><Icon name="chev" size={10} className="chev" /></>
        ), { onClick: toggle("width") })
      case "fill":
        return button("fill", null, "Fill", (
          <><span className={`wm-insp-well${fill ? "" : " none"}`} style={fill ? { background: fill } : undefined} /><Icon name="chev" size={10} className="chev" /></>
        ), { onClick: toggle("fill") })
      case "label":
        return button("label", null, only?.kind === "shape" && only.shape.kind === "text" ? "Edit the words" : "Label", <span className="wm-insp-aa">Aa</span>,
          { onClick: props.onLabel })
      case "read":
        return button("read", null, "Read the words out of this picture", <span className="wm-insp-aa">Aa</span>, { onClick: props.onRead })
      case "crop":
        return button("crop", "crop", "Crop this picture", null, { onClick: props.onCrop })
      case "order":
        return button("order", "layers", "Order", <Icon name="chev" size={10} className="chev" />, { onClick: toggle("order") })
      case "dock":
        return button("dock", "dockin", "Dock into the note (click: at the cursor; drag: where you let go)", null,
          { onPointerDown: props.onDockPress })
      case "duplicate":
        return button("duplicate", "copy", "Make a copy beside it (Ctrl+C then Ctrl+V does too)", null, { onClick: props.onDuplicate })
      case "delete":
        return button("delete", "trash", "Delete", null, { onClick: props.onDelete })
      case "group":
        return (
          <button type="button" key="group" className="wm-insp-btn wm-insp-pill" data-insp="group" data-group={grouping}
                  title={grouping === "ungroup" ? "Ungroup these (⌃G does too)" : "Group these (⌃G does too)"}
                  onClick={props.onGroup}>{grouping === "ungroup" ? "Ungroup" : "Group"}</button>
        )
      case "heads":
        return (
          <span className="wm-insp-heads" key="heads" data-row="heads">
            {head("startHead", "none", "headnoneL", "No head at the start")}
            {head("startHead", "arrow", "headL", "A head at the start")}
            <span className="wm-insp-gap" />
            {line("solid", "lnsolid", "Solid")}
            {line("dashed", "lndashed", "Dashed")}
            {line("dotted", "lndotted", "Dotted")}
            <span className="wm-insp-gap" />
            {head("endHead", "arrow", "headR", "A head at the end")}
            {head("endHead", "none", "headnoneR", "No head at the end")}
          </span>
        )
    }
  }

  return (
    <>
      <div ref={bar} className="wm-insp" data-bar="inspector" data-compact={compact ? "1" : undefined}
           style={{ left, top }} onPointerDown={hold} onContextMenu={(event) => event.preventDefault()}>
        {!compact && plan.groups.length > 0 && <span className="wm-insp-name" data-insp="name">{plan.name}</span>}
        {plan.groups.map((group, index) => (
          <span className="wm-insp-group" key={index}>
            {(index > 0 || !compact) && <span className="wm-insp-rule" />}
            {group.map(render)}
          </span>
        ))}
      </div>
      {pop && bar.current && (
        <Popover for={bar.current.querySelector<HTMLElement>(`[data-insp="${pop}"]`)} onClose={() => onPop(null)} control={pop}>
          {pop === "colour" && (
            <Swatches current={colour} presets={PRESET_COLOURS} data="colour" onPick={(hex) => { if (hex !== null) onPatch({ colorHex: hex }); onPop(null) }}
                      onCustom={(hex) => onPatch({ colorHex: hex })} title="Another colour" />
          )}
          {pop === "fill" && (
            <Swatches current={fill} presets={["#FFFFFF", ...PRESET_COLOURS.slice(0, 5)]} data="fill" none
                      onPick={(hex) => { onPatch({ fillHex: hex }); onPop(null) }}
                      onCustom={(hex) => onPatch({ fillHex: hex })} title="Another fill" />
          )}
          {pop === "width" && (
            <div className="wm-insp-widths" role="menu">
              {WIDTH_LADDER.map((rung) => (
                <button type="button" key={rung} role="menuitemradio" aria-checked={nearestWidth(width ?? 0) === rung}
                        className={nearestWidth(width ?? 0) === rung ? "on" : ""} data-width={rung}
                        onClick={() => { onPatch({ lineWidth: rung }); onPop(null) }}>
                  <span className="wm-insp-rung" style={{ height: Math.max(1, rung) }} />
                  <span className="wm-insp-rungn">{rung}</span>
                </button>
              ))}
            </div>
          )}
          {pop === "order" && (
            <div className="wm-insp-orders" role="menu">
              {(["front", "forward", "backward", "back"] as Order[]).map((how) => (
                <button type="button" key={how} role="menuitem" data-style={how}
                        onClick={() => { onOrder(how); onPop(null) }}>{ORDER_LABELS[how]}</button>
              ))}
            </div>
          )}
        </Popover>
      )}
    </>
  )
}

const popular = (control: Control): boolean => control === "colour" || control === "width" || control === "fill" || control === "order"

function Swatches({ current, presets, data, none, onPick, onCustom, title }: {
  current: string | null; presets: string[]; data: "colour" | "fill"; none?: boolean
  onPick(hex: string | null): void; onCustom(hex: string): void; title: string
}) {
  return (
    <div className="wm-insp-swatches">
      {none && (
        <button type="button" className={`wm-swatch none${current === null ? " on" : ""}`} data-colour="none" title="No fill" aria-label="No fill"
                onClick={() => onPick(null)} />
      )}
      {presets.map((hex) => (
        <button type="button" key={hex} className={`wm-swatch${same(current, hex) ? " on" : ""}`} style={{ background: hex }}
                data-colour={data === "colour" ? hex : undefined} data-fill={data === "fill" ? hex : undefined} title={hex} aria-label={hex}
                onClick={() => onPick(hex)} />
      ))}
      <input type="color" className="wm-insp-colour" title={title} value={sixDigits(current, data === "fill" ? "#FFFFFF" : "#000000")}
             onChange={(event) => onCustom(event.target.value)} />
    </div>
  )
}

/**
 * A popover under (or, with no room, over) its button, on the page rather than in the pane so nothing clips it.
 * Closes on Escape (and says so to nobody else: the layer's own Escape must not also put the pick away) and on a
 * press anywhere outside it and its button.
 */
function Popover({ for: anchor, control, onClose, children }: { for: HTMLElement | null; control: Control; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element || !anchor) return
    const a = anchor.getBoundingClientRect()
    const { width, height } = element.getBoundingClientRect()
    const left = Math.max(4, Math.min(a.left, window.innerWidth - width - 4))
    const below = a.bottom + 4
    const top = below + height <= window.innerHeight - 4 ? below : Math.max(4, a.top - 4 - height)
    setAt({ left, top })
  }, [anchor, control])
  useEffect(() => {
    const away = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (box.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      onClose()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", escape, true)
    window.addEventListener("blur", onClose)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("blur", onClose)
      window.removeEventListener("resize", onClose)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={box} className="wm-insp-pop" data-pop={control} style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden" }}
         onPointerDown={(event) => {
           // The colour wells take their press (the picker opens from it); everything else keeps the keyboard where it was.
           if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
           event.stopPropagation()
         }}>
      {children}
    </div>,
    document.body,
  )
}
