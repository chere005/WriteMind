import { describe, expect, it } from "vitest"
import { blockHtml } from "../src/export/blocks"
import { inlineHtml, inlineTokens, replaceBold, replaceLinks, spanDeclarations, type InlineToken } from "../src/export/inline"
import { positioned } from "../src/markdown/parser"
import { ESCAPABLE } from "../src/markdown/plainText"

/**
 * Bold and links on paper, read in one pass (export/inline.ts `replaceBold`, `replaceLinks`). Port-only: the Mac reads
 * them with NSRegularExpression and the PDF here read them with these same two patterns, which are quadratic on a line
 * that opens and never closes — a crafted note held the Quick Look preview for seconds, and for minutes at its
 * 200 000-character cap (review of the preview, 2026-10-17). The readers must give EXACTLY the patterns' answers, so
 * the patterns are kept here as the reference and every reader is put to them on thousands of strings made of the
 * characters that matter.
 */

const LINK = /\[([^\]\n]+)\]\(([^)\n]+)\)/g
const BOLD = /\*\*(?=\S)(.*?\S)\*\*|(?<![A-Za-z0-9])__(?=\S)(.*?\S)__(?![A-Za-z0-9])/g

/** Strings of up to `longest` pieces out of `alphabet`, from a seeded generator (the same strings on every run). */
function strings(alphabet: string[], count: number, longest: number, seed: number): string[] {
  let state = seed
  const next = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const length = Math.floor(next() * longest)
    let text = ""
    for (let j = 0; j < length; j++) text += alphabet[Math.floor(next() * alphabet.length)]!
    out.push(text)
  }
  return out
}

describe("links read in one pass", () => {
  const link = (label: string, href: string) => `<A ${label}|${href}>`

  it("are exactly what the pattern reads, on every string of brackets, parentheses and line ends", () => {
    const alphabet = ["[", "[", "]", "](", "(", ")", ")", "\n", "\r", "a", " ", "b", "!", "\u2028", "[a](b)", "[[", "))"]
    let linked = 0
    for (const text of strings(alphabet, 20_000, 16, 7)) {
      const expected = text.replace(LINK, (_whole, label: string, href: string) => link(label, href))
      expect(replaceLinks(text, link), JSON.stringify(text)).toBe(expected)
      if (expected !== text) linked++
    }
    // (Enough of them are links for the comparison to mean something.)
    expect(linked).toBeGreaterThan(2_000)
  })

  it("are read from a line of brackets that never closes without reading it again for every bracket", () => {
    const started = performance.now()
    expect(replaceLinks("[".repeat(200_000), link)).toBe("[".repeat(200_000))
    expect(replaceLinks("[x](".repeat(50_000), link)).toBe("[x](".repeat(50_000))
    expect(replaceLinks("![".repeat(100_000), link)).toBe("![".repeat(100_000))
    // The pattern takes minutes on these; one pass takes milliseconds. (Generous for a slow machine.)
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})

describe("bold read in one pass", () => {
  const bold = (inner: string) => `<B ${inner}>`

  it("is exactly what the pattern reads, stars and underscores, at word edges and line ends", () => {
    const alphabet = ["**", "__", "*", "_", "a", "1", " ", "\n", "\t", "\u00a0", "\u2028", "-", "a**", "**a", "a__", "__a", "***"]
    let bolded = 0
    for (const text of strings(alphabet, 30_000, 14, 11)) {
      const expected = text.replace(BOLD, (_whole, star: string | undefined, under: string | undefined) => bold(star ?? under ?? ""))
      expect(replaceBold(text, bold), JSON.stringify(text)).toBe(expected)
      if (expected !== text) bolded++
    }
    expect(bolded).toBeGreaterThan(5_000)
  })

  it("is read from a line of openings that never close without reading it again for every opening", () => {
    const started = performance.now()
    expect(replaceBold("**a ".repeat(50_000), bold)).toBe("**a ".repeat(50_000))
    expect(replaceBold("__a ".repeat(50_000), bold)).toBe("__a ".repeat(50_000))
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})

/** The tokenizer as it was first written (export/inline.ts before 2026-10-17): the reference `inlineTokens` is held to. */
function tokensAsWritten(source: string): InlineToken[] {
  const styleFromTag = (tag: string) => {
    const found = /style="([^"]*)"/.exec(tag)
    return { underline: false, ...(found ? spanDeclarations(found[1]!) : {}) }
  }
  const tokens: InlineToken[] = []
  let buffer = ""
  let index = 0
  const flush = () => { if (buffer) { tokens.push({ text: buffer }); buffer = "" } }
  while (index < source.length) {
    const rest = source.slice(index, index + 400)
    let match: RegExpExecArray | null
    if (source.charCodeAt(index) === 92 && index + 1 < source.length && ESCAPABLE.includes(source[index + 1]!)) {
      buffer += source.slice(index, index + 2); index += 2; continue
    }
    if (rest.startsWith("<u>")) { flush(); tokens.push({ open: { underline: true } }); index += 3 }
    else if (rest.startsWith("</u>")) { flush(); tokens.push({ close: true }); index += 4 }
    else if (rest.startsWith("</span>")) { flush(); tokens.push({ close: true }); index += 7 }
    else if ((match = /^<span\b[^>]*>/.exec(rest))) {
      flush(); tokens.push({ open: styleFromTag(match[0]) }); index += match[0].length
    } else if ((match = /^<a id="[^"]*"><\/a>/.exec(rest))) {
      flush(); index += match[0].length
    } else if ((match = /^<mark\b[^>]*>/.exec(rest))) {
      flush(); tokens.push({ open: { underline: false, mark: true } }); index += match[0].length
    } else if (rest.startsWith("</mark>")) { flush(); tokens.push({ close: true }); index += 7 }
    else { buffer += source[index]; index += 1 }
  }
  flush()
  return tokens
}

describe("the tags round a run of words, read in one pass", () => {
  it("are exactly what the tokenizer first written read, tags, anchors and escapes", () => {
    const alphabet = ["<", ">", "\"", "\\", "\\<", "\\*", "a", " ", "_", "-", "<u>", "</u>", "<span", "<span ", "</span>", "<mark",
      "<mark>", "</mark>", "<a id=\"", "\"></a>", "<a id=\"x\"></a>", " style=\"color:#2D7DD2\"", "<spanx>", "<marks>", "\n"]
    let tags = 0
    for (const text of strings(alphabet, 30_000, 14, 5)) {
      const expected = tokensAsWritten(text)
      expect(inlineTokens(text), JSON.stringify(text)).toEqual(expected)
      if (expected.some((token) => !("text" in token))) tags++
    }
    expect(tags).toBeGreaterThan(10_000)
  })

  it("keep to 400 characters from the <, as before, however far the > is", () => {
    // (A span's or a mark's `>` 394 places on is inside the window, 395 is not; an anchor's end, 387 and 388.)
    for (const gap of [380, 387, 388, 393, 394, 395, 396, 420]) {
      for (const text of [`<span${" ".repeat(gap)}>a</span>`, `<mark${" ".repeat(gap)}>a</mark>`, `<a id="${"i".repeat(gap)}"></a>b`]) {
        expect(inlineTokens(text), `${gap}`).toEqual(tokensAsWritten(text))
        expect(inlineTokens(`ab${text}cd`), `${gap}`).toEqual(tokensAsWritten(`ab${text}cd`))
      }
    }
  })
})

describe("a markdown cell on paper", () => {
  it("is drawn as before: links, bold, italics, code and spans", () => {
    const source = "<!-- markdown -->\nA **bold** and __bold__ word, *italic* and _italic_, ~~struck~~, `code`, a [link](https://example.com) "
      + "and a [**bold link**](#here), snake_case_name, 2 * 3 * 4, <span style=\"color:#2D7DD2\">a span with [a link](x.md)</span>."
    const html = blockHtml(positioned(source)[0]!.block)
    expect(html).toBe('<div class="para">A <b>bold</b> and <b>bold</b> word, <i>italic</i> and <i>italic</i>, <s>struck</s>, '
      + '<code>code</code>, a <a class="link" href="https://example.com">link</a> and a <a class="link" href="#here"><b>bold link</b></a>, '
      + 'snake_case_name, 2 * 3 * 4, <span style="color:#2D7DD2">a span with <a class="link" href="x.md">a link</a></span>.</div>')
  })

  it("of a hundred thousand characters that open and never close is drawn in one pass", () => {
    const started = performance.now()
    for (const run of ["[", "[x](", "**a ", "__a ", "![", "<span ", "<", "<a id=\"", "\\"]) {
      const html = inlineHtml(run.repeat(Math.ceil(100_000 / run.length)))
      // (`\\` is an escaped backslash: half as many come out.)
      expect(html.length).toBeGreaterThan(45_000)
    }
    expect(performance.now() - started).toBeLessThan(4_000)
  })
})
