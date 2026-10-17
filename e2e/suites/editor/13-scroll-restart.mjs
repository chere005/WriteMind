// @e2e isolated
// REOPENING WRITEMIND brings every open note back where it was scrolled to (Sean, 2026-10-16: "remember scroll position when
// switching tabs or reopening writemind"). The app is killed once its session is written (a crash, or a quit) and started
// again: the note in front comes back with the same line at the top at the same height — a note whose picture, above the
// place, has no height until it has loaded again in the new app — and so does each other tab when it is brought to the front.
// A note left on the rendered page comes back on the markdown side (every launch does) with the same words at its top.
// And the place is the one the page had got to when the session was written: a reload a few milliseconds after the wheel,
// and a real quit (quitApp: the window's flush handshake, not a kill) while the page is still moving (review, 2026-10-16).
import { ok, note, finish, sleep, send, seedNotes, writeNoteFile, closeAllTabs, openNote, setRendered, setWindowSize, restartApp, quitApp, reloadApp, js, VIEW } from "../../lib/harness.mjs"
import { longNote, picturesNote, PICTURE, topLine, topWords, which, wheelTo, wheelUntil, clickTab, sameTop, show } from "../tabs/_scroll.mjs"

await seedNotes({ "Long.md": longNote(), "Rendered.md": longNote("Rendered note") }, { clean: true, reload: false })
await writeNoteFile("Pictures.md", picturesNote(), { entries: PICTURE })
await seedNotes({}, { reload: true })
await closeAllTabs()
await setWindowSize(1440, 900)

// the markdown side, a long note
await openNote("Long")
await setRendered(false)
const long = await wheelTo(0.45)
ok("Long is scrolled to its middle", long.scrollTop > 1000, show(long))

// the rendered page, another long note: its place is read off the rendered page as its tab is left
await openNote("Rendered")
await setRendered(true)
await wheelTo(0.5)
const renderedWords = await topWords()
ok("Rendered is scrolled to its middle on the rendered page", which(renderedWords) !== "", JSON.stringify(renderedWords))

// the note in front: a few lines below a picture and typeset maths, which are drawn just above the page's edge, on the markdown side
await openNote("Pictures")
await setRendered(false)
const pictures = await wheelUntil("Row 4")
ok("Pictures is scrolled to just below its picture and maths", which(pictures.text) === "Row 4", show(pictures))
await sleep(1200)

await restartApp()
await sleep(1500)
const tabs = await js(`[...document.querySelectorAll('.tab')].map(t=>t.textContent.replace('×','')+(t.classList.contains('open')?'*':'')).join(' | ')`)
ok("the three tabs are back, Pictures in front", tabs === "Long | Rendered | Pictures*", tabs)
const back = await topLine()
note(`Pictures: ${show(pictures)} → ${show(back)}`)
ok("Pictures is back with the same line at the top, at the same height, its picture loaded above it", sameTop(pictures, back), `${show(pictures)} → ${show(back)}`)
ok("...the picture above it has loaded in this app (it had no height until then)", await js(`[...document.querySelectorAll('.cm-content img')].some((i) => i.complete && i.naturalHeight > 0 && i.getBoundingClientRect().height > 100)`))
await sleep(1500)
ok("...and the page stays there", sameTop(pictures, await topLine()), show(await topLine()))

await clickTab("Long")
const longBack = await topLine()
note(`Long: ${show(long)} → ${show(longBack)}`)
ok("Long is back with the same line at the top, at the same height", sameTop(long, longBack), `${show(long)} → ${show(longBack)}`)

await clickTab("Rendered")
const wordsBack = await topWords()
note(`Rendered: ${JSON.stringify(renderedWords)} → ${JSON.stringify(wordsBack)}`)
ok("Rendered, left on the rendered page, opens on the markdown side on the same words", which(wordsBack) === which(renderedWords), `${JSON.stringify(renderedWords)} → ${JSON.stringify(wordsBack)}`)
ok("...with its caret where it was (no place moves a caret)", (await js(`${VIEW}.state.selection.main.head`)) === 0)

// ---- the place is read as the session is WRITTEN, not only once the scrolling has paused (reviewer, 2026-10-16: a quit while
// the page was still gliding kept the place from before the whole flick). A reload a few milliseconds after the wheel (the
// page's beforeunload writes the session), then a real quit (the window's flush handshake) while a wheel is still turning.
await clickTab("Long")
await sleep(1500)
const middle = JSON.parse(await js(`JSON.stringify((() => { const r = ${VIEW}.scrollDOM.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })())`))
const still = await topLine()
for (let i = 0; i < 4; i++) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: middle.x, y: middle.y, deltaX: 0, deltaY: 300 })
await sleep(40)
const flicked = await topLine()
ok("the wheel has just moved the page on", flicked.pos > still.pos, `${show(still)} → ${show(flicked)}`)
await reloadApp()
await sleep(1000)
const reloaded = await topLine()
note(`reload right after a wheel: ${show(still)} → ${show(flicked)} → ${show(reloaded)}`)
ok("reloaded 40 ms after the wheel, the note opens where the wheel took it, not where it was before", sameTop(flicked, reloaded), `${show(still)} → ${show(flicked)} → ${show(reloaded)}`)

await sleep(1500)
const resting = await topLine()
let gliding = true
const glide = (async () => {
  while (gliding) {
    try { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: middle.x, y: middle.y, deltaX: 0, deltaY: 40 }) } catch { break }
    await sleep(16)
  }
})()
await sleep(600)
const gliding1 = await topLine()
const quit = await quitApp()
gliding = false
await glide
ok("the app quits the way a person quits it (the page asked to flush first)", quit)
await restartApp()
await sleep(1500)
const afterQuit = await topLine()
note(`quit while gliding: ${show(resting)} → ${show(gliding1)} → ${show(afterQuit)}`)
ok("quit while the page was still moving: it comes back where it got to, not where it was before the scroll",
  afterQuit.pos >= gliding1.pos && afterQuit.pos > resting.pos, `${show(resting)} → ${show(gliding1)} → ${show(afterQuit)}`)
finish()
