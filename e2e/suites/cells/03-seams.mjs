// The seams (the bars between cells): hover cursor, click to arm, typing opens a cell, Enter / Escape / arrows,
// the + menu and its kinds, a click above the first and below the last cell. (Was tour/t04-t06 and wm/features.)
import { ok, finish, js, sleep, freshNote, setDoc, doc, sel, key, typeKeys, typeText, click, hover, focus, armed, setSel, lineBoxes, shot, centerOf, setPen } from "../../lib/harness.mjs"

await freshNote()
const D0 = "Alpha\n\nBeta\n\nGamma"
const gapOf = async (i = 1) => { const l = await lineBoxes(); return Math.round((l[i][0] + l[i][1]) / 2) }

// ---- the bar between two cells
await setDoc(D0); await focus(); await sleep(200)
let gapY = await gapOf()
await hover(600, gapY); await sleep(100)
// (The Mac's iBeamCursorForVerticalLayout: the click there puts a horizontal input cursor between the cells.)
ok("the pointer over a seam becomes the vertical-text cursor", (await js(`getComputedStyle(document.elementFromPoint(600, ${gapY})).cursor`)) === "vertical-text")
await click(600, gapY)
ok("a click on the seam arms it", await armed(), JSON.stringify(await sel()))
ok("the caret is on the bar between the cells", (await sel())[0] === 6, JSON.stringify(await sel()))
await shot("armed")
await typeKeys("New")
ok("typing at the bar makes a cell between", (await doc()) === "Alpha\n\nNew\n\nBeta\n\nGamma", JSON.stringify(await doc()))
ok("the caret is after the typed text", (await sel())[0] === 10, JSON.stringify(await sel()))
ok("the bar is no longer armed", !(await armed()))
await key("z", { ctrl: true })
ok("Ctrl+Z takes the new cell away", (await doc()) === D0, JSON.stringify(await doc()))

// ---- Escape disarms and leaves the note alone
await setDoc(D0); await sleep(150)
gapY = await gapOf()
await click(600, gapY)
await key("Escape")
ok("Escape disarms the bar", !(await armed()))
ok("...and does not touch the note", (await doc()) === D0, JSON.stringify(await doc()))

// ---- keys at an armed bar
const atBar = async (k, o) => { await setDoc(D0); await setSel(6); await focus(); await sleep(100); await click(600, await gapOf()); await key(k, o); return { d: await doc(), s: await sel(), a: await armed() } }
let r = await atBar("Enter")
ok("Enter at a bar opens an empty cell", r.d === "Alpha\n\n\n\nBeta\n\nGamma" && r.s[0] === 7 && !r.a, JSON.stringify(r))
for (const k of ["Tab", "Home", "End"]) {
  r = await atBar(k)
  ok(`${k} at a bar changes nothing and keeps it armed`, r.d === D0 && r.s[0] === 6 && r.a, JSON.stringify(r))
}
r = await atBar("ArrowLeft")
ok("ArrowLeft at a bar goes to the end of the cell before", r.s[0] === 5 && !r.a, JSON.stringify(r))
r = await atBar("ArrowRight")
ok("ArrowRight at a bar goes to the start of the cell after", r.s[0] === 7 && !r.a, JSON.stringify(r))

// ---- arrow keys walk cell, seam, cell
await setDoc("One\n\nTwo"); await setSel(3); await focus()
await key("ArrowDown")
ok("down off a cell lands on the bar", (await sel())[0] === 4 && await armed(), JSON.stringify(await sel()))
ok("the bar is drawn", (await js(`document.querySelectorAll('.wm-bar').length`)) >= 1)
await key("ArrowDown")
ok("down again goes into the next cell", (await sel())[0] >= 5 && (await sel())[0] <= 8 && !(await armed()), JSON.stringify(await sel()))
await key("ArrowUp")
ok("up comes back to the bar", (await sel())[0] === 4 && await armed(), JSON.stringify(await sel()))
await typeText("X")
ok("typing at the bar makes a cell between", (await doc()) === "One\n\nX\n\nTwo", JSON.stringify(await doc()))

// ---- above the first cell and below the last one
await setDoc(D0); await sleep(200)
const first = (await lineBoxes())[0]
await click(600, first[0] - 6)
ok("a click above the first cell arms the bar before it", await armed() && (await sel())[0] === 0, JSON.stringify(await sel()))
await typeKeys("Top")
ok("typing there makes a new first cell", (await doc()) === "Top\n\nAlpha\n\nBeta\n\nGamma", JSON.stringify(await doc()))
await setDoc(D0); await sleep(200)
await click(600, 600)
ok("a click far below the last cell arms the bar after it", await armed() && (await sel())[0] === D0.length, JSON.stringify(await sel()))
await typeKeys("Z")
ok("typing there makes a new last cell", (await doc()) === D0 + "\n\nZ", JSON.stringify(await doc()))

// ---- the + on an armed bar and the kinds it offers
const kinds = async (label) => {
  await setDoc("One\n\nTwo"); await setSel(3); await focus()
  await key("ArrowDown")
  const plus = await centerOf(".wm-plus")
  if (!plus) return null
  await click(plus.x, plus.y); await sleep(250)
  const names = await js(`[...document.querySelectorAll('.kind-menu button')].map(b=>b.textContent)`)
  if (label) { await js(`[...document.querySelectorAll('.kind-menu button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(200) }
  return names
}
const names = await kinds("Quote")
ok("the + is drawn on the armed bar and opens the kinds", !!names && ["Body Text", "Quote", "Code Block", "Title"].every((n) => names.includes(n)), JSON.stringify(names))
await typeText("q")
ok("the next thing typed is a quote cell", (await doc()) === "One\n\n> q\n\nTwo", JSON.stringify(await doc()))
await kinds("Title"); await typeText("T")
ok("the Title kind opens a # cell", (await doc()) === "One\n\n# T\n\nTwo", JSON.stringify(await doc()))
await kinds("To-do List"); await typeText("t")
ok("the To-do kind opens a task", /\n\n- \[ \] t\n\n/.test(await doc()), JSON.stringify(await doc()))
await kinds("Section"); await typeText("Heading text")
ok("the Section kind opens a heading cell", /\n\n#+ Heading text\n\n/.test(await doc()), JSON.stringify(await doc()))
finish()
