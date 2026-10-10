// The rest of the overlays (docs/PLAN-bars-2026-10.md, P6): Esc closes every popover and menu (and goes no further), a press
// elsewhere closes them, the keyboard goes back to the notes; the divider between the notes and the video is a visible
// 6px column with a grip and the accent while it is dragged; the footer says what the pen is (a live region) and the page
// carries the same chip with "Esc to stop", and that Esc really stops it; the link picker floats like the find card.
import { ok, finish, js, sleep, waitFor, freshNote, setDoc, key, click, rightClick, drag, mouse, hover, focus, shot, centerOf, menuClick, showVideoPane, insertText, doc, clickEl, penMenu } from "../../lib/harness.mjs"
import { MAC, mod, box, keyboardIn } from "../../lib/overlays.mjs"

// (The scripts of a suite share one app: the pen's width, colour and tool are what 08-toolbar-pen left in the page's storage.)
await js(`localStorage.clear()`)
await js(`location.reload()`); await sleep(1500)
await freshNote()
await setDoc("Alpha para\n\nBeta para\n\nGamma", 0); await focus(); await sleep(300)
const gone = (selector) => js(`!document.querySelector(${JSON.stringify(selector)})`)

// ---- Esc closes the popovers, and the keyboard is the note's
await menuClick("insertMath"); await waitFor(`!!document.querySelector('[data-math="pop"]')`)
ok("the maths palette opens", true)
await key("Escape"); await sleep(250)
ok("Esc closes the maths palette", await gone('[data-math="pop"]'))
ok("...and the keyboard is the note's", (await keyboardIn()) === "editor", await keyboardIn())
await menuClick("insertMath"); await waitFor(`!!document.querySelector('[data-math="pop"]')`)
// (Elsewhere is measured from the palette, not a fixed point: the palette is 420 x 533 under the toolbar's Maths button and reaches
// (900, 600) at 1440 x 900, so a press there is a press INSIDE it.)
const open = await box('[data-math="pop"]')
await click(open.x - 80, open.y + 200); await sleep(250)
ok("a press elsewhere closes the maths palette", await gone('[data-math="pop"]'))
await menuClick("insertMath"); await waitFor(`!!document.querySelector('[data-math="pop"]')`)
const pop = await box('[data-math="pop"]')
ok("the palette is inside the window", pop.x >= 0 && pop.y >= 0 && pop.r <= (await js(`innerWidth`)) && pop.b <= (await js(`innerHeight`)), JSON.stringify(pop))
await key("Escape"); await sleep(200)

// the right-click menu (a FloatingMenu): nothing is chosen on opening; the first arrow moves onto a row; Esc closes it
const lines = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.cm-line')].map(l=>{const r=l.getBoundingClientRect();return [r.left+20,r.top+8]}))`))
await rightClick(lines[0][0] + 100, lines[0][1]); await sleep(300)
ok("the right-click menu opens", await js(`!!document.querySelector('#context-menu')`))
ok("no row is chosen on opening: the menu itself has the keyboard", await js(`document.activeElement?.id === 'context-menu'`), await js(`document.activeElement?.outerHTML.slice(0,80)`))
await key("ArrowDown"); await sleep(60)
ok("the first arrow key moves onto the first live row", await js(`document.activeElement?.closest('#context-menu') && document.activeElement.tagName === 'BUTTON'`))
await key("Escape"); await sleep(250)
ok("Esc closes it", await gone("#context-menu"))
ok("...and the keyboard is the note's", (await keyboardIn()) === "editor", await keyboardIn())
ok("a menu keeps the page's keys: Enter with the menu just opened does not paste or cut anything", (await doc()) === "Alpha para\n\nBeta para\n\nGamma")

// ---- the footer says what the pen is, and Esc stops it
const chipText = () => js(`document.querySelector('[data-footer="mode"]')?.textContent ?? ''`)
const pageChip = () => js(`document.querySelector('[data-page="mode-chip"]')?.textContent ?? ''`)
ok("with the pen up the footer's chip is empty and the page has none", (await chipText()) === "" && (await pageChip()) === "")
ok("the footer chip is a live region, present even when empty", await js(`(()=>{const c=document.querySelector('[data-footer="mode"]');return c?.getAttribute('role')==='status'&&c.getAttribute('aria-live')==='polite'})()`))
await menuClick("togglePen"); await sleep(300)
ok("pen down: the footer says 'Pen · 3 px'", (await chipText()) === "Pen · 3 px", await chipText())
ok("the page's chip says how to stop: 'Pen · 3 px · Esc to stop'", (await pageChip()) === "Pen · 3 px · Esc to stop", await pageChip())
await shot("pen-chip")
const footer = await js(`[...document.querySelector('.footer').children].map(c=>c.className||c.tagName).join(' | ')`)
ok("the footer is the file, the mode chip, then the counts", /footer-file/.test(footer) && footer.indexOf("mode-chip") > footer.indexOf("footer-file") && footer.indexOf("footer-count") > footer.indexOf("mode-chip"), footer)
await key("Escape"); await sleep(400)
ok("Esc puts the pen up, as the chip says", (await chipText()) === "" && (await pageChip()) === "", `${await chipText()} / ${await pageChip()}`)
await menuClick("penErase"); await sleep(250)
ok("the Erase tool: the footer says 'Eraser'", (await chipText()) === "Eraser", await chipText())
await key("Escape"); await sleep(300)
ok("Esc stops it", (await chipText()) === "")
await menuClick("penSelect"); await sleep(250)
ok("the Select tool: 'Select tool'", (await chipText()) === "Select tool", await chipText())
await key("Escape"); await sleep(300)
await menuClick("insertTextBox"); await sleep(250)
ok("an armed text box: 'Placing: Text Box', and it is cancelled, not stopped", (await chipText()) === "Placing: Text Box" && /Esc to cancel/.test(await pageChip()), `${await chipText()} / ${await pageChip()}`)
await key("Escape"); await sleep(300)
ok("Esc cancels the placement", (await chipText()) === "")
// a menu's Esc is the menu's, not the pen's
await menuClick("togglePen"); await sleep(250)
await rightClick(lines[0][0] + 100, lines[0][1]); await sleep(300)
await key("Escape"); await sleep(300)
ok("while a menu is up its Esc is the menu's: it closes and the pen stays down", (await gone("#context-menu")) && (await chipText()) === "Pen · 3 px", await chipText())
await key("Escape"); await sleep(300)
ok("the next Esc stops the pen", (await chipText()) === "")

// The chip against the bar's ONE pen button (the toolbar made the button a pen-or-eraser tool: `penSettings.tool`): the chip says what the
// pane is doing, Pen / Eraser, and nothing once the pane is the notebook's again.
await clickEl('[data-bar=pen]'); await sleep(300)
ok("the pen button down (tool: pen): the chip says Pen · 3 px", (await chipText()) === "Pen · 3 px", await chipText())
await penMenu(); await clickEl('.float-menu [data-bar=erase]'); await sleep(300)
ok("Eraser picked from the button's menu: the chip says Eraser", (await chipText()) === "Eraser" && /^Eraser · Esc to stop$/.test(await pageChip()), `${await chipText()} / ${await pageChip()}`)
await clickEl('[data-bar=pen]'); await sleep(300)
ok("the eraser button up while the pen is still down under it: the chip still says Pen · 3 px (the pane takes the clicks)", (await chipText()) === "Pen · 3 px", await chipText())
await clickEl('[data-bar=pen]'); await sleep(300)
ok("the eraser button down again: Eraser", (await chipText()) === "Eraser", await chipText())
await key("Escape"); await sleep(300)
ok("Esc puts both down: the chip goes, the tool stays the eraser", (await chipText()) === "" && (await pageChip()) === "" && (await js(`/^Eraser/.test(document.querySelector('[data-bar=pen]').title)`)), await chipText())
await clickEl('[data-bar=pen]'); await sleep(300)
ok("the eraser button from rest: Eraser", (await chipText()) === "Eraser", await chipText())
await clickEl('[data-bar=pen]'); await sleep(300)
ok("and up again: no chip, the pane is the notebook's", (await chipText()) === "" && (await pageChip()) === "", await chipText())
await penMenu(); await clickEl('.float-menu [data-bar=pen-pen]'); await sleep(300)
ok("Pen picked from the menu: the chip says Pen · 3 px and the eraser is let go", (await chipText()) === "Pen · 3 px", await chipText())
await key("Escape"); await sleep(300)
ok("Esc puts the pen up and the chip goes", (await chipText()) === "" && !(await js(`document.querySelector('[data-bar=pen]').classList.contains('on')`)), await chipText())

// ---- AltGr: Ctrl+Alt pen chords stand down, so { [ ] } @ \ | type (a PC's chord; a Mac's is Cmd+Option and is not AltGr)
if (!MAC) {
  const press = (init) => js(`document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', Object.assign({bubbles:true,cancelable:true}, ${JSON.stringify(init)})))`)
  await press({ key: "{", code: "Digit7", ctrlKey: true, altKey: true }); await sleep(200)
  ok("Ctrl+Alt+7 that types '{' is typing, not Thinner Line", (await chipText()) === "")
  await press({ key: "1", code: "Digit1", ctrlKey: true, altKey: true }); await sleep(250)
  ok("Ctrl+Alt+1 on a layout that types '1' is the pen chord", (await chipText()) === "Pen · 3 px", await chipText())
  await key("Escape"); await sleep(300)
}

// ---- the link picker floats over the page like the find card
await focus(); await js(`${"document.querySelector('.cm-content').cmTile.view"}.dispatch({selection:{anchor:${"document.querySelector('.cm-content').cmTile.view"}.state.doc.length}})`)
const top = await box(".cm-scroller")
await insertText("\nsee /link"); await sleep(500)
ok("typing /link raises the picker as a card", await js(`!!document.querySelector('.link-card[data-bar="link"]')`))
const after = await box(".cm-scroller")
ok("the note's top edge did not move", after.y === top.y && after.h === top.h, JSON.stringify({ top, after }))
ok("it floats over the page", (await js(`getComputedStyle(document.querySelector('.link-card').parentElement).position`)) === "absolute")
ok("it says 'Link to…' and has Cancel and Link here", await js(`(()=>{const c=document.querySelector('.link-card');const t=c.textContent;return t.includes('Link to…')&&[...c.querySelectorAll('button')].map(b=>b.textContent).join()==='Cancel,Link here'})()`))
await shot("link-card")
await key("Escape"); await sleep(300)
ok("Esc cancels the picker", await gone(".link-card"))

// ---- the divider
await showVideoPane(); await sleep(500)
const d = await box(".pane-divider")
ok("the divider is a visible 6px column", d && Math.round(d.w) === 6, JSON.stringify(d))
ok("with a wider hit area than it looks (the ::before reaches past it)", await js(`parseFloat(getComputedStyle(document.querySelector('.pane-divider'), '::before').width) >= 14`))
ok("and a grip (dots drawn in its ::after)", await js(`/radial-gradient/.test(getComputedStyle(document.querySelector('.pane-divider'), '::after').backgroundImage)`))
await shot("divider")
const cam0 = (await box(".camera")).w
const x = d.x + d.w / 2, y = d.y + d.h / 2
await hover(x, y)
await mouse("mousePressed", x, y)
await mouse("mouseMoved", x - 60, y); await sleep(100)
ok("while it is dragged it takes the accent", await js(`document.querySelector('.pane-divider').classList.contains('dragging')`) && (await js(`getComputedStyle(document.querySelector('.pane-divider')).backgroundColor`)) !== (await js(`getComputedStyle(document.querySelector('.footer')).backgroundColor`)))
await mouse("mouseMoved", x - 120, y)
await mouse("mouseReleased", x - 120, y); await sleep(200)
const cam1 = (await box(".camera")).w
ok("dragging it left widens the video by what it moved (within a pixel or two)", Math.abs(cam1 - cam0 - 120) <= 3, `${cam0} -> ${cam1}`)
ok("the mouse never gave it the keyboard", (await keyboardIn()) === "editor", await keyboardIn())
await js(`document.querySelector('.pane-divider').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`); await sleep(200)
ok("a double click puts it back", Math.abs((await box(".camera")).w - cam0) <= 3)
finish()
