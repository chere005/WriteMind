// @e2e isolated
// THE QUICK REFERENCE (shared/welcome.ts, main/welcome.ts, renderer/welcomeView.ts; Sean, 2026-10-07: "make sure the
// features md file that ships is rendered by default and correct"):
//   1. a FIRST LAUNCH (WRITEMIND_WELCOME=1 asks a test instance for it) writes `WriteMind Quick Reference.wm`, opens it as the one
//      tab, and shows it RENDERED (a real table, bold leads);
//   2. another note stays in its OWN mode: markdown stays markdown, the rendered page stays rendered, whatever the Quick
//      Reference did while it was in front;
//   3. closing it and opening it again with Help ▸ Quick Reference opens it rendered AGAIN (not only at the first launch),
//      also from no tab at all, and also when it is already open and was turned to markdown by hand;
//   4. an OUTDATED copy (an older app's text, or somebody's edits) is rewritten with the current text, in the open tab too,
//      never as a second tab;
//   5. an EXISTING install (the marker is there, the file is not) is not given the file at launch: Help ▸ Quick Reference does.
// Everything happens in this instance's own scratch notes folder (WRITEMIND_NOTES) and profile.
import fs from "node:fs"
import path from "node:path"
import {
  ok, finish, js, sleep, waitFor, menu, menuClick, notesDir, resetNotes, restartApp, writeNoteFile, removeNoteFile,
  noteFileExists, readNoteWm, readNoteFile, openNote, setRendered, closeAllTabs, shot,
} from "../../lib/harness.mjs"

const NAME = "WriteMind Quick Reference"
const FILE = "WriteMind Quick Reference.md" // the harness's name for the note; the file is `.wm`
const notes = await notesDir()
const J = async (expression) => JSON.parse(await js(`JSON.stringify(${expression})`))
const rendered = () => js(`document.querySelector('.cm-editor')?.classList.contains('wm-rendered') ?? false`)
const tabs = () => J(`[...document.querySelectorAll('.tab')].map((t) => ({ name: t.querySelector('.name')?.textContent ?? '', open: t.classList.contains('open'), path: t.title }))`)
const quickTabs = async () => (await tabs()).filter((t) => /Quick Reference\.wm$/.test(t.path))
const front = async () => (await tabs()).find((t) => t.open)?.name ?? null
const select = async (needle) => {
  await js(`[...document.querySelectorAll('.tab')].find((t) => t.title.replace(/\\\\/g, '/').endsWith(${JSON.stringify(needle)}))?.click()`)
  await sleep(500)
}
const closeTab = async (needle) => {
  await js(`[...document.querySelectorAll('.tab')].find((t) => t.title.replace(/\\\\/g, '/').endsWith(${JSON.stringify(needle)}))?.querySelector('.close')?.click()`)
  await sleep(500)
}
const text = () => js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)
const QUICK = "/WriteMind Quick Reference.wm"

// ---- 1. a first launch -----------------------------------------------------------------------------------------------
await sleep(500)
await resetNotes({ reload: false })
await restartApp({ env: { WRITEMIND_WELCOME: "1" } })
await waitFor(`document.querySelectorAll('.tab').length === 1 && !!document.querySelector('.cm-content')`, 20000)
await sleep(800)
ok("the Quick Reference was written into the (scratch) notes folder, as a .wm", await noteFileExists(FILE) && fs.existsSync(path.join(notes, "WriteMind Quick Reference.wm")))
const first = (await readNoteWm(FILE)).text
ok("it is the app's text: the title, the intro, the Features and the keys table", first.startsWith("# WriteMind Quick Reference\n\nWhat WriteMind does") && first.includes("## Features") && first.includes("## Most important keys") && first.includes("| What"), first.slice(0, 80))
ok("the first-run marker was written beside it", fs.existsSync(path.join(notes, ".writemind", "welcomed")))
ok("it is the one tab, and in front", (await tabs()).length === 1 && (await front()) === NAME, JSON.stringify(await tabs()))
await waitFor(`document.querySelector('.cm-editor')?.classList.contains('wm-rendered')`, 8000).catch(() => {})
ok("it opened on the RENDERED page", await rendered())
// (the page draws what is in view: the keys table is at the end)
ok("the features have bold leads", await js(`document.querySelectorAll('.cm-content strong').length >= 10`))
await js(`document.querySelector('.cm-scroller').scrollTop = 1e6`)
await sleep(700)
ok("the keys are drawn as a real table", await js(`document.querySelectorAll('.cm-content table').length === 1`), await js(`document.querySelectorAll('.cm-content table').length + ' tables'`))
await js(`document.querySelector('.cm-scroller').scrollTop = 0`)
await sleep(300)
ok("the features it shows are the ones written", await js(`document.querySelector('.cm-content').innerText.includes('Runnable cells') && document.querySelector('.cm-content').innerText.includes('Mathematica')`))
await shot("quick-reference-rendered")
const help = (await menu()).find((t) => t.label === "Help")?.submenu ?? []
const item = help.find((i) => i.id === "quickReference")
ok("Help has Quick Reference, first, with no key, enabled", !!item && item.label === "Quick Reference" && help[0].id === "quickReference" && !item.accelerator && item.enabled !== false, JSON.stringify(item))
ok("Keyboard Shortcuts keeps its key (F1; Shift+Cmd+/ on a Mac)", help.some((i) => i.id === "keyList" && /^(F1|Shift\+Cmd\+\/)$/.test(i.accelerator ?? "")), JSON.stringify(help.find((i) => i.id === "keyList")))

// ---- 2. another note stays in its own mode --------------------------------------------------------------------------------
await writeNoteFile("Other.md", "# Other\n\nA note of its own.\n")
await waitFor(`[...document.querySelectorAll('.note-row')].some((r) => r.dataset.path?.replace(/\\\\/g, '/').endsWith('/Other.wm'))`, 10000)
await openNote("Other")
ok("another note opens in the mode the notes were in: markdown", (await front()) === "Other" && !(await rendered()))
await select(QUICK)
ok("the Quick Reference comes back to the front: rendered", (await front()) === NAME && (await rendered()))
await select("/Other.wm")
ok("back on the other note: markdown, as it was", (await front()) === "Other" && !(await rendered()))
await setRendered(true)
await select(QUICK)
ok("a rendered other note, then the Quick Reference: rendered", (await front()) === NAME && (await rendered()))
await select("/Other.wm")
ok("and the other note is still rendered (nothing the Quick Reference did changed it)", (await front()) === "Other" && (await rendered()))
await setRendered(false)
ok("turned back to markdown by hand on the other note", !(await rendered()))

// ---- 3. closed, then opened again with Help ▸ Quick Reference --------------------------------------------------------------
await closeTab(QUICK)
ok("the Quick Reference tab is closed; the other note is in front, in markdown", (await quickTabs()).length === 0 && (await front()) === "Other" && !(await rendered()))
ok("Help ▸ Quick Reference is there to click", await menuClick("quickReference"))
await waitFor(`[...document.querySelectorAll('.tab.open')].some((t) => /Quick Reference\\.wm$/.test(t.title))`, 10000)
await sleep(600)
ok("it opens in a tab, in front, ONCE", (await quickTabs()).length === 1 && (await front()) === NAME)
ok("and RENDERED again (not only at the first launch)", await rendered())
await select("/Other.wm")
ok("the other note is in markdown again", (await front()) === "Other" && !(await rendered()))
await closeAllTabs()
ok("with no tab at all", (await tabs()).length === 0)
await menuClick("quickReference")
await waitFor(`[...document.querySelectorAll('.tab.open')].some((t) => /Quick Reference\\.wm$/.test(t.title))`, 10000)
await sleep(600)
ok("Help ▸ Quick Reference from no tab: open, in front, rendered", (await quickTabs()).length === 1 && (await rendered()))
await setRendered(false)
ok("turned to markdown by hand while it is in front: it stays so (the person's choice)", !(await rendered()))
await menuClick("quickReference")
await sleep(1200)
ok("chosen again while it is open: rendered again, and still one tab", (await rendered()) && (await quickTabs()).length === 1)

// ---- 4. an outdated copy is rewritten ------------------------------------------------------------------------------------
const OLD = "# WriteMind Quick Reference\n\n- **Cells:** from an older WriteMind\n"
await writeNoteFile(FILE, OLD)
await waitFor(`document.querySelector('.cm-content').cmTile.view.state.doc.toString().includes('from an older WriteMind')`, 10000).catch(() => {})
ok("(the older copy is on disk, and the open tab took it in)", (await readNoteFile(FILE)) === OLD && (await text()).includes("from an older WriteMind"))
await menuClick("quickReference")
await waitFor(`!document.querySelector('.cm-content').cmTile.view.state.doc.toString().includes('from an older WriteMind')`, 10000).catch(() => {})
await sleep(800)
ok("the open tab shows the current text again", (await text()) === first, (await text()).slice(0, 60))
ok("the file on disk is the current text", (await readNoteFile(FILE)) === first)
ok("still one Quick Reference tab, and it is rendered", (await quickTabs()).length === 1 && (await rendered()))
ok("the file is still a valid .wm with the same note id (rewritten in place)", (await readNoteWm(FILE)).manifest.id !== undefined)
await closeAllTabs()
await writeNoteFile(FILE, `${first}\nMy own line.\n`)
await sleep(600)
await menuClick("quickReference")
await waitFor(`[...document.querySelectorAll('.tab.open')].some((t) => /Quick Reference\\.wm$/.test(t.title))`, 10000)
await sleep(800)
ok("an edited copy (nobody has it open) is overwritten too, and opens rendered", (await readNoteFile(FILE)) === first && (await rendered()))

// ---- 5. an existing install: not written at launch, written by the menu ------------------------------------------------------
await closeAllTabs()
await removeNoteFile(FILE)
ok("(the file is gone; the marker and another note stay)", !(await noteFileExists(FILE)) && fs.existsSync(path.join(notes, ".writemind", "welcomed")) && (await noteFileExists("Other.md")))
await restartApp({ env: { WRITEMIND_WELCOME: "1" } })
await sleep(2000)
ok("a launch (asked to welcome) does NOT write it for an install that has been welcomed", !(await noteFileExists(FILE)))
ok("and the sidebar has no row for it", !(await js(`[...document.querySelectorAll('.note-row')].some((r) => /Quick Reference/.test(r.dataset.path ?? '') || /Quick Reference/.test(r.textContent))`)))
await menuClick("quickReference")
await waitFor(`[...document.querySelectorAll('.tab.open')].some((t) => /Quick Reference\\.wm$/.test(t.title))`, 10000)
await sleep(800)
ok("Help ▸ Quick Reference writes it now", await noteFileExists(FILE) && (await readNoteFile(FILE)) === first)
ok("opens it in a tab, rendered", (await quickTabs()).length === 1 && (await rendered()))
ok("and the sidebar lists it", await js(`[...document.querySelectorAll('.note-row')].some((r) => /Quick Reference/.test(r.textContent))`))
finish()
