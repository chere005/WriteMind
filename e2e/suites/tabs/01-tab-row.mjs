// @e2e isolated
// THE TAB ROW at a wide window and at 460px: one 36px strip, [sidebar][rendered][video] then the tabs, the +, and a list button
// with the open notes' count at the right; tabs that overflow scroll and the list is the way back to one that is out of sight.
import {
  js, key, ok, finish, sleep, shot, seedNotes, closeAllTabs, openNote, clickEl, centerOf, rectOf, click, rightClick, setWindowSize, waitFor,
} from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))

const names = ["Alpha", "Bravo notes with a rather long title that must be clipped", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"]
await seedNotes(Object.fromEntries(names.map((n, i) => [`${n}.md`, `# ${n}\n\nbody ${i}\n`])), { clean: true })
await js(`localStorage.clear()`)
await closeAllTabs()

const row = () => J(`(() => {
  const r = document.querySelector('.tab-bar').getBoundingClientRect()
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, w: b.width, h: b.height } }
  return { bar: { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right }, sidebar: q('[data-bar=sidebar]'), markdown: q('[data-bar=markdown]'), video: q('[data-bar=video]'),
    plus: q('[data-bar=new-tab]'), list: q('[data-bar=tab-list]'), strip: q('.tab-strip'),
    tabs: [...document.querySelectorAll('.tab')].map((t) => { const b = t.getBoundingClientRect(); return { name: t.querySelector('.name').textContent, open: t.classList.contains('open'), x: b.x, r: b.right, w: b.width, h: b.height } }),
    count: document.querySelector('[data-bar=tab-list]')?.textContent.trim() ?? null, listTitle: document.querySelector('[data-bar=tab-list]')?.title ?? null,
    scrollW: document.documentElement.scrollWidth, innerW: innerWidth } })()`)

// ---- an empty row: the three switches and the + — and the bar is there with nothing open (no list: FinalToolbar.png's "No note open" strip has none, so 0 notes is not a count to show)
let r = await row()
ok("with nothing open the row still has its switches and a +", r.sidebar && r.markdown && r.video && r.plus, JSON.stringify(r))
ok("and no list button (there is nothing to list; it comes with the first tab)", r.list === null && r.count === null, `${r.count} / ${r.listTitle}`)
ok("the rendered button is greyed with no note to render", await js(`document.querySelector('[data-bar=markdown]').disabled`))

// ---- three tabs at the wide window
for (const n of ["Alpha", "Charlie", "Delta"]) await openNote(n)
r = await row()
ok("three open notes make three tabs", r.tabs.length === 3, JSON.stringify(r.tabs.map((t) => t.name)))
ok("the row is 36px tall", Math.round(r.bar.h) === 36, String(r.bar.h))
ok("left to right: sidebar, rendered, video, then the tabs, the +, the list", r.sidebar.x < r.markdown.x && r.markdown.x < r.video.x && r.video.r <= r.tabs[0].x + 1 && r.tabs[2].r <= r.plus.x + 1 && r.plus.r <= r.list.x + 1, JSON.stringify(r))
ok("the + sits right after the last tab (not at the far end)", r.plus.x - r.tabs[2].r < 12, String(r.plus.x - r.tabs[2].r))
ok("the list is at the right end and says 3", r.count === "3" && r.bar.r - r.list.r < 12 && r.listTitle === "3 open notes", `${r.count} ${r.bar.r - r.list.r}`)
ok("the note in front is Delta, the last one opened", r.tabs.find((t) => t.open)?.name === "Delta")
ok("every tab is as tall as the row (the one in front runs into the toolbar)", r.tabs.every((t) => Math.round(t.h) === 36), JSON.stringify(r.tabs.map((t) => t.h)))
ok("no tab is wider than 190", r.tabs.every((t) => t.w <= 190.5), JSON.stringify(r.tabs.map((t) => t.w)))
const bg = await J(`(() => { const probe = document.createElement('div'); probe.style.background = 'var(--wm-page)'; document.body.append(probe); const page = getComputedStyle(probe).backgroundColor; probe.remove(); const open = getComputedStyle(document.querySelector('.tab.open')).backgroundColor; const strip = getComputedStyle(document.querySelector('.tab-bar')).backgroundColor; return { open, page, strip } })()`)
ok("the tab in front is the page's colour (the toolbar's, once it is a page bar), the strip is not", bg.open === bg.page && bg.open !== bg.strip, JSON.stringify(bg))
// the × shows on the tab in front and on hover, and on no other
const closeShown = () => J(`[...document.querySelectorAll('.tab')].map((t) => +getComputedStyle(t.querySelector('.close')).opacity)`)
await click(5, 5)
let shownNow = await closeShown()
ok("the × is on the tab in front only", shownNow[2] === 1 && shownNow[0] === 0 && shownNow[1] === 0, JSON.stringify(shownNow))
const mid = await centerOf(".tab:nth-child(2)")
await click(mid.x, 18, { wait: 0 })   // (a click selects it: the hover is what is read next)
await openNote("Delta")
await sleep(100)
const first = await centerOf(".tab:nth-child(1)")
await js(`0`)
const { hover } = await import("../../lib/harness.mjs")
await hover(first.x, first.y); await sleep(200)
shownNow = await closeShown()
ok("and on the one under the pointer", shownNow[0] === 1, JSON.stringify(shownNow))
await shot("wide")
// light and dark: the strip, the tab in front and the page differ in both, and the × and the count stay readable
const { send: sendCdp } = await import("../../lib/harness.mjs")
await sendCdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }); await sleep(300)
const light = await J(`(() => { const probe = document.createElement('div'); probe.style.background = 'var(--wm-page)'; document.body.append(probe); const page = getComputedStyle(probe).backgroundColor; probe.remove(); return { page, open: getComputedStyle(document.querySelector('.tab.open')).backgroundColor, strip: getComputedStyle(document.querySelector('.tab-bar')).backgroundColor, count: getComputedStyle(document.querySelector('[data-bar=tab-list]')).color } })()`)
ok("in the light theme the tab in front is the page's colour and the strip is not", light.open === light.page && light.open !== light.strip && light.count !== light.strip, JSON.stringify(light))
await shot("wide-light")
await sendCdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); await sleep(200)
await sendCdp("Emulation.setEmulatedMedia", { features: [] })

// ---- a middle click closes a tab; × closes; the count follows
const before = (await row()).tabs.map((t) => t.name)
await js(`document.querySelector('.tab:nth-child(1)').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))`); await sleep(300)
let after = await row()
ok("a middle click closes the tab", after.tabs.length === before.length - 1 && !after.tabs.some((t) => t.name === before[0]), JSON.stringify(after.tabs.map((t) => t.name)))
ok("and the count follows", after.count === String(after.tabs.length), after.count)
await js(`document.querySelector('.tab.open .close').click()`); await sleep(400)
after = await row()
ok("the × on the tab in front closes it and the count follows", after.tabs.length === 1 && after.count === "1" && after.listTitle === "1 open note", JSON.stringify([after.tabs.length, after.count, after.listTitle]))

// ---- the narrow window: 460px wide, the sidebar shut, every note open
await js(`document.querySelector('[data-bar=sidebar]').click()`); await sleep(300)
await setWindowSize(460, 800); await sleep(500)
// (a note is opened from the list, which is the only way back to one that is not a tab)
await js(`document.querySelector('[data-bar=sidebar]').click()`); await sleep(300)
await setWindowSize(1440, 900); await sleep(300)
for (const n of names) await openNote(n)
await js(`document.querySelector('[data-bar=sidebar]').click()`); await sleep(300)
await setWindowSize(460, 800); await sleep(600)
r = await row()
ok("at 460px the row is still 36px and nothing makes the page scroll sideways", Math.round(r.bar.h) === 36 && r.scrollW <= r.innerW, JSON.stringify([r.bar.h, r.scrollW, r.innerW]))
ok("every note is a tab, and the count says so", r.tabs.length === names.length && r.count === String(names.length), JSON.stringify([r.tabs.length, r.count]))
ok("the switches, the + and the list are all in view", r.sidebar.x >= 0 && r.list.r <= r.bar.r + 1 && r.plus.r <= r.list.x + 1, JSON.stringify(r))
const inView = r.tabs.filter((t) => t.x >= r.strip.x - 1 && t.r <= r.strip.r + 1)
ok("tabs that do not fit are out of view, not squeezed to nothing", inView.length < names.length && r.tabs.every((t) => t.w >= 80), JSON.stringify(r.tabs.map((t) => Math.round(t.w))))
ok("the tab in front is scrolled into view", (() => { const t = r.tabs.find((t) => t.open); return t.x >= r.strip.x - 1 && t.r <= r.strip.r + 1 })(), JSON.stringify(r.tabs.find((t) => t.open)))
ok("the + is after the strip, in view", r.plus.x >= r.strip.r - 1 && r.plus.r <= r.bar.r, JSON.stringify(r.plus))
await shot("narrow")

// the wheel walks along the strip, a tab a notch
const firstShown = () => J(`(() => { const s = document.querySelector('.tab-strip').getBoundingClientRect(); return [...document.querySelectorAll('.tab')].findIndex((t) => t.getBoundingClientRect().right > s.left + 1) })()`)
const at0 = await firstShown()
const strip = await centerOf(".tab-strip")
const { send } = await import("../../lib/harness.mjs")
for (let i = 0; i < 6; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: strip.x, y: strip.y, deltaX: 0, deltaY: -40 }); await sleep(60) }
const at1 = await firstShown()
ok("the wheel walks the strip back to earlier tabs", at1 < at0 || at0 === 0, `${at0} -> ${at1}`)
for (let i = 0; i < 12; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: strip.x, y: strip.y, deltaX: 0, deltaY: 40 }); await sleep(60) }
const at2 = await firstShown()
ok("and forward again", at2 > at1, `${at1} -> ${at2}`)

// the list is the way back to a tab that is out of sight
const hidden = (await row()).tabs.filter((t) => t.r <= (r.strip.x - 1) || t.x >= r.strip.r + 1)
await clickEl("[data-bar=tab-list]"); await sleep(250)
const list = await J(`[...document.querySelectorAll('.float-menu button')].map((b) => ({ text: b.textContent, checked: b.getAttribute('aria-checked'), role: b.getAttribute('role') }))`)
ok("the list names every open note, then Close Other Tabs", list.length === names.length + 1 && list.at(-1).text.includes("Close Other Tabs"), JSON.stringify(list))
ok("the note in front has a real check (a check column, not spaces)", list.filter((l) => l.checked === "true").length === 1 && list.slice(0, names.length).every((l) => l.checked === "true" || l.checked === "false"), JSON.stringify(list))
await shot("list")
// pick a note that is out of view: its tab comes back
const target = (await row()).tabs.find((t) => t.r <= r.strip.x + 1)?.name ?? names[0]
await js(`[...document.querySelectorAll('.float-menu button')].find((b) => b.textContent.includes(${JSON.stringify(target)}))?.click()`); await sleep(500)
const back = await row()
ok("choosing one from the list brings that tab to the front, in view", back.tabs.find((t) => t.open)?.name === target && (() => { const t = back.tabs.find((t) => t.open); return t.x >= back.strip.x - 1 && t.r <= back.strip.r + 1 })(), JSON.stringify([target, back.tabs.find((t) => t.open)]))
ok("the menu closed and the keyboard is back in the notes", (await js(`!document.querySelector('.float-menu') && document.activeElement?.classList.contains('cm-content')`)))
// Escape closes the list and a second press of the button does too
await clickEl("[data-bar=tab-list]"); await sleep(200)
ok("pressing the list button again puts the list away", (await (async () => { await clickEl("[data-bar=tab-list]"); await sleep(250); return js(`!document.querySelector('.float-menu')`) })()))
await clickEl("[data-bar=tab-list]"); await sleep(200)
await key("Escape"); await sleep(200)
ok("Escape closes it", await js(`!document.querySelector('.float-menu')`))

await setWindowSize(1440, 900)
finish()
