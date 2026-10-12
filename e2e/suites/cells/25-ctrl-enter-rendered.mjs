// @e2e timeout=300
// Ctrl+Enter, the newline that never leaves the cell, on the rendered page (Sean, 2026-10-11). See _ctrlEnter.mjs.
import { finish } from "../../lib/harness.mjs"
import { runCtrlEnter } from "./_ctrlEnter.mjs"

await runCtrlEnter({ rendered: true })
finish()
