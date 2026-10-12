// @e2e timeout=420
// A list inserted with the caret where its words go, and a * at the bar opening a bullet list: the markdown side, pen up. See _listItems.mjs.
import { runListItems } from "./_listItems.mjs"

await runListItems({ rendered: false, pen: false })
