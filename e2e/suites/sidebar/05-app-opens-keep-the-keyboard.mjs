// AN OPEN THE APP MAKES BY ITSELF DOES NOT TAKE THE KEYBOARD FROM A FIELD THAT HAS IT. The launch opens a note on its own — the
// session's note in front, or the project's first note when there is none to bring back (useSession.ts `restore`, the Mac's
// `selection = notes.first`) — and so does the folder when the note in front leaves it (App.tsx `keepOnly`). Both used to give it
// the keyboard as if the person had opened it, and on the Windows runner the launch's open came seconds after 3,000 rows were
// drawn, after the first letter of a search: the rest went into the note (sidebar/04, 2026-10-17). Here the race is run on
// purpose, on every machine: the session read is held back (perfProbe.ts `hold`) so the search has begun before the launch's note
// opens, and the note in front is taken off the disk between two letters. And the other half: with nothing else holding the
// keyboard the app's open still gives it to the note, and an open the person makes always does (focusReturn.ts `openTakesKeyboard`).
// @e2e timeout=150
import fs from "node:fs"
import { ok, test, finish, js, sleep, key, typeText, waitFor, send, appReady, writeNoteFile, removeNoteFile, resetNotes, reloadApp, closeAllTabs, menuClick, openNote, shot } from "../../lib/harness.mjs"

const SEED = {
  "Alpha.wm": "# Alpha\nalpha words here\n",
  "Beta.wm": "# Beta\nbeta words here\n",
  "Gamma.wm": "# Gamma\ngamma words here\n",
}
await resetNotes({ reload: false })
const now = Date.now() / 1000
// (ages, so the tree's order is known: the newest first, Alpha)
for (const [i, [rel, text]] of Object.entries(SEED).entries()) fs.utimesSync(await writeNoteFile(rel, text), now - 10 * (i + 1), now - 10 * (i + 1))
await reloadApp()
if (await js(`!!document.querySelector('.camera')`)) { await menuClick("toggleCamera"); await sleep(300) }

const FIELD = `document.querySelector('[data-sidebar=search]')`
const IN_SEARCH = "sidebar search"
/** Where the keyboard is, what is in the search, which note is in front and what is in it. */
const state = async () => JSON.parse(await js(`JSON.stringify((() => {
  const a = document.activeElement
  const editor = document.querySelector('.cm-content')
  return {
    keyboard: a?.closest('.cm-content') ? 'notes' : a?.dataset?.sidebar ? 'sidebar ' + a.dataset.sidebar : a?.dataset?.keys ? 'keys ' + a.dataset.keys : a?.tagName ?? null,
    field: ${FIELD}?.value ?? null,
    front: document.querySelector('.tab.open')?.title.replace(/\\\\/g, '/').split('/').pop() ?? null,
    tabs: document.querySelectorAll('.tab[data-path]').length,
    editor: !!editor,
    text: editor ? editor.cmTile.view.state.doc.toString() : null,
  }
})())`))
const front = (rel) => `(document.querySelector('.tab.open')?.title.endsWith(${JSON.stringify(rel)}) ?? false)`
const hasRow = (rel) => `[...document.querySelectorAll('.note-row')].some((r) => r.dataset.path?.endsWith(${JSON.stringify(rel)}))`
const clearSearch = async () => {
  await js(`(() => { const i = ${FIELD}; i.focus(); i.select() })()`)
  await key("Backspace"); await sleep(300)
  await js(`document.activeElement?.blur()`)
}

/**
 * A launch, with the session read held back `ms` (perfProbe.ts `hold`): the page and its rows come up, and the launch's note
 * opens that much later — what 3,000 notes on a slow disk did on the Windows runner.
 */
async function heldLaunch(ms) {
  ok("(the session read can be held back)", (await js(`window.wm.e2ePerf('hold', { channel: 'session:read', ms: ${ms} })`)) === true)
  await js(`window.__beforeReload = true`)
  await send("Page.reload")
  await waitFor(`!window.__beforeReload`, 20000)
  await appReady()
  await waitFor(`!!${FIELD} && document.querySelectorAll('.note-row').length >= ${Object.keys(SEED).length}`, 15000)
}

await test("at launch with no session to bring back: a search begun before the project's first note opens keeps every letter", async () => {
  await closeAllTabs(); await sleep(800)
  await heldLaunch(2500)
  ok("(the launch's note is not open yet)", !(await state()).editor)
  await js(`${FIELD}.focus()`)
  await typeText("wor")
  const early = await state()
  ok("the first letters are in the search, typed before the launch's note opened", early.field === "wor" && !early.editor, JSON.stringify(early))
  await waitFor(`!!document.querySelector('.cm-content')`, 10000)
  await sleep(300)
  const opened = await state()
  ok("the launch still opens the project's first note", opened.editor && opened.front === "Alpha.wm", JSON.stringify(opened))
  ok("…and the keyboard stays in the search", opened.keyboard === IN_SEARCH, JSON.stringify(opened))
  await typeText("ds")
  await sleep(300)
  const after = await state()
  ok("the rest of the letters go into the search as well", after.field === "words", JSON.stringify(after))
  ok("…and none of them into the note", after.text === SEED["Alpha.wm"], JSON.stringify(after.text))
  // The person opens a note while the field has the keyboard: the keyboard goes into the note, as it always did.
  await clearSearch()
  await js(`${FIELD}.focus()`)
  ok("(the field has the keyboard, the tree is back)", (await state()).keyboard === IN_SEARCH && (await js(`document.querySelectorAll('.note-row').length`)) >= 3)
  await openNote("Beta")
  await waitFor(front("Beta.wm"), 8000)
  await sleep(300)
  const picked = await state()
  ok("a note the person opens takes the keyboard from the field", picked.front === "Beta.wm" && picked.keyboard === "notes", JSON.stringify(picked))
})

await test("at launch with the session's tabs to bring back: the note in front comes back without taking the search's letters", async () => {
  // Alpha (the launch's), Beta (the person's) and Gamma, Gamma in front.
  await openNote("Gamma")
  await waitFor(front("Gamma.wm"), 8000)
  await sleep(800)
  await heldLaunch(2500)
  await js(`${FIELD}.focus()`)
  await typeText("he")
  const early = await state()
  ok("the first letters are in the search, typed before the session's note came back", early.field === "he" && !early.editor, JSON.stringify(early))
  await waitFor(`!!document.querySelector('.cm-content')`, 10000)
  await sleep(300)
  const opened = await state()
  ok("the session's three tabs come back, Gamma in front", opened.front === "Gamma.wm" && opened.tabs === 3, JSON.stringify(opened))
  ok("…and the keyboard stays in the search", opened.keyboard === IN_SEARCH, JSON.stringify(opened))
  await typeText("re")
  await sleep(300)
  const after = await state()
  ok("every letter is in the search", after.field === "here", JSON.stringify(after))
  ok("…and none in the note", after.text === SEED["Gamma.wm"], JSON.stringify(after.text))
  await clearSearch()
})

await test("at launch with nothing else holding the keyboard: the note the launch opens takes it, as it always did", async () => {
  await heldLaunch(1200)
  await waitFor(`!!document.querySelector('.cm-content')`, 10000)
  await sleep(300)
  const opened = await state()
  ok("the note in front came back and has the keyboard", opened.front === "Gamma.wm" && opened.keyboard === "notes", JSON.stringify(opened))
})

await test("the note in front leaves the folder while a search is typed: the first tab left comes forward, the letters stay in the search", async () => {
  ok("(Alpha, Beta and Gamma are open, Gamma in front)", (await state()).front === "Gamma.wm" && (await state()).tabs === 3, JSON.stringify(await state()))
  await js(`${FIELD}.focus()`)
  await typeText("wo")
  await removeNoteFile("Gamma.wm")
  await waitFor(front("Alpha.wm"), 10000)
  await sleep(300)
  const moved = await state()
  ok("the first tab left comes forward", moved.front === "Alpha.wm", JSON.stringify(moved))
  ok("…and the keyboard stays in the search", moved.keyboard === IN_SEARCH, JSON.stringify(moved))
  await typeText("rds")
  await sleep(300)
  const after = await state()
  ok("every letter is in the search", after.field === "words", JSON.stringify(after))
  ok("…and none in the note that came forward", after.text === SEED["Alpha.wm"], JSON.stringify(after.text))
  await clearSearch()
  await writeNoteFile("Gamma.wm", SEED["Gamma.wm"])
})

await test("the note in front leaves the folder while a dialog's field has the keyboard: the field keeps it", async () => {
  await waitFor(hasRow("Gamma.wm"), 10000)
  await openNote("Gamma")
  await waitFor(front("Gamma.wm"), 8000)
  await menuClick("keyList")
  await waitFor(`document.activeElement?.dataset?.keys === 'search'`, 4000)
  await typeText("bo")
  await removeNoteFile("Gamma.wm")
  await waitFor(front("Alpha.wm"), 10000)
  await sleep(300)
  const moved = await state()
  ok("the first tab left comes forward behind the dialog, and the dialog's field keeps the keyboard",
    moved.front === "Alpha.wm" && moved.keyboard === "keys search" && (await js(`!!document.querySelector('[data-modal=keys]')`)), JSON.stringify(moved))
  await typeText("ld")
  await sleep(200)
  ok("every letter is in the dialog's field", (await js(`document.querySelector('[data-keys=search]')?.value`)) === "bold", await js(`document.querySelector('[data-keys=search]')?.value`))
  ok("…and none in the note", (await state()).text === SEED["Alpha.wm"], JSON.stringify((await state()).text))
  await key("Escape"); await sleep(200); await key("Escape"); await sleep(400)
  ok("(the dialog is put away)", !(await js(`!!document.querySelector('[data-modal=keys]')`)))
  await writeNoteFile("Gamma.wm", SEED["Gamma.wm"])
})

await test("the note in front leaves the folder while it has the keyboard: the first tab left takes it", async () => {
  await waitFor(hasRow("Gamma.wm"), 10000)
  await openNote("Gamma")
  await waitFor(`${front("Gamma.wm")} && !!document.activeElement?.closest('.cm-content')`, 8000)
  await removeNoteFile("Gamma.wm")
  await waitFor(front("Alpha.wm"), 10000)
  await sleep(300)
  const moved = await state()
  ok("the first tab left comes forward with the keyboard (nothing else had it)", moved.front === "Alpha.wm" && moved.keyboard === "notes", JSON.stringify(moved))
})

await shot("app-opens")
finish()
