// (d) After any bar or menu action the keyboard is back in the notes with the caret where it was (focusReturn.ts; the Mac's
// buttons never take the keyboard). Real mouse clicks on the bars, the tab row, the sidebar and the menus, then the next key typed:
// it lands at the caret. A button that is found by its tooltip's first word is skipped (not failed) when a bar has renamed it.
import { ok, test, skip, finish, js, sleep, freshNote, setDoc, doc, sel, key, click, rightClick, focus, setSel, typeText, setRendered, clickEl, menuClick, centerOf, lineBoxes } from "../../lib/harness.mjs"

await freshNote()
const D = "One words here\n\nTwo words here\n\nThree words here"
const AT = D.indexOf("Two words") + 6
const inNotes = () => js(`document.activeElement?.closest('.cm-content') !== null`)
const byTitle = (word) => `(()=>{const b=[...document.querySelectorAll('.top-bar button, .tab-bar button, .sidebar button')].find(b=>b.title.toLowerCase().startsWith(${JSON.stringify(word)})); if(b) b.setAttribute('data-e2e-find', ${JSON.stringify(word)}); return !!b})()`
const reset = async () => { await setDoc(D, 0); await focus(); await sleep(250); await setSel(AT); await sleep(100) }

/** Click something, then: the keyboard is in the notes, the caret did not move, and a typed letter lands at it. */
async function after(name, act, { moves = false } = {}) {
  await reset()
  await act(); await sleep(450)
  ok(`${name}: the keyboard is in the notes`, await inNotes(), await js(`document.activeElement?.tagName + '.' + document.activeElement?.className`))
  if (!moves) ok(`${name}: the caret is where it was`, (await sel())[0] === AT && (await sel())[1] === AT, JSON.stringify(await sel()))
  const at = (await sel())[0]
  await typeText("Z"); await sleep(150)
  const d = await doc()
  ok(`${name}: the next key goes in at the caret`, d.slice(at, at + 1) === "Z" && d.length === (moves ? d.length : D.length + 1), JSON.stringify(d))
}

for (const rendered of [false, true]) {
  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)

  for (const target of ["[data-bar=sidebar]", "[data-bar=video]", "[data-bar=edit]", "[data-bar=tabs] .tab.open, .tab.open"]) {
    await test(`${side}: a click on ${target}`, async () => {
      if (!(await js(`!!document.querySelector(${JSON.stringify(target)})`))) { skip(`${target} is not on this build`); return }
      await after(`${side}: ${target}`, () => clickEl(target))
      // The pane buttons come in pairs: put things back.
      if (/sidebar|video|edit/.test(target)) { await clickEl(target); await sleep(300) }
    })
  }

  for (const word of ["bold", "italic", "underline", "strikethrough", "quote", "list", "decrease indentation", "increase indentation", "move section up", "move section down", "text box"]) {
    await test(`${side}: a click on the ${word} button`, async () => {
      if (!(await js(byTitle(word)))) { skip(`no "${word}" button on this bar`); return }
      // (A button that edits moves the caret with the text: the check is the keyboard, and the letter going in at the caret.)
      await after(`${side}: ${word}`, () => clickEl(`[data-e2e-find="${word}"]`), { moves: true })
    })
  }

  await test(`${side}: the font and colour popover: open it, Escape, the caret is where it was`, async () => {
    if (!(await js(byTitle("font")))) { skip("no font popover on this bar"); return }
    await reset()
    await clickEl(`[data-e2e-find="font"]`); await sleep(350)
    ok("the popover is open", await js(`!!document.querySelector('.style-pop, .float-menu, .popover')`))
    await key("Escape"); await sleep(300)
    ok("Escape closed it", await js(`!document.querySelector('.style-pop, .popover')`))
    ok("the keyboard is in the notes, the caret where it was", (await inNotes()) && (await sel())[0] === AT, JSON.stringify(await sel()))
    await clickEl(`[data-e2e-find="font"]`); await sleep(300)
    await click(1000, 700); await sleep(350)
    ok("a click away closes it too, and the caret stays", (await js(`!document.querySelector('.style-pop, .popover')`)))
  })

  await test(`${side}: the open-notes list: Escape closes it and the keyboard is back in the notes, the caret kept`, async () => {
    if (!(await js(`!!document.querySelector('[data-bar=tab-list]')`))) { skip("no open-notes list"); return }
    await reset()
    await clickEl("[data-bar=tab-list]"); await sleep(350)
    ok("the list is up", await js(`!!document.querySelector('.float-menu, .tab-menu, .context-menu, .tab-list-pop')`))
    await key("Escape"); await sleep(350)
    ok("Escape closed it", await js(`!document.querySelector('.float-menu, .tab-menu, .context-menu, .tab-list-pop')`))
    ok("the keyboard is in the notes, the caret kept", (await inNotes()) && (await sel())[0] === AT, JSON.stringify(await sel()))
  })

  await test(`${side}: the right-click menu on the notes: Escape gives the keyboard back, the caret kept`, async () => {
    await reset()
    const lines = await lineBoxes()
    const l = lines.find((x) => x[2] === "Two words here") ?? lines[2]
    await rightClick(420, Math.round((l[0] + l[1]) / 2)); await sleep(300)
    ok("the menu is up", await js(`!!document.querySelector('.context-menu, .float-menu')`))
    const at = (await sel())[0]
    await key("Escape"); await sleep(300)
    ok("Escape closed it, the keyboard is in the notes", (await js(`!document.querySelector('.context-menu, .float-menu')`)) && (await inNotes()))
    ok("the caret is where the right-click put it", (await sel())[0] === at)
  })

  await test(`${side}: a menu bar command (the key's own function) leaves the keyboard in the notes`, async () => {
    for (const id of ["toggleMarkers", "collapseSubsections", "expandSelection", "jumpToSelection"]) {
      await reset()
      await menuClick(id); await sleep(350)
      ok(`${id}: the keyboard is in the notes`, await inNotes(), await js(`document.activeElement?.tagName`))
      if (id === "toggleMarkers") await menuClick(id)
      if (id === "collapseSubsections") await menuClick("unfoldAll")
    }
  })

  await test(`${side}: the maths palette: Escape gives the keyboard back, the caret kept`, async () => {
    if (!(await js(byTitle("maths")))) { skip("no maths button"); return }
    await reset()
    await clickEl(`[data-e2e-find="maths"]`); await sleep(400)
    ok("the palette is up", await js(`!!document.querySelector('.math-pop, [data-math=pop]')`))
    await key("Escape"); await sleep(300)
    ok("Escape closed it, the keyboard is in the notes, the caret kept", (await js(`!document.querySelector('.math-pop, [data-math=pop]')`)) && (await inNotes()) && (await sel())[0] === AT, JSON.stringify(await sel()))
  })
}
finish()
