/**
 * The bar over the note — one 36px row that never wraps and never clips (docs/PLAN-bars-2026-10.md P1; the wireframes are
 * docs/ui-2026-10/FinalMain.png and FinalToolbar.png). It is a view inside the editor pane, never across the sidebar or
 * the video, and it has to FIT the pane it lives in: what does not fit leaves the row in a fixed order and waits in the ⋯
 * menu (`barFold.ts`, a pure function of the width).
 *
 * Left to right: STYLE (the caret's cell kind, with the menu the seam's + opens too), B I U S and Aa (font, size, colour);
 * the BLOCKS, List and Quote and Code (the list and the code button write the style / language last picked); the INSERTS,
 * each its own button, Text box, Picture, Table, Maths and Shapes (Sean, 2026-10-10: "don't collapse the inserts into one
 * button.. it should have text box, picture, table, maths"), and the section moves ("move section up/down to the right of
 * the insert buttons"); then the PEN, ONE button and its menu (Sean: "i only need a pen enabled and disabled button.. and
 * a dropdown to choose between pen or eraser (which switches the mode of the single button).. [colour and width] should be
 * under this dropdown"); then ⋯ when something has folded. The sidebar's switch, the rendered page's and the video's are
 * in the TAB row now ("keep the rendered and video buttons to the right of the sidebar always"), not on this bar.
 *
 * Every button calls the same command its keyboard shortcut does, and every tooltip names that key (`shown`, from the one
 * table the menu bar uses). Every menu and popover closes on Escape and on a click anywhere else and gives the keyboard
 * back to the notes.
 */

import type { EditorView } from "@codemirror/view"
import {
  CODE_LANGUAGES, languageTitle, LIST_STYLES, listTitle, MARK_MENU_KINDS, NODE_KINDS, shapeTitle,
  type CellKind, type CodeLanguage, type ListStyle, type Placement, type ShapeKind, type SpanStyle,
} from "@writemind/core"
import { applyTextStyle, watchCellKind } from "@writemind/editor"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { shown } from "../shared/commands"
import { barParts, foldAt, foldFor, hasMore, type BarSections, type FoldLevel } from "./barFold"
import type { CanvasMode } from "./Canvas"
import { runEditorCommand } from "./editorCommands"
import { returnFocusSoon } from "./focusReturn"
import type { MenuItem } from "./FloatingMenu"
import { Icon, type IconName } from "./icons"
import { kindLabel, kindMenuItems, type KindPick } from "./kindMenu"
import { MathPalette, MATH_OPEN_EVENT } from "./MathPalette"
import { MenuButton } from "./MenuButton"
import { PenSheet, PenSheetRow, type SheetPlace } from "./PenMenu"
import { PEN_SWATCHES, PEN_WIDTHS, dotSize, nearestWidth, sameInk, swatchOf } from "./penLook"
import { setPenDraws, usePenSettings, type PenPress } from "./penSettings"
import { TOOL_GROUPS, type ToolGroupId } from "./toolGroups"

export { TOOL_GROUPS, type ToolGroupId }

interface Props {
  view: EditorView | null
  platform: string
  /** A note is open: the tools work on it. */
  hasNote: boolean
  /** The sections that are put away (Customize toolbar…). */
  collapsed: ToolGroupId[]
  onCollapse(group: ToolGroupId, collapsed: boolean): void
  listStyle: ListStyle
  onListStyle(style: ListStyle): void
  codeLanguage: CodeLanguage
  onCodeLanguage(language: CodeLanguage): void
  mode: CanvasMode
  /** The pen button, its key or its menu (the app owns the pen's mode: `nextPenButton` says what each does). */
  onPenButton(press: PenPress): void
  penColour: string
  onPenColour(hex: string): void
  penWidth: number
  onPenWidth(width: number): void
  placing: Placement | null
  onPlace(placing: Placement | null): void
  onAddPicture(): void
  /** A command the page owns, not the editor (the Style menu's Drawing cell makes the cell AND its drawing). */
  onCommand(id: string): void
}

const FONTS = ["Georgia", "Palatino Linotype", "Times New Roman", "Arial", "Verdana", "Courier New",
  "Consolas", "Comic Sans MS"]

/** A tooltip the Mac's way: the name, its key, and a line about what it does. */
export const tip = (label: string, keys: string, help: string): string =>
  `${label}${keys ? `  (${keys})` : ""}\n${help}`

/**
 * The Aa button's popover: font, size and colour for the selected text. Only the ticked parts go in, and a font left
 * unticked means no `font-family` at all. It hangs under its button, fixed (the bar clips what is drawn outside it), and
 * closes on Escape and on a click anywhere else.
 */
function TextStyleMenu({ view, anchor, onClose }: { view: EditorView | null; anchor: HTMLElement | null; onClose(): void }) {
  const [useFont, setUseFont] = useState(false)
  const [font, setFont] = useState(FONTS[0]!)
  const [useSize, setUseSize] = useState(false)
  const [size, setSize] = useState(18)
  const [useColour, setUseColour] = useState(false)
  const [colour, setColour] = useState("#2d7dd2")
  const pop = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<CSSProperties>({ visibility: "hidden" })

  useLayoutEffect(() => {
    const box = anchor?.getBoundingClientRect()
    const width = pop.current?.getBoundingClientRect().width ?? 0
    if (!box) return
    setAt({ position: "fixed", top: box.bottom + 4, left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)) })
  }, [anchor])

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && (pop.current?.contains(event.target) || anchor?.contains(event.target))) return
      onClose()
    }
    // Escape goes first and stops there (the keyboard is the notes' after a click on the bar, and the editor would take it).
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      onClose()
      returnFocusSoon()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", escape, true)
    window.addEventListener("resize", onClose)
    window.addEventListener("blur", onClose)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("resize", onClose)
      window.removeEventListener("blur", onClose)
    }
  }, [anchor, onClose])

  const apply = (style: SpanStyle) => {
    if (view) applyTextStyle(style)(view)
    onClose()
  }
  return (
    <div ref={pop} className="style-pop" style={at} data-bar="font-pop" onMouseDown={(event) => event.stopPropagation()}>
      <label><input type="checkbox" checked={useFont} onChange={(e) => setUseFont(e.target.checked)} /> Font</label>
      <select value={font} onChange={(e) => { setFont(e.target.value); setUseFont(true) }}>
        {FONTS.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <label><input type="checkbox" checked={useSize} onChange={(e) => setUseSize(e.target.checked)} /> Size</label>
      <input type="number" min={8} max={96} value={size}
             onChange={(e) => { setSize(Number(e.target.value)); setUseSize(true) }} />
      <label><input type="checkbox" checked={useColour} onChange={(e) => setUseColour(e.target.checked)} /> Colour</label>
      <input type="color" value={colour} onChange={(e) => { setColour(e.target.value); setUseColour(true) }} />
      <div className="actions">
        <button onClick={() => apply({})}>Remove</button>
        <button onClick={() => apply({
          family: useFont ? font : null,
          size: useSize ? size : null,
          colorHex: useColour ? colour.toUpperCase() : null,
        })}>Apply</button>
      </div>
    </div>
  )
}

/** The caret's cell kind, for the Style button (packages/editor `cellKind.ts`: told only of a change of kind). */
function useCellKind(view: EditorView | null): CellKind | null {
  const [kind, setKind] = useState<CellKind | null>(null)
  useEffect(() => {
    if (!view) { setKind(null); return }
    return watchCellKind(view, setKind)
  }, [view])
  return kind
}

/** The bar's own width, measured: padding included, the row's own box. */
function useBarWidth(row: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(1000)
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [row])
  return width
}

/** A plain bar button: a line icon, or a styled letter. */
function Btn({ icon, glyph, title, onClick, on, disabled, dataBar, className }: {
  icon?: IconName; glyph?: ReactNode; title: string; onClick(): void; on?: boolean; disabled?: boolean; dataBar?: string
  className?: string
}) {
  return (
    <button type="button" className={`bar-btn${on ? " on" : ""}${glyph ? " letter" : ""}${className ? ` ${className}` : ""}`}
            data-bar={dataBar} title={title} aria-label={title.split("\n")[0]} aria-pressed={on === undefined ? undefined : on}
            disabled={disabled} onClick={onClick}>
      {icon && <Icon name={icon} />}{glyph}
    </button>
  )
}

const LIST_ICONS: Record<ListStyle, IconName> = { dots: "list", dashes: "listdash", numbered: "listnum", todo: "listcheck" }

export function TopBar({
  view, platform, hasNote, collapsed, onCollapse, listStyle, onListStyle, codeLanguage, onCodeLanguage,
  mode, onPenButton, penColour, onPenColour, penWidth, onPenWidth, placing, onPlace, onAddPicture, onCommand,
}: Props) {
  const editor = hasNote ? view : null
  const off = !hasNote
  const run = (id: string, options?: { listStyle?: ListStyle; codeLanguage?: CodeLanguage }) => () => {
    if (editor) runEditorCommand(editor, id, { listStyle, codeLanguage, ...options })
  }
  const key = (id: string) => shown(id, platform)
  const away = (group: ToolGroupId) => collapsed.includes(group)
  const sections: BarSections = { text: !away("text"), blocks: !away("blocks"), insert: !away("insert"), pen: !away("pen") }

  const row = useRef<HTMLDivElement | null>(null)
  const width = useBarWidth(row)
  const level: FoldLevel = foldFor(width, sections)
  const fold = foldAt(level)
  const kind = useCellKind(editor)

  const penTools = usePenSettings()
  const erasing = penTools.eraser
  const penLit = penTools.tool === "pen" ? mode === "pen" : erasing

  const [styling, setStyling] = useState(false)
  const fontButton = useRef<HTMLButtonElement | null>(null)
  const [sheet, setSheet] = useState<SheetPlace | null>(null)
  const split = useRef<HTMLSpanElement | null>(null)
  const colourInput = useRef<HTMLInputElement | null>(null)
  const [customize, setCustomize] = useState<{ x: number; y: number } | null>(null)

  // The Customize checklist puts itself away on the next click anywhere else, on Escape, and when the window goes.
  useEffect(() => {
    if (!customize) return
    const close = (event: Event) => {
      if (event instanceof PointerEvent && event.target instanceof Element && event.target.closest(".bar-context")) return
      setCustomize(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      setCustomize(null)
      returnFocusSoon()
    }
    window.addEventListener("pointerdown", close, true)
    window.addEventListener("keydown", escape, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("pointerdown", close, true)
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [customize])

  const place = (value: string) => {
    if (value === "tool") {
      // The Mac's "Draw arrows between nodes": stays armed, and a drag from anywhere draws a line that attaches to the
      // nodes at its ends.
      onPlace(placing?.kind === "line" && placing.tool ? null : { kind: "line", start: "none", end: "arrow", tool: true })
    } else if (value === "line" || value === "arrow" || value === "both") {
      onPlace({ kind: "line", start: value === "both" ? "arrow" : "none", end: value === "line" ? "none" : "arrow" })
    } else if (value) {
      onPlace({ kind: "shape", shape: value as ShapeKind })
    }
  }
  const armedTool = placing?.kind === "line" && placing.tool === true
  const armedText = placing?.kind === "shape" && placing.shape === "text"
  const placingShape = placing !== null && !armedText

  // MARK: - The menus

  const styleItems = (): MenuItem[] => kindMenuItems(platform, kind, (pick: KindPick) => {
    if (!editor) return
    // A list kind is the list button's style from now on, as the button's own menu is.
    if (pick.listStyle) onListStyle(pick.listStyle)
    if (!runEditorCommand(editor, pick.command, { listStyle: pick.listStyle ?? listStyle, codeLanguage })) onCommand(pick.command)
  })

  const listItems = (): MenuItem[] => [
    ...LIST_STYLES.map((style): MenuItem => ({
      label: listTitle(style), icon: LIST_ICONS[style], checked: style === listStyle, dataBar: `list-${style}`,
      hint: style === "dots" ? key("list") || undefined : undefined,
      onClick: () => { onListStyle(style); if (editor) runEditorCommand(editor, "list", { listStyle: style, codeLanguage }) },
    })),
    "-",
    { label: "Increase Indentation", icon: "indent", hint: key("indent") || undefined, onClick: run("indent") },
    { label: "Decrease Indentation", icon: "outdent", hint: key("outdent") || undefined, onClick: run("outdent") },
  ]

  const codeItems = (): MenuItem[] => CODE_LANGUAGES.map((language): MenuItem => ({
    label: languageTitle(language), checked: language === codeLanguage, dataBar: `code-${language}`,
    hint: language === "plain" ? key("codeBlock") || undefined : undefined,
    onClick: () => { onCodeLanguage(language); if (editor) runEditorCommand(editor, "codeBlock", { listStyle, codeLanguage: language }) },
  }))

  const shapeItems = (): MenuItem[] => [
    { header: "Flow chart" },
    ...NODE_KINDS.filter((shape) => shape !== "text").map((shape): MenuItem => ({
      label: shapeTitle(shape), checked: placing?.kind === "shape" && placing.shape === shape, dataBar: `shape-${shape}`,
      onClick: () => place(shape),
    })),
    "-",
    { header: "Lines" },
    { label: "Arrow", checked: false, dataBar: "shape-arrow", onClick: () => place("arrow") },
    { label: "Both Ways", checked: false, dataBar: "shape-both", onClick: () => place("both") },
    { label: "Line", checked: false, dataBar: "shape-line", onClick: () => place("line") },
    { label: "Arrow tool (drag between nodes)", checked: armedTool, dataBar: "shape-tool", onClick: () => place("tool") },
    "-",
    { header: "Marks" },
    ...MARK_MENU_KINDS.filter((shape) => !NODE_KINDS.includes(shape)).map((shape): MenuItem => ({
      label: shapeTitle(shape), checked: placing?.kind === "shape" && placing.shape === shape, dataBar: `shape-${shape}`,
      onClick: () => place(shape),
    })),
  ]

  const penItems = (): MenuItem[] => [
    {
      label: "Pen", icon: "pen", checked: penTools.tool === "pen", dataBar: "pen-pen", hint: key("penToggle") || undefined,
      onClick: () => onPenButton("choosePen"),
    },
    {
      label: "Eraser", icon: "eraser", checked: penTools.tool === "eraser", dataBar: "erase", hint: key("penErase") || undefined,
      onClick: () => onPenButton("chooseEraser"),
    },
    "-",
    { header: "Colour" },
    {
      custom: (
        <div className="pen-swatches" data-bar="pen-colours">
          {PEN_SWATCHES.map((swatch) => (
            <button key={swatch.hex} type="button" className={`pen-swatch${sameInk(swatch.hex, penColour) ? " on" : ""}`}
                    style={{ background: swatch.hex }} aria-label={swatch.name} title={swatch.name}
                    aria-pressed={sameInk(swatch.hex, penColour)} data-bar={`colour-${swatch.hex.slice(1).toLowerCase()}`}
                    onClick={() => onPenColour(swatch.hex)} />
          ))}
          <button type="button" className={`pen-swatch custom${swatchOf(penColour) === null ? " on" : ""}`} data-bar="colour-custom"
                  aria-label="Custom colour…" title="Custom colour…" aria-pressed={swatchOf(penColour) === null}
                  onClick={() => {
                    const input = colourInput.current
                    if (!input) return
                    // The system's picker belongs to an input that outlives this menu (the menu goes when the window loses focus).
                    if (typeof input.showPicker === "function") input.showPicker(); else input.click()
                  }} />
        </div>
      ),
    },
    { header: "Width" },
    {
      custom: (
        <div className="pen-widths" data-bar="pen-widths">
          {PEN_WIDTHS.map((one) => (
            <button key={one} type="button" className={`pen-width${nearestWidth(penWidth) === one ? " on" : ""}`}
                    aria-label={`Width ${one}`} title={`${one} px`} aria-pressed={nearestWidth(penWidth) === one}
                    data-bar={`width-${one}`} onClick={() => onPenWidth(one)}>
              <i style={{ width: dotSize(one), height: dotSize(one) }} />
            </button>
          ))}
        </div>
      ),
    },
    "-",
    {
      label: "Pen always draws (tablet)", toggle: penTools.penDraws, dataBar: "pen-always",
      onClick: () => setPenDraws(!penTools.penDraws),
    },
    {
      custom: (close) => (
        <PenSheetRow close={close} onOpen={() => {
          const box = split.current?.getBoundingClientRect()
          setSheet({ top: (box?.bottom ?? 36) + 4, right: Math.max(8, window.innerWidth - (box?.right ?? window.innerWidth)) })
        }} />
      ),
    },
  ]

  /** What folded for width, as menu rows with their icons and keys (the same commands as the buttons). */
  const moreItems = (): MenuItem[] => {
    const rows: MenuItem[] = []
    if (fold.blocks && sections.blocks) {
      rows.push(
        { label: "List", icon: LIST_ICONS[listStyle], hint: key("list") || undefined, disabled: off, dataBar: "list", onClick: run("list") },
        { label: "Quote", icon: "quote", hint: key("quote") || undefined, disabled: off, dataBar: "quote", onClick: run("quote") },
        { label: "Code", icon: "code", hint: key("codeBlock") || undefined, disabled: off, dataBar: "code", onClick: run("codeBlock") },
      )
    }
    if (fold.inserts && sections.insert) {
      rows.push(
        { label: "Text box", icon: "textbox", disabled: off, dataBar: "textbox", onClick: () => onPlace(armedText ? null : { kind: "shape", shape: "text" }) },
        { label: "Picture…", icon: "image", hint: key("insertImage") || undefined, disabled: off, dataBar: "picture", onClick: onAddPicture },
        { label: "Table", icon: "table", disabled: off, dataBar: "table", onClick: run("insertTable") },
        { label: "Maths", icon: "math", hint: key("insertMath") || undefined, disabled: off, dataBar: "maths",
          onClick: () => window.dispatchEvent(new Event(MATH_OPEN_EVENT)) },
        { label: "Shapes", icon: "shapes", disabled: off, dataBar: "shapes", submenu: shapeItems() },
        { label: "Move section up", icon: "secup", hint: key("moveSectionUp") || undefined, disabled: off, dataBar: "secup", onClick: run("moveSectionUp") },
        { label: "Move section down", icon: "secdown", hint: key("moveSectionDown") || undefined, disabled: off, dataBar: "secdown", onClick: run("moveSectionDown") },
      )
    }
    return [
      ...(rows.length > 0 ? [{ header: "Moved here for width" } as MenuItem, ...rows, "-" as const] : []),
      { label: "Customize toolbar…", dataBar: "customize", onClick: () => {
        const box = row.current?.querySelector<HTMLElement>('[data-bar="more"]')?.getBoundingClientRect()
        setCustomize({ x: Math.max(8, (box?.right ?? 300) - 190), y: (box?.bottom ?? 36) + 2 })
      } },
    ]
  }

  // MARK: - The parts

  const glyphs: Record<string, ReactNode> = {
    bold: <b>B</b>, italic: <i>I</i>, underline: <u>U</u>, strike: <s>S</s>,
  }
  const renderPart = (id: string): ReactNode => {
    switch (id) {
      case "style": {
        const help = tip("Style", `${key("heading:1")}–${key("heading:0").split("+").pop()}`,
          "The caret's cell, and the style to make it: title, chapter, author, section, lists, quote, code, maths, drawing")
        return fold.glyph
          ? <MenuButton key={id} icon="para" title={help} items={styleItems} disabled={off} dataBar="style" />
          : <MenuButton key={id} label={kindLabel(kind)} chevron noMark title={help} items={styleItems} disabled={off}
                        className="bordered style" dataBar="style" />
      }
      case "bold": return <Btn key={id} glyph={glyphs.bold} dataBar="bold" title={tip("Bold", key("bold"), "Heavier type for the selection")} disabled={off} onClick={run("bold")} />
      case "italic": return <Btn key={id} glyph={glyphs.italic} dataBar="italic" title={tip("Italic", key("italic"), "Sloped type for the selection")} disabled={off} onClick={run("italic")} />
      case "underline": return <Btn key={id} glyph={glyphs.underline} dataBar="underline" title={tip("Underline", key("underline"), "A line under the selection")} disabled={off} onClick={run("underline")} />
      case "strike": return <Btn key={id} glyph={glyphs.strike} dataBar="strike" title={tip("Strikethrough", key("strike"), "A line through the selection — struck out, still readable")} disabled={off} onClick={run("strike")} />
      case "font":
        return (
          <span key={id} className="pop-anchor">
            <button ref={fontButton} type="button" className={`bar-btn menu letter${styling ? " on" : ""}`} disabled={off} data-bar="font"
                    aria-label="Font and Colour" aria-expanded={styling}
                    title={tip("Font and Colour", "", "Font, size and colour for the selected text")}
                    onClick={() => setStyling((was) => !was)}><span className="aa">Aa</span></button>
            {styling && <TextStyleMenu view={editor} anchor={fontButton.current} onClose={() => setStyling(false)} />}
          </span>
        )
      case "list":
        // The list button writes whichever marker the menu last picked.
        return <MenuButton key={id} icon={LIST_ICONS[listStyle]} dataBar="list" disabled={off} onMain={run("list")} items={listItems}
                           title={tip("List", key("list"), `Make these lines a ${listTitle(listStyle).toLowerCase()} list`)} />
      case "quote": return <Btn key={id} icon="quote" dataBar="quote" title={tip("Quote", key("quote"), "Set these lines in as a quotation")} disabled={off} onClick={run("quote")} />
      case "code":
        // The fence carries a language, and the menu picks it.
        return <MenuButton key={id} icon="code" dataBar="code" disabled={off} onMain={run("codeBlock")} items={codeItems}
                           title={tip("Code Block", key("codeBlock"), codeLanguage === "plain"
                             ? "A fenced block, set in monospace" : `A fenced ${languageTitle(codeLanguage)} block, coloured`)} />
      case "textbox":
        return <Btn key={id} icon="textbox" dataBar="textbox" on={armedText} disabled={off}
                    title={tip("Text box", key("insertTextBox"), "A box of words that floats over the page — click where it goes")}
                    onClick={() => onPlace(armedText ? null : { kind: "shape", shape: "text" })} />
      case "picture":
        return <Btn key={id} icon="image" dataBar="picture" disabled={off} onClick={onAddPicture}
                    title={tip("Picture…", key("insertImage"), `Add a picture (${key("paste") || "paste"} pastes one, and so does a drop)`)} />
      case "table":
        return <Btn key={id} icon="table" dataBar="table" disabled={off} onClick={run("insertTable")}
                    title={tip("Table", key("insertTable"), "A table of two columns — Tab goes cell to cell, Return adds a row")} />
      case "maths":
        return <MathPalette key={id} view={editor} disabled={off}
                            title={tip("Maths", key("insertMath"), "Integrals, sums, derivatives — written as Wolfram Language")} />
      case "shapes":
        return <MenuButton key={id} icon="shapes" dataBar="shapes" disabled={off} on={placingShape} items={shapeItems}
                           title={tip("Shapes", "", "Flow-chart shapes, lines and arrows, marks — pick one, then click where it goes")} />
      case "secup":
        return <Btn key={id} icon="secup" dataBar="secup" disabled={off} onClick={run("moveSectionUp")}
                    title={tip("Move Section Up", key("moveSectionUp"), "This heading and everything under it, above the section before it")} />
      case "secdown":
        return <Btn key={id} icon="secdown" dataBar="secdown" disabled={off} onClick={run("moveSectionDown")}
                    title={tip("Move Section Down", key("moveSectionDown"), "This heading and everything under it, below the section after it")} />
      case "grow": return <div key={id} className="grow" />
      case "pen":
        return (
          <span key={id} ref={split} className="pen-split-anchor">
            <MenuButton caret icon={penTools.tool === "pen" ? "pen" : "eraser"} dataBar="pen" caretDataBar="pen-menu"
                        on={penLit} disabled={off} items={penItems}
                        onMain={() => onPenButton("button")}
                        title={penTools.tool === "pen"
                          ? tip(mode === "pen" ? "Pen (down)" : "Pen", key("penToggle"), mode === "pen"
                            ? "Put the pen down and give the clicks back to the notebook"
                            : `Draw over the note (hold ${platform === "darwin" ? "Cmd" : "Ctrl"} in either mode to pull a rectangle over what is on the page)`)
                          : tip(erasing ? "Eraser (on)" : "Eraser", key("penErase"), erasing
                            ? "Erase is on: touch a stroke with the pen (or the mouse) to rub it out. Click to put it down."
                            : "Erase on the note's page: rub out whole strokes by touching them")}
                        caretTitle={tip("Pen options", "", "Pen or eraser, colour, width, the tablet")} />
          </span>
        )
      default:
        return id.startsWith("air") ? <span key={id} className="bar-air" /> : null
    }
  }

  return (
    <div ref={row} className="bar-row page top-bar" data-bar-row="top"
         onContextMenu={(event) => {
           // A right-click on the bar is Customize toolbar… (the pen's own button has its menu).
           event.preventDefault()
           setCustomize({ x: event.clientX, y: event.clientY })
         }}>
      {barParts(level, sections).map((part) => renderPart(part.id))}
      {/* The maths palette answers its key (Insert ▸ Maths…) and the dots' Maths row whether or not its button is on the bar. */}
      {!barParts(level, sections).some((part) => part.id === "maths") && <MathPalette view={editor} showButton={false} />}
      {/* The pen's colour, kept in an input that outlives the pen menu: the system's picker is a window of its own,
          and the menu goes when this one takes the keyboard. (Its value is the pen's colour: the old bar's swatch.) */}
      <input ref={colourInput} type="color" className="pen-colour" tabIndex={-1} aria-hidden="true" value={penColour}
             onChange={(event) => onPenColour(event.target.value)} />
      {hasMore(level, sections) && (
        <MenuButton icon="more" dataBar="more" title={tip("More", "", "What no longer fits the bar, and Customize toolbar…")} items={moreItems} />
      )}
      {sheet && <PenSheet at={sheet} onClose={() => { setSheet(null); returnFocusSoon() }} />}
      {customize && (
        <div className="bar-context" data-bar="customize-pop" role="dialog" aria-label="Customize toolbar"
             style={{ left: Math.max(8, Math.min(customize.x, window.innerWidth - 200)), top: customize.y }}>
          <div className="heading">Toolbar sections</div>
          {TOOL_GROUPS.map((group) => (
            <label key={group.id}>
              <input type="checkbox" checked={!away(group.id)} data-section={group.id}
                     onChange={(event) => onCollapse(group.id, !event.target.checked)} />
              {" "}{group.title}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
