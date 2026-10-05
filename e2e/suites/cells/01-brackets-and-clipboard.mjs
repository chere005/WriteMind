// Cell brackets sit on their cells; a click holds a cell; delete / copy / cut / paste / type-over / move / duplicate.
// (Was e2e/cells.mjs.)
import { ok, finish, js, send, sleep, freshNote, setDoc, doc, key, click, brackets, VIEW, CTRL, SHIFT } from "../../lib/harness.mjs"

await freshNote()
await setDoc("Alpha\n\nBeta line one\nline two\n\n## Head\n\nGamma\n\nDelta")
await sleep(300)

// 1. alignment: every cell bracket sits on its cell's lines
const geo = JSON.parse(await js(`(()=>{const v=${VIEW};const sc=v.scrollDOM.getBoundingClientRect();
 const brs=[...document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)')].map(b=>{const r=b.getBoundingClientRect();return [r.top-sc.top+v.scrollDOM.scrollTop,r.bottom-sc.top+v.scrollDOM.scrollTop]});
 const lines=[...document.querySelectorAll('.cm-line')].map(l=>{const r=l.getBoundingClientRect();return [r.top-sc.top+v.scrollDOM.scrollTop,r.bottom-sc.top+v.scrollDOM.scrollTop,l.textContent]});
 return JSON.stringify({brs,lines})})()`))
const cellsExpected = [["Alpha", "Alpha"], ["Beta line one", "line two"], ["## Head", "## Head"], ["Gamma", "Gamma"], ["Delta", "Delta"]]
ok("five cells have five brackets", geo.brs.length === 5, `brackets=${geo.brs.length}`)
cellsExpected.forEach(([a, b], i) => {
  const l1 = geo.lines.find((l) => l[2].includes(a)), l2 = geo.lines.find((l) => l[2].includes(b))
  const br = geo.brs[i]
  ok(`bracket ${i} aligns with its cell`, br && Math.abs(br[0] - l1[0]) <= 2 && Math.abs(br[1] - l2[1]) <= 2, JSON.stringify({ br, l1, l2 }))
})

const clickBracket = async (i, mods = {}) => {
  const b = (await brackets())[i]
  await click(b.right, b.y, { ctrl: mods.ctrl, shift: mods.shift })
  await sleep(100)
}
const clip = (type) => js(`(()=>{const dt=new DataTransfer();const e=new ClipboardEvent('${type}',{clipboardData:dt,bubbles:true,cancelable:true});${VIEW}.contentDOM.dispatchEvent(e);window.__dt=dt;return JSON.stringify({text:dt.getData('text/plain'),cells:dt.getData('application/x-writemind-cells'),prevented:e.defaultPrevented})})()`)

// 2. delete a held cell
await clickBracket(3) // Gamma
ok("bracket click selects exactly Gamma", (await js(`${VIEW}.state.sliceDoc(${VIEW}.state.selection.main.from,${VIEW}.state.selection.main.to)`)) === "Gamma")
await key("Delete")
ok("Delete removes a held cell and closes up", (await doc()) === "Alpha\n\nBeta line one\nline two\n\n## Head\n\nDelta", JSON.stringify(await doc()))

// 3. copy then paste
await clickBracket(0)
const c = JSON.parse(await clip("copy"))
ok("copy puts the cell's markdown on the clipboard", c.text === "Alpha" && c.cells === "Alpha" && c.prevented, JSON.stringify(c))
await clickBracket(2) // Head
const pasted = await js(`(()=>{const e=new ClipboardEvent('paste',{clipboardData:window.__dt,bubbles:true,cancelable:true});${VIEW}.contentDOM.dispatchEvent(e);return e.defaultPrevented})()`)
ok("paste after a held cell", pasted && (await doc()) === "Alpha\n\nBeta line one\nline two\n\n## Head\n\nAlpha\n\nDelta", JSON.stringify(await doc()))

// 4. cut two cells with a hole (ctrl-click)
await setDoc("One\n\nTwo\n\nThree\n\nFour"); await sleep(300)
await clickBracket(0); await clickBracket(2, { ctrl: true })
const cut = JSON.parse(await clip("cut"))
ok("cut copies both held cells", cut.text === "One\n\nThree", JSON.stringify(cut))
ok("cut leaves the cells between", (await doc()) === "Two\n\nFour", JSON.stringify(await doc()))

// 5. typing over several held cells
await setDoc("One\n\nTwo\n\nThree\n\nFour"); await sleep(300)
await clickBracket(0); await clickBracket(1, { shift: true })
await send("Input.insertText", { text: "X" }); await sleep(200)
ok("typing replaces held cells with the text", (await doc()) === "X\n\nThree\n\nFour", JSON.stringify(await doc()))

// 6. move and duplicate
await setDoc("One\n\nTwo\n\nThree"); await sleep(300)
await clickBracket(1)
await key("ArrowUp", { modifiers: CTRL | SHIFT })
ok("Ctrl-Shift-Up moves the held cell", (await doc()) === "Two\n\nOne\n\nThree", JSON.stringify(await doc()))
await key("d", { modifiers: CTRL | SHIFT })
ok("Ctrl-Shift-D duplicates it", (await doc()).split("Two").length === 3, JSON.stringify(await doc()))

// 7. scroll, then a bracket click still hits (no double scrollTop)
await setDoc(Array.from({ length: 60 }, (_, i) => "Cell " + i).join("\n\n")); await sleep(400)
await js(`${VIEW}.scrollDOM.scrollTop=600`); await sleep(300)
const lit = JSON.parse(await js(`(()=>{const sc=${VIEW}.scrollDOM.getBoundingClientRect();const bs=[...document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)')].filter(b=>{const r=b.getBoundingClientRect();return r.top>sc.top+50&&r.bottom<sc.bottom-20});const b=bs[2].getBoundingClientRect();return JSON.stringify({x:b.right-2,y:(b.top+b.bottom)/2})})()`))
await click(lit.x, lit.y)
await sleep(200)
const picked = await js(`${VIEW}.state.sliceDoc(${VIEW}.state.selection.main.from,${VIEW}.state.selection.main.to)`)
const under = await js(`document.elementsFromPoint(${lit.x - 40},${lit.y}).find(e=>e.classList.contains('cm-line'))?.textContent`)
ok("after scrolling a bracket click picks the cell beside it", picked === under && picked.startsWith("Cell"), JSON.stringify({ picked, under }))
finish()
