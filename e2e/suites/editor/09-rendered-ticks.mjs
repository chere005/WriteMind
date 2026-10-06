// A code span's backticks on the rendered page: put away even on the line being edited, so a selection never takes
// them (Sean, 2026-10-06: "backticks should not be highlightable in rendered view").
import { setRendered, ok, finish, js, sleep, freshNote, setDoc, shot } from "../../lib/harness.mjs"

await freshNote()
const V = `document.querySelector('.cm-content').cmTile.view`
const shownTicks = () => js(`[...document.querySelectorAll('.cm-content .wm-marker')].filter(e=>e.textContent.includes('\`')).length`)
await setDoc("Say `code` and **bold** here.")
await setRendered(true); await sleep(300)
await js(`${V}.dispatch({selection:{anchor:6}}); ${V}.focus(); true`); await sleep(200)
ok("the caret in the span: no backtick shows", (await shownTicks()) === 0)
await js(`${V}.dispatch({selection:{anchor:0,head:${"Say `code` and **bold** here.".length}}}); true`); await sleep(200)
ok("the whole line selected: no backtick shows", (await shownTicks()) === 0)
ok("...and no backtick is in what the page shows", !(await js(`document.querySelector('.cm-content').innerText`)).includes("`"))
await shot("rendered-ticks")
await setRendered(false); await sleep(300)
await js(`${V}.dispatch({selection:{anchor:6}}); true`); await sleep(200)
ok("the markdown still shows them", (await shownTicks()) === 2)
finish()
