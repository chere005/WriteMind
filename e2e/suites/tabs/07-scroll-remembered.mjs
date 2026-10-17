// @e2e isolated
// EACH NOTE COMES BACK WHERE IT WAS SCROLLED TO (Sean, 2026-10-16: "remember scroll position when switching tabs or reopening
// writemind"). A long note scrolled to the middle with the real wheel, on the markdown side and on the rendered page, comes
// back from another tab with the same line at the top, at the same height to a few pixels — not with its caret in the middle,
// not at the top. The place is the TEXT at the top, so it also survives the other pane (the same words at the top), a narrower
// window, and lines written into the note by another program while it was in the background; a picture and typeset maths above
// the place, which take their height only once drawn, do not move it. A note opened for the first time still opens at its top.
// (The relaunch is editor/13.)
import { ok, note, finish, sleep, click, seedNotes, writeNoteFile, closeAllTabs, openNote, setRendered, setWindowSize, js, VIEW, readNoteFile } from "../../lib/harness.mjs"
import { longNote, picturesNote, PICTURE, topLine, topWords, which, wheel, wheelTo, wheelUntil, clickTab, sameTop, show } from "./_scroll.mjs"

await seedNotes({ "Long.md": longNote(), "Other.md": "# Other\n\nA short note.\n", "Fresh.md": longNote("Fresh note") }, { clean: true, reload: false })
await writeNoteFile("Pictures.md", picturesNote(), { entries: PICTURE })
await seedNotes({}, { reload: true })
await closeAllTabs()
await setWindowSize(1440, 900)
await openNote("Other")
await openNote("Long")
await setRendered(false)

// ---- the markdown side: the caret put near the top with the mouse, then the page scrolled away from it with the wheel
const line3 = JSON.parse(await js(`JSON.stringify((() => { const l = [...document.querySelectorAll('.cm-line')].find((x) => x.textContent.startsWith('Line 3 ')); const r = l.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 } })())`))
await click(line3.x, line3.y)
const caretWas = await js(`${VIEW}.state.selection.main.head`)
ok("the caret is in Line 3, near the top", caretWas > 0 && (await js(`${VIEW}.state.doc.lineAt(${VIEW}.state.selection.main.head).text`)).startsWith("Line 3 "), String(caretWas))
let before = await wheelTo(0.45)
ok("the long note is scrolled to the middle by the wheel", before.scrollTop > 1000 && before.scrollTop < before.max - 400, show(before))
await clickTab("Other")
ok("another note is in front", (await js(`${VIEW}.state.doc.toString()`)).startsWith("# Other"))
await clickTab("Long")
let after = await topLine()
note(`markdown: ${show(before)} → ${show(after)}`)
ok("back on the long note: the same line is at the top, at the same height (markdown)", sameTop(before, after), `${show(before)} → ${show(after)}`)
ok("...and the caret is where it was, far above (the place, not the caret, says where the page is)", (await js(`${VIEW}.state.selection.main.head`)) === caretWas)
await sleep(1500)
ok("...and it stays there once the page has settled", sameTop(before, await topLine()), show(await topLine()))

// a second place, part-way into a long wrapped paragraph's lines, and back again twice
await wheel(2, 37)
before = await topLine()
for (const round of [1, 2]) {
  await clickTab("Other")
  await clickTab("Long")
  after = await topLine()
  ok(`a place part-way down a line comes back to the pixel (round ${round})`, sameTop(before, after, 2), `${show(before)} → ${show(after)}`)
}

// ---- the rendered page
await setRendered(true)
await wheel(6, 150)
before = await topLine()
ok("the rendered page is scrolled somewhere else again", before.rendered && before.scrollTop > 1000, show(before))
await clickTab("Other")
await clickTab("Long")
after = await topLine()
note(`rendered: ${show(before)} → ${show(after)}`)
ok("back on the long note: the same block is at the top, at the same height (rendered page)", sameTop(before, after), `${show(before)} → ${show(after)}`)

// ---- the other pane: the words that were at the top of the rendered page are at the top of the markdown side
await wheel(3, 140)
const words = await topWords()
ok("the rendered page shows a numbered line at its top", which(words) !== "", JSON.stringify(words))
await clickTab("Other")
await setRendered(false)
await clickTab("Long")
const markdownWords = await topWords()
note(`other pane: ${JSON.stringify(words)} → ${JSON.stringify(markdownWords)}`)
ok("shown on the other pane, the note opens on the same words at the top", which(words) !== "" && which(markdownWords) === which(words), `${JSON.stringify(words)} → ${JSON.stringify(markdownWords)}`)

// ---- a narrower window while the note was away: the same words still open it
before = await topLine()
const wordsBefore = await topWords()
await clickTab("Other")
await setWindowSize(1000, 900)
await sleep(600)
await clickTab("Long")
ok("the long note is somewhere in its middle before the window changes", which(wordsBefore) !== "" && before.scrollTop > 1000, `${JSON.stringify(wordsBefore)} ${show(before)}`)
ok("after the window was made narrower, the same words are at the top", which(await topWords()) === which(wordsBefore), `${JSON.stringify(wordsBefore)} → ${JSON.stringify(await topWords())}`)
await clickTab("Other")
await setWindowSize(1440, 900)
await sleep(600)
await clickTab("Long")
after = await topLine()
ok("...and back at the old width, the same line at the same height", sameTop(before, after), `${show(before)} → ${show(after)}`)

// ---- lines written into the note by another program while it was in the background
await clickTab("Other")
const text = await readNoteFile("Long.md")
await writeNoteFile("Long.md", text.replace("# Long note\n\n", "# Long note\n\n" + "A line from another editor.\n\n".repeat(12)))
await sleep(1200)
await clickTab("Long")
ok("the note holds the lines written elsewhere", (await js(`${VIEW}.state.doc.toString()`)).includes("A line from another editor."))
ok("and opens on the same words at the top all the same", which(wordsBefore) !== "" && which(await topWords()) === which(wordsBefore), `${JSON.stringify(wordsBefore)} → ${JSON.stringify(await topWords())}`)

// ---- a picture and typeset maths above the place
await openNote("Pictures")
await sleep(800)
ok("the pictures note shows its picture and its maths", await js(`!!document.querySelector('.cm-content img') && !!document.querySelector('.cm-content math')`))
before = await wheelUntil("Row 3")
ok("the pictures note is scrolled to just below the picture and the maths", which(before.text) === "Row 3", show(before))
await clickTab("Long")
await clickTab("Pictures")
after = await topLine()
note(`pictures: ${show(before)} → ${show(after)}`)
ok("back on it: the same line at the top, at the same height, the picture and maths above it", sameTop(before, after), `${show(before)} → ${show(after)}`)
await setRendered(true)
await sleep(300)
await wheel(2, 40)
before = await topLine()
ok("the pictures note is scrolled just below the picture on the rendered page", before.rendered && which(before.text).startsWith("Row"), show(before))
await clickTab("Long")
await clickTab("Pictures")
after = await topLine()
note(`pictures, rendered: ${show(before)} → ${show(after)}`)
ok("...and on the rendered page", sameTop(before, after), `${show(before)} → ${show(after)}`)
await setRendered(false)

// ---- a note opened for the first time opens at its top; a link or Find still move the page on purpose (editor/04, cells/14)
await openNote("Fresh")
const fresh = await topLine()
ok("a note opened for the first time opens at its top", fresh.scrollTop === 0 && fresh.text.includes("Fresh note"), show(fresh))
finish()
