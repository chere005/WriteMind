// The evaluation cell's mark shows the LANGUAGE'S ICON, not letters (Sean, a608cc3: "use icons for WL, CPP, Python").
// A note of five evaluation cells (Wolfram, Python, C, C++, Rust) and one that names a language this app cannot run:
// each cell's mark is a button holding an <svg> of that language (none of the letters is drawn), with the language's
// name and letters as its accessible name and its tooltip; the icons are 12+ px, paint in the mark's own colour
// (currentColor, so the dark theme and the amber of a missing tool follow) and none of the marks overlap; the
// unknown fence keeps its dash as text; a click on a mark opens Runs As with an icon on each row, and picking Rust
// on the Python cell rewrites its fence and redraws the mark; the language under In[n] (a cell that has "run": its
// `out` pair is written into the note by hand, nothing is started) is an icon too. Shots: the five marks in the
// light theme and in the dark, and the menu.
import {
  ok, finish, js, sleep, setDoc, setRendered, focus, setSel, doc, click, send, shot, waitFor, freshNote, rectOf,
} from "../../lib/harness.mjs"

await freshNote()
await setRendered(false)
// (the instance follows the machine's appearance, which may be dark: say which theme each half is in)
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] })

const FENCES = ["wl", "python", "c", "c++", "rust"]
const EVALUATOR = { wl: "wolfram", python: "python", c: "c", "c++": "cpp", rust: "rust" }
const LETTERS = { wolfram: "WL", python: "PY", c: "C", cpp: "C++", rust: "RS" }
const NAMES = { wolfram: "Wolfram", python: "Python", c: "C", cpp: "C++", rust: "Rust" }
const text = [
  ...FENCES.flatMap((f) => ["```eval " + f, "1", "```", ""]),
  "```eval fortran", "1", "```", "",
].join("\n")
await setDoc(text, 0); await focus(); await sleep(700)

const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const badges = () => J(`[...document.querySelectorAll('.wm-eval-badge')].map((b) => {
  const r = b.getBoundingClientRect(); const svg = b.querySelector('svg'); const s = svg?.getBoundingClientRect()
  return { which: b.dataset.evalBadge, letters: b.dataset.evalLetters ?? null, aria: b.getAttribute('aria-label'), title: b.title,
    shown: b.textContent.replace('▾', '').trim(), icon: svg?.dataset.evalIcon ?? null, paths: svg ? svg.querySelectorAll('path').length : 0,
    side: s ? Math.round(Math.min(s.width, s.height)) : 0, hidden: svg?.getAttribute('aria-hidden') ?? null,
    left: r.left, right: r.right, top: r.top, bottom: r.bottom, colour: getComputedStyle(b).color, iconColour: svg ? getComputedStyle(svg).color : null,
    painted: svg ? [...svg.querySelectorAll('path')].every((p) => (p.getAttribute('fill') === 'currentColor') !== (p.getAttribute('stroke') === 'currentColor')) : false,
    logoRed: svg ? [...svg.querySelectorAll('path')].every((p) => p.getAttribute('fill') === '#dd1100') : false } })`)

await waitFor(`document.querySelectorAll('.wm-eval-badge').length === 6`)
const all = await badges()
ok("one mark per cell: five languages and the one this app cannot run", all.length === 6, JSON.stringify(all.map((b) => b.which)))
const five = all.filter((b) => b.which !== "")
ok("the five marks name their languages in order", JSON.stringify(five.map((b) => b.which)) === JSON.stringify(["wolfram", "python", "c", "cpp", "rust"]))
for (const b of five) {
  ok(`${b.which}: the mark is an icon of that language`, b.icon === b.which && b.paths >= 1, JSON.stringify(b))
  ok(`${b.which}: no letters are drawn (the chevron is all the text there is)`, b.shown === "", JSON.stringify(b.shown))
  ok(`${b.which}: its name and letters are the accessible name, and the tooltip says how to run it`,
    b.aria === `${NAMES[b.which]} (${LETTERS[b.which]})` && b.letters === LETTERS[b.which] && b.title.includes(NAMES[b.which]) && b.title.includes("Shift+Enter"), JSON.stringify(b))
  ok(`${b.which}: the drawing is hidden from assistive technology, the button names it`, b.hidden === "true")
  ok(`${b.which}: the icon is at least 12 px`, b.side >= 12, String(b.side))
  if (b.which === "wolfram") ok("wolfram: the real logo, in its own red", b.logoRed, JSON.stringify(b))
  else ok(`${b.which}: painted in currentColor, filled or stroked and never both`, b.painted && b.iconColour === b.colour, JSON.stringify([b.iconColour, b.colour]))
}
const unknown = all.find((b) => b.which === "")
ok("an unknown language keeps its dash as text, with no icon", unknown && unknown.icon === null && unknown.shown === "—", JSON.stringify(unknown))
const overlaps = five.filter((b, i) => five.some((c, j) => j !== i && b.left < c.right && c.left < b.right && b.top < c.bottom && c.top < b.bottom))
ok("no two marks overlap", overlaps.length === 0)
// the marks stay in the page's left margin: the badge ends before the cell's text begins
const contentLeft = await js(`document.querySelector('.cm-content').getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector('.cm-content')).paddingLeft)`)
ok("the marks end before the cells begin", five.every((b) => b.right <= contentLeft + 1), JSON.stringify([five.map((b) => b.right), contentLeft]))
await shot("light")

// ---- the dark theme: the same marks, the same icons, the dark theme's own colour
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] })
await sleep(500)
const dark = await badges()
ok("dark: still five icons, in a colour that is not the light theme's", dark.filter((b) => b.icon).length === 5
  && dark.find((b) => b.which === "python").colour !== five.find((b) => b.which === "python").colour, JSON.stringify(dark.map((b) => b.colour)))
await shot("dark")
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] })
await sleep(300)

// ---- a missing tool turns the icon amber (the class the runner's report sets); the icon follows the button's colour
const amber = await js(`(() => { const b = document.querySelector('.wm-eval-badge[data-eval-badge="rust"]'); b.classList.add('wm-eval-missing')
  const out = [getComputedStyle(b).color, getComputedStyle(b.querySelector('svg')).color]; b.classList.remove('wm-eval-missing'); return JSON.stringify(out) })()`)
ok("a missing tool's icon is amber, like its letters were", JSON.parse(amber).every((c) => c === "rgb(217, 119, 6)"), amber)

// ---- the mark is still the Runs As button: a click opens the menu, an icon beside each name
const python = await rectOf('.wm-eval-badge[data-eval-badge="python"]')
await click(python.x + python.w / 2, python.y + python.h / 2); await sleep(300)
const menu = await J(`[...document.querySelectorAll('.wm-eval-menu button[data-evaluator]')].map((b) => ({ which: b.dataset.evaluator, icon: b.querySelector('svg')?.dataset.evalIcon ?? null, text: b.textContent }))`)
ok("Runs As lists the five, each with its icon and its name in words", JSON.stringify(menu.map((m) => m.which)) === JSON.stringify(Object.keys(NAMES))
  && menu.every((m) => m.icon === m.which && m.text.includes(NAMES[m.which])), JSON.stringify(menu))
ok("it has the heading", await js(`document.querySelector('.wm-eval-menu .wm-eval-title')?.textContent === 'Runs As'`))
await shot("menu")
await js(`document.querySelector('.wm-eval-menu button[data-evaluator="rust"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`)
await sleep(400)
const after = await doc()
ok("picking Rust rewrote the Python cell's fence", after.includes("```eval rust\n1\n```\n\n```eval c\n") && !after.includes("eval python"), JSON.stringify(after.slice(0, 120)))
const rust = await badges()
ok("and its mark is the Rust icon now", rust.filter((b) => b.icon === "rust").length === 2, JSON.stringify(rust.map((b) => b.icon)))
ok("the menu closed", await js(`!document.querySelector('.wm-eval-menu')`))

// ---- a cell that has run: In[n] over the language's icon (the pair is written by hand; nothing is started)
await setDoc("```eval python\nprint(1)\n```\n\n```out\n1\n```\n\n```eval c++\nint main(){}\n```\n\n```out\n[no output]\n```\n", 0)
await focus(); await sleep(700)
await waitFor(`document.querySelectorAll('.wm-eval-lang').length === 2`)
const ran = await J(`[...document.querySelectorAll('.wm-eval-lang')].map((l) => ({ which: l.dataset.evalLang, icon: l.querySelector('svg')?.dataset.evalIcon ?? null,
  shown: l.textContent.trim(), aria: l.getAttribute('aria-label'), side: Math.round(l.querySelector('svg')?.getBoundingClientRect().width ?? 0) }))`)
ok("under In[1] and In[2] the language is an icon, with no letters", ran.length === 2 && ran[0].icon === "python" && ran[1].icon === "cpp"
  && ran.every((r) => r.shown === "" && r.side >= 12), JSON.stringify(ran))
ok("its accessible name is still the language and its letters", ran[0].aria === "Python (PY)" && ran[1].aria === "C++ (C++)", JSON.stringify(ran.map((r) => r.aria)))
ok("the labels are still In[1] and In[2], Out[1] and Out[2]", JSON.stringify(await J(`[...document.querySelectorAll('.wm-eval-label')].map((l) => l.textContent)`)) === JSON.stringify(["In[1]", "Out[1]", "In[2]", "Out[2]"]))
// the language under In[n] still opens the menu
const lang = await rectOf('.wm-eval-lang[data-eval-lang="python"]')
await click(lang.x + lang.w / 2, lang.y + lang.h / 2); await sleep(300)
ok("a click on the icon under In[n] opens Runs As too", await js(`!!document.querySelector('.wm-eval-menu')`))
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200)
await shot("ran")

finish()
