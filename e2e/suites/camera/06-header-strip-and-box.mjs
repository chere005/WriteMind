// The video pane as the 2026-10-10 wireframes draw it (docs/PLAN-bars-2026-10.md P4): a 36px header that never wraps or
// clips (460 / 438 / 280px wide), Writing | Image | Raw as one segmented control with the last-taken one lifted, the box's
// four corner handles and its row, Hold's frame and badge, Zoom's magnification, the footer's one line and its fact, the
// toast for what an action did, and the "What should this pane show?" cards when there is no source.
// @e2e video=chart
import { showVideoPane, pickCamera, js, ok, finish, sleep, drag, freshNote, shot, waitFor, rectOf, key, pickFromMenu, openVideoMenu } from "../../lib/harness.mjs"

// (The lifted take is remembered between launches, and the scripts of this suite share one profile: this one starts from the
// default, Writing, whatever an earlier script last took.)
await js(`localStorage.removeItem('writemind.captureMode')`)
await freshNote()
await showVideoPane()
await pickCamera()
const live = await waitFor(`(() => { const v = document.querySelector('.camera video'); return v && v.videoWidth > 0 && v.readyState >= 2 })()`, 15000)
ok("the (fake) camera is delivering frames", live)
if (!live) finish()
await sleep(500)
const width = (w) => js(`document.querySelector('.app').style.setProperty('--video-w', '${w}px')`).then(() => sleep(450))
const head = () => js(`(() => { const h = document.querySelector('.camera-head'); const r = h.getBoundingClientRect(); const kids = [...h.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return JSON.stringify({ h: r.height, scroll: h.scrollWidth, client: h.clientWidth, inside: kids.every((k) => k.left >= r.left - 0.5 && k.right <= r.right + 0.5), wrap: new Set(kids.map((k) => Math.round((k.top + k.bottom) / 2 / 4))).size, seg: [...h.querySelectorAll('[data-capture]')].map((b) => b.textContent.trim()) }) })()`).then(JSON.parse)

// 1. the header at the widths that matter
for (const w of [460, 438, 280]) {
  await width(w)
  const h = await head()
  ok(`${w}px: the header is exactly 36px, on one row, and nothing is clipped`, h.h === 36 && h.wrap === 1 && h.inside && h.scroll <= h.client, JSON.stringify(h))
  ok(`${w}px: the takes read ${w >= 340 ? "Writing | Image | Raw" : "as icons only"}`, w >= 340 ? h.seg.join("|") === "Writing|Image|Raw" : h.seg.every((t) => t === ""), JSON.stringify(h.seg))
}
await width(438)
await shot("header-438")
ok("the camera's source is not chosen in the pane's header (no select, no source menu)", await js(`!document.querySelector('.camera-head select') && ![...document.querySelectorAll('.camera-head button')].some((b) => /camera|device|source/i.test(b.getAttribute('aria-label') ?? '') && b.hasAttribute('aria-haspopup'))`))
ok("it has turn left / right, Zoom, Hold and Straighten", await js(`['[data-camera-turn=left]', '[data-camera-turn=right]', '[data-camera-zoom=square]', '[data-camera=hold]'].every((s) => !!document.querySelector('.camera-head ' + s)) && [...document.querySelectorAll('.camera-head button')].some((b) => b.title.startsWith('Square the page up'))`))
ok("the live tab names the camera in use (never a path)", /^Live/.test(await js(`document.querySelector('[data-scan-tab=camera]').textContent`)) && !/[\\/]/.test(await js(`document.querySelector('[data-scan-tab=camera]').textContent`)))

// 2. the footer: one standing line and one fact
const status = () => js(`JSON.stringify({ line: document.querySelector('.camera [data-camera=status-line]')?.textContent, fact: document.querySelector('.camera [data-camera=status-fact]')?.textContent })`).then(JSON.parse)
let s = await status()
ok("the footer line is the standing hint, short", /Point it at a page · drag a box for a part/.test(s.line ?? "") && (s.line ?? "").length < 60, JSON.stringify(s))
ok("...and its fact is the picture's size", /^\d+×\d+$/.test(s.fact ?? ""), JSON.stringify(s))

// 3. the lifted take
ok("Writing is lifted to begin with", await js(`document.querySelector('[data-capture=ink]').classList.contains('on') && !document.querySelector('[data-capture=page]').classList.contains('on')`))
const box = async (a, b) => { const r = await rectOf(".camera-body"); await drag(r.x + r.w * a[0], r.y + r.h * a[1], r.x + r.w * b[0], r.y + r.h * b[1], { steps: 8 }); await sleep(300) }
await box([0.15, 0.4], [0.6, 0.65])
ok("a box shows its four corner handles", await js(`document.querySelectorAll('.camera .box .handle').length`) === 4)
const row = await rectOf(".camera [data-camera=box-actions]")
ok("...and a row Writing | Image | Text | clear under it", !!row && await js(`[...document.querySelectorAll('.camera [data-camera=box-actions] button')].map((b) => b.dataset.section || b.dataset.boxAction).join('|')`) .then((t) => /^writing\|image\|(text\|)?clear$/.test(t)))
await shot("box-row")

// 4. resizing by a corner handle
const before = await rectOf(".camera .box")
const handle = await rectOf(".camera .box .handle[data-handle=se]")
await drag(handle.x + handle.w / 2, handle.y + handle.h / 2, handle.x + handle.w / 2 + 40, handle.y + handle.h / 2 + 30, { steps: 6 })
await sleep(300)
const after = await rectOf(".camera .box")
ok("dragging the south-east handle grows the box about its north-west corner", Math.abs(after.x - before.x) < 1.5 && Math.abs(after.y - before.y) < 1.5 && after.w > before.w + 30 && after.h > before.h + 20, JSON.stringify({ before, after }))
const nw = await rectOf(".camera .box .handle[data-handle=nw]")
await drag(nw.x + nw.w / 2, nw.y + nw.h / 2, nw.x + nw.w / 2 + 60, nw.y + nw.h / 2 + 60, { steps: 6 })
await sleep(300)
const shrunk = await rectOf(".camera .box")
ok("the north-west handle moves that corner and keeps the opposite one", Math.abs((shrunk.r) - after.r) < 1.5 && Math.abs((shrunk.b) - after.b) < 1.5 && shrunk.w < after.w - 40, JSON.stringify({ after, shrunk }))

// 5. taking: the lifted one follows, the toast says what was done, and it goes by itself
await js(`document.querySelector('.camera [data-section=image]').click()`)
await sleep(1800)
ok("Image is lifted after taking it (the header's and the box row's)", await js(`document.querySelector('[data-capture=page]').classList.contains('on') && !document.querySelector('[data-capture=ink]').classList.contains('on') && localStorage.getItem('writemind.captureMode') === '"page"'`))
const toast = await js(`document.querySelector('.camera [data-toast]')?.textContent ?? ''`)
ok("a toast under the header says what was added and where", /^✓ Image added to /.test(toast), toast)
const trect = await rectOf(".camera [data-toast]"), hrect = await rectOf(".camera-head")
ok("...at the header's right edge, under it", !!trect && trect.y >= hrect.b && trect.r <= hrect.r + 0.5 && trect.r >= hrect.r - 24, JSON.stringify({ trect, hrect }))
ok("...and the footer line did not become a sentence about it", !/added|✓/.test((await status()).line ?? ""))
await shot("toast")
await sleep(5200)
ok("the toast goes by itself", await js(`!document.querySelector('.camera [data-toast]')`))
await box([0.2, 0.4], [0.5, 0.6])
ok("a box is up again", await js(`!!document.querySelector('.camera .box')`))
await js(`document.querySelector('.camera [data-box-action=clear]').click()`)
await sleep(200)
ok("the row's \u2715 puts the box away", await js(`!document.querySelector('.camera .box') && !document.querySelector('.camera [data-camera=box-actions]')`))

// 6. Hold: a frame round the picture and a badge
await js(`document.querySelector('.camera [data-camera=hold]').click()`)
await sleep(400)
ok("Hold frames the picture and says Held · Esc", await js(`!!document.querySelector('.camera .held-frame') && /Held/.test(document.querySelector('.camera [data-camera=held]')?.textContent ?? '') && /Esc/.test(document.querySelector('.camera [data-camera=held]')?.textContent ?? '')`))
ok("...and the footer says it is held", /Held still/.test((await status()).line ?? ""), JSON.stringify(await status()))
await shot("held")
await js(`document.querySelector('.camera [data-camera=hold]').click()`)
await sleep(300)

// 7. Zoom: the hint is under the header; a set box lights Zoom with its magnification
await js(`document.querySelector('.camera [data-camera-zoom=square]').click()`)
await sleep(250)
const hint = await rectOf(".camera .zoom-hint")
ok("armed, Zoom's hint sits in the picture's area, below the header and the strip", !!hint && hint.y >= (await rectOf(".camera-body")).y, JSON.stringify(hint))
await box([0.2, 0.4], [0.55, 0.62])
ok("a zoom box lights Zoom and reads its magnification", await js(`document.querySelector('[data-camera-zoom=square]').classList.contains('on') && /^\\d+%$/.test(document.querySelector('[data-camera-zoom=square]').textContent.trim())`), await js(`document.querySelector('[data-camera-zoom=square]').textContent`))
await shot("zoomed")
await width(300)
ok("a narrow pane drops the readout but keeps the header whole", await js(`document.querySelector('[data-camera-zoom=square]').classList.contains('on') && document.querySelector('.camera-head').scrollWidth <= document.querySelector('.camera-head').clientWidth`))
await width(438)
await pickFromMenu(".camera-head [data-camera-zoom=square]", "zoom-original")
ok("Original Size in Zoom's menu puts the whole picture back", await js(`!document.querySelector('[data-camera-zoom=square]').classList.contains('on')`))

// 8. no source: the pane asks, with a card for each way
// (The source is turned off in the video button's menu, in the tab row: `video-options` is that menu since the tab row took it over.)
await openVideoMenu()
await js(`document.querySelector('.float-menu [data-bar=video-off]').click()`)
await sleep(800)
ok("with no source the pane asks What should this pane show?", /What should this pane show\?/.test(await js(`document.querySelector('.camera .placeholder .title')?.textContent ?? ''`)))
ok("...with a card for the tablet, Refresh devices and Hide this pane", await js(`!!document.querySelector('.camera .source-card[data-source=tablet]') && !!document.querySelector('.camera [data-action=refresh]') && !!document.querySelector('.camera [data-action=hide]')`))
ok("...and Hold, Straighten and the takes are off with no picture", await js(`document.querySelector('[data-camera=hold]').disabled && document.querySelector('[data-capture=raw]').disabled && [...document.querySelectorAll('.camera-head button')].find((b) => b.title.startsWith('Square the page up')).disabled`))
await width(280)
await shot("no-source-280")
ok("at 280px the cards and links stay inside the pane", await js(`(() => { const p = document.querySelector('.camera').getBoundingClientRect(); return [...document.querySelectorAll('.camera .placeholder button')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= p.left - 0.5 && r.right <= p.right + 0.5 }) })()`))
await width(438)
await js(`document.querySelector('.camera .source-card[data-source=tablet]').click()`)
ok("the tablet's card makes the pane a sheet", await waitFor(`!!document.querySelector('.camera .tablet')`, 4000))
finish()
