/**
 * What Find remembers for the session (docs/PLAN-bars-2026-10.md P7 (e)): the words looked for, the replacement and the
 * two switches. The bar is mounted when it is asked for and gone when it is closed, so what it held used to go with it:
 * Ctrl+F again came up with the case switch off again. Module state, not storage: it lasts until the app quits (the Mac's
 * find bar keeps its text for the session too), and it is shared by every note, as the find pasteboard is. There is no
 * regular-expression switch: the words are looked for as typed (a dot is a dot, a bracket a bracket).
 */

import type { FindOptions } from "@writemind/core"

export interface FindSession extends FindOptions {
  query: string
  replacement: string
}

export const findSession: FindSession = { query: "", replacement: "", caseSensitive: false, wholeWord: false }
