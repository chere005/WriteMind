// (b) The seam's + (docs/PLAN-bars-2026-10.md P7; the wireframe docs/ui-2026-10/FinalMain.png): a round marker in the left
// margin beside the bar between two cells (never over a cell's text), a 24 px hit target, a menu that is the shared kind menu
// (renderer/kindMenu.ts, a FloatingMenu: arrow keys, Enter, Escape), opened where the page is scrolled to, and a pick that
// makes the very cell the key makes — one undo step, the caret in it. Markdown side and rendered page, real mouse and keys.
import { ok, test, finish, js, sleep, freshNote, setDoc, doc, sel, key, click, hover, focus, armed, setSel, lineBoxes, centerOf, typeText, setRendered, shot } from "../../lib/harness.mjs"

await freshNote()
const D0 = "Alpha\n\nBeta\n\nGamma"

/** The bar's y between the first two cells: the middle of the blank line between them. */
const gapOf = async (i = 1) => { const l = await lineBoxes(); return Math.round((l[i][0] + l[i][1]) / 2) }
const menuNames = () => js(`[...document.querySelectorAll('#seam-kinds .float-label')].map(b=>b.textContent)`)
const pickLabel = (label) => js(`[...document.querySelectorAll('#seam-kinds .float-label')].find(b=>b.textContent===${JSON.stringify(label)}).closest('button').click()`)
const marker = async () => JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-plus'); if(!e) return 'null'; const r=e.getBoundingClientRect(); const c=getComputedStyle(e); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,radius:c.borderRadius,bg:c.backgroundColor})})()`))
const textLeft = () => js(`(()=>{const l=document.querySelector('.cm-line'); const r=document.createRange(); r.selectNodeContents(l); return r.getBoundingClientRect().left})()`)

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)
  await setDoc(D0); await focus(); await sleep(300)

  await test(`${side}: hovering a seam draws a round filled marker in the margin, clear of the words`, async () => {
    await hover(700, await gapOf()); await sleep(200)
    const m = await marker()
    ok("the marker is drawn", !!m, JSON.stringify(m))
    if (!m) return
    ok("it is a circle of about 20 px", Math.abs(m.w - 20) < 1.5 && Math.abs(m.h - 20) < 1.5 && m.radius.includes("50%"), JSON.stringify(m))
    ok("it is filled", m.bg !== "rgba(0, 0, 0, 0)" && m.bg !== "transparent", m.bg)
    const left = await textLeft()
    ok("and stands in the margin, wholly left of where the words start", m.x + m.w <= left - 2, JSON.stringify({ m, left }))
    const bar = await js(`(()=>{const b=document.querySelector('.wm-bar'); const r=b.getBoundingClientRect(); return JSON.stringify([r.left, r.top+r.height/2])})()`)
    const [barLeft, barY] = JSON.parse(bar)
    ok("on the bar's own line", Math.abs(m.cy - barY) <= 1.5, JSON.stringify({ m, barY }))
    ok("the bar starts where the words do, not under the marker", barLeft >= m.x + m.w, JSON.stringify({ barLeft, m }))
    await shot(`${rendered ? "rendered" : "markdown"}-marker`)
  })

  await test(`${side}: the hit target is 24 px, the pointer is a hand over it, and a press arms the bar and opens the kinds`, async () => {
    await setDoc(D0); await focus(); await sleep(200)
    const y = await gapOf()
    await hover(700, y); await sleep(150)
    const m = await marker()
    for (const dy of [-11, 0, 11]) {
      await hover(m.cx, m.cy + dy); await sleep(80)
      const cursor = await js(`getComputedStyle(document.elementFromPoint(${m.cx}, ${m.cy + dy})).cursor`)
      ok(`the pointer ${dy} px from the marker's centre is a hand`, cursor === "pointer", cursor)
    }
    await hover(m.cx, m.cy + 16); await sleep(80)
    ok("16 px away it is not (the seam's own cursor, or the page's)", (await js(`getComputedStyle(document.elementFromPoint(${m.cx}, ${m.cy + 16})).cursor`)) !== "pointer")
    await hover(m.cx + 16, m.cy); await sleep(80)
    ok("16 px to the side it is not either", (await js(`getComputedStyle(document.elementFromPoint(${m.cx + 16}, ${m.cy})).cursor`)) !== "pointer")
    // A press 10 px above the marker's centre is on its target.
    await hover(700, y); await sleep(100)
    const m2 = await marker()
    await click(m2.cx, m2.cy - 10); await sleep(300)
    ok("a press on the target's edge opens the kinds", (await menuNames()).length > 10, JSON.stringify(await menuNames()))
    ok("and the bar is up where the + was pressed", await armed(), JSON.stringify(await sel()))
    ok("the caret is hidden: the bar is the cursor", (await js(`getComputedStyle(document.querySelector('.cm-cursor')||document.body).display`)) === "none" || (await js(`!document.querySelector('.cm-cursor')`)))
    await key("Escape"); await sleep(150)
  })

  await test(`${side}: the menu is the shared kind menu, a FloatingMenu with arrow keys, Enter and Escape`, async () => {
    await setDoc(D0); await focus(); await sleep(200)
    await hover(700, await gapOf()); await sleep(150)
    const m = await marker(); await click(m.cx, m.cy); await sleep(300)
    const names = await menuNames()
    for (const want of ["Text", "Title", "Chapter", "Author", "Section", "Subsection", "Subsubsection", "Dots", "Dashes", "Numbered", "To-do", "Quote", "Markdown", "Code", "Runnable code", "Maths", "Drawing"]) {
      ok(`the menu offers ${want}`, names.includes(want), JSON.stringify(names))
    }
    ok("it is a FloatingMenu (role=menu), not the old .kind-menu", (await js(`document.querySelector('#seam-kinds')?.getAttribute('role')`)) === "menu" && (await js(`!document.querySelector('.kind-menu')`)))
    // The overlays package's rule (docs/PLAN-bars-2026-10.md P6): the MENU has the keyboard on opening, no row is chosen; the first arrow moves onto a row.
    const focused = () => js(`(() => { const a = document.activeElement; if (!a?.closest('#seam-kinds')) return null; return a.id === 'seam-kinds' ? '(menu)' : a.querySelector('.float-label')?.textContent })()`)
    ok("the menu itself has the keyboard, no row is chosen yet", (await focused()) === "(menu)", JSON.stringify(await focused()))
    await key("ArrowDown"); const second = await focused()
    ok("the keyboard is in the menu and ArrowDown moves onto the first row", second === "Text", JSON.stringify({ second }))
    await key("ArrowDown"); const third = await focused()
    ok("and ArrowDown again to the next row", third === "Title", JSON.stringify({ third }))
    await key("ArrowUp"); ok("ArrowUp moves back", (await focused()) === second)
    await key("Escape"); await sleep(200)
    ok("Escape closes the menu", (await js(`!document.querySelector('#seam-kinds')`)))
    ok("...and leaves the bar up (it is the cursor; a second Escape puts it out)", await armed())
    ok("...and the note untouched", (await doc()) === D0, JSON.stringify(await doc()))
    ok("the keyboard is back in the notes", (await js(`document.activeElement?.closest('.cm-content') !== null`)))
    await key("Escape"); await sleep(100)
    ok("a second Escape puts the bar out", !(await armed()))
    // Enter picks the focused row: ArrowDown twice from the menu itself is the second row, Title.
    await hover(700, await gapOf()); await sleep(150)
    const m3 = await marker(); await click(m3.cx, m3.cy); await sleep(250)
    await key("ArrowDown"); await key("ArrowDown"); await key("Enter"); await sleep(250)
    ok("Enter on a row makes that cell at the bar", /\n\n#+ \n\n/.test(await doc()) || /\n\n# \n\n/.test(await doc()), JSON.stringify(await doc()))
    await typeText("Hi"); await sleep(100)
    ok("and what is typed goes into it", /\n\n#+ Hi\n\n/.test(await doc()), JSON.stringify(await doc()))
  })

  // A pick makes the cell the KEY makes (same doc, same caret), as one undo step.
  const KINDS = [
    ["Text", "7", { ctrl: true }], ["Markdown", "7", { ctrl: true, shift: true }], ["Title", "1", { ctrl: true }], ["Chapter", "2", { ctrl: true }],
    ["Author", "3", { ctrl: true }], ["Section", "4", { ctrl: true }], ["Subsection", "5", { ctrl: true }], ["Subsubsection", "6", { ctrl: true }],
    ["Dots", "l", { ctrl: true, shift: true }], ["Quote", "q", { ctrl: true }], ["Code", "8", { ctrl: true }],
    ["Runnable code", "8", { ctrl: true, shift: true }], ["Maths", "9", { ctrl: true }],
  ]
  for (const [label, k, o] of KINDS) {
    await test(`${side}: + ▸ ${label} makes what its key makes: same cell, same caret, one undo step`, async () => {
      await setDoc(D0); await focus(); await sleep(200)
      await click(700, await gapOf()); await sleep(100)
      await key(k, o); await sleep(200)
      const byKey = { d: await doc(), s: await sel() }
      await setDoc(D0); await focus(); await sleep(200)
      await hover(700, await gapOf()); await sleep(120)
      const m = await marker(); await click(m.cx, m.cy); await sleep(250)
      await pickLabel(label); await sleep(250)
      const picked = { d: await doc(), s: await sel() }
      ok("the same note", picked.d === byKey.d, JSON.stringify({ picked: picked.d, byKey: byKey.d }))
      ok("the caret in the same place", JSON.stringify(picked.s) === JSON.stringify(byKey.s), JSON.stringify({ picked: picked.s, byKey: byKey.s }))
      ok("the bar is put away: the caret is in the new cell", !(await armed()))
      ok("the keyboard is in the notes", (await js(`document.activeElement?.closest('.cm-content') !== null`)))
      await key("z", { ctrl: true }); await sleep(200)
      ok("one Ctrl+Z takes the whole cell away", (await doc()) === D0, JSON.stringify(await doc()))
    })
  }

  await test(`${side}: + ▸ Drawing makes a drawing cell at the bar, one undo step`, async () => {
    await setDoc(D0); await focus(); await sleep(200)
    await hover(700, await gapOf()); await sleep(120)
    const m = await marker(); await click(m.cx, m.cy); await sleep(250)
    await pickLabel("Drawing"); await sleep(400)
    const d = await doc()
    ok("a drawing cell's line is between Alpha and Beta", /^Alpha\n\n!\[ink\]\([^)]+\)\n\nBeta\n\nGamma$/.test(d), JSON.stringify(d))
    await key("z", { ctrl: true }); await sleep(250)
    ok("one Ctrl+Z takes it out", (await doc()) === D0, JSON.stringify(await doc()))
  })

  await test(`${side}: a menu opened on a scrolled page opens beside the marker, not a scroll's worth away`, async () => {
    const long = Array.from({ length: 70 }, (_, i) => "Cell " + i).join("\n\n")
    await setDoc(long); await focus(); await sleep(300)
    await js(`document.querySelector('.cm-content').cmTile.view.scrollDOM.scrollTop = 700`); await sleep(400)
    const lines = await lineBoxes()
    // The bar between two cells: the blank line between them.
    // (On the rendered page the blocks are widgets: the lines the page has left are the blank ones between them.)
    const gaps = lines.filter((l) => l[2] === "" && l[0] > 300 && l[0] < 500)
    const y = Math.round((gaps[0][0] + gaps[0][1]) / 2)
    await hover(700, y); await sleep(200)
    const m = await marker()
    ok("the marker is on screen", !!m && m.cy > 100 && m.cy < 800, JSON.stringify(m))
    await click(m.cx, m.cy); await sleep(300)
    const box = JSON.parse(await js(`(()=>{const r=document.querySelector('#seam-kinds').getBoundingClientRect(); return JSON.stringify([r.left,r.top,r.right,r.bottom])})()`))
    ok("the menu is beside the marker", box[0] > m.x && Math.abs(box[1] - m.cy) < 40, JSON.stringify({ box, m }))
    await key("Escape"); await key("Escape")
  })
}
finish()
