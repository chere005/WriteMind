// @e2e timeout=300
// A list is one cell whatever its items are marked with (Sean, 2026-10-11): the markdown source. See _mixedList.mjs.
import { finish } from "../../lib/harness.mjs"
import { runMixedList } from "./_mixedList.mjs"

await runMixedList({ rendered: false })
finish()
