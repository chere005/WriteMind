// WHERE a capture lands (Sean, 2026-09-22 + the 2026-10-10 plan, P4): the size the viewfinder shows it, one gap BELOW the
// caret's line - never over the heading the caret is on. With the caret in the heading's line, or in a paragraph under it,
// or on a wrapped line, the picture's top edge sits just under THAT line's bottom edge, flush with the text's left edge.
// @e2e video=chart
import { showVideoPane, pickCamera, js, ok, note, finish, sleep, freshNote, saved, setDoc, setSel, focus, setRendered, shot, waitFor } from "../../lib/harness.mjs"

const file = await freshNote()
const TEXT = "# The heading of the note\n\nA first paragraph that is short.\n\nA second paragraph, a little longer than the first one, so the lines differ.\n\nThe last one."
await setDoc(TEXT)
await setRendered(true)   // the ink layer belongs to the rendered page (since 2.17.0)
await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live)
if (!live) finish()
await sleep(500)

/** The picture added last: its top edge and left edge ON SCREEN, from the drawing as saved and the pane it was laid on. */
const lastPicture = async () => {
  const d = await saved(file, (x) => x.items.some((i) => i.kind === "image"))
  const pics = d.items.filter((i) => i.kind === "image")
  const pic = pics[pics.length - 1]
  const geo = JSON.parse(await js(`(() => { const s = document.querySelector('.cm-scroller'); const c = document.querySelector('.wm-canvas').getBoundingClientRect(); return JSON.stringify({ w: s.clientWidth, h: s.clientHeight, top: s.scrollTop, x: c.x, y: c.y }) })()`))
  if (!pic) return null
  const width = pic.width * geo.w, height = width * pic.aspect
  return { top: geo.y + pic.center.y * geo.h - height / 2 - geo.top, left: geo.x + pic.center.x * geo.w - width / 2, height, count: pics.length }
}
/** The bottom edge (screen px) and left edge of the line the caret is on, read off the page itself. */
const caretLine = (pos) => js(`(() => { const v = document.querySelector('.cm-content').cmTile.view; let n = v.domAtPos(${pos}).node; while (n && !(n.classList && n.classList.contains('cm-line'))) n = n.parentNode; const r = n.getBoundingClientRect(); return JSON.stringify({ bottom: r.bottom, left: v.contentDOM.getBoundingClientRect().left }) })()`).then(JSON.parse)
const take = async () => { await js(`document.querySelector('.camera-bar [data-capture=raw]').click()`); await sleep(1800) }

let count = 0
for (const [name, pos] of [["the heading", 5], ["the first paragraph", TEXT.indexOf("short")], ["the second paragraph", TEXT.indexOf("longer")]]) {
  await focus(); await setSel(pos)
  const line = await caretLine(pos)
  await take()
  const pic = await lastPicture()
  ok(`the picture was added (${name})`, !!pic && pic.count === ++count, JSON.stringify(pic))
  if (!pic) continue
  const gap = pic.top - line.bottom
  note(`${name}: line bottom ${line.bottom.toFixed(1)}, picture top ${pic.top.toFixed(1)}, gap ${gap.toFixed(1)}`)
  ok(`with the caret in ${name} the picture lands one small gap below that line, not over it`, gap >= 2 && gap <= 16, `gap ${gap.toFixed(1)}`)
  ok(`...flush with the text's left edge (${name})`, Math.abs(pic.left - line.left) <= 40, `picture ${pic.left.toFixed(1)} text ${line.left.toFixed(1)}`)
}
await shot("placed")
finish()
