// The sidebar's search: ⇧⌘F, typing, results (title, section, a line with the match marked), diacritics, no matches,
// the arrow keys, Enter into the note with the Find bar on the first match, Escape back to the notes.
import { ok, finish, js, sleep, key, typeText, shot, waitFor, menuClick, selText, sel, doc, VIEW, until } from "../../lib/harness.mjs"
import { seed, side, MOD } from "./_lib.mjs"

await seed()
const search = (words) => js(`(() => { const i = document.querySelector('[data-sidebar=search]'); i.focus(); i.select(); return true })()`).then(() => typeText(words))
const settled = async (query) => { await waitFor(`(() => { const r = document.querySelector('.results'); return !!r && r.getAttribute('aria-busy') === 'false' })()`).catch(() => {}); await sleep(450); return side() }

// ---- the bar
let s = await side()
ok("the bar is 36px tall", Math.round(s.bar.h) === 36, JSON.stringify(s.bar))
ok("search, +, the pencil — and no rendered or video button on it", JSON.stringify(s.bar.kids) === JSON.stringify(["search", "new-note", "edit"]), JSON.stringify(s.bar.kids))
ok("the tree shows (7 notes) and there are no results", s.tree === 7 && !s.results, `${s.tree}`)

// ---- ⇧⌘F with the sidebar showing: the field takes the keyboard
await js(`document.body.focus?.()`)
await key("f", { ...MOD, shift: true }); await sleep(300)
s = await side()
ok("Search Notes (⇧⌘F) puts the caret in the field", s.focused === "search", s.focused)

// ---- ⇧⌘F with the sidebar away opens it first
await menuClick("toggleSidebar"); await sleep(300)
ok("the sidebar is away", !(await side()).sidebar)
await key("f", { ...MOD, shift: true }); await sleep(500)
s = await side()
ok("…and the key brings it back with the field focused", s.sidebar && s.focused === "search", JSON.stringify([s.sidebar, s.focused]))

// ---- typing: results replace the tree
await search("gauge")
s = await settled("gauge")
ok("results replace the tree", s.results && s.tree === 0 && s.hits.length === 4, JSON.stringify(s.hits.map((h) => h.title)))
ok("a title match first, then the words (newest first)", s.hits.map((h) => h.title).join("|") === "Gauge basics|Demo note|Second note|Qubits", s.hits.map((h) => h.title).join("|"))
const by = Object.fromEntries(s.hits.map((h) => [h.title, h]))
ok("the title's match is marked", by["Gauge basics"].mark === "Gauge", by["Gauge basics"].mark)
ok("a line of the words with the match marked, case as the note has it", by["Second note"].snippetMark === "Gauge" && by["Second note"].snippet.startsWith("Text here."), JSON.stringify(by["Second note"]))
ok("each result names its section", by["Qubits"].where === "Research Projects › Quantum Computing Notes" && by["Second note"].where === "Sections", `${by["Qubits"].where} / ${by["Second note"].where}`)
ok("a note in the project folder names the folder", by["Demo note"].where.length > 0 && !by["Demo note"].where.includes("›"), by["Demo note"].where)
await shot("results")

// ---- accents and case
await search("cafe")
s = await settled("cafe")
ok("'cafe' finds the Café note, marked as written", s.hits.length === 1 && s.hits[0].title === "Qubits" && s.hits[0].snippetMark === "Café", JSON.stringify(s.hits))
await search("ÉCOLE")
s = await settled("ÉCOLE")
ok("no match says so in one line", s.hits.length === 0 && /No notes match/.test(s.status ?? ""), s.status)
await shot("no-matches")

// ---- the arrow keys and Enter
await search("note")
s = await settled("note")
ok("'note' finds several, and none is chosen yet", s.hits.length >= 3 && s.hits.every((h) => !h.active), s.hits.map((h) => h.title).join("|"))
await key("ArrowDown"); await key("ArrowDown"); await sleep(150)
s = await side()
ok("Down twice is on the second result", s.hits[1].active && s.hits.filter((h) => h.active).length === 1, JSON.stringify(s.hits.map((h) => h.active)))
await key("ArrowUp"); await sleep(100)
ok("Up goes back one", (await side()).hits[0].active)
await key("ArrowDown"); await sleep(100)
const chosen = (await side()).hits[1]
await key("Enter"); await sleep(1500)
s = await side()
const where = await js(`document.querySelector('.footer span')?.textContent`)
ok("Enter opens the chosen note", where === chosen.path.split(/[\\/]/).pop(), `${where} vs ${chosen.path}`)
ok("the Find bar is up on the words typed", s.find !== null && /note/i.test(s.find.value), JSON.stringify(s.find))
const text = await doc()
const [from, to] = await sel()
ok("the first match is selected in the note", to > from && /^note$/i.test(await selText()) && text.toLowerCase().indexOf("note") === Math.min(from, to), `${await selText()} @${from}-${to}`)
await shot("opened")
await key("Escape"); await sleep(300)

// ---- Escape clears the field and gives the keyboard back
await search("gauge"); await settled("gauge")
await key("Escape"); await sleep(400)
s = await side()
ok("Escape clears the field and the tree is back", s.field === "" && !s.results && s.tree === 7, JSON.stringify([s.field, s.results, s.tree]))
ok("and the keyboard is the note's", await js(`!!document.activeElement.closest('.cm-content')`))

// ---- a result opens with a click too, and a hit's own menu
await search("qubits"); await settled("qubits")
await js(`document.querySelector('.hit-row').click()`); await sleep(1200)
ok("a click opens the note", (await js(`document.querySelector('.footer span')?.textContent`)) === "Qubits.wm")
finish()
