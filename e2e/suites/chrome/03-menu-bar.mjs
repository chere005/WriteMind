// The application menu, read out of the main process (a page screenshot does not show the menu bar).
import { js, key, menu, menuClick, ok, finish, sleep, shot, seedNotes, reloadApp, press as clickSel } from "../../lib/harness.mjs"
await sleep(500)
await js(`document.querySelector('.note-row')?.click()`); await sleep(800)
const m = await menu()
const text = (items) => items.map((i) => i.type === "separator" ? "-" : i.label + (i.accelerator ? `  [${i.accelerator}]` : "") + (i.enabled ? "" : " (off)") + (i.checked ? " (x)" : "")).join("\n")
console.log(m.map((top) => top.label).join(" | "))
for (const top of m) { console.log("\n== " + top.label); console.log(text(top.submenu ?? [])) }
const names = m.map((t) => t.label)
// (A Mac's menu bar starts with the application's own menu, "WriteMind"; the order asked about is the one after it.)
const after = process.platform === "darwin" ? names.slice(1) : names
ok("top-level order", JSON.stringify(after.slice(0, 8)) === JSON.stringify(["File", "Project", "Edit", "View", "Format", "Insert", "Pen", "Input Devices"]), names.join())
const sub = (l) => m.find((t) => t.label === l).submenu
ok("sidebar item has Ctrl+K (the Mac's ⌘K)", sub("View").find((i) => /Notes Sidebar/.test(i.label)).accelerator === "CmdOrCtrl+K")
ok("Close Tab enabled with a note open", sub("File").find((i) => i.label === "Close Tab").enabled)
ok("Split Cell enabled with a note open", sub("Format").find((i) => i.label === "Split Cell").enabled)
finish()
