// @e2e isolated
// THE THREE SWITCHES in the tab row — sidebar, rendered, video — with the sidebar open and shut (Sean, 2026-10-10: "keep the
// rendered and video buttons to the right of the sidebar always"), and the video button's menu: Show video, the cameras, the tablet,
// Turn left / right and Refresh (the menu stays up for those), Video Only. A plain click shows or hides the pane; the corner, a
// right-click or a held press opens the menu.
import {
  js, key, ok, finish, sleep, shot, seedNotes, closeAllTabs, openNote, clickEl, centerOf, rectOf, click, rightClick, hover, setWindowSize,
  waitFor, menuClick, openVideoMenu,
} from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))

await seedNotes({ "Alpha.md": "# Alpha\n\nbody\n", "Bravo.md": "# Bravo\n\nbody\n" }, { clean: true })
await js(`localStorage.clear()`)
await closeAllTabs()
await openNote("Alpha")
await js(`window.__turns = []; window.addEventListener('wm:camera-action', (e) => window.__turns.push(e.detail))`)

const rendered = () => js(`document.querySelector('.cm-editor')?.classList.contains('wm-rendered') ?? false`)
const pressed = (bar) => js(`document.querySelector('[data-bar=${bar}]').getAttribute('aria-pressed')`)
const cameraUp = () => js(`!!document.querySelector('.camera')`)
const typingBack = () => js(`document.activeElement?.classList.contains('cm-content')`)
const menuUp = () => js(`!!document.querySelector('[data-bar=video-options]')`)
const rows = () => J(`[...document.querySelectorAll('[data-bar=video-options] > .float-row > button')].map((b) => ({ bar: b.dataset.bar, text: b.textContent.trim(), checked: b.getAttribute('aria-checked'), disabled: b.disabled }))`)
const SIDEBAR = "[data-bar=sidebar]"
const MOD = process.platform === "darwin" ? { meta: true } : { ctrl: true }
if (await cameraUp()) { await clickEl("[data-bar=video]"); await sleep(300) }

// ---- the rendered button, with the sidebar open and then shut
for (const sidebarOpen of [true, false]) {
  const state = sidebarOpen ? "sidebar open" : "sidebar shut"
  if ((await js(`!!document.querySelector('.sidebar')`)) !== sidebarOpen) { await clickEl(SIDEBAR); await sleep(300) }
  ok(`${state}: the rendered button is there, to the right of the sidebar's`, await js(`document.querySelector('[data-bar=markdown]').getBoundingClientRect().x > document.querySelector('[data-bar=sidebar]').getBoundingClientRect().right - 1`))
  ok(`${state}: it is not lit while the markdown shows`, (await pressed("markdown")) === "false" && !(await rendered()))
  await clickEl("[data-bar=markdown]"); await sleep(500)
  ok(`${state}: a click renders the page`, await rendered())
  ok(`${state}: and the button is lit`, (await pressed("markdown")) === "true" && (await js(`document.querySelector('[data-bar=markdown]').classList.contains('tint')`)))
  ok(`${state}: the keyboard is back in the note`, await typingBack())
  await shot(`rendered-${sidebarOpen ? "open" : "shut"}`)
  await clickEl("[data-bar=markdown]"); await sleep(500)
  ok(`${state}: a second click puts the markdown back`, !(await rendered()) && (await pressed("markdown")) === "false")
}
// the key does what the button does, and the button follows it
await js(`document.querySelector('.cm-content').focus()`)
await key("t", MOD); await sleep(400)
ok("The key (Cmd/Ctrl+T) renders the page and the button follows", (await rendered()) && (await pressed("markdown")) === "true")
await key("t", MOD); await sleep(400)

// ---- the video button, sidebar shut (it is shut now) and then open
for (const sidebarOpen of [false, true]) {
  const state = sidebarOpen ? "sidebar open" : "sidebar shut"
  if ((await js(`!!document.querySelector('.sidebar')`)) !== sidebarOpen) { await clickEl(SIDEBAR); await sleep(300) }
  ok(`${state}: the video button is not lit with no pane`, (await pressed("video")) === "false" && !(await cameraUp()))
  await clickEl("[data-bar=video]"); await sleep(600)
  ok(`${state}: a plain click shows the video pane and lights the button`, (await cameraUp()) && (await pressed("video")) === "true")
  ok(`${state}: a plain click does not open the menu`, !(await menuUp()))
  await shot(`video-${sidebarOpen ? "open" : "shut"}`)
  await clickEl("[data-bar=video]"); await sleep(500)
  ok(`${state}: a second click puts it away`, !(await cameraUp()) && (await pressed("video")) === "false")
}

// ---- the menu: a right-click opens it
await clickEl("[data-bar=video]"); await sleep(600)   // the pane is up
await openVideoMenu()
const list = await rows()
ok("the menu lists Show video, a camera, the tablet, turn off, left, right, refresh and Video Only", JSON.stringify(list.map((r) => r.bar)) === JSON.stringify(["video-show", "video-source", "video-tablet", "video-off", "video-turn-left", "video-turn-right", "video-refresh", "video-only"]), JSON.stringify(list.map((r) => r.bar)))
ok("Show video is ticked while the pane shows", list[0].checked === "true")
await shot("menu")
// a source: the fake camera
await js(`document.querySelector('[data-bar=video-source]').click()`); await sleep(500)
ok("picking a camera closes the menu", !(await menuUp()))
await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
await openVideoMenu()
let now = await rows()
ok("the camera in use is ticked", now.find((r) => r.bar === "video-source").checked === "true" && now.find((r) => r.bar === "video-tablet").checked === "false", JSON.stringify(now))
ok("Turn left and Turn right are on with a camera open", !now.find((r) => r.bar === "video-turn-left").disabled && !now.find((r) => r.bar === "video-turn-right").disabled)
// THE MENU STAYS UP for the turns and for refresh
await js(`window.__turns.length = 0`)
await clickEl("[data-bar=video-turn-left]"); await sleep(250)
ok("Turn left asks the pane to turn, and the menu stays up", (await menuUp()) && (await js(`window.__turns.join()`)) === "turn-left")
await clickEl("[data-bar=video-turn-right]"); await sleep(250)
ok("Turn right the same", (await menuUp()) && (await js(`window.__turns.join()`)) === "turn-left,turn-right")
await clickEl("[data-bar=video-refresh]"); await sleep(250)
ok("Refresh devices keeps it up too", await menuUp())
// Escape closes it and the keyboard goes back to the note
await key("Escape"); await sleep(250)
ok("Escape closes the menu", !(await menuUp()))
ok("and the keyboard is back in the note", await typingBack())
// the tablet: a sheet to write on, not a picture to turn
await openVideoMenu()
await js(`document.querySelector('[data-bar=video-tablet]').click()`); await sleep(600)
ok("the tablet sheet replaces the camera", await js(`!!document.querySelector('.camera .tablet')`))
await openVideoMenu()
now = await rows()
ok("the tablet is ticked and the turns are greyed", now.find((r) => r.bar === "video-tablet").checked === "true" && now.find((r) => r.bar === "video-turn-left").disabled && now.find((r) => r.bar === "video-turn-right").disabled, JSON.stringify(now))
// Show video in the menu hides the pane and closes the menu
await js(`document.querySelector('[data-bar=video-show]').click()`); await sleep(500)
ok("Show video in the menu puts the pane away and closes the menu", !(await cameraUp()) && !(await menuUp()))
ok("and the button is not lit", (await pressed("video")) === "false")

// ---- the corner of the button opens the menu, and a second press on it puts the menu away
const box = await rectOf("[data-bar=video]")
await click(box.r - 4, box.b - 4); await sleep(300)
ok("a click in the corner opens the menu (and does not toggle the pane)", (await menuUp()) && !(await cameraUp()))
await click(box.r - 4, box.b - 4); await sleep(300)
ok("pressing the corner again puts the menu away (it does not re-open)", !(await menuUp()))
// a held press opens it too
{
  const at = await centerOf("[data-bar=video]")
  const { mouse } = await import("../../lib/harness.mjs")
  await hover(at.x, at.y)
  await mouse("mousePressed", at.x, at.y); await sleep(700); await mouse("mouseReleased", at.x, at.y); await sleep(250)
  ok("a press held for half a second opens the menu", (await menuUp()) && !(await cameraUp()))
  await key("Escape"); await sleep(200)
}

// ---- Video Only: the notes pane goes away, the menu says how to come back
await clickEl("[data-bar=video]"); await sleep(600)
await openVideoMenu()
ok("Video Only is offered while the pane shows", (await rows()).find((r) => r.bar === "video-only").text.startsWith("Video Only") && !(await rows()).find((r) => r.bar === "video-only").disabled)
await js(`document.querySelector('[data-bar=video-only]').click()`); await sleep(500)
ok("Video Only puts the notes pane (and its tab row) away", await js(`getComputedStyle(document.querySelector('.pane')).display === 'none' && !!document.querySelector('.camera')`))
await menuClick("toggleEditorPane"); await sleep(500)
await openVideoMenu()
ok("with the notes back, the item says Video Only again", (await rows()).find((r) => r.bar === "video-only").text.startsWith("Video Only"))
await key("Escape"); await sleep(200)
await clickEl("[data-bar=video]"); await sleep(500)

// ---- at 460px all three are still in the row, in order, in view
await clickEl(SIDEBAR); await sleep(200)
await setWindowSize(460, 800); await sleep(500)
const narrow = await J(`(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, r: b.right, h: b.height } }; return { s: r('[data-bar=sidebar]'), m: r('[data-bar=markdown]'), v: r('[data-bar=video]'), list: r('[data-bar=tab-list]'), bar: document.querySelector('.tab-bar').getBoundingClientRect().height, w: innerWidth } })()`)
ok("at 460px: sidebar, rendered, video in order and in view, the row 36px", narrow.s.r <= narrow.m.x + 1 && narrow.m.r <= narrow.v.x + 1 && narrow.v.r < narrow.list.x && narrow.list.r <= narrow.w && Math.round(narrow.bar) === 36, JSON.stringify(narrow))
await shot("narrow")
await setWindowSize(1440, 900)
finish()
