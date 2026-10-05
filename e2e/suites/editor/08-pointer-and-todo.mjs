// Pointer behaviour in the text: a click beside a line puts the caret on it, double / triple click, a drag,
// shift-click, Select All, Home / End / Ctrl-arrows; ticking a to-do by click; the rendered-page keys.
// (Was tour/t13.mjs and t07.mjs.)
import { waitFor, ok, finish, js, sleep, freshNote, setDoc, doc, sel, setSel, key, click, dblclick, dragPath, line, focus, selText, lineBoxes, rectOf, shot } from "../../lib/harness.mjs"

await freshNote()

// ---- a to-do box ticks and unticks by a click (and the click does not move the caret away from the page)
const D = "# Notes on **everything**\n\nSome *italic* and ~~struck~~ text.\n\n## Todos\n\n- [ ] first thing\n- [x] done thing\n- [ ] third\n\n## Code\n\n```ts\nconst x: number = 42 // answer\n```\n\n> a quote here\n> second\n\n1. one\n2. two\n"
await setDoc(D); await focus(); await sleep(300)
const boxes = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-todo')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,cls:e.className}}))`))
ok("three to-do boxes are drawn, the second one done", boxes.length === 3 && boxes[1].cls.includes("wm-todo-done") && !boxes[0].cls.includes("done"), JSON.stringify(boxes))
await click(boxes[0].x, boxes[0].y)
ok("a click on an open box ticks it", (await doc()).includes("- [x] first thing"))
await click(boxes[0].x, boxes[0].y)
ok("a click again unticks it", (await doc()).includes("- [ ] first thing"))
await click(boxes[1].x, boxes[1].y)
ok("a click on a done box opens it", (await doc()).includes("- [ ] done thing"))
ok("the note is otherwise untouched by the ticking", (await doc()) === D.replace("- [x] done thing", "- [ ] done thing"))

// ---- the rendered page by key
await key("t", { ctrl: true })
await waitFor("document.querySelector('.cm-editor').classList.contains('wm-rendered')", 4000); await sleep(300)
ok("Ctrl+T shows the rendered page", await js(`document.querySelector('.cm-editor').classList.contains('wm-rendered')`))
await shot("rendered")
await key("t", { ctrl: true })
await waitFor("!document.querySelector('.cm-editor').classList.contains('wm-rendered')", 4000); await sleep(300)
ok("and again goes back to the markdown", !(await js(`document.querySelector('.cm-editor').classList.contains('wm-rendered')`)))

// ---- clicks and drags in the text
const T = "# Topic\n\nAlpha para one two three\nsecond line here\n\nBeta para\n\n- item a\n- item b\n\nGamma"
await setDoc(T); await focus(); await sleep(300)
const lb = await lineBoxes()
const y = (i) => Math.round((lb[i][0] + lb[i][1]) / 2)
const content = await rectOf(".cm-content")
const farRight = Math.round(content.x + content.w * 0.8)   // clear of the brackets on the right edge
const alphaEnd = T.indexOf("Alpha") + "Alpha para one two three".length
const alphaStart = T.indexOf("Alpha")

await click(farRight, y(2))
ok("a click far right of a line puts the caret at its end", (await sel())[0] === alphaEnd, JSON.stringify(await sel()))
await setSel(0)
await click(content.x + 2, y(2))
ok("a click in the left margin puts the caret at the line's start", (await sel())[0] === alphaStart, JSON.stringify(await sel()))
await dblclick(content.x + 40, y(2))
ok("a double-click takes the word", (await selText()) === "Alpha", JSON.stringify(await selText()))
await click(content.x + 40, y(2), { clickCount: 3 })
ok("a triple-click takes the line", (await selText()).startsWith("Alpha para one two three"), JSON.stringify(await selText()))
await click(content.x + 40, y(2))
await dragPath(line([content.x + 40, y(2)], [content.x + 70, y(3)], 12))
const dragged = await selText()
ok("a drag across two lines selects from one to the other", dragged.includes("\n") && dragged.length > 15, JSON.stringify(dragged))
await click(content.x + 40, y(2))
await click(content.x + 120, y(3), { shift: true })
ok("shift-click extends the selection from the caret", (await selText()).includes("\n") && (await selText()).length > 20, JSON.stringify(await selText()))
await key("a", { ctrl: true })
ok("Ctrl+A selects the whole note", (await selText()).length === (await doc()).length)
await setSel(40); await key("Home")
const lineStart = (await doc()).lastIndexOf("\n", 39) + 1
ok("Home goes to the start of the line", (await sel())[0] === lineStart, JSON.stringify(await sel()))
await key("End")
ok("End goes to the end of the line", (await sel())[0] > lineStart && (await doc())[(await sel())[0]] === "\n", JSON.stringify(await sel()))
await setSel(alphaStart); await key("ArrowRight", { ctrl: true })
ok("Ctrl+Right jumps a word", (await sel())[0] > alphaStart + 4 && (await sel())[0] <= alphaStart + 6, JSON.stringify(await sel()))
await key("ArrowLeft", { ctrl: true, shift: true })
ok("Ctrl+Shift+Left selects the word back", (await selText()).length >= 4, JSON.stringify(await selText()))
finish()
