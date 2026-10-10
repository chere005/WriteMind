// (e) Find is exact (docs/PLAN-bars-2026-10.md P7): matches across cells, inside code and maths source and in the rendered
// page; the words as the page shows them (a hidden marker line is no match, a text cell's escaped star is one); next and
// previous wrap; the match is selected and scrolled into view (and a closed section that hides it opens); Replace and
// Replace All keep the cells' structure and are ONE undo step; no regex; the words and the switches are remembered for the
// session; closing gives the caret back at the match. Real keys, markdown side and rendered page.
import { ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, selText, key, click, clickEl, focus, setSel, typeText, setRendered, shot, lineBoxes } from "../../lib/harness.mjs"

await freshNote()
const D = [
  "Alpha one", "<!-- markdown -->\n**Alpha** two", "```python\nalpha = 1\n```", "```wl\nAlpha[x]\n```", "star a\\*b done",
  "- alpha item", "> Alpha quote", "[Alpha link](https://example.com/alpha)",
].join("\n\n")
// matches (case blind) that a person can SEE, in order: seven words and the link's address, which the markdown side shows
const count = () => js(`document.querySelector('[data-find=count]')?.textContent`)
const finder = (query) => js(`(()=>{const i=document.querySelector('.find-input'); i.focus(); i.select(); return true})()`).then(() => typeText(query)).then(() => sleep(350))
const open = async () => { await key("f", { ctrl: true }); await sleep(300) }
const closeFind = async () => { await key("Escape"); await sleep(250) }

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  await test(`${side}: the count and the walk across cells, code and maths source`, async () => {
    await setDoc(D, 0); await focus(); await sleep(300)
    await open(); await typeText("alpha"); await sleep(400)
    const N = rendered ? 7 : 8
    ok(rendered ? "seven matches: the page draws the link as its words, its address is not there to find" : "eight matches: the markdown side shows the link's address too", (await count()) === `1 of ${N}`, await count())
    ok("the first is selected exactly", (await selText()) === "Alpha", JSON.stringify(await selText()))
    const seen = []
    for (let i = 1; i < N; i++) { await key("Enter"); await sleep(120); seen.push(await selText()) }
    const want = ["Alpha", "alpha", "Alpha", "alpha", "Alpha", "Alpha", "alpha"].slice(0, N - 1)
    ok("Enter walks to the next each time, all of them selected exactly", JSON.stringify(seen) === JSON.stringify(want), JSON.stringify(seen))
    ok(`the counter says ${N} of ${N} at the last`, (await count()) === `${N} of ${N}`, await count())
    await key("Enter"); await sleep(120)
    ok("Enter past the last wraps to the first", (await count()) === `1 of ${N}` && (await sel())[0] === 0, `${await count()} ${JSON.stringify(await sel())}`)
    await key("Enter", { shift: true }); await sleep(120)
    ok("Shift+Enter before the first wraps to the last", (await count()) === `${N} of ${N}`, await count())
    await key("Enter", { shift: true }); await sleep(120)
    ok("Shift+Enter steps back", (await count()) === `${N - 1} of ${N}`, await count())
    await closeFind()
  })

  await test(`${side}: the words as the page shows them`, async () => {
    await setDoc(D, 0); await focus(); await sleep(300)
    await open(); await typeText("markdown"); await sleep(350)
    ok("the hidden marker line is not a match", (await count()) === "Not found", await count())
    await finder("a*b")
    ok("the star a text cell shows is found, though the file spells it a\\*b", (await count()) === "1 of 1" && (await selText()) === "a\\*b", `${await count()} ${JSON.stringify(await selText())}`)
    await finder("a.c")
    ok("a dot is a dot (no regular expressions)", (await count()) === "Not found", await count())
    await finder("(((")
    ok("brackets do not throw (no regular expression to break)", (await count()) === "Not found", await count())
    await closeFind()
  })

  await test(`${side}: the match is scrolled into view, and a closed section that hides it opens`, async () => {
    const filler = Array.from({ length: 60 }, (_, i) => "Filler " + i).join("\n\n")
    await setDoc(`${filler}\n\nthe needle is here\n\n${filler}`, 0); await focus(); await sleep(400)
    await js(`document.querySelector('.cm-content').cmTile.view.scrollDOM.scrollTop = 0`)
    await open(); await typeText("needle"); await sleep(500)
    const view = `document.querySelector('.cm-content').cmTile.view`
    const box = JSON.parse(await js(`(()=>{const v=${view}; const m=v.state.selection.main; const c=v.coordsAtPos(m.from); const s=v.scrollDOM.getBoundingClientRect(); return JSON.stringify({top:c&&c.top, bottom:c&&c.bottom, sTop:s.top, sBottom:s.bottom, sel:v.state.sliceDoc(m.from,m.to)})})()`))
    ok("the match far below is selected", box.sel === "needle", JSON.stringify(box))
    ok("and on screen", box.top !== null && box.top >= box.sTop && box.bottom <= box.sBottom, JSON.stringify(box))
    await closeFind()
    // a section closed over a match
    await setDoc("# One\n\nplain\n\n## Hidden section\n\nsecret word here\n\n# Two\n\nother", 0); await focus(); await sleep(300)
    await js(`(()=>{const v=document.querySelector('.cm-content').cmTile.view; v.dispatch({selection:{anchor:0}})})()`)
    await key("ArrowUp", { alt: true, shift: true, ctrl: true }).catch(() => {})
    await open(); await typeText("secret"); await sleep(400)
    ok("the match is selected whether or not its section was closed", (await selText()) === "secret", JSON.stringify(await selText()))
    await closeFind()
  })

  await test(`${side}: Replace and Replace All keep the cells and are one undo step each`, async () => {
    await setDoc("Alpha one\n\nalpha two\n\n- alpha item\n\n```python\nalpha = 1\n```", 0); await focus(); await sleep(300)
    const D1 = await doc()
    await key("h", { ctrl: true }); await sleep(350)
    await finder("alpha")
    await js(`document.querySelector('[data-find=replace-toggle]')?.getAttribute('aria-pressed') === 'true' || document.querySelector('[data-find=replace-toggle]').click()`); await sleep(150)
    await js(`(()=>{const i=document.querySelector('input[aria-label="Replace with"]'); i.focus(); i.select()})()`); await typeText("omega"); await sleep(150)
    await clickEl('[data-find=replace]'); await sleep(250)
    ok("Replace changes the selected match only", (await doc()) === D1.replace("Alpha", "omega"), JSON.stringify(await doc()))
    ok("and goes on to the next", (await selText()).toLowerCase() === "alpha", JSON.stringify(await selText()))
    await clickEl('[data-find=replace-all]'); await sleep(300)
    ok("Replace All changes the rest, cells and fences as they were", (await doc()) === D1.replace(/alpha/gi, "omega"), JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(250)
    ok("ONE Ctrl+Z takes Replace All back", (await doc()) === D1.replace("Alpha", "omega"), JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(250)
    ok("and one more takes the single Replace back", (await doc()) === D1, JSON.stringify(await doc()))
    await closeFind()
  })

  await test(`${side}: what Replace writes into a text cell is literal, like typing`, async () => {
    await setDoc("one star here\n\nsecond", 0); await focus(); await sleep(300)
    await key("h", { ctrl: true }); await sleep(350)
    await finder("star")
    await js(`document.querySelector('[data-find=replace-toggle]')?.getAttribute('aria-pressed') === 'true' || document.querySelector('[data-find=replace-toggle]').click()`); await sleep(150)
    await js(`(()=>{const i=document.querySelector('input[aria-label="Replace with"]'); i.focus(); i.select()})()`); await typeText("*x*"); await sleep(150)
    await clickEl('[data-find=replace-all]'); await sleep(300)
    ok("the star that would open emphasis is escaped, as a typed one is (and only that one)", (await doc()) === "one \\*x* here\n\nsecond", JSON.stringify(await doc()))
    await key("z", { ctrl: true }); await sleep(250)
    ok("and one Ctrl+Z takes it back", (await doc()) === "one star here\n\nsecond", JSON.stringify(await doc()))
    await closeFind()
  })

  await test(`${side}: the words and the switches are remembered; Escape gives the caret back at the match`, async () => {
    await setDoc("Alpha alpha ALPHA\n\nsecond note words", 0); await focus(); await sleep(300)
    await open(); await typeText("alpha"); await sleep(300)
    await js(`document.querySelector('[data-find=case]').click()`); await sleep(250)
    ok("the case switch narrows it to the one lower-case match", (await count()) === "1 of 1" && (await selText()) === "alpha", `${await count()} ${JSON.stringify(await selText())}`)
    await closeFind()
    ok("Escape closed the bar", (await js(`!document.querySelector('[data-bar=find]')`)))
    ok("the caret is back in the notes, on the match", (await js(`document.activeElement?.closest('.cm-content') !== null`)) && (await selText()) === "alpha", JSON.stringify(await selText()))
    await setSel(0); await open(); await sleep(300)
    ok("Ctrl+F again comes up with the words it had", (await js(`document.querySelector('.find-input').value`)) === "alpha")
    ok("and the case switch still on", (await js(`document.querySelector('[data-find=case]').getAttribute('aria-pressed')`)) === "true")
    await js(`document.querySelector('[data-find=case]').click()`); await sleep(100)
    await closeFind()
    // Find Next with the bar closed goes on from the selection
    await setSel(0); await key("g", { ctrl: true }); await sleep(250)
    ok("Find Next with the bar closed finds the next (Mac: ⌘G)", (await selText()).toLowerCase() === "alpha", JSON.stringify(await selText()))
  })

  await test(`${side}: every match is marked where it is`, async () => {
    await setDoc(D, 0); await focus(); await sleep(300)
    await open(); await typeText("alpha"); await sleep(500)
    const marks = await js(`(()=>{const h=CSS.highlights.get('wm-find'); return JSON.stringify({drawn: h? [...h].length : 0, decorated: document.querySelectorAll('.wm-find-match').length})})()`).then(JSON.parse)
    if (rendered) ok("the drawn blocks' words are highlighted, the open block's are decorated", marks.drawn >= 4 && marks.decorated >= 1, JSON.stringify(marks))
    else ok("every match is marked: decorated in the markdown, highlighted in the typeset maths cell", marks.decorated + marks.drawn === 8, JSON.stringify(marks))
    await shot(`find-${rendered ? "rendered" : "markdown"}`)
    await closeFind()
    ok("closing takes the marks away", (await js(`document.querySelectorAll('.wm-find-match').length === 0 && (!CSS.highlights.get('wm-find') || [...CSS.highlights.get('wm-find')].length === 0)`)))
  })
}
finish()
