// @e2e timeout=420
// The + menu, every kind, every seam: the rendered page, pen up. See _plusKinds.mjs.
import { runKinds } from "./_plusKinds.mjs"

await runKinds({ rendered: true, pen: false })
