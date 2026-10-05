// @e2e isolated
// A session comes back after the app is quit and started again: the open tabs in order, which one is in
// front, each note's caret, and each note's closed sections. (Was wm/session*.mjs.)
import { ok, finish, js, sleep, seedNotes, openNote, setDoc, doc, dblclick, brackets, restartApp, VIEW } from "../../lib/harness.mjs"

const cells = "# Head\n\nbody one\n\nbody two\n\n# Next\n\nTail words here"
await seedNotes({
  "Cells.md": cells,
  "Second.md": "# Second\n\nsecond body text\n",
  "Third.md": "# Third\n\nthird body text\n",
}, { clean: true })

// start from a clean session: close every tab
while ((await js(`document.querySelectorAll('.tab .close').length`)) > 0) {
  await js(`document.querySelector('.tab .close').click()`); await sleep(200)
}
await openNote("Cells")
await setDoc(cells); await sleep(500)
const g = (await brackets(".wm-bracket-group"))[0]
await dblclick(g.right, g.y); await sleep(300)
await js(`${VIEW}.dispatch({selection:{anchor:${cells.indexOf("Tail") + 4}}})`)   // after the clicks on the bracket
ok("the first section is closed before the restart", (await js(`document.querySelectorAll('.wm-folded').length`)) === 1)
await openNote("Second")
await openNote("Third")
await openNote("Second")
await js(`${VIEW}.dispatch({selection:{anchor:12}})`)
await sleep(1200)
const tabsNow = () => js(`[...document.querySelectorAll('.tab')].map(t=>t.textContent.replace('×','')+(t.classList.contains('open')?'*':'')).join(' | ')`)
ok("three tabs are open", (await js(`document.querySelectorAll('.tab').length`)) === 3, await tabsNow())

await restartApp()
await sleep(1500)
const tabs = await tabsNow()
ok("the same three tabs come back, in order", tabs.replaceAll("*", "") === "Head | Second | Third", tabs)
ok("the front tab is Second", /Second\*/.test(tabs), tabs)
ok("the editor shows Second", (await doc()).includes("Second"))
const head = await js(`${VIEW}.state.selection.main.head`)
ok("Second's caret is where it was", head === 12, head)

// back to Cells: its caret and its closed section
await js(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith("Head")).click()`)
await sleep(800)
const text = await doc()
const lines = await js(`[...document.querySelectorAll('.cm-line')].map(l=>l.textContent).join('|')`)
ok("Cells' closed section is still closed", !lines.includes("body one") && lines.includes("Tail"), lines)
const caret = await js(`${VIEW}.state.selection.main.head`)
ok("Cells' caret is where it was", caret === text.indexOf("Tail") + 4, caret)
finish()
