// What the undo scripts (suites/undo/) do to the notes, through the page's own controls and real input: the sidebar's
// right-click menu and its Rename / Trash dialogs, edit mode's two-click trash, a drag onto a section, real keys. Only
// stable hooks are used (`.note-row[data-path]`, `.section-row[data-path]`, `data-bar="edit"`, `data-trash`,
// `data-modal`, the menu's role="menuitem" labels), so a change to how the sidebar looks leaves these alone.
import fs from "node:fs"
import path from "node:path"
import { click, js, key, rightClick, sleep, typeText, until, notesDir, doc, VIEW } from "./harness.mjs"
import { readWm } from "./wm.mjs"

const norm = (value) => String(value).replace(/\\/g, "/")

/** The notes folder's files, as relative slash paths (hidden folders left out). */
export async function listing() {
  const root = await notesDir()
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".")) continue
      const full = path.join(dir, entry.name)
      out.push(norm(path.relative(root, full)) + (entry.isDirectory() ? "/" : ""))
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(root)
  return out
}

/** The words of a note on disk. */
export async function textOnDisk(rel) {
  return readWm(path.join(await notesDir(), rel)).text
}

/** The rows the sidebar shows, as relative paths (notes and sections). */
export async function sidebarRows() {
  const root = norm(await notesDir())
  return JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.note-row, .section-row')].map(r => r.dataset.path))`))
    .map((one) => norm(one).replace(root + "/", ""))
}

/** The title of the tab in front. */
export const frontTab = () => js(`document.querySelector('.tab.open')?.textContent ?? null`)

/** How many tabs there are. */
export const tabCount = () => js(`document.querySelectorAll('.tab').length`)

/** The footer's file name (the open note's file). */
export const footerName = () => js(`document.querySelector('.footer span')?.textContent ?? null`)

const rowRect = (rel) => js(`(() => {
  const want = ${JSON.stringify(norm(rel))}
  const row = [...document.querySelectorAll('.note-row, .section-row')].find(r => r.dataset.path.replace(/\\\\/g, '/').endsWith('/' + want))
  if (!row) return null
  row.scrollIntoView({ block: 'center' })
  const r = row.getBoundingClientRect()
  return JSON.stringify({ x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 })
})()`).then((text) => (text ? JSON.parse(text) : null))

/** Click an item of the menu that is up (by its label), with a real mouse. */
export async function menuPick(label) {
  const at = await js(`(() => {
    const items = [...document.querySelectorAll('.float-menu [role=menuitem], .float-menu [role=menuitemcheckbox]')]
    const item = items.find(i => (i.querySelector('.float-label')?.textContent ?? i.textContent).trim().startsWith(${JSON.stringify(label)}))
    if (!item) return null
    const r = item.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`)
  if (!at) throw new Error(`no menu item “${label}”`)
  const { x, y } = JSON.parse(at)
  await click(x, y)
  await sleep(200)
}

/** Answer the dialog that is up: type a name (when it has a field) and press its default button. */
export async function answerPrompt(name) {
  await until(() => js(`!!document.querySelector('[data-modal=prompt]')`), 4000, 50)
  if (name !== undefined) {
    // The field starts with its text selected; real keys replace it.
    await typeText(name)
  }
  const ok = await js(`(() => { const b = document.querySelector('[data-modal=ok]'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  const { x, y } = JSON.parse(ok)
  await click(x, y)
  await until(() => js(`!document.querySelector('[data-modal=prompt]')`), 6000, 50)
  await sleep(500)
}

/** Rename… on a note's row (the right-click menu and its dialog). */
export async function renameNote(rel, name) {
  const at = await rowRect(rel)
  await rightClick(at.x, at.y)
  await menuPick("Rename")
  await answerPrompt(name)
}

/** Move to Trash… on a note's row (the right-click menu and its confirmation). */
export async function trashNoteViaMenu(rel) {
  const at = await rowRect(rel)
  await rightClick(at.x, at.y)
  await menuPick("Move to")
  // (the menu has a "Move to" submenu too: the trash item is the one that ends in … )
}

/** Edit mode's two clicks on a row's trash button. */
export async function trashNoteViaEditMode(rel) {
  const root = norm(await notesDir())
  const edit = await js(`document.querySelector('[data-bar=edit]')?.classList.contains('on') ?? false`)
  if (!edit) { await js(`document.querySelector('[data-bar=edit]').click()`); await sleep(250) }
  const at = JSON.parse(await js(`(() => {
    const want = ${JSON.stringify(norm(rel))}
    const b = [...document.querySelectorAll('[data-trash]')].find(b => b.dataset.trash.replace(/\\\\/g, '/').endsWith('/' + want))
    if (!b) return 'null'
    const r = b.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`))
  if (!at) throw new Error(`no trash button for ${rel} in ${root}`)
  await click(at.x, at.y)
  await sleep(200)
  const again = JSON.parse(await js(`(() => {
    const want = ${JSON.stringify(norm(rel))}
    const b = [...document.querySelectorAll('[data-trash]')].find(b => b.dataset.trash.replace(/\\\\/g, '/').endsWith('/' + want))
    const r = b.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`))
  await click(again.x, again.y)
  await sleep(700)
  await js(`document.querySelector('[data-bar=edit]').click()`)
  await sleep(250)
}

/** Drop a note's row (or a section's) on another row, as the sidebar's own drag does. */
export async function dragRow(from, to) {
  const result = await js(`(async () => {
    const q = (p) => [...document.querySelectorAll('[data-path]')].find(e => e.dataset.path.replace(/\\\\/g, '/').endsWith('/' + p) && (e.classList.contains('note-row') || e.classList.contains('section-row')))
    const src = q(${JSON.stringify(norm(from))}), tgt = q(${JSON.stringify(norm(to))})
    if (!src || !tgt) return 'missing ' + (!src ? 'src ' : '') + (!tgt ? 'tgt' : '')
    const dt = new DataTransfer()
    const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    ev(src, 'dragstart'); await new Promise(r => setTimeout(r, 30)); ev(tgt, 'dragenter'); ev(tgt, 'dragover')
    await new Promise(r => setTimeout(r, 30)); ev(tgt, 'drop'); ev(src, 'dragend')
    return 'ok' })()`)
  if (result !== "ok") throw new Error(result)
  await sleep(1000)
}

/** Open a note by its row. */
export async function openRow(rel) {
  const at = await rowRect(rel)
  await click(at.x, at.y)
  await sleep(700)
}

/** Put the caret at the end of the open note and type there with real keys; waits for the save. */
export async function typeAtEnd(text) {
  await js(`${VIEW}.focus(); ${VIEW}.dispatch({ selection: { anchor: ${VIEW}.state.doc.length } })`)
  await sleep(100)
  await typeText(text)
  await sleep(900)
}

/** Ctrl+Z / Ctrl+Shift+Z, one press, and time to settle. */
export async function undoKey() { await key("z", { ctrl: true }); await sleep(900) }
export async function redoKey() { await key("z", { ctrl: true, shift: true }); await sleep(900) }

/** The open note's words as the editor has them. */
export const words = () => doc()

/** What Edit ▸ Undo and Redo say now (the application menu, read from the shell). */
export async function historyMenu() {
  const menu = JSON.parse(await js(`window.wm.e2eMenu().then(JSON.stringify)`))
  const edit = menu.find((top) => top.label === "Edit")?.submenu ?? []
  const pick = (id) => edit.find((item) => item.id === id)
  return { undo: pick("undo"), redo: pick("redo") }
}

/** The journal's state, as the page asks the shell for it. */
export const journalState = () => js(`window.wm.undo.state()`)

/** The backups the journal holds right now, by step folder (the instance's own user-data folder). */
export async function backupFolders() {
  const dir = path.join(process.env.WM_INSTANCE_DIR || "", "profile", "undo")
  if (!process.env.WM_INSTANCE_DIR || !fs.existsSync(dir)) return null
  return fs.readdirSync(dir).flatMap((run) => fs.readdirSync(path.join(dir, run)).map((step) => path.join(run, step)))
}
