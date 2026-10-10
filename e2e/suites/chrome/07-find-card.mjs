// Find and Replace is a CARD that floats over the note (docs/PLAN-bars-2026-10.md, P6; FinalStates.png): the note's top edge
// never moves when it opens or goes. Enter is the next match, Shift+Enter the previous (both wrap), the count reads "1 of 5"
// (a live region), Aa and ab are the case and whole-word switches, Esc puts it away and gives the caret back to the note with
// the match it was on selected, and Replace All is ONE undo.
import { ok, finish, js, sleep, freshNote, setDoc, doc, key, typeText, focus, selText, sel, click, shot } from "../../lib/harness.mjs"
import { mod, replaceChord, box, keyboardIn, typeInto } from "../../lib/overlays.mjs"

await freshNote()
const TEXT = "alpha beta alpha\n\nGamma alpha\n\nalphabet\n\nAlpha end"
await setDoc(TEXT, 0); await focus(); await sleep(300)
const scroller = () => box(".cm-scroller")
const before = await scroller()

// ---- it opens over the note and does not move it
await key("f", mod); await sleep(300)
ok("Find opens as a card", await js(`!!document.querySelector('.find-card[data-bar="find"]')`))
const card = await box(".find-card")
const layer = await js(`getComputedStyle(document.querySelector('.find-card').parentElement).position`)
ok("it floats: its holder is positioned over the page, not a row in the layout", layer === "absolute", layer)
const during = await scroller()
ok("the note's top edge did not move when it opened", before && during && during.y === before.y && during.h === before.h, JSON.stringify({ before, during }))
ok("the card is at the top right of the page, over the words", card && card.y >= before.y && card.y < before.y + 40 && card.r > before.r - 60, JSON.stringify({ card, before }))
ok("the field has the keyboard", (await keyboardIn()) !== "editor" && await js(`document.activeElement?.classList.contains('find-input')`))
await shot("open")

// ---- typing finds, the count says where you are
await typeText("alpha"); await sleep(300)
const count = () => js(`document.querySelector('[data-find="count"]').textContent`)
ok("the first match is selected as it is typed, and the count says '1 of 5'", (await count()) === "1 of 5" && (await selText()) === "alpha", `${await count()} / ${await selText()}`)
ok("the count is a live region (it is heard)", await js(`(()=>{const c=document.querySelector('[data-find="count"]');return c.getAttribute('role')==='status'&&c.getAttribute('aria-live')==='polite'})()`))
const at = async () => (await sel())[0]
await key("Enter"); await sleep(120)
ok("Enter goes to the next match", (await count()) === "2 of 5", await count())
const second = await at()
await key("Enter"); await key("Enter"); await key("Enter"); await sleep(120)
ok("Enter again, and again, reaches the last", (await count()) === "5 of 5", await count())
await key("Enter"); await sleep(120)
ok("and wraps round to the first", (await count()) === "1 of 5", await count())
await key("Enter", { shift: true }); await sleep(120)
ok("Shift+Enter goes back, wrapping round to the last", (await count()) === "5 of 5", await count())
await key("Enter", { shift: true }); await sleep(120)
ok("and on to the one before it", (await count()) === "4 of 5", await count())
await key("Enter"); await key("Enter"); await sleep(100)

// ---- the switches
await js(`document.querySelector('[data-find="case"]').click()`); await sleep(250)
ok("Aa (match case): 'Alpha' is not 'alpha' any more", (await count()).endsWith("of 4"), await count())
await js(`document.querySelector('[data-find="word"]').click()`); await sleep(250)
ok("ab (whole words): 'alphabet' is not 'alpha'", (await count()).endsWith("of 3"), await count())
ok("the switches say they are on", await js(`['case','word'].every(k=>document.querySelector('[data-find="'+k+'"]').getAttribute('aria-pressed')==='true')`))
await js(`document.querySelector('[data-find="case"]').click()`); await js(`document.querySelector('[data-find="word"]').click()`); await sleep(250)
ok("both off again: five", (await count()).endsWith("of 5"), await count())

// ---- Esc: the card goes, the caret is the note's, the match it was on is selected
await js(`document.querySelector('.find-input').focus()`)
await key("Enter"); await sleep(100)
const on = await selText()
await key("Escape"); await sleep(250)
ok("Esc puts the card away", !(await js(`!!document.querySelector('.find-card')`)))
ok("the keyboard is the note's", (await keyboardIn()) === "editor", await keyboardIn())
ok("the match it was on is selected", on === "alpha" && (await selText()).toLowerCase() === "alpha", `${on} / ${await selText()}`)
const after = await scroller()
ok("the note's top edge did not move when it went", after.y === before.y && after.h === before.h, JSON.stringify({ before, after }))

// ---- Find and Replace pressed with the keyboard in the find field opens the replace row (the page leaves a field's keys alone; the card answers its own)
await setDoc(TEXT, 0); await focus(); await key("f", mod); await sleep(250)
ok("(the card is open with only the find row)", !(await js(`!!document.querySelector('[data-find="replace-all"]')`)))
await key(replaceChord.key, replaceChord.opts); await sleep(300)
ok("Find and Replace inside the find field opens the replace row and moves to it", (await js(`!!document.querySelector('[data-find="replace-all"]')`)) && (await js(`document.activeElement?.getAttribute('aria-label') === 'Replace with'`)))
await key("Escape"); await sleep(200)

// ---- Replace All is one undo
await setDoc(TEXT, 0); await focus(); await sleep(200)
await key(replaceChord.key, replaceChord.opts); await sleep(300)
ok("Find and Replace opens the replace row", await js(`!!document.querySelector('[data-find="replace-all"]')`))
await typeInto(".find-input", "alpha"); await sleep(250)
await typeInto('.find-input[aria-label="Replace with"]', "OMEGA"); await sleep(100)
await js(`document.querySelector('[data-find="replace-all"]').click()`); await sleep(400)
ok("Replace All replaced every match, case aside (five of them)",
  (await doc()) === "OMEGA beta OMEGA\n\nGamma OMEGA\n\nOMEGAbet\n\nOMEGA end", JSON.stringify(await doc()))
await key("Escape"); await sleep(200)
await key("z", mod); await sleep(300)
ok("one undo takes the whole Replace All back", (await doc()) === TEXT, JSON.stringify(await doc()))
await shot("after-undo")
finish()
