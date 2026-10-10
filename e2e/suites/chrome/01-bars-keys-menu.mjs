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

// ---- A. the text bar starts with the Style button (the sidebar's switch is the tab row's: docs/PLAN-bars-2026-10.md P2)
const first = await J(`(() => { const b = document.querySelector('.top-bar').firstElementChild; const r = b.getBoundingClientRect(); return { bar: b.dataset.bar, h: document.querySelector('.top-bar').getBoundingClientRect().height } })()`)
ok("the text bar starts with the Style button (BEHAVIOUR CHANGE: the sidebar's switch left it)", first.bar === "style", JSON.stringify(first))
ok("and is one 36px row", Math.round(first.h) === 36, JSON.stringify(first))

// ---- B. the sidebar's own bar
const bar = await J(`(() => { const s = document.querySelector('.sidebar-bar'); const r = s.getBoundingClientRect(); return { h: r.height, right: r.right, kids: [...s.querySelectorAll('[data-bar]')].map(b => b.dataset.bar), last: [...s.querySelectorAll('button')].pop().getBoundingClientRect().right, first: s.querySelector('[data-bar]').getBoundingClientRect().left } })()`)
ok("the sidebar bar is 44 tall", Math.round(bar.h) === 44 || Math.round(bar.h) === 45, JSON.stringify(bar))
ok("edit, new section, markdown, video, in that order", JSON.stringify(bar.kids) === JSON.stringify(["edit", "new-section", "markdown", "video", "video-options"]), JSON.stringify(bar.kids))
ok("right-aligned", bar.right - bar.last < 12 && bar.first > 100, JSON.stringify(bar))
const topText = await js(`document.querySelector('.top-bar').innerText`)
ok("no rendered-page toggle or PDF button left in the text bar", !topText.includes("◧") && !topText.includes("PDF") && !topText.includes("◉"), topText)
ok("the markdown toggle and the video switch moved to the sidebar", await js(`!!document.querySelector('.sidebar-bar [data-bar=markdown]') && !!document.querySelector('.sidebar-bar [data-bar=video]')`))

// ---- C. four sections (Text, Blocks, Insert, Pen), put away in the Customize checklist and remembered; no grips
const sectionsOpen = () => js(`document.querySelectorAll('.bar-context label').length`)
await js(`document.querySelector('.top-bar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 50 }))`); await sleep(150)
ok("the bar's context menu is the Customize checklist: four sections", (await sectionsOpen()) === 4)
ok("named Text, Blocks, Insert and Pen", JSON.stringify(await J(`[...document.querySelectorAll('.bar-context label')].map(l => l.textContent.trim())`)) === JSON.stringify(["Text", "Blocks", "Insert", "Pen"]))
ok("no grips on the bar (a put-away section is shown only in the checklist)", (await js(`document.querySelectorAll('.bar-grip, .bar-group, .away-icon').length`)) === 0)
const listBefore = await js(`!!document.querySelector('[data-bar=list]')`)
await js(`document.querySelector('.bar-context [data-section=blocks]').click()`); await sleep(200)
ok("unticking Blocks puts List, Quote and Code away", listBefore && !(await js(`!!document.querySelector('[data-bar=list]') || !!document.querySelector('[data-bar=quote]') || !!document.querySelector('[data-bar=code]')`)))
ok("the Style button and the pen stay", await js(`!!document.querySelector('[data-bar=style]') && !!document.querySelector('[data-bar=pen]')`))
await reloadApp()
await openHead()
ok("and the put-away is remembered", !(await js(`!!document.querySelector('[data-bar=list]')`)))
await js(`document.querySelector('.top-bar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 50 }))`); await sleep(150)
await js(`document.querySelector('.bar-context [data-section=blocks]').click()`); await sleep(200)
ok("ticking it brings it back", await js(`!!document.querySelector('[data-bar=list]')`))
await key("Escape"); await sleep(150)
ok("Escape puts the checklist away", (await sectionsOpen()) === 0)
// what the six old sections had put away is migrated once, to the four
await js(`localStorage.removeItem('writemind.toolSections'); localStorage.setItem('writemind.collapsedGroups', JSON.stringify(['structure']))`)
await reloadApp()
await openHead()
ok("an old 'Structure' put away comes up as 'Blocks' put away", !(await js(`!!document.querySelector('[data-bar=list]')`)) && await js(`!!document.querySelector('[data-bar=pen]')`))
await js(`localStorage.removeItem('writemind.toolSections'); localStorage.setItem('writemind.collapsedGroups', '[]')`)
await reloadApp()
await openHead()

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
