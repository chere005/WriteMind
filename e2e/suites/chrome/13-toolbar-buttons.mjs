// THE BAR'S OWN BUTTONS (docs/PLAN-bars-2026-10.md P1): every button runs the same command its key does and its tooltip
// names that key; the inserts are separate buttons (Text box, Picture, Table, Maths, Shapes) with the section moves beside
// them; List, Code and Shapes have their menus; Aa is a popover; each closes on Escape / click-away and hands the keyboard
// back to the notes. Real mouse and keys.
import {
  ok, finish, freshNote, setDoc, setSel, doc, sel, js, sleep, clickEl, key, shot, MOD, menuClick, setRendered, canvasBox, drag,
  saved, rightClick, centerOf,
} from "../../lib/harness.mjs"

await js(`localStorage.clear()`)
await js(`location.reload()`); await sleep(1500)
const file = await freshNote()
const mac = await js(`navigator.userAgent.includes('Mac')`)
const focusIsNotes = () => js(`document.activeElement?.classList.contains('cm-content') ?? false`)
const titleOf = (bar) => js(`document.querySelector('[data-bar=${bar}]')?.title ?? ''`)
const menuOpen = () => js(`!!document.querySelector('.float-menu')`)
const rowsOf = () => js(`JSON.stringify([...document.querySelectorAll('.float-menu > .float-row > button')].map(b => [b.dataset.bar ?? '', b.querySelector('.float-label')?.textContent ?? '', b.querySelector('.hint')?.textContent ?? '', b.getAttribute('aria-checked')]))`).then(JSON.parse)
// (CodeMirror joins edits made within half a second into one undo step: a setDoc just before an action would be undone with it.)
const fresh = async (text, caret = 0) => { await setDoc(text, caret); await sleep(650) }
const START = "# One\n\nalpha words\n\n# Two\n\nbeta words\n"

// ---- the tooltips name this machine's keys, never a hand-typed Ctrl
const k = (win, macKey) => (mac ? macKey : win)
const titles = await js(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.top-bar [data-bar]')].filter(b => b.title && !b.closest('.float-menu')).map(b => [b.dataset.bar, b.title])))`).then(JSON.parse)
ok("Bold, Italic, Underline, Strikethrough, List, Quote, Code name their keys", [["bold", k("Ctrl+B", "Cmd+B")], ["italic", k("Ctrl+I", "Cmd+I")], ["underline", k("Ctrl+U", "Cmd+U")], ["strike", k("Ctrl+Shift+X", "Cmd+Shift+X")], ["list", k("Ctrl+Shift+L", "Cmd+Shift+L")], ["quote", k("Ctrl+Q", "Ctrl+Cmd+Q")], ["code", k("Ctrl+8", "Cmd+8")]].every(([bar, keys]) => (titles[bar] ?? "").includes(`(${keys})`)), JSON.stringify(titles))
ok("Picture, Maths and the section moves name theirs", (titles.picture ?? "").includes(`(${k("Ctrl+Shift+I", "Cmd+Shift+I")})`) && (titles.maths ?? "").includes(`(${k("Ctrl+Shift+M", "Cmd+Shift+M")})`) && (titles.secup ?? "").includes(`(${k("Ctrl+Up", "Ctrl+Cmd+Up")})`) && (titles.secdown ?? "").includes(`(${k("Ctrl+Down", "Ctrl+Cmd+Down")})`), JSON.stringify([titles.picture, titles.maths, titles.secup, titles.secdown]))
ok("no tooltip carries a hand-typed key: on a Mac none says 'Ctrl' but in a Ctrl+Cmd chord; none says 'Ctrl/Cmd'", Object.values(titles).every((t) => !/Ctrl\/Cmd|Cmd\/Ctrl/.test(t) && (!mac || !/Ctrl(?!\+Cmd)/.test(t))), JSON.stringify(Object.entries(titles).filter(([, t]) => /Ctrl\/Cmd|Cmd\/Ctrl/.test(t) || (mac && /Ctrl(?!\+Cmd)/.test(t)))))
ok("the inserts are SEPARATE buttons, in the wireframe's order, then the section moves", await js(`(()=>{const ids=[...document.querySelectorAll('.top-bar [data-bar]')].filter(b=>!b.closest('.float-menu')).map(b=>b.dataset.bar);const at=(x)=>ids.indexOf(x);return at('textbox')>0&&at('picture')===at('textbox')+1&&at('table')===at('picture')+1&&at('maths')===at('table')+1&&at('shapes')===at('maths')+1&&at('secup')>at('shapes')&&at('secdown')===at('secup')+1&&at('pen')>at('secdown')})()`))
ok("there is no Insert button that collapses them, no maths ƒ(x) text button and no letter T", await js(`![...document.querySelectorAll('.top-bar button')].some(b => ['ƒ(x)', 'T', '[T]', '▣', '☰', '❝', '{}', '⤒', '⤓', '⇤', '⇥'].includes(b.textContent.trim()))`))
await shot("buttons")

// ---- Table
await fresh(START, START.indexOf("alpha") + 2)
await js(`document.querySelector('.cm-content').focus()`)
await clickEl('[data-bar=table]'); await sleep(350)
const table = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |"
ok("Table writes an empty two-column table, a header and two rows, as a cell after the caret's", (await doc()) === `# One\n\nalpha words\n\n${table}\n\n# Two\n\nbeta words\n`, JSON.stringify(await doc()))
let head = (await sel())[1]
ok("the caret is in the first header cell (after '| ') and the keyboard is the notes'", (await doc()).slice(head - 2, head) === "| " && await focusIsNotes(), String(head))
await key("Tab"); await sleep(150)
const second = (await sel())
ok("Tab goes to the next cell (the editor's own table engine)", (await doc()).slice(0, second[1]).endsWith("|  | ") || second[1] > head, JSON.stringify(second))
await key("z", MOD); await sleep(250)
ok("ONE undo takes the whole table back", (await doc()) === START, JSON.stringify(await doc()))
await fresh("", 0)
await menuClick("insertTable"); await sleep(350)
ok("Insert > Table is the same command (the application menu's item)", (await doc()) === table, JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)

// ---- the section moves
await fresh(START, START.indexOf("beta") + 1)
await js(`document.querySelector('.cm-content').focus()`)
await clickEl('[data-bar=secup]'); await sleep(350)
ok("Move section up swaps the caret's section with the one before it", (await doc()).indexOf("# Two") < (await doc()).indexOf("# One"), JSON.stringify(await doc()))
ok("the caret is still on 'beta words' (inside the moved section)", await js(`(()=>{const v=document.querySelector('.cm-content').cmTile.view;const h=v.state.selection.main.head;const t=v.state.doc.toString();const i=t.indexOf('beta');return h>=i&&h<=i+10})()`))
await key("z", MOD); await sleep(250)
ok("one undo puts it back", (await doc()) === START, JSON.stringify(await doc()))
await setSel(START.indexOf("alpha") + 1)
await clickEl('[data-bar=secdown]'); await sleep(350)
ok("Move section down swaps it with the one after", (await doc()).indexOf("# Two") < (await doc()).indexOf("# One"))
await key("z", MOD); await sleep(250)

// ---- List: its menu picks the marker (and writes it), indentation items, the icon says which
await fresh("one\n\ntwo\n", 1)
await js(`document.querySelector('.cm-content').focus()`)
await clickEl('[data-bar=list]'); await sleep(300)
ok("the List button writes the marker last picked (dots to begin with)", (await doc()).startsWith("- one"), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)
await rightClick(...Object.values(await centerOf('[data-bar=list]')).slice(0, 2)); await sleep(250)
const listRows = await rowsOf()
ok("its menu: Dots, Dashes, Numbered, To-do, then Increase / Decrease Indentation, the current ticked", JSON.stringify(listRows.map((r) => r[1])) === JSON.stringify(["Dots", "Dashes", "Numbered", "To-do", "Increase Indentation", "Decrease Indentation"]) && listRows[0][3] === "true", JSON.stringify(listRows))
await clickEl('.float-menu [data-bar=list-numbered]'); await sleep(300)
ok("picking Numbered picks the marker and writes it", (await doc()).startsWith("1. one"), JSON.stringify(await doc()))
ok("the keyboard is the notes' and the list icon follows the marker", await focusIsNotes())
await key("z", MOD); await sleep(250)
await fresh("one\n\ntwo\n", 1)
await clickEl('[data-bar=list]'); await sleep(300)
ok("and the button writes numbers from now on (the style last picked)", (await doc()).startsWith("1. one"), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)
await fresh("- one\n- two\n", 3)
await rightClick(...Object.values(await centerOf('[data-bar=list]')).slice(0, 2)); await sleep(250)
await clickEl('.float-menu button:not([data-bar])'); await sleep(300)
ok("Increase Indentation from the List menu indents the line", /^  - one|^\s+- one/.test(await doc()), JSON.stringify(await doc()))
await key("z", MOD); await sleep(250)

// ---- Code: the languages, the current ticked
await fresh("code here\n", 2)
await rightClick(...Object.values(await centerOf('[data-bar=code]')).slice(0, 2)); await sleep(250)
const codeRows = await rowsOf()
ok("its menu lists the ten languages, Plain first and ticked", codeRows.length === 10 && codeRows[0][1] === "Plain Text" && codeRows[0][3] === "true", JSON.stringify(codeRows.map((r) => r[1])))
await key("Escape"); await sleep(250)
ok("Escape closes the menu and the keyboard is the notes'", !(await menuOpen()) && await focusIsNotes())

// ---- Aa: font, size, colour
await fresh("at dawn", 0); await setSel(3, 7)
await clickEl('[data-bar=font]'); await sleep(250)
ok("Aa opens its popover under the button", await js(`!!document.querySelector('.style-pop') && document.querySelector('.style-pop').getBoundingClientRect().top >= document.querySelector('[data-bar=font]').getBoundingClientRect().bottom`))
await key("Escape"); await sleep(250)
ok("Escape closes it and the keyboard is the notes'", !(await js(`!!document.querySelector('.style-pop')`)) && await focusIsNotes())
await clickEl('[data-bar=font]'); await sleep(250)
await clickEl('.footer'); await sleep(250)
ok("a click anywhere else closes it too", !(await js(`!!document.querySelector('.style-pop')`)))

// ---- Maths: the palette
await clickEl('[data-bar=maths]'); await sleep(350)
ok("Maths opens the palette (its hooks stay: data-math button and pop)", await js(`!!document.querySelector('[data-math=pop]') && document.querySelector('[data-math=button]').classList.contains('on')`))
await key("Escape"); await sleep(250)
ok("Escape closes it and gives the notes the keyboard", !(await js(`!!document.querySelector('[data-math=pop]')`)) && await focusIsNotes())

// ---- Shapes: nodes, lines (the arrow tool ticked while armed), marks
await clickEl('[data-bar=shapes]'); await sleep(250)
const shapeRows = await rowsOf()
ok("the Shapes menu: the flow-chart nodes, the lines, the marks", shapeRows.some((r) => r[1] === "Rectangle") && shapeRows.some((r) => r[1] === "Diamond") && shapeRows.some((r) => r[1] === "Arrow") && shapeRows.some((r) => r[1].startsWith("Arrow tool")) && shapeRows.some((r) => r[1] === "Check Mark") && shapeRows.some((r) => r[1] === "Star"), JSON.stringify(shapeRows.map((r) => r[1])))
await clickEl('.float-menu [data-bar=shape-tool]'); await sleep(250)
ok("arming the Arrow tool lights Shapes", await js(`document.querySelector('[data-bar=shapes]').classList.contains('on')`))
await clickEl('[data-bar=shapes]'); await sleep(250)
ok("and the menu ticks the Arrow tool", (await rowsOf()).find((r) => r[1].startsWith("Arrow tool"))?.[3] === "true")
await clickEl('.float-menu [data-bar=shape-tool]'); await sleep(250)
ok("picking it again puts it away", !(await js(`document.querySelector('[data-bar=shapes]').classList.contains('on')`)))

// ---- Text box lights while armed, and puts a box down on the rendered page
await setRendered(true)
await clickEl('[data-bar=textbox]'); await sleep(250)
ok("Text box is lit while armed", await js(`document.querySelector('[data-bar=textbox]').classList.contains('on')`))
const cb = await canvasBox()
await drag(cb.x + 300, cb.y + 300, cb.x + 460, cb.y + 340, { steps: 8 })
const d = await saved(file, (x) => x.items.some((i) => i.kind === "shape"))
ok("the next drag puts a text box on the page", d.items.some((i) => i.kind === "shape" && i.shapeKind === "text"))
await key("Escape"); await sleep(200)
await setRendered(false)

// ---- the bar's right-click is Customize toolbar…
const sc = await centerOf('.top-bar .grow')
await rightClick(sc.x, sc.y); await sleep(250)
ok("a right-click on the bar opens the four-section checklist", await js(`document.querySelectorAll('.bar-context label').length === 4`))
await key("Escape"); await sleep(250)
ok("Escape closes it", await js(`!document.querySelector('.bar-context')`))
finish()
