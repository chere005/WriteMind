// The text-cell and fence leftovers (docs/TODO.md "Text cells, what is left", "Fence arrows, what is left"), with real
// key presses and clicks:
// (1) Ctrl+D in a text cell writes each half by the escape rule (a mid-line `#` that now starts a line stays words); in a
//     markdown cell the second half gets a marker of its own; Ctrl+M of a markdown cell under a text cell leaves no
//     marker and writes its markup as literal words (the upper cell's kind wins, as Backspace has it).
// (2) Find / Replace (Ctrl+H, Replace All) writes `**` into a text cell literal, into a markdown cell raw.
// (3) On the rendered page a click on the opening fence the caret already stands on (Left from the first content line)
//     stays on it: the language is clicked into, and a double-click selects it.
// (4) A markdown cell emptied of its words keeps the caret (no bar comes up; typing goes back into it) and goes, marker
//     and blank lines, when the caret leaves it by a key or a click; ONE Ctrl+Z brings the words and the marker back.
// Pure halves: packages/core/test/textCellsSplitMerge.test.ts, packages/editor/test/textCellsLeftovers.test.ts and
// previewFences.test.ts.
import {
  ok, finish, js, sleep, freshNote, setDoc, doc, key, focus, setSel, setRendered, click, dblclick, shot, VIEW, typeText,
  armed, sel, selText,
} from "../../lib/harness.mjs"

const M = "<!-- markdown -->"
const ctrl = { ctrl: true }
const coords = async (pos) => JSON.parse(await js(`JSON.stringify(${VIEW}.coordsAtPos(${pos}))`))
/** The note set to `text`, the caret at `at`, and a pause: the next edit is an Undo step of its own, not joined to this one. */
const fresh = async (text, at) => { await setDoc(text, at); await focus(); await sleep(700) }
const shows = async (from, to) => js(`${VIEW}.dom.querySelector('.cm-content').innerText.includes(${JSON.stringify(from)}) && !${VIEW}.dom.querySelector('.cm-content').innerText.includes(${JSON.stringify(to)})`)

await freshNote()

// ---- (1) Split Cell / Merge Cells keep each cell its kind
await setRendered(false)
let D = "foo # bar"
await fresh(D, D.indexOf("#"))
await key("d", ctrl)
let d = await doc()
ok("Ctrl+D in a text cell: the half that now starts with # is escaped, still words", d === "foo\n\n\\# bar", JSON.stringify(d))
await key("z", ctrl)
ok("...and one Ctrl+Z takes the split back", (await doc()) === D, JSON.stringify(await doc()))

D = `${M}\nfoo **bar** baz`
await setDoc(D, D.indexOf("baz")); await focus()
await key("d", ctrl)
d = await doc()
ok("Ctrl+D in a markdown cell: the second half gets a marker of its own", d === `${M}\nfoo **bar**\n\n${M}\nbaz`, JSON.stringify(d))

D = `plain words\n\n${M}\n**b** and more`
await setDoc(D, 2); await focus()
await key("m", ctrl)
d = await doc()
ok("Ctrl+M of a markdown cell under a text cell: no marker is left", !d.includes(M), JSON.stringify(d))
ok("...and its markup is written as literal words (escaped), in the one text cell", d.startsWith("plain words\n\\*\\*b") && !d.includes("\n\n"), JSON.stringify(d))
await setRendered(true)
await setSel(0); await focus(); await sleep(200)
ok("the rendered page shows the joined cell's ** as typed (not bold)", await shows("**b** and more", "\\*"), await js(`${VIEW}.dom.querySelector('.cm-content').innerText`))
await shot("merged-literal")

// ---- (2) Find / Replace into a text cell is literal, into a markdown cell raw
await setRendered(false)
D = `say bar now\n\n${M}\nsay bar too`
await setDoc(D, 0); await focus(); await sleep(300)
await setSel(D.indexOf("bar"), D.indexOf("bar") + 3); await focus()
await key("h", ctrl); await sleep(400)
ok("Ctrl+H opens the bar with its replace row", await js(`!!document.querySelector('[data-find="replace-all"]')`))
await typeText("**x**")
await js(`document.querySelector('[data-find="replace-all"]').click()`); await sleep(400)
d = await doc()
ok("Replace All writes ** into the text cell as literal words", d.startsWith("say \\*\\*x") && d.split("\n")[0].replace(/\\/g, "") === "say **x** now", JSON.stringify(d))
ok("...and into the markdown cell raw (markdown there)", d.endsWith(`${M}\nsay **x** too`), JSON.stringify(d))
await key("Escape"); await sleep(200)

// ---- (3) A click on the opening fence the caret is on stays there: the language can be clicked into
await setRendered(true)
D = "Intro words\n\n```python\nprint(1)\nx = 2\n```\n\nLast words"
const fence = D.indexOf("```python")
await setDoc(D, 0); await focus(); await sleep(300)
await setSel(D.indexOf("print(1)")); await focus(); await sleep(200)
await key("ArrowLeft"); await sleep(250)
let s = await sel()
ok("Left from the first content line stands the caret on the opening fence", s[1] === fence + 9, s)
await shot("fence-open")
let c = await coords(fence + 6)
await click(c.left, (c.top + c.bottom) / 2); await sleep(250)
s = await sel()
ok("a click in its language stays on the fence, where it was clicked", s[0] === s[1] && s[1] >= fence + 5 && s[1] <= fence + 7, { s, want: fence + 6 })
c = await coords(fence + 5)
await dblclick(c.left + 1, (c.top + c.bottom) / 2); await sleep(250)
ok("a double-click there selects the language", (await selText()) === "python", await selText())
await shot("fence-language-selected")
// (Still: from another line, a click on a fence lands on the content beside it — 05-rendered-fence-arrows.)

// ---- (4) An emptied markdown cell goes when the caret leaves it
D = `before\n\n${M}\nhello\n\nafter`
const words = D.indexOf("hello")
const emptied = `before\n\n${M}\n\n\nafter`
await fresh(D, words + 5)
for (let i = 0; i < 5; i++) await key("Backspace")
await sleep(700)
ok("Backspace empties the words; the marker stays while the caret is in the cell", (await doc()) === emptied, JSON.stringify(await doc()))
ok("...and no bar comes up: the caret is in the cell", !(await armed()) && (await sel())[1] === words, await sel())
await shot("emptied-cell")
await key("ArrowUp"); await sleep(300)
d = await doc()
ok("Up out of the emptied cell: it goes, marker and blank lines", d === "before\n\nafter", JSON.stringify(d))
ok("...and the bar stands between the cells round it", await armed(), await sel())
await shot("emptied-cell-gone")
await key("z", ctrl); await sleep(300)
ok("ONE Ctrl+Z brings the words and the marker back", (await doc()) === D, JSON.stringify(await doc()))
ok("...the caret where it was before the emptying", (await sel())[1] === words + 5, await sel())

// Typing goes back into it; a click elsewhere takes it away.
await setDoc(D, words); await focus(); await sleep(300)
await setSel(words, words + 5); await focus()
await key("Backspace"); await sleep(200)
await typeText("y")
ok("what is typed into the emptied cell goes into it (a markdown cell still)", (await doc()) === `before\n\n${M}\ny\n\nafter`, JSON.stringify(await doc()))
await key("Backspace"); await sleep(200)
c = await coords((await doc()).indexOf("after") + 1)
await click(c.left + 2, (c.top + c.bottom) / 2); await sleep(300)
d = await doc()
ok("a click on another cell takes the emptied cell away", d === "before\n\nafter", JSON.stringify(d))
ok("...and the caret is where it was clicked", (await sel())[1] >= d.indexOf("after") && (await sel())[1] <= d.length, await sel())

// A markdown cell opened at a bar (Ctrl+Shift+7) and left without a word typed leaves nothing behind.
D = "before\n\nafter"
await setDoc(D, 0); await focus(); await sleep(200)
await key("ArrowDown"); await sleep(200)
ok("Down from the first cell arms the bar under it", await armed(), await sel())
// (By the physical 7 key: Shift+7 types &.)
await key("&", { ctrl: true, shift: true, vk: 55, code: "Digit7" }); await sleep(300)
ok("Ctrl+Shift+7 at the bar opens an empty markdown cell", (await doc()).includes(M) && !(await armed()), JSON.stringify(await doc()))
await key("ArrowDown"); await sleep(300)
d = await doc()
ok("Down out of it without typing: no marker is left behind", !d.includes(M) && d === D, JSON.stringify(d))

// On the markdown side too.
await setRendered(false)
D = `before\n\n${M}\nhello\n\nafter`
await setDoc(D, words + 5); await focus(); await sleep(300)
await setSel(words, words + 5); await focus()
await key("Backspace"); await sleep(200)
await key("ArrowDown"); await sleep(300)
d = await doc()
ok("on the markdown side, Down out of an emptied markdown cell takes it away too", d === "before\n\nafter", JSON.stringify(d))
await setRendered(true)

finish()
