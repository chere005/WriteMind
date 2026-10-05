// @e2e flaky
// A long note must stay responsive: real key events to the next two frames, scrolling frame times, and pen moves
// on the drawing layer after dozens of strokes. The limits are generous (they catch an order-of-magnitude
// regression, not a few milliseconds); the measured numbers are printed as notes. (Was perf/bench.mjs.)
import { ok, finish, js, send, sleep, note, seedNotes, openNote, focus, setPen, canvasBox, key } from "../../lib/harness.mjs"

const para = (i) => `## Section ${i}\n\nParagraph ${i} with **bold**, *italic*, \`code\` and a [link](other.md). ` + "Words go on and on to make the line wrap onto a second row. ".repeat(3) + `\n\n- item a ${i}\n- item b ${i}\n\n`
await seedNotes({ "Big.md": "# Big note\n\n" + Array.from({ length: 300 }, (_, i) => para(i)).join("") }, { clean: true })
await openNote("Big")
await sleep(1500)
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]

// ---- typing: a real keyDown to the next two animation frames
await focus()
const frames = () => js(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))`)
const typing = []
for (let i = 0; i < 40; i++) {
  const a = Date.now()
  await send("Input.dispatchKeyEvent", { type: "keyDown", text: "a", key: "a" })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a" })
  await frames()
  typing.push(Date.now() - a)
}
note(`typing key -> 2 frames: median ${pct(typing, 0.5)} ms, p95 ${pct(typing, 0.95)} ms, max ${Math.max(...typing)} ms`)
ok("typing in a long note answers within 120 ms (median)", pct(typing, 0.5) < 120, `median ${pct(typing, 0.5)}`)
ok("...and the slowest 5% within 400 ms", pct(typing, 0.95) < 400, `p95 ${pct(typing, 0.95)}`)

// ---- scrolling
const scroll = JSON.parse(await js(`(async()=>{const s=document.querySelector('.cm-scroller');const t=[];let p=performance.now();
 for(let i=0;i<60;i++){s.scrollTop=i*150;await new Promise(r=>requestAnimationFrame(r));const n=performance.now();t.push(n-p);p=n}
 return JSON.stringify(t)})()`))
note(`scroll frame: median ${pct(scroll, 0.5).toFixed(1)} ms, p95 ${pct(scroll, 0.95).toFixed(1)} ms, max ${Math.max(...scroll).toFixed(1)} ms`)
ok("scrolling a long note keeps frames under 100 ms (median)", pct(scroll, 0.5) < 100, `median ${pct(scroll, 0.5)}`)

// ---- pen ink after many strokes
await js(`document.querySelector('.cm-scroller').scrollTop = 0`)
await setPen(true)
const cb = await canvasBox()
const x = cb.x, y = cb.y
const pen = JSON.parse(await js(`(async()=>{
 const fire=(type,px,py,p)=>{const el=document.elementFromPoint(px,py);el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,clientX:px,clientY:py,pointerId:7,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,pressure:p}))}
 const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()))
 for(let s=0;s<15;s++){ fire('pointerdown',${x}+50,${y}+50+s*8,.5)
   for(let i=1;i<=30;i++){fire('pointermove',${x}+50+i*8,${y}+50+s*8+Math.sin(i/3)*5,.5); await frame()}
   fire('pointerup',${x}+300,${y}+50+s*8,0); await frame() }
 await new Promise(r=>setTimeout(r,800))
 const times=[]
 fire('pointerdown',${x}+50,${y}+400,.5)
 for(let i=1;i<=150;i++){const a=performance.now();fire('pointermove',${x}+50+i*4,${y}+400+Math.sin(i/9)*30,.5);await frame();times.push(performance.now()-a)}
 fire('pointerup',${x}+650,${y}+400,0)
 return JSON.stringify(times)})()`))
note(`pen move + frame after 15 strokes: median ${pct(pen, 0.5).toFixed(1)} ms, p95 ${pct(pen, 0.95).toFixed(1)} ms, max ${Math.max(...pen).toFixed(1)} ms`)
ok("pen ink after 15 strokes keeps frames under 60 ms (median)", pct(pen, 0.5) < 60, `median ${pct(pen, 0.5)}`)
await setPen(false)
finish()
