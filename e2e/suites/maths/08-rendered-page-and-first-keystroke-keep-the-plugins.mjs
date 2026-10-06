// Two CodeMirror plugins were taken down for a note by a throw, and stayed down until the note was reopened (found by
// an independent verifier of the maths lane, 2026-10-04):
//  1. The inline-maths plugin: switching the rendered page on split view.visibleRanges round the replaced paragraphs;
//     a one-line paragraph that is not the first block belongs to two ranges, its two equations were added to the
//     sorted RangeSetBuilder twice and CodeMirror threw. Back on the source page every `wl:` was raw text.
//  2. The markdown decorations: the first edit that grows the note while its end is in view mapped the view's visible
//     ranges (already in the new document's positions) through the change again, which threw "Position N is out of
//     range"; headings, bullets and bold were raw markdown until the note was reopened.
// Fixed 2026-10-04 (Mathslane-fix1): `linesOfRanges` in packages/editor/src/math.ts, `windowHoldsPage` in decorations.ts.
import { ok, finish, js, sleep, until, freshNote, setDoc, focus, shot, setRendered, insertText, VIEW } from "../../lib/harness.mjs"

const BT = "`"
const widgets = () => js(`document.querySelectorAll('.cm-line .wm-math-inline').length`)
const hook = () => js(`(() => {
  window.__crashes = []
  if (!window.__ce) {
    window.__ce = console.error
    console.error = (...a) => { const t = a.map((x) => (x && x.stack) || String(x)).join(' | '); if (/plugin crashed/i.test(t)) window.__crashes.push(t.slice(0, 200)); window.__ce.apply(console, a) }
  }
})()`)
const crashes = () => js(`window.__crashes.slice()`)

// ---- 1. the rendered page, with two equations in a paragraph that is not the first block
const cases = {
  "a heading, a paragraph with two equations, a paragraph": `# T\n\nSee ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n\nNext.\n`,
  "a paragraph with two equations only": `See ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n`,
  "a paragraph, then one with two equations": `Intro.\n\nSee ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n`,
  "a paragraph, one with two equations, a paragraph": `Intro.\n\nSee ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n\nNext.\n`,
  "a paragraph with three equations after a heading": `# T\n\nA ${BT}wl:a+b${BT} B ${BT}wl:a-b${BT} C ${BT}wl:c*d${BT} D\n\nEnd\n`,
  "a quote with two equations between paragraphs": `Intro.\n\n> See ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n\nNext.\n`,
  "two equations, then a maths block": `Intro.\n\nSee ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n\n${BT.repeat(3)}wl\nx^2\n${BT.repeat(3)}\n`,
  "a list whose items hold two equations each": `- one ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT}\n- two ${BT}wl:c+d${BT} and ${BT}wl:c-d${BT}\n`,
  "a soft-wrapped paragraph with two equations": `Intro.\n\nSee ${BT}wl:a+b${BT} and\n${BT}wl:a-b${BT} here.\n\nNext.\n`,
}
for (const [name, text] of Object.entries(cases)) {
  await freshNote()
  await setRendered(false)
  await focus()
  await hook()
  await setDoc(text, text.length)
  await sleep(500)
  const before = await widgets()
  await setRendered(true)
  const enteringCrashes = await crashes()
  await setRendered(false)
  await sleep(300)
  const after = await widgets()
  const all = await crashes()
  ok(`${name}: ${before} equations typeset before`, before >= 2, `${before}`)
  ok(`${name}: no plugin crashed going to the rendered page and back`, all.length === 0, JSON.stringify({ entering: enteringCrashes, all }))
  ok(`${name}: the equations are typeset again on the source page (${before} -> ${after})`, after === before, `${before} -> ${after}`)
}

// ... and new equations still typeset afterwards (the plugin is alive, not just left in its old state)
{
  await freshNote()
  await setRendered(false)
  await focus()
  await hook()
  const text = `Intro.\n\nSee ${BT}wl:a+b${BT} and ${BT}wl:a-b${BT} here.\n\nNext.\n`
  await setDoc(text, text.length)
  await sleep(300)
  await setRendered(true)
  await setRendered(false)
  await js(`${VIEW}.focus()`)
  await js(`${VIEW}.dispatch({ changes: { from: ${VIEW}.state.doc.length, insert: ${JSON.stringify(`\nA new ${BT}wl:Sqrt[x]${BT} one.\n`)} }, selection: { anchor: 0 } })`)
  await sleep(400)
  ok("after a visit to the rendered page a NEW equation is typeset at once", (await widgets()) === 3, String(await widgets()))
  await shot("maths-after-the-rendered-page")
}

// ---- 2. the first edit that grows the note, with the end of it in view
{
  await freshNote()
  await setRendered(false)
  await focus()
  await hook()
  ok("the new note is empty (the end of it is in view)", (await js(`${VIEW}.state.doc.length`)) === 0, String(await js(`${VIEW}.state.doc.length`)))
  await insertText("a")
  await sleep(300)
  ok("the first character typed in an empty note crashes no plugin", (await crashes()).length === 0, JSON.stringify(await crashes()))
  // (What is typed into a text cell is literal since 2026-10-05, so the heading, the bullet and the two equations go
  // in as markdown by a plain dispatch, no userEvent: the same growing edit at the end of the note.)
  await js(`${VIEW}.dispatch({ changes: { from: ${VIEW}.state.doc.length, insert: ${JSON.stringify(`\n\n# Title\n\n- a bullet\n\nSee ${BT}wl:a+b${BT} and ${BT}wl:c-d${BT} ok.`)} } })`)
  await js(`${VIEW}.dispatch({ selection: { anchor: ${VIEW}.state.doc.length } })`)
  await sleep(400)
  ok("typing at the end of a short note crashes no plugin", (await crashes()).length === 0, JSON.stringify(await crashes()))
  ok("the heading is a heading (the markdown decorations are alive)", (await js(`document.querySelectorAll('.cm-line.wm-h1').length`)) === 1)
  ok("the bullet is a bullet", (await js(`document.querySelectorAll('.wm-bullet').length`)) === 1)
  ok("both equations are typeset", (await widgets()) === 2, String(await widgets()))
}
{
  // setDoc in a short note: the same growing edit, replacing everything
  await freshNote()
  await setRendered(false)
  await focus()
  await hook()
  await setDoc("# Heading\n- item\n**bold** text\n", 0)
  await sleep(400)
  await setDoc("# Heading\n- item\n**bold** text\n\n## Second\n\n- more\n- and more\n\n*em* and `wl:x+y` and `wl:x-y`\n", 0)
  await sleep(400)
  ok("replacing a short note by a longer one crashes no plugin", (await crashes()).length === 0, JSON.stringify(await crashes()))
  ok("headings, bullets and bold are decorated after it", (await js(`document.querySelectorAll('.cm-line.wm-h1, .cm-line.wm-h2').length`)) === 2
    && (await js(`document.querySelectorAll('.wm-bullet').length`)) === 3, "")
  ok("both equations are typeset after it", (await widgets()) === 2, String(await widgets()))
}

finish()
