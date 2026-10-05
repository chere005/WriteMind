// @e2e flaky
// @e2e timeout=240
// A LONG, REALISTIC note (~3500 lines, ~300 sections nested two deep, lists, to-dos, code, maths, pictures) and
// what the perf lane measured on it (docs/PARITY.md "Editor performance"). The exact checks catch the regressions
// that were fixed: the drawing layer was cleared and painted again on every scroll step (a dropped frame on nearly
// every wheel step, ink or none); now a blank layer is never touched, and ink lives in the scroller and is painted
// again about once a pane, and is still under its strokes' points after scrolling. A keystroke writes nothing to the
// bracket column (it rebuilt every bracket below the caret). The timings have generous limits (an order of
// magnitude, not milliseconds) and are printed.
import fs from "node:fs"
import path from "node:path"
import {
  ok, finish, js, send, sleep, until, note, seedNotes, notesDir, closeAllTabs, VIEW, shot,
} from "../../lib/harness.mjs"

/** The note: 30 parts of 9 sections (every third a level deeper), each with a paragraph and the furniture of a real note. */
function longNote() {
  const out = ["# Field notebook", "", "An index of everything, with *emphasis*, **strong** words and a [link](Small.md).", ""]
  let n = 0
  for (let part = 1; part <= 30; part++) {
    out.push(`## Part ${part}: notes and working`, "", `Part ${part} opens with a paragraph long enough to wrap, with \`code\` and **bold**.`, "")
    for (let s = 1; s <= 9; s++) {
      n++
      out.push(`${s % 3 === 0 ? "####" : "###"} Section ${part}.${s} on topic ${n}`, "")
      out.push(`Paragraph ${n}: the words go on so that the line wraps, with *italic*, **bold**, \`inline code\` and \`wl:Integrate[x^${n % 5 + 1}, {x, 0, 1}]\` in it. ` + "More words to make a long line. ".repeat(2), "")
      if (n % 2 === 0) out.push(`- item one of ${n}`, "- item two with **bold**", `  - nested item ${n}`, "- item three", "")
      else out.push(`1. first step ${n}`, "2. second step", "3. third step", "")
      if (n % 3 === 0) out.push(`- [ ] a task to do ${n}`, `- [x] a task done ${n}`, "")
      if (n % 5 === 0) out.push("```python", `def f${n}(x):`, `    return x * ${n}`, "```", "")
      if (n % 7 === 0) out.push("```wl", `Sum[1/k^2, {k, 1, ${n}}]`, "```", "")
      if (n % 37 === 0) out.push(`![picture ${n}](pics/p.png)`, "")
    }
  }
  out.push("## The end", "", "Last words.", "")
  return out.join("\n")
}
/**
 * `count` pen strokes spread down the WHOLE note, 30 points each, with pressure. The sidecar's coordinates are the pane's
 * size (y = 1 is one pane down), so a note `screens` panes long has its ink up to y = screens.
 */
function ink(count, screens) {
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const items = []
  for (let i = 0; i < count; i++) {
    const x0 = 0.1 + rnd() * 0.7, y0 = rnd() * (screens - 0.05)
    const points = [], pressures = []
    for (let k = 0; k < 30; k++) { points.push({ x: x0 + k * 0.004, y: y0 + Math.sin(k / 4) * 0.002 }); pressures.push(0.5) }
    items.push({ kind: "stroke", id: `s${i}`, colorHex: "#1C1C1E", width: 2, points, pressures, transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, group: null })
  }
  return JSON.stringify({ items })
}
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]
const frames = () => js(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))`)

const BIG = longNote()
const root = await notesDir()
fs.mkdirSync(path.join(root, "pics"), { recursive: true })
const icon = new URL("../../../apps/desktop/out/renderer/icon.png", import.meta.url)
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(root, "pics", "p.png"))
await seedNotes({ "Big.md": BIG }, { clean: true })
const file = await js(`[...document.querySelectorAll('.note-row')].map(r=>r.dataset.path).find(p=>p.replace(/\\\\/g,'/').endsWith('/Big.md'))`)
async function open() {
  await closeAllTabs()
  await js(`[...document.querySelectorAll('.note-row')].find(r=>r.dataset.path===${JSON.stringify(file)})?.click()`)
  await until(() => js(`(()=>{const c=document.querySelector('.cm-content');return !!c && c.cmTile.view.state.doc.length===${BIG.length}})()`), 15000, 50)
  await sleep(1500)
}
await js(`window.wm.writeDrawing(${JSON.stringify(file)}, '{"items":[]}')`)
await open()
note(`note: ${BIG.split("\n").length} lines, ${(BIG.match(/^#{2,4} /gm) || []).length} sections`)

// ---- scrolling with the wheel: frame intervals, and what the drawing layer does
const box = JSON.parse(await js(`(()=>{const r=document.querySelector('.cm-scroller').getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
/** Wheel down `steps` times; the rAF intervals meanwhile, and how often a drawing layer (not the tablet's) was cleared. */
async function wheel(steps) {
  await js(`(()=>{document.querySelector('.cm-scroller').scrollTop=0;
    if(!window.__clears){window.__clears=0;const was=CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.closest&&this.canvas.closest('.wm-ink, .wm-canvas'))window.__clears++;return was.apply(this,a)}}
    window.__f=[];let p=performance.now();window.__run=true;const tick=(n)=>{if(!window.__run)return;window.__f.push(n-p);p=n;requestAnimationFrame(tick)};requestAnimationFrame(tick)})()`)
  await sleep(400)
  await js(`(()=>{window.__f=[];window.__clears=0})()`)
  for (let i = 0; i < steps; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: 100 }); await sleep(16) }
  await sleep(300)
  const r = JSON.parse(await js(`(()=>{window.__run=false;return JSON.stringify({f:window.__f.slice(1),clears:window.__clears,top:document.querySelector('.cm-scroller').scrollTop})})()`))
  return { ...r, dropped: r.f.filter((x) => x > 33).length / Math.max(1, r.f.length) }
}
const blank = await wheel(120)
note(`wheel, no ink: ${blank.f.length} frames, median ${pct(blank.f, 0.5).toFixed(1)} ms, p95 ${pct(blank.f, 0.95).toFixed(1)} ms, ${(blank.dropped * 100).toFixed(1)}% over 33 ms; drawing layer cleared ${blank.clears} times`)
ok("the wheel scrolled the note", blank.top > 5000, `scrollTop ${blank.top}`)
ok("a drawing layer with nothing on it is not cleared while scrolling", blank.clears === 0, `${blank.clears} clears`)
ok("wheel scrolling drops under 20% of frames (it was 26% before the fix; bare CodeMirror ~10%)", blank.dropped < 0.2, `${(blank.dropped * 100).toFixed(1)}%`)

const screens = await js(`(()=>{const s=document.querySelector('.cm-scroller');return s.scrollHeight/s.clientHeight})()`)
await js(`window.wm.writeDrawing(${JSON.stringify(file)}, ${JSON.stringify(ink(500, screens))})`)
await open()
const inked = await wheel(120)
note(`wheel, 500 strokes: median ${pct(inked.f, 0.5).toFixed(1)} ms, p95 ${pct(inked.f, 0.95).toFixed(1)} ms, ${(inked.dropped * 100).toFixed(1)}% over 33 ms; drawing layer cleared ${inked.clears} times`)
ok("with 500 strokes the ink is painted again as the page leaves its band, about once a pane, not on every wheel step", inked.clears > 0 && inked.clears < 40, `${inked.clears} clears over 120 steps`)
ok("...and wheel scrolling still drops under 20% of frames", inked.dropped < 0.2, `${(inked.dropped * 100).toFixed(1)}%`)
// The ink is where its strokes are, after all that scrolling: the middle point of each stroke on the page is inked.
const middles = JSON.parse(ink(500, screens)).items.map((item) => item.points[15])
const onPage = JSON.parse(await js(`(()=>{const c=document.querySelector('.wm-ink');const s=document.querySelector('.cm-scroller');
  const pane=document.querySelector('.wm-canvas').getBoundingClientRect();const box=c.getBoundingClientRect();const r=c.width/box.width;const g=c.getContext('2d');
  const out=[];for(const p of ${JSON.stringify(middles)}){const x=p.x*pane.width,y=p.y*pane.height;
    if(y<s.scrollTop+20||y>s.scrollTop+s.clientHeight-20||x>box.width-4)continue;
    let a=0;for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const d=g.getImageData(Math.round((x+dx)*r),Math.round((y-c.offsetTop+dy)*r),1,1).data;a=Math.max(a,d[3])}
    out.push(a)}
  return JSON.stringify(out)})()`))
ok("after scrolling, the ink is under its strokes' own points", onPage.length >= 2 && onPage.filter((a) => a > 0).length === onPage.length, JSON.stringify(onPage))
await shot("ink-scrolled")

// ---- typing in the middle of the note (500 strokes on the layer)
const caretAt = async (pos) => {
  await js(`(()=>{const v=${VIEW};v.dispatch({selection:{anchor:${pos}},effects:v.constructor.scrollIntoView(${pos},{y:'center'})});v.focus()})()`)
  await sleep(400)
}
const press = async (k, code, vk, text) => {
  const a = performance.now()
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, text })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk })
  await frames()
  return performance.now() - a
}
// A short line (it cannot wrap onto another row): what a keystroke writes to the bracket column.
await caretAt(BIG.indexOf("- item three", BIG.indexOf("Paragraph 150:")) + "- item three".length)
await js(`(()=>{window.__gm=0;window.__go=new MutationObserver((rs)=>{window.__gm+=rs.length});window.__go.observe(document.querySelector('.wm-gutter'),{subtree:true,childList:true,attributes:true})})()`)
for (let i = 0; i < 5; i++) { await press("x", "KeyX", 88, "x"); await press("Backspace", "Backspace", 8) }
await sleep(200)
const gutterWrites = await js(`(()=>{window.__go.disconnect();return window.__gm})()`)
ok("a keystroke that moves no bracket on the screen writes nothing to the bracket column", gutterWrites === 0, `${gutterWrites} mutations over 10 keys`)

await caretAt(BIG.indexOf("Paragraph 150:") + 20)
for (let i = 0; i < 5; i++) await press("a", "KeyA", 65, "a")
const typing = []
for (let i = 0; i < 40; i++) typing.push(await press("a", "KeyA", 65, "a"))
note(`typing key -> 2 frames: median ${pct(typing, 0.5).toFixed(1)} ms, p95 ${pct(typing, 0.95).toFixed(1)} ms (two frames are 33 ms)`)
ok("typing in the long note answers within 60 ms (median)", pct(typing, 0.5) < 60, `median ${pct(typing, 0.5).toFixed(1)}`)

// ---- Enter and Backspace at a section boundary (the caret at the start of a heading)
const enter = [], back = []
const length = await js(`${VIEW}.state.doc.length`)
for (let i = 0; i < 8; i++) {
  await caretAt(await js(`${VIEW}.state.doc.toString().indexOf('### Section 16.4')`))
  enter.push(await press("Enter", "Enter", 13, "\r"))
  back.push(await press("Backspace", "Backspace", 8))
}
note(`Enter at a section boundary: median ${pct(enter, 0.5).toFixed(1)} ms, p95 ${pct(enter, 0.95).toFixed(1)}; Backspace: median ${pct(back, 0.5).toFixed(1)} ms, p95 ${pct(back, 0.95).toFixed(1)}`)
ok("Enter and Backspace at a section boundary answer within 80 ms (median)", pct(enter, 0.5) < 80 && pct(back, 0.5) < 80)
ok("...and each Backspace takes back exactly what its Enter put in", (await js(`${VIEW}.state.doc.length`)) === length)
finish()
