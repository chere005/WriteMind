/**
 * Text as the Wolfram Language writes it, for File ▸ Export… as a Wolfram Notebook and for a drawing cell copied into
 * Mathematica (Sean, 2026-10-06: "add export to wolfram notebook").
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * EVERY STRING IS 7-BIT ASCII. A notebook file is read by a front end, a kernel and `Get` alike, and each of them
 * reads a `\:hhhh` escape the same way whatever the file's encoding was taken to be; a raw UTF-8 byte is read as
 * whatever `$CharacterEncoding` says, which on Windows is not UTF-8. So everything outside printable ASCII is escaped,
 * and the file is ASCII by construction.
 */

import { rgbFromHex, readableInk } from "../../drawing/textBox"
import { PAPER_HEX } from "../inline"

const hex = (value: number, digits: number): string => value.toString(16).padStart(digits, "0")

/**
 * A WL string literal, quotes and all: `\` `"` and the three whitespace controls by their own escapes, every other
 * control character and everything past ASCII as `\:hhhh`, a character outside the Basic Multilingual Plane as
 * `\|hhhhhh` (the escape for a full code point), and half of a broken surrogate pair as U+FFFD.
 */
export function wlString(text: string): string {
  let out = "\""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
      if (low >= 0xdc00 && low <= 0xdfff) {
        out += "\\|" + hex(0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00), 6)
        i++
        continue
      }
      out += "\\:fffd"
      continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) { out += "\\:fffd"; continue }
    switch (c) {
      case 0x5c: out += "\\\\"; continue
      case 0x22: out += "\\\""; continue
      case 0x0a: out += "\\n"; continue
      case 0x09: out += "\\t"; continue
      case 0x0d: out += "\\r"; continue
      default: break
    }
    out += c >= 0x20 && c < 0x7f ? text[i] : "\\:" + hex(c, 4)
  }
  return out + "\""
}

/**
 * A span's colour as an `RGBColor[r, g, b]`, put through the same "can it be read on white" rule as the PDF
 * (`readableInk`): a colour picked to read on a dark window is not one that exists on a white notebook. Null for a
 * colour that is not `#RRGGBB` / `#RGB` (the cell then keeps the notebook's own).
 */
export function wlColor(css: string): string | null {
  if (rgbFromHex(css) === null) return null
  const rgb = rgbFromHex(readableInk(css, PAPER_HEX))
  return rgb ? `RGBColor[${rgb.map((channel) => channel.toFixed(3)).join(", ")}]` : null
}

/**
 * Boxes as the front end's own linear syntax, `\!\(\*boxes\)`: the plain text it puts on the clipboard for a cell
 * whose content is boxes, and turns back into those boxes when it is pasted.
 */
export const linearSyntax = (boxes: string): string => "\\!\\(\\*" + boxes + "\\)"
