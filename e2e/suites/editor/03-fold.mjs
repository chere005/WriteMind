// Folding a section: double-click on its bracket, the + marker, the caret steps over what is hidden,
// the keys (Ctrl+Alt+arrows) and the View menu's Fold All / Unfold All. (Was wm/fold.mjs and chrome2.mjs.)
import { ok, finish, js, sleep, freshNote, setDoc, doc, setSel, sel, key, click, dblclick, brackets, centerOf, menuClick, VIEW, shot } from "../../lib/harness.mjs"

await freshNote()
const note = "# Head\n\nbody one\n\nbody two\n\n# Next\n\nTail"
await setDoc(note); await sleep(400)
const lines = () => js(`[...document.querySelectorAll('.cm-line')].map(l=>l.textContent).join('|')`)
const folds = () => js(`document.querySelectorAll('.wm-folded').length`)
const group = async (i = 0) => (await brackets(".wm-bracket-group"))[i]

// 1. a double-click on a section bracket closes the section
const g = await brackets(".wm-bracket-group")
ok("two section brackets are drawn", g.length === 2, g.length)
await dblclick(g[0].right, g[0].y); await sleep(300)
let shown = await lines()
ok("the body is hidden", !shown.includes("body one") && !shown.includes("body two"), shown)
ok("the next section is still shown", shown.includes("Next") && shown.includes("Tail"), shown)
ok("a fold marker is drawn", (await folds()) === 1)
ok("the note itself is untouched", (await doc()) === note)
ok("the closed bracket is marked", (await js(`document.querySelectorAll('.wm-bracket-folded').length`)) >= 1)
await shot("folded")

// 2. the caret steps over what is hidden
await setSel(6)
await key("ArrowRight")
ok("the caret steps over the fold going forwards", (await sel())[0] === note.indexOf("# Next"), JSON.stringify(await sel()))
await setSel(note.indexOf("# Next"))
await key("ArrowLeft")
ok("and steps back over it", (await sel())[0] === 6, JSON.stringify(await sel()))

// 3. a second double-click opens it
let p = await group()
await dblclick(p.right, p.y); await sleep(300)
ok("a second double-click opens it", (await lines()).includes("body one"), await lines())

// 4. the marker opens it too
p = await group()
await dblclick(p.right, p.y); await sleep(300)
const marker = await js(`(()=>{const m=document.querySelector('.wm-folded');const r=m.getBoundingClientRect();return JSON.stringify({x:r.x+3,y:r.y+5})})()`).then(JSON.parse)
await click(marker.x, marker.y); await sleep(300)
ok("clicking the marker opens it", (await lines()).includes("body one"), await lines())

// 5. the keys
await setSel(1)
await key("ArrowLeft", { ctrl: true, alt: true }); await sleep(300)
ok("Ctrl+Alt+Left folds the section the caret is in", (await folds()) === 1)
await key("ArrowRight", { ctrl: true, alt: true }); await sleep(300)
ok("Ctrl+Alt+Right unfolds it", (await folds()) === 0)
await key("ArrowLeft", { ctrl: true, alt: true, shift: true }); await sleep(300)
ok("Ctrl+Alt+Shift+Left folds them all", (await folds()) >= 1)
await key("ArrowRight", { ctrl: true, alt: true, shift: true }); await sleep(300)
ok("Ctrl+Alt+Shift+Right opens them all", (await folds()) === 0)

// 6. the View menu does the same
await menuClick("foldAll"); await sleep(400)
ok("View > Fold All Sections folds", (await folds()) > 0)
await menuClick("unfoldAll"); await sleep(300)
ok("View > Unfold All Sections unfolds", (await folds()) === 0)
finish()
