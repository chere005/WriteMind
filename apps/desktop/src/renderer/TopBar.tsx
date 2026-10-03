/**
 * The bar over the note — the Mac's `TopBar.swift`. It is a view inside the
 * editor pane, never across the sidebar, and it has to FIT the pane it lives
 * in, so: small icons, no spacing, and wrapping rather than clipping.
 *
 * Left to right, as on the Mac: the SIDEBAR'S SWITCH (one spot, whether the
 * sidebar is open or shut), then six sections — Style, Structure, Insert,
 * Maths, Flow Chart, Pen — each with a grip at its end that puts it away
 * (the bar's context menu lists them all, and `collapsed` is remembered).
 * The markdown toggle and the video's switch are on the SIDEBAR's bar, and
 * export is in the File menu: a pane's switch lives on a different pane.
 *
 * Every button calls the same command its keyboard shortcut does, and every
 * tooltip names that key (`shown`, from the one table the menu bar uses).
 */

import type { EditorView } from "@codemirror/view"
import {
  CODE_LANGUAGES, languageTitle, LIST_STYLES, listTitle, MARK_KINDS, NODE_KINDS,
  PRESET_COLOURS, shapeTitle, HEADING_LADDER, headingName,
  type CodeLanguage, type Heading, type ListStyle, type Placement, type ShapeKind, type SpanStyle,
} from "@writemind/core"
import { applyTextStyle } from "@writemind/editor"
import { useEffect, useState, type ReactNode } from "react"
import { shown } from "../shared/commands"
import type { CanvasMode } from "./Canvas"
import { runEditorCommand } from "./editorCommands"
import { useOnScreen } from "./useOnScreen"
import { MathPalette } from "./MathPalette"
import { PenMenu } from "./PenMenu"
import { setEraser, setSelectTool, usePenSettings } from "./penSettings"

/** The sections of the bar, in the Mac's order (`ToolGroup`). `capture` is the pen's. */
export const TOOL_GROUPS = [
  { id: "style", title: "Style", icon: "Aa" },
  { id: "structure", title: "Structure", icon: "☰" },
  { id: "insert", title: "Insert", icon: "⊞" },
  { id: "maths", title: "Maths", icon: "ƒ" },
  { id: "flowchart", title: "Flow Chart", icon: "⬡" },
  { id: "capture", title: "Pen", icon: "✏" },
] as const
export type ToolGroupId = typeof TOOL_GROUPS[number]["id"]

interface Props {
  view: EditorView | null
  platform: string
  /** A note is open: the tools work on it. */
  hasNote: boolean
  sidebar: boolean
  onToggleSidebar(): void
  /** The sections that are put away. */
  collapsed: ToolGroupId[]
  onCollapse(group: ToolGroupId, collapsed: boolean): void
  listStyle: ListStyle
  onListStyle(style: ListStyle): void
  codeLanguage: CodeLanguage
  onCodeLanguage(language: CodeLanguage): void
  mode: CanvasMode
  onToggleMode(): void
  penColour: string
  onPenColour(hex: string): void
  penWidth: number
  onPenWidth(width: number): void
  placing: Placement | null
  onPlace(placing: Placement | null): void
  onAddPicture(): void
}

const FONTS = ["Georgia", "Palatino Linotype", "Times New Roman", "Arial", "Verdana", "Courier New",
  "Consolas", "Comic Sans MS"]

/**
 * The T button: font, size and colour for the selected text. Only the ticked
 * parts go in, and a font left unticked means no `font-family` at all.
 */
function TextStyleMenu({ view, onClose }: { view: EditorView | null; onClose(): void }) {
  const [useFont, setUseFont] = useState(false)
  const [font, setFont] = useState(FONTS[0]!)
  const [useSize, setUseSize] = useState(false)
  const [size, setSize] = useState(18)
  const [useColour, setUseColour] = useState(false)
  const [colour, setColour] = useState("#2d7dd2")

  const pop = useOnScreen<HTMLDivElement>(true)
  const apply = (style: SpanStyle) => {
    if (view) applyTextStyle(style)(view)
    onClose()
  }
  return (
    <div ref={pop} className="style-pop" onMouseDown={(event) => event.stopPropagation()}>
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

/** A tooltip the Mac's way: the name, its key, and a line about what it does. */
export const tip = (label: string, keys: string, help: string): string =>
  `${label}${keys ? `  (${keys})` : ""}\n${help}`

function Btn({ label, title, onClick, on, disabled, wide, children }: {
  label: ReactNode; title: string; onClick(): void; on?: boolean; disabled?: boolean; wide?: boolean
  children?: ReactNode
}) {
  return (
    <button className={`icon-button${on ? " on" : ""}`} title={title} disabled={disabled} onClick={onClick}
            style={wide ? { width: "auto", padding: "0 6px", fontSize: 11 } : undefined}>
      {label}{children}
    </button>
  )
}

/** One section, with the grip at its end that puts it away; collapsed it is a single icon. */
function Group({ id, collapsed, onCollapse, children }: {
  id: ToolGroupId; collapsed: boolean; onCollapse(collapsed: boolean): void; children: ReactNode
}) {
  const group = TOOL_GROUPS.find((one) => one.id === id)!
  return (
    <span className={`bar-group${collapsed ? " away" : ""}`} data-group={id}>
      {collapsed ? (
        <button className="icon-button away-icon" title={tip(`Show ${group.title} Tools`, "",
          "This section is put away — click to bring it back")}
                onClick={() => onCollapse(false)}>{group.icon}</button>
      ) : children}
      <button className="bar-grip" data-grip={id}
              title={tip(collapsed ? `Show ${group.title}` : `Hide ${group.title}`, "",
                collapsed ? "Bring this section of the bar back" : "Put this section of the bar away")}
              aria-label={collapsed ? `Show ${group.title} Tools` : `Hide ${group.title} Tools`}
              onClick={() => onCollapse(!collapsed)}><i /></button>
    </span>
  )
}

const SidebarIcon = () => (
  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden>
    <rect x="0.75" y="0.75" width="13.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.2 1v10" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

export function TopBar({
  view, platform, hasNote, sidebar, onToggleSidebar, collapsed, onCollapse, listStyle, onListStyle,
  codeLanguage, onCodeLanguage, mode, onToggleMode, penColour, onPenColour, penWidth, onPenWidth,
  placing, onPlace, onAddPicture,
}: Props) {
  const editor = hasNote ? view : null
  const options = { listStyle, codeLanguage }
  const run = (id: string) => () => { if (editor) runEditorCommand(editor, id, options) }
  const key = (id: string) => shown(id, platform)
  const [styling, setStyling] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const off = !hasNote
  const penTools = usePenSettings()
  const erasing = penTools.eraser
  const selecting = penTools.selectTool
  const away = (group: ToolGroupId) => collapsed.includes(group)

  // The bar's context menu puts itself away on the next click anywhere.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [menu])

  const place = (value: string) => {
    if (value === "line" || value === "arrow" || value === "both") {
      onPlace({
        kind: "line",
        start: value === "both" ? "arrow" : "none",
        end: value === "line" ? "none" : "arrow",
      })
    } else if (value) {
      onPlace({ kind: "shape", shape: value as ShapeKind })
    }
  }

  return (
    <div className="top-bar" onContextMenu={(event) => {
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY })
    }}>
      {/* ONE spot for the sidebar's switch, the one it has when the sidebar is
          away: it does not move when the sidebar opens (Sean, 2026-09-19). */}
      <button className={`icon-button${sidebar ? " on" : ""}`} data-bar="sidebar"
              aria-label={sidebar ? "Hide Notes Sidebar" : "Show Notes Sidebar"}
              aria-pressed={sidebar}
              title={tip(sidebar ? "Hide Notes Sidebar" : "Show Notes Sidebar", key("toggleSidebar"),
                sidebar ? "Put the notes list away" : "Bring the notes list back")}
              onClick={onToggleSidebar}><SidebarIcon /></button>
      <div className="bar-divider" />

      <Group id="style" collapsed={away("style")} onCollapse={(c) => onCollapse("style", c)}>
        <select className="icon-button bar-select narrow" disabled={off}
                title={tip("Text Style", "Ctrl+1–7",
                  "Title, chapter, author, section, subsection, subsubsection or body text")}
                value=""
                onChange={(event) => {
                  if (editor) runEditorCommand(editor, `heading:${Number(event.target.value) as Heading}`, options)
                  event.currentTarget.value = ""
                }}>
          <option value="" disabled>Style</option>
          {HEADING_LADDER.map((level) => (
            <option key={level} value={level}>{headingName(level)}</option>
          ))}
        </select>
        <Btn label="B" title={tip("Bold", key("bold"), "Heavier type for the selection")}
             disabled={off} onClick={run("bold")} />
        <Btn label="I" title={tip("Italic", key("italic"), "Sloped type for the selection")}
             disabled={off} onClick={run("italic")} />
        <Btn label="U" title={tip("Underline", key("underline"), "A line under the selection")}
             disabled={off} onClick={run("underline")} />
        <Btn label="S" title={tip("Strikethrough", key("strike"),
          "A line through the selection — struck out, still readable")}
             disabled={off} onClick={run("strike")} />
        <span className="pop-anchor">
          <button className={`icon-button${styling ? " on" : ""}`} disabled={off}
                  title={tip("Font and Colour", "", "Font, size and colour for the selected text")}
                  onClick={() => setStyling((was) => !was)}>T</button>
          {styling && <TextStyleMenu view={editor} onClose={() => setStyling(false)} />}
        </span>
      </Group>

      <Group id="structure" collapsed={away("structure")} onCollapse={(c) => onCollapse("structure", c)}>
        {/* The list button writes whichever marker the chevron picked. */}
        <span className="bar-split">
          <button className="icon-button" disabled={off} data-bar="list"
                  title={tip("List", key("list"), `Make these lines a ${listTitle(listStyle).toLowerCase()} list`)}
                  onClick={run("list")}>☰</button>
          <select className="icon-button chevron" disabled={off} value={listStyle}
                  title={tip("List Style", "", "Dots, dashes, numbers or to-dos")}
                  onChange={(event) => onListStyle(event.target.value as ListStyle)}>
            {LIST_STYLES.map((style) => <option key={style} value={style}>{listTitle(style)}</option>)}
          </select>
        </span>
        <Btn label="❝" title={tip("Quote", key("quote"), "Set these lines in as a quotation")}
             disabled={off} onClick={run("quote")} />
        {/* The fence carries a language, and the chevron picks it. */}
        <span className="bar-split">
          <button className="icon-button" disabled={off} data-bar="code"
                  title={tip("Code Block", key("codeBlock"), codeLanguage === "plain"
                    ? "A fenced block, set in monospace"
                    : `A fenced ${languageTitle(codeLanguage)} block, coloured`)}
                  onClick={run("codeBlock")}>{"{}"}</button>
          <select className="icon-button chevron" disabled={off} value={codeLanguage}
                  title={tip("Code Language", "", "What the block is written in")}
                  onChange={(event) => onCodeLanguage(event.target.value as CodeLanguage)}>
            {CODE_LANGUAGES.map((language) => (
              <option key={language} value={language}>{languageTitle(language)}</option>
            ))}
          </select>
        </span>
        <Btn label="⇤" title={tip("Decrease Indentation", key("outdent"), "Out one step — quotes and bullets too")}
             disabled={off} onClick={run("outdent")} />
        <Btn label="⇥" title={tip("Increase Indentation", key("indent"), "In one step — quotes and bullets too")}
             disabled={off} onClick={run("indent")} />
        <Btn label="⤒" title={tip("Move Section Up", key("moveSectionUp"),
          "This heading and everything under it, above the section before it")}
             disabled={off} onClick={run("moveSectionUp")} />
        <Btn label="⤓" title={tip("Move Section Down", key("moveSectionDown"),
          "This heading and everything under it, below the section after it")}
             disabled={off} onClick={run("moveSectionDown")} />
      </Group>

      <Group id="insert" collapsed={away("insert")} onCollapse={(c) => onCollapse("insert", c)}>
        {/* The Mac keeps only the Text Box here (the picture is Insert > Image…);
            the picture button stays too, since a pasted or dropped one is the
            most common way a picture gets onto the page. */}
        <Btn label="[T]" title={tip("Text Box", "", "A box of words that floats over the page — click where it goes")}
             disabled={off} wide on={placing?.kind === "shape" && placing.shape === "text"}
             onClick={() => onPlace(placing?.kind === "shape" && placing.shape === "text" ? null : { kind: "shape", shape: "text" })} />
        <Btn label="▣" title={tip("Image…", key("insertImage"), "Add a picture (Ctrl+V pastes one, and so does a drop)")}
             disabled={off} onClick={onAddPicture} />
      </Group>

      <Group id="maths" collapsed={away("maths")} onCollapse={(c) => onCollapse("maths", c)}>
        <MathPalette view={editor} />
      </Group>

      <Group id="flowchart" collapsed={away("flowchart")} onCollapse={(c) => onCollapse("flowchart", c)}>
        <select className={`icon-button bar-select narrow${placing?.kind === "shape" && NODE_KINDS.includes(placing.shape) ? " on" : ""}`}
                disabled={off} value=""
                title={tip("Shapes", "", "Flow-chart shapes, and arrows between them — pick one, then click where it goes")}
                onChange={(event) => { place(event.target.value); event.currentTarget.value = "" }}>
          <option value="" disabled>Shapes</option>
          <optgroup label="Flow chart">
            {NODE_KINDS.map((kind) => <option key={kind} value={kind}>{shapeTitle(kind)}</option>)}
          </optgroup>
          <optgroup label="Lines">
            <option value="arrow">Arrow</option>
            <option value="both">Both Ways</option>
            <option value="line">Line</option>
          </optgroup>
        </select>
        <select className={`icon-button bar-select narrow${placing?.kind === "shape" && MARK_KINDS.includes(placing.shape) ? " on" : ""}`}
                disabled={off} value=""
                title={tip("Marks", "", "Check marks, crosses, stars, arrows — the things drawn all the time")}
                onChange={(event) => { place(event.target.value); event.currentTarget.value = "" }}>
          <option value="" disabled>Marks</option>
          {MARK_KINDS.map((kind) => <option key={kind} value={kind}>{shapeTitle(kind)}</option>)}
        </select>
      </Group>

      <Group id="capture" collapsed={away("capture")} onCollapse={(c) => onCollapse("capture", c)}>
        {/* ONE BUTTON FOR THE PANE: the pen, lit while it is down. ⌘ is the
            selector in either mode, so the marquee needs none of its own. */}
        <button className={`icon-button${mode === "pen" ? " on" : ""}`} disabled={off}
                title={mode === "pen"
                  ? "Put the pen down and give the clicks back to the notebook"
                  : "Draw over the note (hold Ctrl in either mode to pull a rectangle over what is on the page)"}
                onClick={onToggleMode}>✎</button>
        <button className={`icon-button${erasing ? " on" : ""}`} disabled={off} data-bar="erase"
                aria-pressed={erasing}
                title={erasing
                  ? "Erase is on: touch a stroke with the pen (or the mouse) to rub it out. Click to put it down."
                  : "Erase: rub out whole strokes by touching them — no eraser end or side button needed"}
                onClick={() => setEraser(!erasing)}>⌫</button>
        <button className={`icon-button${selecting ? " on" : ""}`} disabled={off} data-bar="select"
                aria-pressed={selecting}
                title={selecting
                  ? "Select is on: drag on the page to pull a rectangle, or on an object to move it. Click to put it down."
                  : "Select: pull a rectangle over the page, or move an object — no key or side button needed (Ctrl+Alt+3)"}
                onClick={() => setSelectTool(!selecting)}>⬚</button>
        <input type="color" className="pen-colour" title="Pen colour" value={penColour} disabled={off}
               onChange={(event) => onPenColour(event.target.value)} />
        {PRESET_COLOURS.slice(0, 4).map((hex) => (
          <button key={hex} className="swatch" style={{ background: hex }} title={hex} disabled={off}
                  onClick={() => onPenColour(hex)} />
        ))}
        <select className="icon-button bar-select" disabled={off}
                title="Pen width" value={penWidth}
                onChange={(event) => onPenWidth(Number(event.target.value))}>
          {[1, 2, 3, 5, 8, 12].map((width) => <option key={width} value={width}>{width}</option>)}
        </select>
        <PenMenu />
      </Group>

      {menu && (
        <div className="bar-context" style={{ left: menu.x, top: menu.y }}
             onPointerDown={(event) => event.stopPropagation()}>
          <div className="heading">Toolbar Sections</div>
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
