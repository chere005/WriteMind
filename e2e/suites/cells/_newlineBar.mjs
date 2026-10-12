// THE SECOND NEWLINE ARMS THE BAR (Sean, 2026-10-11: "a single newline grows all those contents.. the second newline should make
// the cursor horizontal with the +, not start the next cell"). The first Return at the end of a cell leaves the caret on a new
// line that is the cell's (core growth.ts): its bracket runs down to it and is lit, the Style button names the cell, the rendered
// page keeps the cell open, no bar is up. The second Return, on that line, ends the cell: the line goes, the note keeps exactly
// the blank line that separates the cell from what follows, and the bar under the cell is the cursor (core newline.ts). Typing
// there opens the next cell, ONE Undo gives the grown line back and another takes the newline back. The same for every kind of
// cell, on the markdown side and on the rendered page, with the real Return key (the rendered page's Return is the markdown
// side's: Shift+Return is still the single newline it was). Real keys and the real mouse.
import { ok, test, js, sleep, freshNote, setDoc, doc, sel, key, click, hover, focus, setSel, setRendered, armed, lineBoxes, lineTexts, typeText, shot } from "../../lib/harness.mjs"

export async function runNewlineBar({ rendered }) {
  await freshNote()
  const cellBrackets = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-bracket:not(.wm-bracket-group)')].map(e=>{const r=e.getBoundingClientRect();return {lit:e.classList.contains('wm-bracket-lit'),top:r.top,bottom:r.bottom,h:r.height}}))`))
  const sectionBrackets = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-bracket-group')].map(e=>{const r=e.getBoundingClientRect();return {lit:e.classList.contains('wm-bracket-lit'),top:r.top,bottom:r.bottom,h:r.height}}))`))
  const label = () => js(`document.querySelector('[data-bar=style] .bar-label-text')?.textContent ?? null`)
  // (The caret goes to 0 and back: a bar a Redo left up at the old note's end would otherwise "stand" in the new note when the caret lands on its end.)
  const start = async (text, caret) => { await setDoc(text, caret); await setSel(0); await setSel(caret); await focus(); await sleep(300) }
  /** The bar is drawn (its line and its +), and the caret is not: the bar IS the cursor. */
  const barShown = () => js(`!!document.querySelector('.wm-bar:not(.wm-bar-faint)') && !!document.querySelector('.wm-plus')`)
  const caretHidden = () => js(`[...document.querySelectorAll('.cm-cursor')].every(c => getComputedStyle(c).display === 'none' || getComputedStyle(c).visibility === 'hidden')`)
  const litCount = async () => (await cellBrackets()).filter((b) => b.lit).length

  // What each kind looks like, and what its first Return writes after the cell (the new line; a list's, a quote's or a table's
  // carried-on item). `label` is what the Style button says while the caret is on the grown line.
  const KINDS = [
    { name: "text", cell: "hello", carry: "", label: "Text" },
    { name: "markdown", cell: "<!-- markdown -->\nsome **words**", carry: "", label: "Markdown" },
    { name: "heading", cell: "# Title", carry: "", label: "Title" },
    { name: "rule", cell: "---", carry: "", label: null },
    { name: "list", cell: "- one", carry: "- ", label: "Dots" },
    { name: "numbered list", cell: "1. one", carry: "2. ", label: "Numbered" },
    { name: "to-do list", cell: "- [ ] one", carry: "- [ ] ", label: "To-do" },
    { name: "quote", cell: "> quoted", carry: "> ", label: "Quote" },
    { name: "code block, at its closing fence", cell: "```\nx\n```", carry: "", label: "Code" },
    { name: "maths cell, at its closing fence", cell: "```wl\nx^2\n```", carry: "", label: "Maths", typeset: true },
    // (Return in a table puts the caret in the new row's first cell: two characters in.)
    { name: "table", cell: "| a | b |\n|---|---|\n| 1 | 2 |", carry: "|  |  |", label: "Table", caretIn: 2 },
  ]

  const side = rendered ? "rendered page" : "markdown side"
  await setRendered(rendered)
  // A LIST'S OR A QUOTE'S empty item is not ended into the bar (Sean, 2026-10-11: "exiting bullet points shouldn't exit the cell though,
  // just add a newline after it"): the second Return takes the marker off and leaves the line, the cell grown to it; the THIRD is the bar's.
  const exitsOf = (kind) => ["list", "numbered list", "to-do list", "quote"].includes(kind.name)

  for (const kind of KINDS) {
    for (const tail of ["", "\n\nworld"]) {
      const where = tail ? "with a cell below" : "at the end of the note"
      await test(`${side}: ${kind.name} ${where}: Return grows the cell, Return again arms the bar and keeps the note as it was`, async () => {
        const at = kind.cell.length
        await start(kind.cell + tail, at)
        const before = await cellBrackets()
        ok("one lit bracket, to begin with", before.length === (tail ? 2 : 1) && before[0].lit, JSON.stringify(before))

        // --- the first Return: the cell grows
        await key("Enter"); await sleep(350)
        const grown = kind.cell + "\n" + kind.carry
        const caretOnLine = kind.caretIn ? kind.cell.length + 1 + kind.caretIn : grown.length
        ok("the first Return writes the one newline (and the item's marker) and the caret is on that line", (await doc()) === grown + tail && (await sel())[0] === caretOnLine, JSON.stringify([await doc(), await sel()]))
        ok("no bar is up", !(await armed()), String(await armed()))
        const one = await cellBrackets()
        ok("the cell's bracket is lit and taller than it was, the cell below (if any) is not lit",
          one.length === before.length && one[0].lit && one[0].h > before[0].h + 8 && one.slice(1).every((b) => !b.lit), JSON.stringify({ before, one }))
        if (kind.label) ok(`the Style button names the cell: ${kind.label}`, (await label()) === kind.label, String(await label()))
        if (rendered) ok("the rendered page draws no 'write something' line for it", await js(`!document.querySelector('.wm-pv-placeholder')`))
        if (kind.name === "text" && !tail) await shot(`${rendered ? "rendered" : "markdown"}-text-grown`)
        if (kind.name === "heading" && !tail) await shot(`${rendered ? "rendered" : "markdown"}-heading-grown`)

        // --- a list's or a quote's second Return: the marker goes, the line stays, the cell is still the one
        if (exitsOf(kind)) {
          await key("Enter"); await sleep(400)
          ok("the empty item's Return takes the marker off and keeps the line: a newline after the " + kind.name, (await doc()) === kind.cell + "\n" + tail && (await sel())[0] === kind.cell.length + 1, JSON.stringify([await doc(), await sel()]))
          ok("no bar is up: the cell is not exited", !(await armed()), String(await armed()))
          const stayed = await cellBrackets()
          ok("the cell's bracket is still lit, and runs down to the line", stayed.length === before.length && stayed[0].lit && stayed[0].h > before[0].h + 8, JSON.stringify({ before, stayed }))
        }
        // --- the bar
        await key("Enter"); await sleep(400)
        ok("the Return after it takes the grown line away: the note is as it was", (await doc()) === kind.cell + tail, JSON.stringify(await doc()))
        ok("the bar is up", await armed(), String(await armed()))
        ok("the bar is drawn with its +, and it is the cursor: no caret blinks", (await barShown()) && (await caretHidden()), JSON.stringify([await barShown(), await caretHidden()]))
        // The caret waits on the blank line the bar stands on, or at the end of the note.
        ok("the caret waits where the bar is", (await sel())[0] === (tail ? at + 1 : at), JSON.stringify(await sel()))
        const bar = await cellBrackets()
        // (On the rendered page the cell is drawn again, which is not the height of its source: a rule is a hairline, a code block has its box.)
        ok("nothing is lit and the cell is its own height again", bar.length === before.length && bar.every((b) => !b.lit) && (rendered || kind.typeset || Math.abs(bar[0].h - before[0].h) < 2), JSON.stringify({ before, bar }))
        ok("the Style button says what the bar will open: Text", (await label()) === "Text", String(await label()))
        if (kind.name === "text") await shot(`${rendered ? "rendered" : "markdown"}-text-bar`)
        if (kind.name === "heading") await shot(`${rendered ? "rendered" : "markdown"}-heading-bar`)

        // --- typing: the next cell, after the bar
        await typeText("x"); await sleep(350)
        ok("a character typed opens the next cell after the cell, with one blank line between", (await doc()) === kind.cell + "\n\nx" + tail, JSON.stringify(await doc()))
        const typed = await cellBrackets()
        ok("the new cell is the one lit", typed.length === before.length + 1 && typed[1].lit && !typed[0].lit && (await litCount()) === 1, JSON.stringify(typed))
        ok("and the bar is gone", !(await armed()), String(await armed()))
      })

      await test(`${side}: ${kind.name} ${where}: ONE Undo gives the grown line back, another takes the newline back, Redo does both again`, async () => {
        const at = kind.cell.length
        await start(kind.cell + tail, at)
        await key("Enter"); await sleep(250)
        await key("Enter"); await sleep(300)
        if (exitsOf(kind)) { await key("Enter"); await sleep(300) }
        // (A list's or a quote's marker was taken off by the second Return: the line the bar's Return takes away is the empty one.)
        const grown = kind.cell + "\n" + (exitsOf(kind) ? "" : kind.carry)
        const caretOnLine = kind.caretIn ? kind.cell.length + 1 + kind.caretIn : grown.length
        ok("the bar is up", await armed(), String(await armed()))
        await key("z", { ctrl: true }); await sleep(350)
        ok("one Undo: the grown line is back, the caret on it, the bar gone", (await doc()) === grown + tail && (await sel())[0] === caretOnLine && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))

        const back = await cellBrackets()
        ok("and the cell is lit and grown again", back[0].lit && (await litCount()) === 1, JSON.stringify(back))
        // A list's or a quote's marker coming off is a step of its own, on BOTH pages. On the markdown side it used to undo with the
        // newline when the two Returns came within half a second (`carryTheListOn` named no user event, so CodeMirror joined them; at
        // 700 ms they were two steps): the review of the one-list branch, 2026-10-11, on Sean's probe of a list ("this should not be
        // two separate cells") found Undo skipping the empty item on that side only. Each list Return is its own step now, as on the
        // rendered page (`returnInBlock`) and as a plain Return.
        const markerStep = exitsOf(kind)
        if (markerStep) {
          await key("z", { ctrl: true }); await sleep(350)
          ok("the next Undo gives the marker back", (await doc()) === kind.cell + "\n" + kind.carry + tail, JSON.stringify(await doc()))
        }
        await key("z", { ctrl: true }); await sleep(350)
        ok("the next Undo takes the newline back: the note and the caret as they were", (await doc()) === kind.cell + tail && (await sel())[0] === at && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
        // (Redo walks the same steps back: the newline, the marker coming off, the bar's Return.)
        for (let i = 0; i < (markerStep ? 3 : 2); i++) { await key("z", { ctrl: true, shift: true }); await sleep(300) }
        ok("Redo all the way: the bar again, the note as it was", (await doc()) === kind.cell + tail, JSON.stringify(await doc()))
      })
    }
  }

  await test(`${side}: a heading grown by a newline is transient: a character typed on the line is the next cell, touching, and the heading is its one line again`, async () => {
    await start("# Title", 7)
    await key("Enter"); await sleep(300)
    const grown = await cellBrackets()
    ok("the heading's bracket runs down to the line and is lit", grown.length === 1 && grown[0].lit, JSON.stringify(grown))
    const sections = await sectionBrackets()
    ok("the section's bracket reaches the line with it", sections.length === 1 && sections[0].bottom >= grown[0].bottom - 1, JSON.stringify({ sections, grown }))
    await typeText("b"); await sleep(300)
    ok("the character is a cell of its own (the parser's reading of a heading with a line under it)", (await doc()) === "# Title\nb", JSON.stringify(await doc()))
    const typed = await cellBrackets()
    ok("two cells: the heading one line again and not lit, the new one lit", typed.length === 2 && !typed[0].lit && typed[1].lit && typed[0].h < grown[0].h - 15, JSON.stringify({ grown, typed }))
    ok("the Style button says Text", (await label()) === "Text", String(await label()))
    await key("Backspace"); await key("Backspace"); await sleep(300)
    ok("Backspace twice takes the character and the newline away", (await doc()) === "# Title" && (await sel())[0] === 7, JSON.stringify([await doc(), await sel()]))
  })

  await test(`${side}: a list's empty item: the Return takes the marker off and stays in the cell, the one after it arms the bar; a list that is only an empty item goes, the bar back`, async () => {
    await start("- one\n- two", 11)
    await key("Enter"); await sleep(250)
    ok("the new item is the list's: ONE bracket, lit, three lines", (await doc()) === "- one\n- two\n- " && (await cellBrackets()).length === 1 && (await litCount()) === 1, JSON.stringify([await doc(), await cellBrackets()]))
    await key("Enter"); await sleep(300)
    ok("the marker is gone, the line stays in the list's cell, no bar", (await doc()) === "- one\n- two\n" && !(await armed()) && (await litCount()) === 1 && (await cellBrackets()).length === 1, JSON.stringify([await doc(), await armed(), await cellBrackets()]))
    await key("Enter"); await sleep(300)
    ok("the next Return takes the line away and the bar is up under the list", (await doc()) === "- one\n- two" && (await armed()), JSON.stringify([await doc(), await armed()]))
    // A list just opened (the + menu) with nothing in it. Until 2026-10-11 Return took its marker away and left the line ("not ended into a
    // bar": an empty line between two blank ones on the markdown side, an empty block on the rendered page). Since then a marker alone is
    // the list's empty item (Sean: "the input cursor should go to where it is typing when inserting a checklist or bullets.. typing a * while
    // the input cursor is horizontal will start a markdown text cell with bullet points"), and Return on one that is a cell of its own takes
    // it away and puts the bar back where it was (core newline.ts; editor/10..12 press it after a `*` at the bar).
    await start("hello\n\n- ", 9)
    await key("Enter"); await sleep(300)
    ok("a lone empty item goes and the bar is up where it was", (await doc()) === "hello" && (await armed()), JSON.stringify([await doc(), await armed(), await sel()]))
  })

  await test(`${side}: Shift+Return is the single newline it was: twice makes a blank line and arms nothing`, async () => {
    await start("hello", 5)
    await key("Enter", { shift: true }); await sleep(250)
    ok("one: the cell grows", (await doc()) === "hello\n" && (await litCount()) === 1 && !(await armed()), JSON.stringify([await doc(), await armed()]))
    await key("Enter", { shift: true }); await sleep(300)
    ok("two: a blank line, the caret on the line after it, no bar", (await doc()) === "hello\n\n" && (await sel())[0] === 7 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
  })

  await test(`${side}: a third Return at the bar is the bar's own: an empty cell opens there`, async () => {
    await start("hello", 5)
    await key("Enter"); await sleep(200)
    await key("Enter"); await sleep(250)
    await key("Enter"); await sleep(300)
    ok("an empty cell, the caret in it, the bar gone", (await doc()) === "hello\n\n" && (await sel())[0] === 7 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
    await typeText("x"); await sleep(250)
    ok("and what is typed is its words", (await doc()) === "hello\n\nx", JSON.stringify(await doc()))
  })

  // (Found with this feature, 2026-10-11, and older than it: the bar under the last cell of a note that does not end with a newline,
  // when that cell is drawn, has no line for the browser's caret, and a typed character reached nobody.)
  await test(`${side}: a character typed at the bar under the last cell of a note with no newline at its end opens the next cell, however the bar was armed`, async () => {
    for (const text of ["hello", "```wl\nx^2\n```"]) {
      await start(text, text.length)
      await key("ArrowDown"); await sleep(300)
      ok(`an arrow armed the bar under ${JSON.stringify(text)}`, await armed(), String(await armed()))
      await typeText("x"); await sleep(300)
      ok("and the character opens the next cell", (await doc()) === text + "\n\nx" && !(await armed()), JSON.stringify([await doc(), await armed()]))
    }
  })

  await test(`${side}: Escape at the bar puts it out and the caret back at the end of the cell`, async () => {
    await start("hello\n\nworld", 5)
    await key("Enter"); await sleep(200)
    await key("Enter"); await sleep(300)
    await key("Escape"); await sleep(300)
    ok("no bar, the caret at the end of hello, the note as it was", (await doc()) === "hello\n\nworld" && (await sel())[0] === 5 && !(await armed()), JSON.stringify([await doc(), await sel(), await armed()]))
    ok("hello is lit again", (await cellBrackets())[0].lit)
  })

  await test(`${side}: the arrows walk off the bar as they do off any other, the column kept: Down into the cell below, Up back to the end of the one above`, async () => {
    await start("hello\n\nthe world", 5)
    await key("Enter"); await sleep(200)
    await key("Enter"); await sleep(300)
    ok("the bar is up", await armed(), String(await armed()))
    await key("ArrowDown"); await sleep(300)
    // (The rendered page's Down steps into the cell below at its start, as it does from any bar; the markdown side keeps the column.)
    ok("Down: the cell below", !(await armed()) && (await sel())[0] === (rendered ? 7 : 12), JSON.stringify([await armed(), await sel()]))
    await key("ArrowUp"); await sleep(300)
    ok("Up: the bar again", await armed(), String(await armed()))
    await key("ArrowUp"); await sleep(300)
    ok("Up again: the end of hello", !(await armed()) && (await sel())[0] === 5, JSON.stringify([await armed(), await sel()]))
    await key("Enter"); await sleep(200)
    await key("Enter"); await sleep(300)
    await key("ArrowUp"); await sleep(300)
    ok("Up straight from the bar the second Return put up: the end of hello", !(await armed()) && (await sel())[0] === 5, JSON.stringify([await armed(), await sel()]))
  })

  await test(`${side}: the + on the bar the second Return put up makes the kind picked, below the cell`, async () => {
    await start("hello", 5)
    await key("Enter"); await sleep(200)
    await key("Enter"); await sleep(350)
    const plus = JSON.parse(await js(`(()=>{const e=document.querySelector('.wm-plus'); if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({cx:r.x+r.width/2,cy:r.y+r.height/2})})()`))
    ok("the + is on the bar", !!plus, JSON.stringify(plus))
    if (!plus) return
    await click(plus.cx, plus.cy); await sleep(300)
    await js(`[...document.querySelectorAll('#seam-kinds .float-label')].find(b=>b.textContent==='Dots').closest('button').click()`); await sleep(350)
    ok("a list is made under the cell, one blank line between, the caret after its marker", (await doc()) === "hello\n\n- " && (await sel())[0] === 9, JSON.stringify([await doc(), await sel()]))
    await typeText("x"); await sleep(250)
    ok("and the next thing typed is its first item", (await doc()) === "hello\n\n- x", JSON.stringify(await doc()))
  })

  await test(`${side}: beside a picture Return arms the bar on that side and starts no cell`, async () => {
    const picture = "![](media/missing.png)"
    await start(`intro\n\n${picture}\n\noutro`, 7 + picture.length)
    await key("Enter"); await sleep(300)
    ok("after it: the bar under the picture, the note untouched", (await doc()) === `intro\n\n${picture}\n\noutro` && (await armed()), JSON.stringify([await doc(), await armed()]))
    await typeText("x"); await sleep(250)
    ok("and a character typed there is a cell of its own", (await doc()) === `intro\n\n${picture}\n\nx\n\noutro`, JSON.stringify(await doc()))
  })

  if (rendered) {
    await test(`${side}: Return in the middle of a block still splits it into two (only the end of a cell grows)`, async () => {
      await start("hello world", 5)
      await key("Enter"); await sleep(300)
      ok("two cells: hello and world", (await doc()) === "hello\n\nworld" && (await sel())[0] === 7, JSON.stringify([await doc(), await sel()]))
    })
  }
}
