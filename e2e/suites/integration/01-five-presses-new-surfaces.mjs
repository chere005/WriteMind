// The requirement, end to end, from the NEW surfaces (Sean, 2026-10-10: "make sure undo is always able to undo up to 3 steps, even
// if it involves file changes"; docs/PLAN-bars-2026-10.md P8's scenario: type, rename, move to a section, trash another note, type;
// five Ctrl+Z, five Ctrl+Shift+Z). Here the five things are done the way the new bars do them:
//   1. the Style button's menu: Title on a cell                          (a text step)
//   2. the tab row's right-click menu: Rename…                           (a file step)
//   3. the sidebar row's right-click menu: Move to ▸ a section           (a file step)
//   4. the sidebar row's right-click menu: Move to Trash… on ANOTHER note (a file step)
//   5. the seam's +: a Quote cell between two cells                      (a text step)
// After EVERY step, and after every press of Ctrl+Z and of Ctrl+Shift+Z, the picture is read whole — the tab in front, the words, the
// caret, whether the keyboard is in the notes, the files on disk and what each holds, the sidebar's rows, the footer's file name —
// and compared with the picture taken at the same point on the way forward.
import {
  ok, finish, js, sleep, shot, doc, start, world, expectWorld, sameAs, ALL, tabMenu, rowMenu, dialog, styleMenu, seamPick, caretAfter,
  undo, redo, J, caretTo,
} from "./_lib.mjs"

const A0 = "alpha\n\nbeta words\n\ngamma\n"
await start({ "Alpha.md": A0, "Other.md": "other\n", "Sec/In.md": "inside\n" })
const ROWS0 = ["Alpha.wm", "Other.wm", "Sec", "Sec/In.wm"]
const FILES0 = ["Alpha.wm", "Other.wm", "Sec/", "Sec/In.wm"]

await caretAfter("beta")
const W = [await world()]                    // W[k]: the picture after step k
expectWorld("the start", W[0], { front: "Alpha", text: A0, caret: [11, 11], notes: true, files: FILES0, rows: ROWS0, footer: "Alpha.wm" })

// ---- 1. Style ▸ Title (a text step)
await styleMenu("heading-1")
let got = await world()
const A1 = "alpha\n\n# beta words\n\ngamma\n"
expectWorld("step 1, Style > Title", got, { front: "beta words", text: A1, notes: true, files: FILES0, rows: ROWS0, disk: { "Alpha.wm": A1, "Other.wm": "other\n", "Sec/In.wm": "inside\n" }, footer: "Alpha.wm" })
ok("step 1: the caret is on the same words (beta|)", got.text.slice(0, got.caret[1]).endsWith("# beta"), JSON.stringify(got.caret))
W.push(got)
await sleep(700)

// ---- 2. the tab's menu: Rename… (a file step)
await tabMenu("Alpha.wm", "Rename…"); await dialog("Beta")
got = await world()
expectWorld("step 2, tab menu > Rename… Beta", got, { front: "beta words", text: A1, caret: W[1].caret, notes: true, files: ["Beta.wm", "Other.wm", "Sec/", "Sec/In.wm"], rows: ["Beta.wm", "Other.wm", "Sec", "Sec/In.wm"], disk: { "Beta.wm": A1, "Other.wm": "other\n" }, footer: "Beta.wm" })
W.push(got)

// ---- 3. the sidebar row's menu: Move to ▸ Sec (a file step)
await rowMenu("Beta.wm", "Move to", { sub: "Sec" })
got = await world()
expectWorld("step 3, sidebar row menu > Move to > Sec", got, { front: "beta words", text: A1, caret: W[1].caret, notes: true, files: ["Other.wm", "Sec/", "Sec/Beta.wm", "Sec/In.wm"], rows: ["Other.wm", "Sec", "Sec/Beta.wm", "Sec/In.wm"], disk: { "Sec/Beta.wm": A1 }, footer: "Beta.wm" })
W.push(got)

// ---- 4. the sidebar row's menu: Move to Trash… on another note (a file step)
await rowMenu("Other.wm", "Move to Trash…"); await dialog()
got = await world()
expectWorld("step 4, sidebar row menu > Move to Trash… Other", got, { front: "beta words", text: A1, caret: W[1].caret, notes: true, files: ["Sec/", "Sec/Beta.wm", "Sec/In.wm"], rows: ["Sec", "Sec/Beta.wm", "Sec/In.wm"], footer: "Beta.wm" })
ok("step 4: the note that was trashed is not on disk (the OS Trash has it)", !got.files.includes("Other.wm"))
W.push(got)

// ---- 5. the seam's +: a Quote cell between “# beta words” and “gamma” (a text step)
let armedAt = null
await seamPick("Quote", 3, { onMenu: async () => { armedAt = await world() } })
got = await world()
const A5 = "alpha\n\n# beta words\n\n> \n\ngamma\n"
expectWorld("step 5, seam + > Quote", got, { front: "beta words", text: A5, notes: true, files: ["Sec/", "Sec/Beta.wm", "Sec/In.wm"], rows: ["Sec", "Sec/Beta.wm", "Sec/In.wm"], footer: "Beta.wm" })
ok("step 5: the caret is inside the new quote cell, after its marker", got.caret[0] === got.caret[1] && got.caret[1] === "alpha\n\n# beta words\n\n> ".length, JSON.stringify(got.caret))
await sleep(900)
W.push(await world())
await shot("after-5-steps")

// ---- Ctrl+Z, five times: each takes back the newest step, whichever kind
// What each press must leave is the picture BEFORE that step: the text step's caret is where the gesture found it (the bar armed
// for the seam), a file step leaves the open note's caret alone.
await undo()
got = await world()
sameAs("press 1 (the Quote cell)", got, W[4], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
ok("press 1: the caret is back where the + found it (the bar's place)", JSON.stringify(got.caret) === JSON.stringify(armedAt.caret), `${JSON.stringify(got.caret)} vs ${JSON.stringify(armedAt.caret)}`)

await undo()
got = await world()
sameAs("press 2 (the trash: Other is back)", got, W[3], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
ok("press 2: Other is back with its words, as a file and as a row", got.disk["Other.wm"] === "other\n" && got.rows.includes("Other.wm"), JSON.stringify([got.disk, got.rows]))
ok("press 2: the open note's caret did not move", JSON.stringify(got.caret) === JSON.stringify(armedAt.caret), JSON.stringify(got.caret))

await undo()
got = await world()
sameAs("press 3 (the move: Beta is at the root again)", got, W[2], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])

await undo()
got = await world()
sameAs("press 4 (the rename: Alpha again)", got, W[1], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
ok("press 4: the tab's file is Alpha.wm again, the footer too", got.footer === "Alpha.wm", got.footer)

await undo()
got = await world()
sameAs("press 5 (the Title)", got, W[0], ["front", "tabs", "text", "caret", "notes", "files", "rows", "disk", "footer"])
await shot("after-5-undos")

await undo()
got = await world()
sameAs("a sixth press changes nothing", got, W[0], ["front", "tabs", "text", "caret", "notes", "files", "rows", "disk", "footer"])

// ---- Ctrl+Shift+Z, five times
await redo()
got = await world()
sameAs("redo 1 (Title)", got, W[1], ["front", "tabs", "text", "caret", "notes", "files", "rows", "disk", "footer"])
await redo()
got = await world()
sameAs("redo 2 (Beta)", got, W[2], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
await redo()
got = await world()
sameAs("redo 3 (in Sec)", got, W[3], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
await redo()
got = await world()
sameAs("redo 4 (Other trashed again)", got, W[4], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
await redo()
got = await world()
sameAs("redo 5 (the Quote cell)", got, W[5], ["front", "tabs", "text", "caret", "notes", "files", "rows", "disk", "footer"])
await redo()
got = await world()
sameAs("a sixth redo changes nothing", got, W[5], ["front", "tabs", "text", "notes", "files", "rows", "disk", "footer"])
await shot("after-5-redos")
finish()
