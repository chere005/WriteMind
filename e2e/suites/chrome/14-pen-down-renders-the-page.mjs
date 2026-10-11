// THE PEN PUT DOWN ON THE NOTEBOOK SWITCHES THE PAGE TO THE RENDERED ONE (Sean, 2026-10-10: "switch to rendered mode if bringing in
// text or switching to pen mode on the notebook"): the ink layer (.wm-canvas) belongs to the rendered page, so a pen put down on the
// markdown page draws nowhere. Every way of putting it down is one writer (App.tsx penButton): the bar's pen button, the menu's Pen,
// the pen's key, Pen ▸ Pen Down in the application menu, and "Pen always draws" turned on. An ACT switches, a state never does: a
// person who turns the rendered page off by hand with the pen down is not fought, and putting the pen UP, or turning Pen always draws
// OFF, switches nothing. The switch is the page's own toggle: the words, the caret and the undo are what they were.
import {
  ok, finish, freshNote, js, sleep, shot, clickEl, key, MOD, ALT, setRendered, penIsDown, penMenu, menuClick, typeText, doc, sel, focus, waitFor,
  pickTablet, showVideoPane,
} from "../../lib/harness.mjs"

await js(`localStorage.clear()`)
await js(`location.reload()`); await sleep(1500)
await freshNote()
const isRendered = () => js(`document.querySelector('.cm-editor')?.classList.contains('wm-rendered') ?? false`)
const hasLayer = () => js(`!!document.querySelector('.wm-canvas')`)
const stored = () => js(`JSON.parse(localStorage.getItem('writemind.pen') || '{}')`)
const closeMenu = async () => { if (await js(`!!document.querySelector('.float-menu')`)) { await key("Escape"); await sleep(250) } }
/** Back to where each act starts: the markdown page, the pen up. */
const reset = async () => {
  await closeMenu()
  if (await penIsDown()) await clickEl("[data-bar=pen]")
  await setRendered(false)
  await sleep(300)
}
const startsPlain = async (name) => ok(`(${name}: the markdown page, the pen up)`, !(await isRendered()) && !(await penIsDown()))

ok("a note starts on the markdown page, with no ink layer, the pen up", !(await isRendered()) && !(await hasLayer()) && !(await penIsDown()))

// Something typed first: the switch must leave the words, the caret and the undo alone.
await focus()
await typeText("first cell\n\nsecond cell")
await sleep(300)
const words = await doc()
const caret = await sel()

// ---- the bar's pen button
await clickEl("[data-bar=pen]"); await sleep(500)
ok("the pen button puts the pen down AND the page is the rendered one, with the ink layer", (await penIsDown()) && (await isRendered()) && (await hasLayer()))
ok("the words and the caret are what they were (the page's own toggle)", (await doc()) === words && JSON.stringify(await sel()) === JSON.stringify(caret), JSON.stringify([await doc(), await sel(), caret]))
await shot("pen-down-rendered")

// ---- turned off by hand with the pen down: nobody fights for it
await setRendered(false)
await sleep(1200)
ok("the rendered page turned off by hand with the pen down STAYS off", !(await isRendered()) && !(await hasLayer()))
ok("...and the pen is still down (nothing was asked of it)", await penIsDown())

// ---- putting it up switches nothing; the undo is the note's one timeline
await clickEl("[data-bar=pen]"); await sleep(400)
ok("the pen button puts the pen up: the page stays as it was (the markdown page)", !(await penIsDown()) && !(await isRendered()))
await focus()
await key("z", { modifiers: MOD }); await sleep(300)
ok("Undo still takes back the typing (the switches left the undo history alone)", (await doc()) !== words, JSON.stringify(await doc()))
await key("z", { modifiers: MOD | 8, wait: 150 }); await sleep(300)
await startsPlain("the button")

// ---- the menu's Pen
await penMenu()
await clickEl(".float-menu [data-bar=pen-pen]"); await sleep(500)
ok("the menu's Pen puts the pen down AND renders the page", (await penIsDown()) && (await isRendered()))
await reset()
await startsPlain("the menu")

// ---- the pen's key (Cmd/Ctrl+Alt+1)
await focus()
await key("1", { modifiers: MOD | ALT }); await sleep(500)
ok("the pen's key puts the pen down AND renders the page", (await penIsDown()) && (await isRendered()))
await reset()
await startsPlain("the key")

// ---- Pen ▸ Pen Down in the application menu
await menuClick("penToggle"); await sleep(500)
ok("Pen ▸ Pen Down puts the pen down AND renders the page", (await penIsDown()) && (await isRendered()))
await reset()
await startsPlain("the menu bar")

// ---- the menu's Pen with the pen ALREADY down on the markdown page (turned off by hand): choosing the pen is the act
await clickEl("[data-bar=pen]"); await sleep(400)
await setRendered(false)
await sleep(600)
ok("(the pen down on the markdown page, turned off by hand)", (await penIsDown()) && !(await isRendered()))
await penMenu()
await clickEl(".float-menu [data-bar=pen-pen]"); await sleep(500)
ok("choosing Pen again from the menu renders the page: it is the act of putting the pen down", await isRendered())
await reset()

// ---- Pen always draws: turned OFF switches nothing, turned ON is the act
await penMenu()
const was = (await stored()).penDraws
ok("(Pen always draws starts on)", was !== false)
await clickEl(".float-menu [data-bar=pen-always]"); await sleep(500)
ok("Pen always draws turned OFF leaves the markdown page alone", (await stored()).penDraws === false && !(await isRendered()))
await clickEl(".float-menu [data-bar=pen-always]"); await sleep(500)
ok("Pen always draws turned back ON switches to the rendered page (the pen's tip draws on the page)", (await stored()).penDraws === true && (await isRendered()))
await closeMenu()
await reset()
await focus()
await key("8", { modifiers: MOD | ALT }); await sleep(400)
ok("(its key, Cmd/Ctrl+Alt+8: off, and the page stays)", (await stored()).penDraws === false && !(await isRendered()))
await key("8", { modifiers: MOD | ALT }); await sleep(500)
ok("...and on again switches to the rendered page", (await stored()).penDraws === true && (await isRendered()))
await reset()

// ---- the tablet sheet being the video source is not the notebook's pen
await showVideoPane()
await pickTablet()
await sleep(500)
ok("the tablet sheet as the video source leaves the page as it was (it has its own pen)", !(await isRendered()) && !(await penIsDown()))
await shot("tablet-source")
finish()
