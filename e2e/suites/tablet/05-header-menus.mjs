// The tablet sheet's header and layout as the 2026-10-10 wireframe draws them (docs/PLAN-bars-2026-10.md P4): one 36px row
// (Paper, orientation, Undo ... Bring in, close) that never wraps or clips at 438 and 280px, never sits on the sheet (the
// sheet is letterboxed in what is left under it and its top never jumps), menus that open from the button and close on
// Escape / click-away, the footer's one line and its fact, the sheet's tab strip.
import { js, ok, finish, sleep, freshNote, key, noGrab, pickTablet, showVideoPane, tabletBox, waitFor, rectOf, shot, penStroke, seg, pickFromMenu, setOrientation, click, setDoc, focus, rightClick, menuClick } from "../../lib/harness.mjs"

await noGrab()
await freshNote({ video: true })
await showVideoPane()
await pickTablet()
await setOrientation(0)
const width = (w) => js(`document.querySelector('.app').style.setProperty('--video-w', '${w}px')`).then(() => sleep(450))
const head = () => js(`(() => { const h = document.querySelector('.camera-head'); const r = h.getBoundingClientRect(); const kids = [...h.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return JSON.stringify({ h: r.height, scroll: h.scrollWidth, client: h.clientWidth, inside: kids.every((k) => k.left >= r.left - 0.5 && k.right <= r.right + 0.5), rows: new Set(kids.map((k) => Math.round((k.top + k.bottom) / 2 / 4))).size, buttons: kids.length }) })()`).then(JSON.parse)

// 1. the header
for (const w of [438, 280]) {
  await width(w)
  const h = await head()
  ok(`${w}px: the header is exactly 36px, on one row, nothing clipped`, h.h === 36 && h.rows === 1 && h.inside && h.scroll <= h.client, JSON.stringify(h))
}
await width(438)
ok("it holds Paper, orientation, Undo, Bring in and close - and no Select, no Page, no Clear, no select box", await js(`(() => { const h = document.querySelector('.camera-head'); const q = (s) => !!h.querySelector(s); return q('[data-tablet=paper]') && q('[data-tablet=orientation-menu]') && q('[data-tablet=undo]') && q('[data-capture=ink]') && !q('select') && !q('[data-tablet=select]') && !q('[data-capture=page]') && !q('[data-tablet=clear]') && h.querySelectorAll('button').length === 5 })()`))
ok("Bring in is the one filled button", await js(`document.querySelectorAll('.camera-head .bar-btn.primary').length === 1 && document.querySelector('.camera-head .bar-btn.primary').textContent.trim() === 'Bring in'`))
const hd = await rectOf(".camera-head"), strip = await rectOf(".camera .sheet-tabs"), body = await rectOf(".camera-body"), sheet = await rectOf(".camera .tablet")
ok("header, strip, then the picture's area: stacked, none over another", hd.b <= strip.y + 0.5 && strip.b <= body.y + 0.5, JSON.stringify({ hd, strip, body }))
ok("the sheet is entirely inside the area under the strip", sheet.y >= body.y - 0.5 && sheet.b <= body.b + 0.5 && sheet.x >= body.x - 0.5 && sheet.r <= body.r + 0.5, JSON.stringify({ sheet, body }))
const top0 = body.y
await setOrientation(1)
await sleep(400)
const portrait = await rectOf(".camera .tablet")
ok("turning the tablet changes the sheet's shape (portrait is taller than wide) ...", portrait.h > portrait.w, JSON.stringify(portrait))
ok("... and the area under the header does not move (its top never jumps)", Math.abs((await rectOf(".camera-body")).y - top0) < 0.5)
await setOrientation(0)
await sleep(300)
await shot("tablet-438")

// 2. the footer
const status = () => js(`JSON.stringify({ line: document.querySelector('.camera [data-camera=status-line]')?.textContent, fact: document.querySelector('.camera [data-camera=status-fact]')?.textContent })`).then(JSON.parse)
const f = await status()
ok("the footer's line says the pen writes and which button erases; its fact says what the mouse does", /^Pen writing/.test(f.line ?? "") && f.fact === "mouse: box a part", JSON.stringify(f))

// 3. the orientation menu: four, the current one ticked, a pick turns the sheet
await js(`document.querySelector('[data-tablet=orientation-menu]').click()`)
await waitFor(`!!document.querySelector('.float-menu')`)
const items = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.float-menu [data-bar^=orientation-]')].map((b) => [b.querySelector('.float-label').textContent, b.getAttribute('aria-checked')]))`))
ok("the orientation menu lists the four, Landscape ticked", items.length === 4 && items[0][0] === "Landscape" && items[0][1] === "true" && items.slice(1).every((i) => i[1] === "false"), JSON.stringify(items))
await key("Escape"); await sleep(200)
ok("Escape closes it", await js(`!document.querySelector('.float-menu')`))

// 4. the paper menu: choices apply at once and the menu stays up; Escape closes it; a click away closes it
await js(`document.querySelector('[data-tablet=paper]').click()`)
await waitFor(`!!document.querySelector('.float-menu [data-bar=paper-lines]')`)
await js(`document.querySelector('.float-menu [data-bar=paper-lines]').click()`)
await sleep(250)
ok("picking Lines changes the paper at once", await js(`document.querySelector('.camera .tablet').dataset.paper`) === "lines")
ok("...and the menu stays up for the next choice (spacing, colour)", await js(`!!document.querySelector('.float-menu [data-paper-spacing=small]') && !!document.querySelector('.float-menu [data-paper-colour=cream]')`))
await js(`document.querySelector('.float-menu [data-paper-colour=cream]').click()`)
await sleep(250)
ok("...Cream paper too", await js(`document.querySelector('.camera .tablet').dataset.paperColour`) === "cream")
await key("Escape"); await sleep(200)
ok("Escape closes the Paper menu", await js(`!document.querySelector('.float-menu')`))
await js(`document.querySelector('[data-tablet=paper]').click()`)
await waitFor(`!!document.querySelector('.float-menu')`)
await click(300, 300)
await sleep(250)
ok("a click anywhere else closes it too", await js(`!document.querySelector('.float-menu')`))
await js(`document.querySelector('[data-tablet=paper]').click()`)
await waitFor(`!!document.querySelector('.float-menu')`)
await js(`document.querySelector('.float-menu [data-bar=paper-dots]').click()`); await sleep(150)
await js(`document.querySelector('.float-menu [data-paper-colour=white]').click()`); await sleep(150)
await key("Escape"); await sleep(150)

// 5. Undo and its menu's Clear the Sheet
const t = await tabletBox()
const px = () => js(`(()=>{const c=document.querySelector('.camera .tablet canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})()`)
ok("with nothing written, Undo is dimmed", await js(`document.querySelector('[data-tablet=undo]').classList.contains('dim')`))
await js(`document.querySelector('[data-tablet=undo]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
await waitFor(`!!document.querySelector('.float-menu [data-bar=clear]')`)
ok("...and so is Clear the Sheet in its menu", await js(`document.querySelector('.float-menu [data-bar=clear]').disabled`))
await key("Escape"); await sleep(150)
await penStroke(seg(t.x + 40, t.y + 80, t.x + 200, t.y + 90, 14))
await sleep(150)
ok("a stroke is drawn, and Undo is live", (await px()) > 100 && !(await js(`document.querySelector('[data-tablet=undo]').classList.contains('dim')`)))
await js(`document.querySelector('[data-tablet=undo]').click()`)
await sleep(200)
ok("Undo takes the stroke back", (await px()) === 0)
await penStroke(seg(t.x + 40, t.y + 80, t.x + 200, t.y + 90, 14))
await pickFromMenu(".camera-head [data-tablet=undo]", "clear")
ok("Clear the Sheet wipes it", (await px()) === 0)

// 6. Bring in is on while a note is open (it is off on a drawing cell's own sheet: tablet/03 and cellSheets)
ok("Bring in is on with a note open", await js(`!document.querySelector('[data-capture=ink]').disabled`))

// 7. the sheet's strip
ok("the strip has Sheet 1 and a +", await js(`document.querySelector('.sheet-tabs [data-sheet-id]').textContent.trim() === 'Sheet 1' && !!document.querySelector('.sheet-tabs [data-sheet-add]')`))

// 8. a sheet BOUND to a drawing cell (right-click the cell > Open in Tablet Sheet): its tab says so, Bring in is off, the
// footer says whose cell it is
await setDoc("# Cells\n\nA drawing cell below.", 0)
await focus(); await js(`document.querySelector('.cm-content').cmTile.view.dispatch({selection:{anchor:20}})`)
await menuClick("insertInkCell"); await sleep(800)   // (the key is Cmd+0 on a Mac, Ctrl+0 elsewhere)
await key("Escape"); await sleep(150)
const cell = JSON.parse(await js(`(() => { const e = document.querySelector('.wm-inkcell canvas'); if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }) })()`))
ok("a drawing cell (Ctrl+0)", !!cell)
if (cell) {
  await rightClick(cell.x + cell.w / 2, cell.y + cell.h / 2); await sleep(250)
  await js(`[...document.querySelectorAll('#cell-menu button')].find((b) => b.textContent.trim().startsWith('Open in Tablet Sheet')).click()`)
  await waitFor(`!!document.querySelector('.sheet-tab.bound')`, 5000)
  await sleep(300)
  const tab = await js(`JSON.stringify({ name: document.querySelector('.sheet-tab.bound .name').textContent, mark: getComputedStyle(document.querySelector('.sheet-tab.bound .name'), '::before').content })`).then(JSON.parse)
  ok("the bound sheet's tab is named for its note's drawing, with the \u25A3 mark", /Drawing$/.test(tab.name) && tab.mark.includes("\u25A3"), JSON.stringify(tab))
  ok("Bring in is off on it (the cell is the note's already)", await js(`document.querySelector('[data-capture=ink]').disabled`))
  ok("the footer says whose drawing cell it is", /^Drawing cell of /.test((await status()).line ?? ""), JSON.stringify(await status()))
  ok("its header is still 36px and whole at 280px", await (async () => { await width(280); const h = await head(); await width(438); return h.h === 36 && h.rows === 1 && h.inside && h.scroll <= h.client })())
  await shot("tablet-bound")
}
await shot("tablet-done")
finish()
