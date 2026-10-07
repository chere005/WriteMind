/**
 * What a copy of held cells puts on the clipboard for Mathematica, by the names the OS gives clipboard types — the one
 * fact about an OS here, asked once (platform/capabilities.ts `wolframClipboard`).
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * ON A MAC the front end has a pasteboard type of its own, `CorePasteboardFlavorType 0x4F4D4547` ('OMEG'), whose UTI
 * is `dyn.ah62d4rv4gk8y8xnfk6` (measured against the front end's own Copy). It holds the cells as text, and the front
 * end prefers it to the plain text and to a PNG: pasted between cells it is the cells, pasted inside an Input cell it
 * is their boxes — an image pastes as the image itself. Beside it goes the PNG under its raw type `public.png`
 * (Electron's `image/png` would be a second pasteboard item), for Pages, Word and the rest.
 *
 * ELSEWHERE the front end's own clipboard format has a name WriteMind has not measured (docs/TODO.md), so nothing of
 * its own is written: the plain text becomes the front end's linear syntax for the image (notebook.ts
 * `drawingText`), which it turns back into the image when it is pasted, and the PNG goes under the standard
 * `image/png` (null here).
 */

export interface WolframClipboard {
  /** The raw clipboard type the front end's own cells go under, or null where it is not known. */
  cell: string | null
  /** The raw type a PNG goes under, or null for the standard `image/png`. */
  png: string | null
}

export function wolframClipboardFor(platform: string): WolframClipboard {
  return platform === "darwin"
    ? { cell: "dyn.ah62d4rv4gk8y8xnfk6", png: "public.png" }
    : { cell: null, png: null }
}

/**
 * Whether a type already on the clipboard stays when the copy is written again: only what WriteMind's own copy wrote
 * — the plain text, and the page's custom data (Chromium's, which holds `application/x-writemind-cells`) — so a
 * second write never carries the first write's front-end cells, TIFF or PNG along beside the new ones.
 */
export const clipboardKeeps = (type: string): boolean => type === "text/plain" || /chromium|web custom/i.test(type)
