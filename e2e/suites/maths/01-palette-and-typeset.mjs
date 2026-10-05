// Maths: the palette on the bar, insertMath's edit in the note, typeset in the notebook, source back on click.
// (Was maths.mjs.)
import { until, ok, finish, js, sleep, click, key, typeText, freshNote, shot, focus, doc, setInput, centerOf, clickEl, CTRL } from "../../lib/harness.mjs"

await freshNote()
await focus()
await typeText("The area is ")
const lines = () => js(`[...document.querySelectorAll('.cm-line')].map(l => l.textContent).join('\\n')`)
const palette = () => js(`!!document.querySelector('.math-pop')`)

ok("the maths button is on the bar", !!(await centerOf('[data-math="button"]')))
await clickEl('[data-math="button"]'); await sleep(250)
ok("the palette opens", await palette())
const groups = await js(`[...document.querySelectorAll('[data-group-name]')].map(s => s.dataset.groupName)`)
ok("with its six groups", JSON.stringify(groups) === JSON.stringify(["Calculus", "Algebra", "Functions", "Relations", "Symbols", "Greek"]), JSON.stringify(groups))
await shot("palette")

await clickEl('[data-template="integrate.definite"]'); await sleep(250)
ok("a template with slots opens its fields", (await js(`document.querySelectorAll('.math-form input').length`)) === 4)
const preview = await js(`document.querySelector('.math-preview').textContent`)
ok("the preview is typeset (an integral sign, no template name)", preview.includes("∫") && !preview.includes("Integrate"), preview)
ok("the Wolfram Language source is shown in the custom field", (await js(`document.querySelector('[data-custom]').value`)) === "Integrate[x^2, {x, 0, 1}]")
await shot("form")

// "On its own line" is ticked by default; unticking it puts the maths inline in the sentence.
await js(`document.querySelector('[data-own]').click()`)
await clickEl('[data-insert="1"]'); await sleep(300)
let text = await lines()
ok("inline: the source went into the note as a wl: code span", text.includes("`wl:Integrate[x^2, {x, 0, 1}]`"), text)
ok("the palette closes after inserting", !(await palette()))
await typeText(" and more")
await sleep(300)
ok("moving the caret off typesets it", await js(`!!document.querySelector('.cm-content .wm-math')`))
const shown = await js(`document.querySelector('.cm-content .wm-math').textContent`)
ok("...as maths, not as source", shown.includes("∫") && !shown.includes("Integrate"), shown)
// Inline maths is a linear run of text, the way the Mac sets it (Mathslane-fix2): the exponent and the upper limit are
// raised, the lower limit lowered, the integral sign bigger. (Maths on its own line is MathML: see the block below.)
ok("exponents and limits are typeset as such (raised and lowered pieces of the line)", await js(`(() => {
  const up = [...document.querySelectorAll('.cm-content .wm-math-inline .wm-math-up')].map((e) => [e.textContent, parseFloat(e.style.top)])
  const raised = up.filter(([, top]) => top < 0).map(([t]) => t), lowered = up.filter(([, top]) => top > 0).map(([t]) => t)
  return raised.includes('2') && raised.includes('1') && lowered.includes('0') && !document.querySelector('.cm-content .wm-math-inline math')
})()`))
await shot("typeset")

// A template with no slots (a Greek letter) shows no fields; Escape puts the palette away and inserts nothing.
await clickEl('[data-math="button"]'); await sleep(250)
await clickEl('[data-template="greek.Pi"]'); await sleep(300)
ok("a slotless template shows no fields and a typeset preview", (await js(`document.querySelectorAll('.math-form input').length`)) === 0 && (await js(`document.querySelector('.math-preview').textContent`)).includes("π"))
await key("Escape")
ok("Escape puts the palette away", await until(async () => !(await palette()), 3000))
ok("...and inserts nothing", !(await doc()).includes("Pi"))

// Custom Wolfram Language as a block on its own line (the default placement).
await focus()
await key("End", { ctrl: true })
await typeText("\n")
await clickEl('[data-math="button"]'); await sleep(250)
await setInput('[data-custom]', "Sqrt[x^2 + 1]")
await sleep(250)
ok("custom source previews as typeset maths (a root sign over x squared plus one)", await js(`!!document.querySelector('.math-preview msqrt') && document.querySelector('.math-preview').textContent.includes('x2+1')`))
ok("'On its own line' is the default", await js(`document.querySelector('[data-own]').checked`))
await clickEl('[data-insert="1"]'); await sleep(300)
await key("End", { ctrl: true })
await typeText("after")
await sleep(300)
text = await lines()
ok("block: a wl fence on its own lines", /```wl\nSqrt\[x\^2 \+ 1\]\n```/.test(await doc()), await doc())
ok("the block is typeset in the notebook", await js(`!!document.querySelector('.wm-math-block .wm-math')`))
await shot("block")

// Clicking typeset maths brings its source back for editing.
const inline = await centerOf('.cm-content .wm-math')
await click(inline.x, inline.y)
await sleep(300)
text = await lines()
ok("a click on typeset maths opens its source", text.includes("`wl:Integrate[x^2, {x, 0, 1}]`"), text)
finish()
