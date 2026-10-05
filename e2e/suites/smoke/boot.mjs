// The app starts, shows its chrome, makes a note and takes typing.
import { ok, finish, js, sleep, freshNote, doc, focus, typeText, shot, notesDir, windowInfo } from "../../lib/harness.mjs"

ok("the bridge to the main process is there", await js(`typeof window.wm?.capabilities === 'function'`))
ok("the test hooks are on (WRITEMIND_E2E)", await js(`typeof window.wm.e2eMenu === 'function'`))
const info = await windowInfo()
ok("the window is offscreen and not full screen", info.bounds.x < -1000 && !info.fullScreen, JSON.stringify(info.bounds))
const root = await notesDir()
ok("the notes folder is a temp one", /wm-e2e|instances/i.test(root), root)
const file = await freshNote()
ok("a new note is open with an editor", await js(`!!document.querySelector('.cm-content')`), file)
await focus()
await typeText("Hello")
await sleep(200)
ok("typing lands in the note", (await doc()).includes("Hello"), await doc())
await shot("boot")
finish()
