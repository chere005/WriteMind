// Holding cells with brackets: click, shift-click extends, ctrl-click adds / removes, a drag down picks a run,
// move / duplicate / delete by key, typing over a run, dragging a held bracket moves the run. (Was tour/t03.mjs.)
import { ok, finish, js, sleep, freshNote, setDoc, doc, sel, selText, key, typeKeys, click, dragPath, line, brackets, focus, shot, CTRL, SHIFT } from "../../lib/harness.mjs"

const D0 = "# Title\n\nAlpha para one\nsecond line\n\nBeta\n\n- a\n- b\n\nGamma\n\nDelta"
await freshNote()
await setDoc(D0); await focus(); await sleep(300)

// the section bracket of "# Title" is a group bracket; the cell ones are the plain ones
let b = await brackets()
ok("six cell brackets for six cells", b.length === 6, b.length)
await click(b[1].x, b[1].y)
ok("a bracket click holds the cell", (await selText()) === "Alpha para one\nsecond line", await selText())
await click(b[2].x, b[2].y, { shift: true })
ok("shift-click extends the hold", (await selText()).includes("Alpha para one") && (await selText()).includes("Beta"), await selText())
await click(b[4].x, b[4].y, { ctrl: true })
ok("ctrl-click adds a cell (with a hole between)", (await selText()).endsWith("Gamma"), await selText())
await click(b[2].x, b[2].y, { ctrl: true })
ok("ctrl-click on a held cell lets it go", !(await selText()).includes("Beta"), await selText())

await click(b[1].x, b[1].y)
await key("ArrowDown", { ctrl: true, shift: true })
ok("Ctrl-Shift-Down moves the held cell down", (await doc()).startsWith("# Title\n\nBeta\n\nAlpha para one"), JSON.stringify(await doc()))
ok("the cell is still held after the move", (await selText()) === "Alpha para one\nsecond line", await selText())
await key("ArrowUp", { ctrl: true, shift: true })
ok("Ctrl-Shift-Up moves it back", (await doc()) === D0, JSON.stringify(await doc()))
await key("d", { ctrl: true, shift: true })
ok("Ctrl-Shift-D duplicates the held cell", (await doc()).includes("second line\n\nAlpha para one\nsecond line\n\nBeta"), JSON.stringify(await doc()))
await key("Backspace", { ctrl: true })
ok("Ctrl-Backspace deletes the held cell", (await doc()) === D0, JSON.stringify(await doc()))

// a drag down the brackets holds a run, live
b = await brackets()
await dragPath(line([b[2].x, b[2].y], [b[4].x, b[4].y], 20))
const run = (await selText()).split("|")
ok("dragging down the brackets holds a run of three cells", run.length === 3 && run[0] === "Beta" && run[2] === "Gamma", JSON.stringify(run))
await shot("run-held")
await typeKeys("Z")
ok("typing replaces the whole run with the text", (await doc()).includes("Z") && !(await doc()).includes("Beta") && !(await doc()).includes("Gamma") && (await doc()).includes("Delta"), JSON.stringify(await doc()))
await key("z", { ctrl: true })
ok("Ctrl+Z gives the run back", (await doc()).includes("Beta") && (await doc()).includes("Gamma"), JSON.stringify(await doc()))

// dragging a HELD bracket moves the run to where it is dropped
await setDoc(D0); await sleep(250); b = await brackets()
await click(b[1].x, b[1].y)
await dragPath(line([b[1].x, b[1].y], [b[3].x, b[3].y + 8], 20))
const moved = await doc()
ok("dragging a held bracket down moves the cell past the ones it crossed", moved.indexOf("Alpha para one") > moved.indexOf("Beta"), JSON.stringify(moved))
ok("and nothing was lost by the move", moved.length === D0.length, `${moved.length} vs ${D0.length}`)

// a click on the text drops the hold: the selection collapses to a caret
await click(400, 300)
const s = await sel()
ok("a click on the text leaves a caret, not a hold", s[0] === s[1], JSON.stringify(s))
finish()
