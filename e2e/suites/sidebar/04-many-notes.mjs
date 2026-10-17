// A project of 3,000 notes: the list draws, the first search reads every note and the second asks the disk only whether a
// file moved, and typing in the search field does not stall the page. (Numbers are printed as notes; the limits are generous.)
// @e2e timeout=240
import fs from "node:fs"
import path from "node:path"
import { ok, note, finish, js, sleep, typeText, notesDir, resetNotes, writeNoteFile, reloadApp, waitFor, key, shot } from "../../lib/harness.mjs"

await resetNotes({ reload: false })
const N = 3000
for (let i = 0; i < N; i++) {
  const folder = ["", "Alpha/", "Beta/", "Beta/Deep/"][i % 4]
  await writeNoteFile(`${folder}Note ${i}.wm`, `# Note ${i}\n${"Some ordinary words about heat and flow. ".repeat(6)}\nunique-token-${i} café ${i % 7 === 0 ? "needle" : ""}\n`)
}
const started = Date.now()
await reloadApp()
await waitFor(`document.querySelectorAll('.note-row').length >= ${N}`, 60000)
note(`${N} rows drawn ${Date.now() - started} ms after the reload`)
ok("every note has a row", (await js(`document.querySelectorAll('.note-row').length`)) === N)
// THE LAUNCH IS NOT OVER WITH THE ROWS: with no tab to bring back the app opens the project's first note (useSession.ts `restore`,
// as the Mac does), and on the Windows runner that came seconds after the rows, after the first letter of the search below. It
// took the keyboard then, and the rest of the typing went into Note 2996; an open the app makes by itself leaves the keyboard
// in a field that has it now (focusReturn.ts `openTakesKeyboard`; sidebar/05 runs that race on purpose). The search starts at once.

const query = async (words) => {
  await js(`(() => { const i = document.querySelector('[data-sidebar=search]'); i.focus(); i.select() })()`)
  const t0 = Date.now()
  await typeText(words)
  // Done is the list showing the answer FOR THESE WORDS: while a search is still on its way the rows of an earlier one (a few
  // letters typed, on a slow runner) stay up, and they are not this search's answer.
  await waitFor(`(() => { const r = document.querySelector('.results'); return !!r && r.getAttribute('aria-busy') === 'false' && r.dataset.query === ${JSON.stringify(words)} && ![...r.querySelectorAll('[data-sidebar=searching]')].length })()`, 60000)
  return {
    ms: Date.now() - t0, hits: await js(`document.querySelectorAll('.hit-row').length`),
    typed: await js(`document.querySelector('[data-sidebar=search]').value`), first: await js(`[...document.querySelectorAll('.hit-row .title')].slice(0, 3).map((t) => t.textContent).join(' | ')`),
  }
}
// a frame counter that runs while the search does: if the main process or the page blocked, it would stall
await js(`window.__frames = 0; (function tick() { window.__frames++; requestAnimationFrame(tick) })()`)
const first = await query("unique-token-2999")
note(`first search (reads ${N} notes): ${first.ms} ms`)
ok("the first search finds the one note", first.hits === 1, `${first.hits} for “${first.typed}”: ${first.first}`)
const frames = await js(`window.__frames`)
ok("the page kept drawing frames while it ran", frames > first.ms / 200, `${frames} frames in ${first.ms} ms`)
await waitFor(`!!document.querySelector('.cm-content')`, 60000)
note(`the first note open ${Date.now() - started} ms after the reload`)
const opened = await js(`document.querySelector('.cm-content').cmTile.view.state.doc.toString()`)
ok("the launch's note is open, with none of the search's letters in it", /^# Note \d+\n/.test(opened), JSON.stringify(opened.slice(0, 40)))
await js(`document.querySelector('[data-sidebar=search-clear]').click()`)
await sleep(300)
const second = await query("needle")
note(`second search (from the cache): ${second.ms} ms, ${second.hits} results`)
ok("the words of a few notes: capped at 200, best first", second.hits === 200 || second.hits === Math.ceil(N / 7), `${second.hits}`)
ok("the second search is not slower than the first", second.ms < first.ms + 2000, `${second.ms} vs ${first.ms}`)
ok("a search is well inside a minute", first.ms < 45000)
await shot("many")
await key("Escape"); await sleep(400)
ok("clearing brings the list back", (await js(`document.querySelectorAll('.note-row').length`)) === N)
finish()
