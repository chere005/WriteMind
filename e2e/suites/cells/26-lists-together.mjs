// @e2e timeout=420
// THE 3.10.0 LIST RULES TOGETHER, typed as a person types them (Sean, 2026-10-11): "typing a * while the input cursor is
// horizontal will start a markdown text cell with bullet points with the input cursor ready to start typing", "the input cursor
// should go to where it is typing when inserting a checklist or bullets", "this should not be two separate cells" and "ctrl +
// enter adds a newline without leaving the current cell..". Each has its own scripts (editor/10-12, cells/22-25); this is the
// note Sean was making when he asked, start to end, on the markdown side and the rendered page: a `*` at the bar, dots (Sean,
// 2026-10-12: "dots"), Return,
// Return, Style ▸ To-do, to-dos, Ctrl+Enter in a to-do, Return after it — one list cell all the way, the caret drawn where each
// first character lands, and the note saved as typed.
import {
  ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, key, focus, setSel, setRendered, armed, typeText, shot, clickEl, VIEW, CTRL,
} from "../../lib/harness.mjs"

const cells = () => js(`document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)').length`)
const label = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
const pickKind = async (row) => { await clickEl('[data-bar=style]'); await sleep(250); await clickEl(`.float-menu [data-bar="kind-${row}"]`); await sleep(350) }
/** The drawn caret's middle x and height, or null when none is drawn. */
const caretBox = async () => JSON.parse(await js(`(()=>{const c=document.querySelector('.cm-cursor-primary');if(!c)return 'null';const s=getComputedStyle(c);if(s.display==='none'||s.visibility==='hidden')return 'null';const r=c.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,h:r.height})})()`))
/** Where the character just typed was drawn: its left edge. */
const lastCharLeft = () => js(`(()=>{const v=${VIEW};const r=v.coordsAtPos(v.state.selection.main.head-1,1);return r?r.left:null})()`)

/** Type `words` where the caret is, first checking that the caret was DRAWN where the first character then lands. */
async function typeAtCaret(what, words) {
  const before = await caretBox()
  await typeText(words[0]); await sleep(200)
  const landed = await lastCharLeft()
  ok(`${what}: the caret was drawn where the first character landed, at full height`,
    before !== null && landed !== null && Math.abs(before.x - landed) <= 3 && before.h >= 15, JSON.stringify({ before, landed }))
  if (words.length > 1) await typeText(words.slice(1))
  await sleep(250)
}

await freshNote()
for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  await test(`${side}: Sean's list, typed start to end, is one cell`, async () => {
    await setDoc("Top", 3); await setSel(0); await setSel(3); await focus(); await sleep(300)
    await key("ArrowDown"); await sleep(300)
    ok("Down from the end of the cell arms the bar", await armed())

    await typeText("*"); await sleep(400)
    ok("a `*` at the bar opens a bullet list of dots: `- `", (await doc()) === "Top\n\n- " && !(await armed()), JSON.stringify(await doc()))
    ok("the Style button says Dots", (await label()) === "Dots", String(await label()))
    await typeAtCaret("after the `*`", "hello")
    ok("the words are the item's, not escaped", (await doc()) === "Top\n\n- hello", JSON.stringify(await doc()))

    await key("Enter"); await sleep(300)
    await typeAtCaret("after Return on a dot", "there")
    await key("Enter"); await sleep(300)
    await key("Enter"); await sleep(300)
    ok("Return on the empty dot takes its marker off and keeps the line in the cell",
      (await doc()) === "Top\n\n- hello\n- there\n" && !(await armed()), JSON.stringify([await doc(), await armed()]))

    await pickKind("list-todo")
    ok("Style ▸ To-do makes that line a to-do", (await doc()) === "Top\n\n- hello\n- there\n- [ ] ", JSON.stringify(await doc()))
    await typeAtCaret("after Style ▸ To-do", "Are you")
    await key("Enter"); await sleep(300)
    await typeAtCaret("after Return on a to-do", "Doing today")
    ok("two cells: Top, and the list (dots and to-dos together)", (await cells()) === 2, String(await cells()))
    ok("the Style button names the item the caret is on: To-do", (await label()) === "To-do", String(await label()))

    await key("Enter", { modifiers: CTRL }); await sleep(300)
    ok("Ctrl+Enter in the to-do: a new line, no new box, the bar not armed",
      (await doc()).endsWith("- [ ] Doing today\n      <br>") && !(await armed()), JSON.stringify(await doc()))
    await typeText("and more"); await sleep(300)
    ok("the words typed there are the to-do's next line", (await doc()).endsWith("- [ ] Doing today\n      and more"), JSON.stringify(await doc()))
    ok("still two cells", (await cells()) === 2, String(await cells()))

    await key("Enter"); await sleep(300)
    ok("Return after it adds the next to-do after the item's last line",
      (await doc()).endsWith("- [ ] Doing today\n      and more\n- [ ] "), JSON.stringify(await doc()))
    await typeAtCaret("after Return under Ctrl+Enter's line", "Last")
    const want = "Top\n\n- hello\n- there\n- [ ] Are you\n- [ ] Doing today\n      and more\n- [ ] Last"
    ok("the note is exactly what was typed", (await doc()) === want, JSON.stringify(await doc()))
    ok("and it is still two cells", (await cells()) === 2, String(await cells()))

    // Drawn once the caret has left the list: each item its own kind, the next line a line of its item.
    await setSel(1); await sleep(400)
    if (rendered) {
      const drawn = JSON.parse(await js(`JSON.stringify({ boxes: document.querySelectorAll('.wm-pv-box').length,
        marks: [...document.querySelectorAll('.wm-pv-mark')].map(e=>e.textContent),
        items: [...document.querySelectorAll('.wm-pv-li')].map(e=>e.innerText.trim()) })`))
      ok("the rendered page draws two dots and three boxes", drawn.boxes === 3 && JSON.stringify(drawn.marks) === JSON.stringify(["•", "•"]), JSON.stringify(drawn))
      ok("and `and more` is a line of `Doing today`, not an item", drawn.items.some((one) => /^Doing today\s*\n\s*and more$/.test(one)) && drawn.items.length === 5, JSON.stringify(drawn.items))
    } else {
      ok("the markdown side draws three boxes", (await js(`document.querySelectorAll('.wm-todo').length`)) === 3)
    }
    await shot(`${rendered ? "rendered" : "markdown"}-lists-together`)
  })
}
finish()
