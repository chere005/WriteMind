// @e2e isolated
// REOPENING WRITEMIND brings every open note back where it was scrolled to (Sean, 2026-10-16: "remember scroll position when
// switching tabs or reopening writemind"). The app is killed once its session is written (a crash, or a quit) and started
// again: the note in front comes back with the same line at the top at the same height — a note whose picture, above the
// place, has no height until it has loaded again in the new app — and so does each other tab when it is brought to the front.
// A note left on the rendered page comes back on the markdown side (every launch does) with the same words at its top.
import { ok, note, finish, sleep, seedNotes, writeNoteFile, closeAllTabs, openNote, setRendered, setWindowSize, restartApp, js, VIEW } from "../../lib/harness.mjs"
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
finish()
