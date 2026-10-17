/**
 * What the core takes for granted and JavaScriptCore does not have. The Quick Look extension runs `preview.ts` in a bare
 * `JSContext`: the language and nothing else — no `TextEncoder` (names.ts measures names in UTF-8 bytes at load), no
 * `crypto` (a drawing item with no id is given one, `newID`). Imported FIRST by `preview.ts`, so these are in place
 * before any core module's own top-level code runs. Each is put in only when it is missing, so the same bundle runs in
 * Node's `vm` (the test) and in a browser unchanged.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const scope = globalThis as any

if (typeof scope.TextEncoder !== "function") {
  /** UTF-8, as the WHATWG encoder does it: a lone surrogate is U+FFFD. */
  class Utf8Encoder {
    readonly encoding = "utf-8"
    encode(text = ""): Uint8Array {
      const out: number[] = []
      for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
          const low = text.charCodeAt(i + 1)
          if (low >= 0xdc00 && low <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00); i++ }
          else code = 0xfffd
        } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd
        if (code < 0x80) out.push(code)
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
        else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
        else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
      }
      return new Uint8Array(out)
    }
  }
  scope.TextEncoder = Utf8Encoder
}

if (typeof scope.crypto !== "object" || scope.crypto === null || typeof scope.crypto.randomUUID !== "function") {
  // Only ever an id for a drawing item that came without one, in a page nobody saves: it need not be unguessable.
  const hex = (n: number): string => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0")
  const randomUUID = (): string =>
    `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(6)}${hex(6)}`
  scope.crypto = { ...(scope.crypto ?? {}), randomUUID }
}

export {}
