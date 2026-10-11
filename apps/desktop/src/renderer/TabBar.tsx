/**
 * The tab row (`TabBar.swift`, and the wireframes: docs/ui-2026-10/FinalMain.png, FinalToolbar.png). One 36px strip:
 *
 *   [sidebar] [rendered] [video ▾]   Demo note ×   Second note   +                      ☰ 2
 *
 * THE THREE SWITCHES ARE HERE, ALWAYS, sidebar open or shut (Sean, 2026-10-10: "keep the rendered and video buttons
 * to the right of the sidebar always"). They used to be the sidebar's own bar, so shutting the sidebar took the
 * two of them with it; a switch for a pane lives on a different pane, and the tab row is the one that never goes.
 * The video button is a split button: a click shows or hides the pane, the corner triangle (or a right-click, or a
 * held press) opens its menu — the cameras, the tablet, the turns, refresh.
 *
 * Then the tabs, in the order they were opened. The one in front is the page's colour and runs into the toolbar
 * under it (no underline); its × shows on it and on whichever tab the pointer is over. A wheel over the strip walks
 * along it, a middle click closes a tab, the + at the end is a new note, and the button at the right — the open
 * notes' list, with their count — is the way back to a tab that has been scrolled off the end. There are no ‹ ›
 * arrows: the list is how you reach a tab you cannot see (Sean, 2026-10-10: the bars audit).
 *
 * THE TABS CAN BE REARRANGED (Sean, 2026-10-10: "add rearranging tabs"): press a tab and drag it sideways (tabDrag.ts: the
 * others step aside, a row that scrolls scrolls under a drag held at its end, Escape or letting go outside the row puts it
 * back), or Move Tab Left / Right in its right-click menu and Window menu (Ctrl+Shift+PageUp / PageDown, the tab in front).
 * The order is `open`'s, which the session keeps, so it survives a restart and the open-notes list shows it. It is the
 * arrangement of the window and not an edit: no undo step, nothing written to a note, and the tab in front stays in front.
 *
 * A tab's right-click menu is the sidebar row's: Rename…, Duplicate, Move to ▸ and Move to Trash… call the same
 * handlers the sidebar's rows do (App.tsx), through the same dialogs' wording (notePrompts.ts).
 *
 * It is always there, even with nothing open: the + is the way to a new note.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Note } from "@writemind/core"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { returnFocusSoon } from "./focusReturn"
import { Icon } from "./icons"
import { MenuButton } from "./MenuButton"
import { renamePrompt, trashPrompt } from "./notePrompts"
import { Prompt, type PromptSpec } from "./Prompt"
import { trashWord } from "./SidebarProject"
import { beginTabDrag } from "./tabDrag"
import { barTip, openCount, openListMenu, tabMenu, walkTo, wheelSteps } from "./tabMenus"
import { videoMenu } from "./videoMenu"
import { shown } from "../shared/commands"
import type { Section } from "./wm"

interface Props {
  platform: string
  open: Note[]
  current: string | null
  /** The project's tree, for Move to. */
  root: Section | null
  /** A note is open: the rendered page needs one. */
  hasNote: boolean
  sidebar: boolean
  onToggleSidebar(): void
  rendered: boolean
  onToggleRendered(): void
  camera: boolean
  onToggleCamera(): void
  cameras: { id: string; name: string }[]
  /** The video source that is open: a camera's id, the tablet, or null. */
  cameraId: string | null
  onPickCamera(id: string): void
  onCameraOff(): void
  onRefreshCameras(): void
  /** The notes pane is showing, and the video menu's way to put it away. */
  notesPane: boolean
  onToggleNotesPane(): void
  onSelect(note: Note): void
  onClose(path: string): void
  onCloseOthers(path: string): void
  /** A tab dragged to place `to` of the row, from 0. */
  onMoveTab(path: string, to: number): void
  /** Move Tab Left (-1) / Right (+1) on one tab. */
  onStepTab(path: string, by: -1 | 1): void
  /** The tab that was just moved (a new object each time): brought into view if the row has it off its end. */
  moved: { path: string; n: number } | null
  onNew(): void
  onReveal(path: string): void
  /** Rename… (a string back says why it did not work), Duplicate, Move to, and the Trash: the sidebar's own handlers. */
  onRename(note: Note, name: string): void | string | Promise<void | string>
  onDuplicate(note: Note): void
  onMove(note: Note, folder: string): void
  onTrash(note: Note): void
}

export function TabBar(props: Props) {
  const {
    platform, open, current, root, hasNote, sidebar, rendered, camera, cameras, cameraId, notesPane,
    onSelect, onClose, onCloseOthers, onNew,
  } = props
  const strip = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  const wheel = useRef(0)
  const bin = trashWord(platform)

  // The tab in front is always in view, however far the row has been walked — and still is after the window is made
  // narrower (the strip shrinks, and the tab that was at its right end is now past it).
  useEffect(() => {
    const element = strip.current
    if (!element) return
    const bring = () => element.querySelector<HTMLElement>(".tab.open")?.scrollIntoView({ block: "nearest", inline: "nearest" })
    bring()
    const watch = new ResizeObserver(bring)
    watch.observe(element)
    return () => watch.disconnect()
  }, [current, open.length])

  // A tab that was moved (by the menu or the keys; a drop lands in view already) is in view, however far the row has been walked.
  useEffect(() => {
    if (!props.moved) return
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>(".tab") ?? [])]
    tabs.find((tab) => tab.dataset.path === props.moved!.path)?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [props.moved])

  /** A press on a tab: a click as ever, or (moved a few pixels) a drag that rearranges the row. */
  const press = (event: React.PointerEvent, path: string) => {
    const row = bar.current, element = strip.current
    if (!row || !element) return
    beginTabDrag(event, {
      strip: element, row, selector: ".tab", from: open.findIndex((note) => note.path === path),
      onDrop: (_from, to) => props.onMoveTab(path, to),
    })
  }

  /** A wheel over the strip walks along it. A mouse only sends vertical deltas, and a row of tabs is the one place that has to mean sideways. */
  const walk = useCallback((event: React.WheelEvent) => {
    const element = strip.current
    if (!element) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    const moved = wheelSteps(wheel.current, delta)
    wheel.current = moved.carried
    if (moved.steps === 0) return
    const tabs = [...element.querySelectorAll<HTMLElement>(".tab")]
    const at = walkTo(tabs.map((tab) => tab.getBoundingClientRect().right), element.getBoundingClientRect().left, moved.steps)
    tabs[at]?.scrollIntoView({ block: "nearest", inline: "start" })
  }, [])

  const tabsMenu = (note: Note) => tabMenu(note, {
    platform, openCount: open.length, position: open.findIndex((one) => one.path === note.path), root,
    close: onClose, closeOthers: onCloseOthers, step: (one, by) => props.onStepTab(one.path, by), reveal: props.onReveal,
    rename: (one) => setPrompt(renamePrompt(one, (name) => props.onRename(one, name))),
    duplicate: props.onDuplicate,
    moveTo: props.onMove,
    trash: (one) => setPrompt(trashPrompt(one, bin, () => props.onTrash(one))),
  })

  const key = (id: string) => shown(id, platform)
  return (
    <div className={`tab-bar bar-row${sidebar ? "" : " under-lights"}`} data-bar="tabs" ref={bar}>
      <button type="button" className={`bar-btn${sidebar ? " tint" : ""}`} data-bar="sidebar" aria-pressed={sidebar}
              aria-label={sidebar ? "Hide Notes Sidebar" : "Show Notes Sidebar"}
              title={barTip(sidebar ? "Hide Notes Sidebar" : "Show Notes Sidebar", key("toggleSidebar"),
                sidebar ? "Put the notes list away" : "Bring the notes list back")}
              onClick={props.onToggleSidebar}><Icon name="sidebar" /></button>
      <button type="button" className={`bar-btn${rendered ? " tint" : ""}`} data-bar="markdown" aria-pressed={rendered}
              disabled={!hasNote}
              aria-label={rendered ? "Show Markdown" : "Show Rendered Page"}
              title={barTip(rendered ? "Rendered" : "Markdown", key("toggleMode"),
                rendered ? "Showing the note rendered — click for the markdown behind it"
                  : "Showing the markdown — click to render it and go on typing")}
              onClick={props.onToggleRendered}><Icon name="eye" /></button>
      {/* A PANE'S SWITCH LIVES ON A DIFFERENT PANE: the video's is here, and its menu lists the cameras, as the Input Devices menu does. */}
      <MenuButton icon="camera" dataBar="video" menuBar="video-options" tint={camera} onMain={props.onToggleCamera}
                  title={barTip(camera ? "Hide Video" : "Show Video", key("toggleCamera"),
                    camera ? "Put the camera pane away — its corner opens the sources" : "Bring the camera pane back — its corner opens the sources")}
                  items={() => videoMenu({ platform, camera, cameras, cameraId, notesPane }, {
                    toggleVideo: props.onToggleCamera, pick: props.onPickCamera, off: props.onCameraOff,
                    refresh: props.onRefreshCameras, toggleNotesPane: props.onToggleNotesPane,
                    // The pane owns the picture's state, so a turn is asked of it by event (CameraPane's `wm:camera-action`).
                    turn: (direction) => window.dispatchEvent(new CustomEvent("wm:camera-action", { detail: direction })),
                  })} />
      <div className="tab-gap" aria-hidden="true" />
      <div className="tab-strip" ref={strip} onWheel={walk}>
        {open.map((note) => (
          <button key={note.path} type="button"
                  className={`tab${note.path === current ? " open" : ""}`}
                  title={note.path} data-path={note.path}
                  onPointerDown={(event) => press(event, note.path)}
                  onClick={() => onSelect(note)}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(note.path) } }}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({ x: event.clientX, y: event.clientY, items: tabsMenu(note) })
                  }}>
            <span className="name">{note.title}</span>
            <span className="close" role="button" aria-label="Close this tab" title={`Close this tab (${key("closeTab")})`}
                  onClick={(event) => { event.stopPropagation(); onClose(note.path) }}><Icon name="close" size={10} /></span>
          </button>
        ))}
      </div>
      {/* The + is not part of the strip that walks: a new note is always one click away, however many tabs are open. */}
      <button type="button" className="bar-btn tab-new" aria-label="New Tab" data-bar="new-tab"
              title={`New note (${key("newNote")})`} onClick={onNew}><Icon name="plus" /></button>
      <div className="tab-room" />
      {/* (With no note open there is nothing to list: FinalToolbar.png's "No note open" strip has no count.) */}
      {open.length > 0 && (
        <MenuButton icon="list" label={open.length} dataBar="tab-list" className="tab-list" title={openCount(open.length)} name={`Open notes: ${open.length}`}
                    items={() => openListMenu(open, current, onSelect, onCloseOthers)} />
      )}
      {menu && <FloatingMenu x={menu.x} y={menu.y} items={menu.items} id="tab-menu"
                             onClose={() => { setMenu(null); returnFocusSoon() }} />}
      {prompt && <Prompt spec={prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}
