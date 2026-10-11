// @e2e timeout=420
// The + menu, every kind, every seam: the markdown source, pen down. See _plusKinds.mjs.
import { runKinds } from "./_plusKinds.mjs"

await runKinds({ rendered: false, pen: true })
