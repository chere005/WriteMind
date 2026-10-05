// The maths palette is operable from the keyboard alone -- however it was opened. The page puts the keyboard back
// in the note after a chrome action (focusReturn.ts: after a menu command, after a click on a bar), and the palette
// takes it at the next frame: the two used to cross, so the focus went glyph -> note about 1ms later and the arrows
// moved the note's caret, Esc closed nothing and Enter typed a newline into the note (found by the Mathslane-v1
// verifier). Also: a click on a bare part of the palette (its heading) must not hand the keyboard back to the note.
// Fixed: `.math-pop` is a popup that keeps the keyboard (focusReturn.ts POPUPS), and the palette is focusable itself
// and hands a bare-area click to the picked shape (MathPalette.tsx).
import { ok, finish, js, sleep, until, freshNote, setDoc, doc, focus, key, click, clickEl, menuClick, shot, VIEW } from "../../lib/harness.mjs"

await freshNote()
await focus()

const open = () => js(`!!document.querySelector('[data-math="pop"]')`)
const picked = () => js(`document.querySelector('[data-template].on')?.dataset.template ?? null`)
const where = () => js(`(() => { const a = document.activeElement; if (!a) return null
  if (a.closest('.math-pop')) return a.dataset.template ? 'glyph:' + a.dataset.template : a.dataset.slot !== undefined ? 'slot:' + a.dataset.slot : a.dataset.custom ? 'wl' : a.dataset.own ? 'own' : a.dataset.insert ? 'insert' : 'pop'
  return a.closest('.cm-content') ? 'editor' : a.tagName + '.' + a.className })()`)
const stage = async (text) => { await setDoc(text, text.length); await focus(); await sleep(200) }
const closeIfOpen = async () => { if (await open()) { await key("Escape"); await sleep(250) } }
const watchFocus = () => js(`(() => { window.__focusLog = []; const t0 = performance.now()
  document.addEventListener('focusin', (e) => window.__focusLog.push([Math.round(performance.now() - t0), e.target.closest('.math-pop') ? 'pop' : e.target.closest('.cm-content') ? 'editor' : e.target.tagName]), true)
  return true })()`)
const focusLog = () => js(`window.__focusLog`)

await watchFocus()

const OPENERS = [
  ["Ctrl+Shift+M", async () => { await key("M", { ctrl: true, shift: true }) }],
  ["a mouse click on the ƒ(x) button", async () => { await clickEl('[data-math="button"]') }],
  ["Insert > Maths… from the menu bar", async () => { await menuClick("insertMath") }],
]

for (const [how, opener] of OPENERS) {
  await closeIfOpen()
  await stage("Words here")
  await js(`window.__focusLog.length = 0`)
  await opener()
  ok(`the palette opens: ${how}`, await until(open, 3000))
  // The old bug: glyph focus at ~17ms, the page's focus-return at ~18ms. Look at the keyboard for 1.5 seconds.
  const seen = []
  for (const wait of [40, 80, 150, 300, 600, 900]) { await sleep(wait); seen.push(await where()) }
  const log = await focusLog()
  ok(`the keyboard is in the palette and stays there for 1.5 s: ${how}`, seen.every((w) => w === "glyph:integrate.definite"), JSON.stringify({ seen, log }))
  const first = log.findIndex((e) => e[1] === "pop")
  ok(`...and the note never took it back after the palette had it: ${how}`, first >= 0 && log.slice(first).every((e) => e[1] === "pop"), JSON.stringify(log))

  await key("ArrowRight")
  ok(`ArrowRight picks the next shape, not the note's caret: ${how}`, (await picked()) === "integrate" && (await where()) === "glyph:integrate", `${await picked()} / ${await where()}`)
  const caret = await js(`${VIEW}.state.selection.main.head`)
  ok(`...and the note's caret did not move: ${how}`, caret === "Words here".length, String(caret))
  await key("ArrowDown")
  ok(`ArrowDown goes down a row: ${how}`, !["integrate", "integrate.definite", "sum", null].includes(await picked()), String(await picked()))
  await key("Tab")
  ok(`Tab walks on to the first slot: ${how}`, (await where()).startsWith("slot:"), String(await where()))
  await key("Escape")
  ok(`Escape closes the palette: ${how}`, await until(async () => !(await open()), 2000))
  ok(`...and gives the keyboard back to the note: ${how}`, (await where()) === "editor", String(await where()))
  ok(`...and inserts nothing: ${how}`, (await doc()) === "Words here", JSON.stringify(await doc()))
}

// Enter inserts (the tick says a block), and does not also type a newline into the note.
await closeIfOpen()
await stage("Words here")
await key("M", { ctrl: true, shift: true })
await until(open, 3000)
await sleep(300)
await key("ArrowRight")
await key("Enter")
await sleep(300)
const after = await doc()
ok("Enter inserts the picked shape as a block", /```wl\nIntegrate\[f\[x\], x\]\n```/.test(after), JSON.stringify(after))
ok("...and no newline went into the note on top of it", !/\n\n\n/.test(after) && after.startsWith("Words here"), JSON.stringify(after))
ok("...the palette is closed and the note has the keyboard", !(await open()) && (await where()) === "editor", String(await where()))

// Ctrl+Enter the other way, from a slot.
await closeIfOpen()
await stage("Sum ")
await key("M", { ctrl: true, shift: true })
await until(open, 3000)
await sleep(300)
await key("Tab")
await key("Enter", { ctrl: true })
await sleep(300)
const inline = await doc()
ok("Ctrl+Enter inserts the other way (inline) from a slot", /^Sum `wl:Integrate\[x\^2, \{x, 0, 1\}\]`/.test(inline), JSON.stringify(inline))

// A click on a bare part of the palette (the heading) keeps the keyboard in it.
await closeIfOpen()
await stage("Words here")
await key("M", { ctrl: true, shift: true })
await until(open, 3000)
await sleep(300)
const head = await js(`(() => { const r = document.querySelector('.math-head').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
await click(head.x, head.y)
await sleep(500)
ok("a click on the palette's heading leaves the palette open with the keyboard in it", (await open()) && (await where()).startsWith("glyph:"), `${await open()} / ${await where()}`)
await key("ArrowRight")
ok("...and the arrows still pick a shape", (await picked()) === "integrate", String(await picked()))
await shot("palette-after-heading-click")
await key("Escape")
ok("...and Escape closes it, with the note holding the keyboard", (await until(async () => !(await open()), 2000)) && (await where()) === "editor", String(await where()))

// A click on a slot's field is typed into (the page's focus-return must leave it alone), and Tab goes on from there.
await stage("Words here")
await key("M", { ctrl: true, shift: true })
await until(open, 3000)
await sleep(300)
await clickEl('[data-slot="1"]')
await sleep(400)
ok("a click on a slot's field keeps the keyboard in that field", (await where()) === "slot:1", String(await where()))
await key("Escape")
await sleep(200)

finish()
