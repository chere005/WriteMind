/**
 * How a link is followed. The page that owns the editor says (`linkClicks`
 * provides it); the rendered page's drawn links ask for it here, so neither
 * knows about notes.
 */

import { Facet } from "@codemirror/state"

export const followLink = Facet.define<(href: string) => void, ((href: string) => void) | null>({
  combine: (values) => values[0] ?? null,
})
