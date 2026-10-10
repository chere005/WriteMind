// Shared by the integration scripts (docs/PLAN-bars-2026-10.md; Sean, 2026-10-10: "make sure the cell behavior, moving the input
// cursor, search, and undo are all implemented properly.. make sure undo is always able to undo up to 3 steps, even if it
// involves file changes"). Everything here is a person's gesture, made through the page's own controls with the real mouse and
// real keys (the harness turns a Ctrl chord into the Mac's own); the only reads are of the page (the editor, the sidebar, the tab
// row) and of the notes folder on disk, so a change to how something LOOKS leaves these alone while a change to what it DOES fails.
//
//   world()          the whole picture in one read: the tab in front, its words, its caret, the keyboard, the files on disk
//                    (with each note's words), the sidebar's rows
//   expectWorld()    one check per part of that picture, named, so a failure says which part is wrong and after which step
//   the surfaces     tabMenu / rowMenu / plusMenu / styleMenu / seamPick / toolbar / find card / inspector / the sidebar search
import fs from "node:fs"
import path from "node:path"
import {
  ok, js, sleep, key, typeText, click, rightClick, hover, centerOf, clickEl, doc, sel, notesDir, until, waitFor, VIEW, lineBoxes,
  setRendered, shot, closeAllTabs, resetNotes, writeNoteFile, reloadApp, armed, arm, canvasBox, drag,
} from "../../lib/harness.mjs"
import { readWm } from "../../lib/wm.mjs"
import { answerPrompt, listing, sidebarRows } from "../../lib/undoSteps.mjs"

export { listing, sidebarRows, answerPrompt }

const norm = (value) => String(value).replace(/\\/g, "/")
export const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))

// ---------------------------------------------------------------------------------------------------------------
// Starting clean
// ---------------------------------------------------------------------------------------------------------------
/** A notes folder holding `files` ({ "Name.md": text }), no tabs, no video pane, the sidebar showing the tree; the first file open if `open`. */
export async function start(files, { open = true, rendered = false } = {}) {
  await resetNotes({ reload: false })
  for (const [rel, text] of Object.entries(files)) await writeNoteFile(rel, text)
  await reloadApp()
  await js(`localStorage.clear()`)
  await closeAllTabs()
  if (await js(`!!document.querySelector('.camera')`)) { await clickEl("[data-bar=video]"); await sleep(400) }
  if (open) await openByRow(Object.keys(files)[0].replace(/\.(md|wm)$/, ".wm"))
  if (rendered) await setRendered(true)
  await sleep(300)
}

// ---------------------------------------------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------------------------------------------
/** The words of every note on disk, by relative path (a file that is not a readable note says so instead). */
export async function disk() {
  const root = await notesDir()
  const out = {}
  for (const rel of await listing()) {
    if (rel.endsWith("/") || !rel.endsWith(".wm")) continue
    try { out[rel] = readWm(path.join(root, rel)).text } catch (error) { out[rel] = `<<unreadable: ${error.message}>>` }
  }
  return out
}

/** How many drawing objects each note on disk holds (its drawing.json), by relative path. */
export async function inkOnDisk() {
  const root = await notesDir()
  const out = {}
  for (const rel of await listing()) {
    if (rel.endsWith("/") || !rel.endsWith(".wm")) continue
    try { const drawing = readWm(path.join(root, rel)).drawing; out[rel] = drawing ? (JSON.parse(drawing).items ?? []).length : 0 } catch { out[rel] = -1 }
  }
  return out
}

/** Is the keyboard in the notes (the editor has the focus)? */
export const inNotes = () => js(`!!document.activeElement?.closest('.cm-content')`)

/** What the person would see and what is on disk, right now. */
export async function world() {
  // (A save writes a temporary file beside the note and renames it over: a picture taken in that instant is of the writer's
  // scaffolding. One that stays is a real finding — it is then in the `files` check.)
  // (The autosave starts 500 ms after the last edit: a picture taken before it has even begun would see no scaffolding yet and then, a
  // moment later in the same call, the writer's temporary file. So wait past the debounce first, then for the scaffolding to go.)
  await sleep(700)
  for (let i = 0; i < 25 && (await listing()).some((rel) => /\.tmp$/.test(rel)); i++) await sleep(200)
  const hasEditor = await js(`!!document.querySelector('.cm-content')`)
  return {
    front: await js(`document.querySelector('.tab.open .name')?.textContent ?? null`),
    tabs: await J(`[...document.querySelectorAll('.tab .name')].map(n => n.textContent)`),
    text: hasEditor ? await doc() : null,
    caret: hasEditor ? await sel() : null,
    notes: hasEditor ? await inNotes() : false,
    files: await listing(),
    rows: await sidebarRows(),
    disk: await disk(),
    ink: await inkOnDisk(),
    footer: await js(`document.querySelector('.footer span')?.textContent ?? null`),
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (value) => JSON.stringify(value)

/**
 * One named check per part of the picture the expectation names (`front`, `tabs`, `text`, `caret`, `notes` (keyboard in the notes),
 * `files`, `rows`, `disk` (a map of relative path → words), `footer`, `absent` (files that must not be there)).
 * `files` and `rows` are compared as sets of names, the order the sidebar shows being the sidebar's own business.
 */
export function expectWorld(label, got, want) {
  const all = []
  const check = (part, pass, detail) => all.push(ok(`${label}: ${part}`, pass, detail))
  if ("front" in want) check("the tab in front", got.front === want.front, `${got.front} vs ${want.front}`)
  if ("tabs" in want) check("the open tabs", same([...got.tabs].sort(), [...want.tabs].sort()), `${show(got.tabs)} vs ${show(want.tabs)}`)
  if ("text" in want) check("the words in the editor", got.text === want.text, `${show(got.text)} vs ${show(want.text)}`)
  if ("caret" in want) check("the caret", same(got.caret, want.caret), `${show(got.caret)} vs ${show(want.caret)}`)
  if ("notes" in want) check(want.notes ? "the keyboard is in the notes" : "the keyboard is not in the notes", got.notes === want.notes, `${got.notes}`)
  if ("files" in want) check("the files on disk", same([...got.files].sort(), [...want.files].sort()), `${show(got.files)} vs ${show(want.files)}`)
  if ("rows" in want) check("the sidebar's rows", same([...got.rows].sort(), [...want.rows].sort()), `${show(got.rows)} vs ${show(want.rows)}`)
  if ("disk" in want) {
    for (const [rel, text] of Object.entries(want.disk)) check(`${rel} on disk holds its words`, got.disk[rel] === text, `${show(got.disk[rel])} vs ${show(text)}`)
  }
  if ("ink" in want) {
    for (const [rel, count] of Object.entries(want.ink)) check(`${rel} holds ${count} drawing object(s)`, got.ink[rel] === count, `${got.ink[rel]} vs ${count}`)
  }
  if ("absent" in want) for (const rel of want.absent) check(`${rel} is not on disk`, !got.files.includes(rel), show(got.files))
  if ("footer" in want) check("the footer names the open file", got.footer === want.footer, `${got.footer} vs ${want.footer}`)
  return all.every(Boolean)
}

/** The expectation "it is as it was then": the named parts of an earlier picture. */
export function sameAs(label, got, ref, parts) {
  const want = {}
  for (const part of parts) want[part] = ref[part]
  if (parts.includes("disk")) want.disk = ref.disk
  return expectWorld(label, got, want)
}
export const ALL = ["front", "tabs", "text", "caret", "notes", "files", "rows", "disk", "footer"]

// ---------------------------------------------------------------------------------------------------------------
// Rows, tabs, menus
// ---------------------------------------------------------------------------------------------------------------
const rowAt = (rel) => js(`(() => {
  const want = ${JSON.stringify(norm(rel))}
  const row = [...document.querySelectorAll('.note-row, .section-row')].find(r => r.dataset.path.replace(/\\\\/g, '/').endsWith('/' + want))
  if (!row) return null
  row.scrollIntoView({ block: 'center' })
  const r = row.getBoundingClientRect()
  return JSON.stringify({ x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 })
})()`).then((text) => (text ? JSON.parse(text) : null))

/** Open a note by clicking its sidebar row. */
export async function openByRow(rel) {
  const at = await rowAt(rel)
  if (!at) throw new Error(`no sidebar row for ${rel}`)
  await click(at.x, at.y)
  await sleep(700)
}

const tabAt = (rel) => J(`(() => { const want = ${JSON.stringify(norm(rel))}; const t = [...document.querySelectorAll('.tab')].find(t => t.title.replace(/\\\\/g, '/').endsWith('/' + want)); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + 24, y: r.y + r.height / 2 } })()`)

/** Click a tab (by its note's file, "Alpha.wm") with the real mouse. A tab is titled by its note's first heading, so the file is the stable name. */
export async function clickTab(rel) {
  const at = await tabAt(rel)
  if (!at) throw new Error(`no tab ${rel}`)
  await click(at.x, at.y)
  await sleep(600)
}

/** The items of the menu that is up, top level. */
export const menuLabels = () => J(`[...document.querySelectorAll('.float-menu:not(.sub) > .float-row > button')].map(b => b.querySelector('.float-label').textContent)`)

/** Click an item of the menu that is up, by the start of its label, with the real mouse. A `sub` first hovers the row that opens a submenu. */
export async function menuItem(label, { sub = null } = {}) {
  const find = (inSub) => `(() => {
    const items = [...document.querySelectorAll(${JSON.stringify(inSub ? ".float-menu.sub [role=menuitem], .float-menu.sub [role=menuitemcheckbox]" : ".float-menu:not(.sub) [role=menuitem], .float-menu:not(.sub) [role=menuitemcheckbox]")})]
    const item = items.find(i => (i.querySelector('.float-label')?.textContent ?? i.textContent).trim() === ${JSON.stringify(inSub ? sub : label)})
    if (!item) return null
    item.scrollIntoView?.({ block: 'nearest' })
    const r = item.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`
  if (sub) {
    const parent = await js(find(false).replace(JSON.stringify(sub), JSON.stringify(label)).replace(/inSub/g, "false"))
    if (!parent) throw new Error(`no menu item “${label}”`)
    const p = JSON.parse(parent)
    await hover(p.x, p.y)
    await sleep(350)
    const child = await js(find(true))
    if (!child) throw new Error(`no submenu item “${sub}” under “${label}”`)
    const c = JSON.parse(child)
    await click(c.x, c.y)
    await sleep(400)
    return
  }
  const at = await js(find(false))
  if (!at) throw new Error(`no menu item “${label}”: ${await menuLabels()}`)
  const { x, y } = JSON.parse(at)
  await click(x, y)
  await sleep(400)
}

/** Right-click a tab and choose from its menu; `sub` for Move to ▸ a folder. */
export async function tabMenu(rel, label, opts) {
  const at = await tabAt(rel)
  if (!at) throw new Error(`no tab ${rel}`)
  await rightClick(at.x, at.y)
  await waitFor(`!!document.querySelector('#tab-menu')`)
  await menuItem(label, opts)
}

/** Right-click a note's (or a section's) sidebar row and choose from its menu. */
export async function rowMenu(rel, label, opts) {
  const at = await rowAt(rel)
  if (!at) throw new Error(`no sidebar row for ${rel}`)
  await rightClick(at.x, at.y)
  await waitFor(`!!document.querySelector('.float-menu')`)
  await menuItem(label, opts)
}

/** The sidebar's + menu (a right-click on it) and its item. */
export async function plusMenu(label) {
  const at = await centerOf("[data-bar=new-note]")
  await rightClick(at.x, at.y)
  await waitFor(`!!document.querySelector('.float-menu')`)
  await menuItem(label)
}

/** Answer the dialog that is up with a name (a Rename), or just its default button (a confirmation: Move to Trash). */
export async function dialog(name) {
  await until(() => js(`!!document.querySelector('[data-modal=prompt]')`), 4000, 50)
  await sleep(150)
  if (name !== undefined) {
    await js(`document.querySelector('[data-modal=prompt] input')?.select()`)
    await typeText(name)
  }
  const at = await centerOf("[data-modal=ok]")
  await click(at.x, at.y)
  await until(() => js(`!document.querySelector('[data-modal=prompt]')`), 6000, 50)
  await sleep(600)
}

// ---------------------------------------------------------------------------------------------------------------
// The editor: where the caret is, typing, the Style menu, the seam, the bar's buttons
// ---------------------------------------------------------------------------------------------------------------
export const caretTo = async (anchor, head = anchor) => {
  await js(`${VIEW}.focus(); ${VIEW}.dispatch({ selection: { anchor: ${anchor}, head: ${head} } })`)
  await sleep(150)
}
export const caretAtEnd = async () => caretTo(await js(`${VIEW}.state.doc.length`))

/** Put the caret just after `needle` (the first occurrence in the editor's words) — or `before` it. */
export async function caretAfter(needle, { before = false } = {}) {
  const text = await doc()
  const at = text.indexOf(needle)
  if (at < 0) throw new Error(`“${needle}” is not in ${JSON.stringify(text)}`)
  await caretTo(before ? at : at + needle.length)
}

/** Type with real keys and wait for the save (the debounce is 500 ms). */
export async function typeAndSettle(text) {
  await typeText(text)
  await sleep(900)
}

/** The Style button's menu: click it, click a row (`kind-heading-1`, `kind-quote`, `kind-ink`...). */
export async function styleMenu(kind) {
  await clickEl("[data-bar=style]")
  await waitFor(`!!document.querySelector('.float-menu')`)
  await sleep(150)
  await clickEl(`.float-menu [data-bar="kind-${kind}"]`)
  await sleep(500)
}

/** The kind the Style button says the caret is in. */
export const styleLabel = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)

/** A toolbar button (`table`, `textbox`, `secup`, `secdown`, `bold`...): a real click on it. */
export async function bar(name) {
  await clickEl(`[data-bar=${name}]`)
  await sleep(500)
}

/**
 * The y of the seam: the blank line at editor line `i`, or (given the words of a line instead) the blank line just above it. The
 * rendered page draws a closed cell as a block, not as a line, so the line numbers differ between the two sides: the seam above
 * the cell the caret is in is found by that cell's own words.
 */
export async function seamY(at = 1) {
  const lines = await lineBoxes()
  const i = typeof at === "string" ? lines.findIndex((l) => l[2] === at) - 1 : at
  if (i < 0 || !lines[i]) throw new Error(`no seam at ${JSON.stringify(at)} in ${JSON.stringify(lines)}`)
  return Math.round((lines[i][0] + lines[i][1]) / 2)
}
const marker = async () => J(`(() => { const e = document.querySelector('.wm-plus'); if (!e) return null; const r = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
/**
 * The seam's + at the blank line `i` (counting editor lines, 1 = the first blank line): hover the seam, press the marker, choose a
 * kind of the menu that opens. Returns false when there was no marker.
 */
export async function seamPick(label, i = 1, { onMenu = null } = {}) {
  const y = await seamY(i)
  const x = Math.round((await centerOf(".cm-content")).x)
  // (The pointer is moved away first: a move to where it already is says nothing to the page.)
  await hover(x, y + 80)
  await sleep(120)
  await hover(x, y)
  await sleep(250)
  const m = await marker()
  if (!m) return false
  await click(m.cx, m.cy)
  await waitFor(`!!document.querySelector('#seam-kinds')`)
  if (onMenu) await onMenu()
  await js(`[...document.querySelectorAll('#seam-kinds .float-label')].find(b => b.textContent === ${JSON.stringify(label)}).closest('button').click()`)
  await sleep(500)
  return true
}

// ---------------------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------------------
export async function undo() { await key("z", { ctrl: true }); await sleep(1000) }
export async function redo() { await key("z", { ctrl: true, shift: true }); await sleep(1000) }
export const mod = process.platform === "darwin" ? { meta: true } : { ctrl: true }

// ---------------------------------------------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------------------------------------------
export const findCard = () => J(`(() => { const f = document.querySelector('[data-bar=find]'); if (!f) return null; return { query: f.querySelector('input').value, count: f.querySelector('[data-find=count]')?.textContent ?? '', replacement: f.querySelectorAll('input')[1]?.value ?? null, focused: document.activeElement?.closest('[data-bar=find]') ? document.activeElement.getAttribute('aria-label') : null } })()`)
export async function openFind(replace = false) {
  await key(replace ? "h" : "f", { ctrl: true })
  await waitFor(`!!document.querySelector('[data-bar=find]')`)
  await sleep(300)
}
/** Type into the Find card's field (or its Replace field) with real keys. */
export async function findType(words, { field = "Find" } = {}) {
  await js(`(() => { const i = document.querySelector('[data-bar=find] input[aria-label="${field === "Find" ? "Find" : "Replace with"}"]'); i.focus(); i.select() })()`)
  await typeText(words)
  await sleep(400)
}
export async function findPress(what) { await clickEl(`[data-find=${what}]`); await sleep(350) }
export * from "../../lib/harness.mjs"

// ---------------------------------------------------------------------------------------------------------------
// The drawing layer (the rendered page): a shape from the bar's Shapes menu, the inspector over a picked object
// ---------------------------------------------------------------------------------------------------------------
/** Arm a shape from the Shapes menu and drag it out on the rendered page. */
export async function drawShape(kind = "rectangle", [x, y, w, h] = [300, 330, 240, 120]) {
  const box = await canvasBox()
  if (!(await arm(kind))) throw new Error(`no shape ${kind} in the Shapes menu`)
  await drag(box.x + x, box.y + y, box.x + x + w, box.y + y + h)
  await sleep(500)
}
/** Press a button of the inspector over the picked object (`duplicate`, `delete`, `colour`...) with the real mouse. */
export async function inspectorPress(what) {
  const at = await centerOf(`.wm-insp [data-insp="${what}"]`)
  if (!at) throw new Error(`no inspector button ${what}`)
  await click(at.x, at.y)
  await sleep(500)
}

// ---------------------------------------------------------------------------------------------------------------
// The sidebar's search
// ---------------------------------------------------------------------------------------------------------------
/** What the sidebar shows while a search is on: the rows (path, title, section, whether chosen), the field and the status lines. */
export const searchState = () => J(`(() => {
  const q = (s) => document.querySelector(s)
  return {
    field: q('[data-sidebar=search]')?.value ?? null,
    focus: document.activeElement?.dataset?.sidebar ?? '',
    results: !!q('.results'),
    tree: document.querySelectorAll('.note-row').length,
    hits: [...document.querySelectorAll('.hit-row')].map((r) => ({ path: r.dataset.hit.replace(/\\\\/g, '/'), title: r.querySelector('.title')?.textContent ?? '', where: r.querySelector('.where')?.textContent ?? '', active: r.classList.contains('active') })),
    status: q('[data-sidebar=no-matches]')?.textContent ?? q('[data-sidebar=searching]')?.textContent ?? null,
    unreadable: q('[data-sidebar=unreadable]')?.textContent ?? null,
    busy: q('.results')?.getAttribute('aria-busy') === 'true',
  }
})()`)
/** The file names (relative to the notes folder) the search is showing. */
export async function hitFiles() {
  const root = norm(await notesDir())
  return (await searchState()).hits.map((h) => h.path.replace(root + "/", "")).sort()
}
/** Type a query into the search field with real keys (⇧⌘F puts the caret there), and wait until the answer is for those words. */
export async function searchFor(words) {
  await key("f", { ctrl: true, shift: true })
  await sleep(250)
  await js(`(() => { const i = document.querySelector('[data-sidebar=search]'); i.focus(); i.select() })()`)
  await typeText(words)
  await settleSearch()
}
export async function settleSearch() {
  await sleep(400)
  await until(async () => !(await searchState()).busy, 8000, 100)
  await sleep(200)
}
