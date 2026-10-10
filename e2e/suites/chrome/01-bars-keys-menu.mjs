import { js, key, menu, menuClick, ok, finish, sleep, shot, seedNotes, reloadApp, closeAllTabs } from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const state = () => J(`({
  sidebar: !!document.querySelector('.sidebar'),
  rendered: document.querySelector('.cm-editor')?.classList.contains('wm-rendered') ?? false,
  doc: document.querySelector('.cm-content').cmTile.view.state.doc.toString(),
})`)
const label = async (top, re) => (await menu()).find((t) => t.label === top).submenu.find((i) => re.test(i.label))?.label
const openHead = async () => { await closeAllTabs(); await js(`[...document.querySelectorAll('.note-row')].find(r=>r.textContent.startsWith('Head'))?.click()`); await sleep(800) }
const selectWord = () => js(`(() => { const v = document.querySelector('.cm-content').cmTile.view; const at = v.state.doc.toString().indexOf('body one'); v.dispatch({ selection: { anchor: at, head: at + 4 } }); v.focus() })()`)

// A small notes folder: Cells ("Head"), Second, Third and a fourth, so the sidebar has something to edit.
await seedNotes({
  "Cells.md": "# Head\n\nbody one\n\nbody two\n\n# Next\n\nTail",
  "Second.md": "# Second\n\nsecond body text\n",
  "Third.md": "# Third\n\nthird\n",
  "Fourth.md": "# Fourth\n\nfourth\n",
}, { clean: true })
await js(`localStorage.clear()`)
await reloadApp()
await openHead()

// ---- A. the TAB ROW carries the three switches: sidebar, rendered, video — in that order, sidebar open or shut
// (Sean, 2026-10-10: "keep the rendered and video buttons to the right of the sidebar always")
const strip = () => J(`(() => { const row = document.querySelector('.tab-bar'); const kids = [...row.querySelectorAll('[data-bar]')].map((b) => b.dataset.bar).filter((k) => ['sidebar', 'markdown', 'video'].includes(k)); const at = (k) => { const r = document.querySelector('[data-bar=' + k + ']').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }; const b = row.getBoundingClientRect(); return { kids, row: { h: b.height, x: b.x }, sidebar: at('sidebar'), markdown: at('markdown'), video: at('video'), lit: document.querySelector('[data-bar=sidebar]').getAttribute('aria-pressed'), first: row.firstElementChild.dataset.bar } })()`)
const first = await strip()
ok("the sidebar's switch is the first button of the tab row", first.first === "sidebar", JSON.stringify(first))
ok("then the rendered button, then the video button, left to right", JSON.stringify(first.kids) === JSON.stringify(["sidebar", "markdown", "video"]) && first.sidebar.x < first.markdown.x && first.markdown.x < first.video.x, JSON.stringify(first))
ok("the tab row is 36px tall", Math.round(first.row.h) === 36, String(first.row.h))
ok("and the text bar no longer carries a sidebar button", !(await js(`!!document.querySelector('.top-bar [data-bar=sidebar]')`)))
ok("it is lit while the sidebar shows", first.lit === "true")
const sidebarWidth = await js(`document.querySelector('.sidebar').getBoundingClientRect().width`)
await js(`document.querySelector('[data-bar=sidebar]').click()`); await sleep(300)
const shut = await strip()
ok("clicking it puts the sidebar away", (await js(`document.querySelectorAll('.sidebar').length`)) === 0)
ok("and the button is not lit", shut.lit === "false")
ok("the rendered and video buttons are still right of it with the sidebar shut", JSON.stringify(shut.kids) === JSON.stringify(["sidebar", "markdown", "video"]) && shut.sidebar.x < shut.markdown.x && shut.markdown.x < shut.video.x, JSON.stringify(shut))
ok("the old collapse/expand buttons are gone", (await J(`!![...document.querySelectorAll('button')].find(b => b.textContent === '‹' || b.textContent === '›')`)) === false)
await shot("closed")
await js(`document.querySelector('[data-bar=sidebar]').click()`); await sleep(300)
const open = await strip()
ok("it is back", (await js(`document.querySelectorAll('.sidebar').length`)) === 1)
ok("the toggle's row does not depend on the sidebar being open (y)", open.sidebar.y === shut.sidebar.y, `${open.sidebar.y} vs ${shut.sidebar.y}`)
// (On a Mac the row starts after the traffic lights while the sidebar is shut — the sidebar's own bar carries them when it is open.)
const lights = await js(`document.querySelector('.app').classList.contains('mac')`) ? 72 : 0
ok("x moves only by the sidebar's own width (less the traffic lights' room on a Mac)", Math.abs((open.sidebar.x - shut.sidebar.x) - (sidebarWidth - lights)) < 8, `${open.sidebar.x} vs ${shut.sidebar.x} (sidebar ${sidebarWidth}, lights ${lights})`)

// ---- B. the sidebar's own bar
// (docs/PLAN-bars-2026-10.md P3, CHANGED: it was 44 tall and read edit · new section · markdown · video, right-aligned. It is the Mac's 36px bar now:
// a search field, +, the pencil. New Section is in the + menu; the markdown and video buttons are the tab row's, to the right of the sidebar's button.)
const bar = await J(`(() => { const s = document.querySelector('.sidebar-bar'); const r = s.getBoundingClientRect(); return { h: r.height, kids: [...s.querySelectorAll('[data-bar],[data-sidebar=search]')].map(b => b.dataset.bar ?? b.dataset.sidebar) } })()`)
ok("the sidebar bar is 36 tall", Math.round(bar.h) === 36, JSON.stringify(bar))
ok("search, +, the pencil, in that order", JSON.stringify(bar.kids) === JSON.stringify(["search", "new-note", "edit"]), JSON.stringify(bar.kids))
const topText = await js(`document.querySelector('.top-bar').innerText`)
ok("no rendered-page toggle or PDF button left in the text bar", !topText.includes("◧") && !topText.includes("PDF") && !topText.includes("◉"), topText)
ok("the markdown toggle and the video switch are not on the sidebar's bar", await js(`!document.querySelector('.sidebar-bar [data-bar=markdown]') && !document.querySelector('.sidebar-bar [data-bar=video]')`))

// ---- C. groups, in the Mac's order, each collapsible and remembered
const groups = await J(`[...document.querySelectorAll('.bar-group')].map(g => g.dataset.group)`)
ok("groups in the Mac's order", JSON.stringify(groups) === JSON.stringify(["style", "structure", "insert", "maths", "flowchart", "capture"]), groups.join())
const before = await J(`document.querySelector('[data-group=structure]').querySelectorAll('button:not(.bar-grip)').length`)
await js(`document.querySelector('[data-grip=structure]').click()`); await sleep(200)
const after = await J(`document.querySelector('[data-group=structure]').querySelectorAll('button:not(.bar-grip)').length`)
ok("the grip collapses a group to one icon", before > 4 && after === 1, `${before} -> ${after}`)
await reloadApp()
await openHead()
ok("and the collapse is remembered", await js(`document.querySelector('[data-group=structure]').classList.contains('away')`))
await js(`document.querySelector('[data-group=structure] .away-icon').click()`); await sleep(200)
ok("the icon brings it back", !(await js(`document.querySelector('[data-group=structure]').classList.contains('away')`)))
await js(`document.querySelector('.top-bar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 50 }))`); await sleep(150)
ok("the bar's context menu lists the six sections", (await js(`document.querySelectorAll('.bar-context label').length`)) === 6)
await js(`document.querySelector('.bar-context [data-section=maths]').click()`); await sleep(150)
ok("and unticking one puts it away", await js(`document.querySelector('[data-group=maths]').classList.contains('away')`))
await js(`document.querySelector('[data-group=maths] .away-icon').click()`); await sleep(150)

// ---- D. one press = one action
await js(`document.querySelector('.cm-content').focus()`)
const s0 = await state()
await key("k", { ctrl: true }); await sleep(250)
const s1 = await state()
ok("Ctrl+K toggles the sidebar exactly once", s0.sidebar === true && s1.sidebar === false, JSON.stringify([s0.sidebar, s1.sidebar]))
await key("k", { ctrl: true }); await sleep(250)
ok("and again brings it back", (await state()).sidebar === true)
await js(`document.querySelector('.cm-content').focus()`)
await key("t", { ctrl: true }); await sleep(250)
ok("Ctrl+T toggles the rendered page once", (await state()).rendered === true)
await key("t", { ctrl: true }); await sleep(250)
ok("and back to the markdown", (await state()).rendered === false)
// bold: CodeMirror's key. If the page ALSO ran it, the markers would cancel out.
await selectWord()
const plain = (await state()).doc
await key("b", { ctrl: true }); await sleep(200)
const bold = (await state()).doc
ok("Ctrl+B bolds once (not twice)", bold.includes("**body** one"), bold.slice(0, 80))
await key("z", { ctrl: true }); await sleep(200)
ok("Ctrl+Z takes it back in one press", (await state()).doc === plain)
// the menu's Bold is the same function
await selectWord()
ok("the menu item exists and is pressed", await menuClick("bold"))
await sleep(300)
ok("Format > Bold does what the key does", (await state()).doc.includes("**body** one"))
await menuClick("undo"); await sleep(300)
ok("Edit > Undo takes the menu's bold back", (await state()).doc === plain)

// ---- E. the menu drives the page, and the menu follows the page
ok("menu says Hide Notes Sidebar", (await label("View", /Notes Sidebar/)) === "Hide Notes Sidebar")
await menuClick("toggleSidebar"); await sleep(500)
ok("View > Hide Notes Sidebar hides it", (await state()).sidebar === false)
ok("the item now reads Show Notes Sidebar", (await label("View", /Notes Sidebar/)) === "Show Notes Sidebar", await label("View", /Notes Sidebar/))
await menuClick("toggleSidebar"); await sleep(500)
await menuClick("toggleMode"); await sleep(500)
ok("View > Markdown Preview renders the page", (await state()).rendered === true)
ok("and reads Show Markdown Editor", (await label("View", /Markdown (Preview|Editor)/)) === "Show Markdown Editor")
await menuClick("toggleMode"); await sleep(400)
await menuClick("foldAll"); await sleep(400)
ok("View > Fold All Sections folds", (await js(`document.querySelectorAll('.wm-folded').length`)) > 0)
await menuClick("unfoldAll"); await sleep(300)
ok("Unfold All Sections unfolds", (await js(`document.querySelectorAll('.wm-folded').length`)) === 0)
await menuClick("toggleEditorPane"); await sleep(400)
ok("Hide Notes Pane forces the video up (never both away)", await js(`getComputedStyle(document.querySelector('.pane')).display === 'none' && !!document.querySelector('.camera')`))
await menuClick("toggleEditorPane"); await sleep(300)
await menuClick("toggleCamera"); await sleep(400)
ok("Hide Video puts the camera pane away", !(await js(`!!document.querySelector('.camera')`)))

// ---- F. edit mode in the sidebar
await js(`document.querySelector('[data-bar=edit]').click()`); await sleep(300)
const rowsBefore = await J(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)
ok("Edit Notes shows duplicate and trash on every note row", (await js(`document.querySelectorAll('.note-row [data-duplicate]').length`)) === rowsBefore.length && rowsBefore.length > 3)
const target = rowsBefore.find((p) => /Third/.test(p))
const q = (s) => JSON.stringify(s)
await js(`[...document.querySelectorAll('[data-duplicate]')].find(b => b.dataset.duplicate === ${q(target)}).click()`); await sleep(900)
const rowsDup = await J(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)
const copy = rowsDup.find((p) => /Third copy/.test(p))
ok("Duplicate adds 'Third copy' beside the note", !!copy && rowsDup.length === rowsBefore.length + 1, rowsDup.join())
ok("right after it in the list", rowsDup.indexOf(copy) === rowsDup.indexOf(target) + 1)
const trash = `[...document.querySelectorAll('[data-trash]')].find(b => b.dataset.trash === ${q("note:" + copy)})`
await js(`${trash}.click()`); await sleep(200)
ok("the first click on the trash only arms it (red)", (await js(`${trash}.classList.contains('armed')`)) && (await J(`document.querySelectorAll('.note-row').length`)) === rowsDup.length)
await js(`${trash}.click()`); await sleep(1200)
const rowsEnd = await J(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path)`)
ok("the second click moves it to the trash", !rowsEnd.some((p) => /Third copy/.test(p)) && rowsEnd.length === rowsBefore.length, rowsEnd.join())
await shot("edit")
await js(`document.querySelector('[data-bar=edit]').click()`); await sleep(200)
ok("Done Editing takes them away", (await js(`document.querySelectorAll('[data-duplicate]').length`)) === 0)
finish()
