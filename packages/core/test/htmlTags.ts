/**
 * Every tag of a piece of HTML as a BROWSER's tokenizer reads it — not as the writer meant it — for the tests that
 * check a page built from someone else's note can run nothing (quickLook.test.ts, hostileDrawing.test.ts). Port-only,
 * a test helper.
 *
 * A regular expression over the output can only say a string is or is not there; this reads the page the way WebKit's
 * tokenizer does (the data, tag-open, attribute-name and attribute-value states of the HTML standard, comments, and
 * the raw text of `<style>`, `<script>`, `<textarea>`, `<title>`), so an attribute value a crafted colour ENDED early
 * shows up as the extra element or attribute it became. Attribute values come back with their character references
 * decoded, as the browser would use them (`&#106;avascript:` is `javascript:`).
 */

export interface Tag {
  /** Lower-cased. */
  name: string
  /** In order, names lower-cased, values decoded. */
  attributes: { name: string; value: string }[]
}

const SPACE = /[\t\n\f\r ]/
const RAW_TEXT = new Set(["style", "script", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"])

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", colon: ":", tab: "\t", newline: "\n" }

/** Character references decoded (the numeric ones, and the few named ones that could matter here). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�"
    }
    return NAMED[ref.toLowerCase()] ?? whole
  })
}

/** The start tags of `html`, in order (end tags, comments, doctypes and text are read past). */
export function tagsOf(html: string): Tag[] {
  const tags: Tag[] = []
  let at = 0
  while (at < html.length) {
    const open = html.indexOf("<", at)
    if (open < 0) break
    const next = html[open + 1] ?? ""
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4)
      at = end < 0 ? html.length : end + 3
      continue
    }
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", open)
      at = end < 0 ? html.length : end + 1
      continue
    }
    if (next === "/") {
      const end = html.indexOf(">", open)
      at = end < 0 ? html.length : end + 1
      continue
    }
    if (!/[a-zA-Z]/.test(next)) { at = open + 1; continue }
    // Tag name state.
    let i = open + 1
    let name = ""
    while (i < html.length && !SPACE.test(html[i]!) && html[i] !== "/" && html[i] !== ">") name += html[i++]!
    const tag: Tag = { name: name.toLowerCase(), attributes: [] }
    // Before-attribute-name / attribute-name / attribute-value states.
    for (;;) {
      while (i < html.length && (SPACE.test(html[i]!) || html[i] === "/")) i++
      if (i >= html.length) break
      if (html[i] === ">") { i++; break }
      let attribute = html[i++]!
      while (i < html.length && !SPACE.test(html[i]!) && html[i] !== "/" && html[i] !== ">" && html[i] !== "=") attribute += html[i++]!
      while (i < html.length && SPACE.test(html[i]!)) i++
      let value = ""
      if (html[i] === "=") {
        i++
        while (i < html.length && SPACE.test(html[i]!)) i++
        const quote = html[i]
        if (quote === "\"" || quote === "'") {
          const end = html.indexOf(quote, i + 1)
          value = html.slice(i + 1, end < 0 ? html.length : end)
          i = end < 0 ? html.length : end + 1
        } else {
          while (i < html.length && !SPACE.test(html[i]!) && html[i] !== ">") value += html[i++]!
        }
      }
      tag.attributes.push({ name: attribute.toLowerCase(), value: decodeEntities(value) })
    }
    tags.push(tag)
    at = i
    if (RAW_TEXT.has(tag.name)) {
      const close = html.toLowerCase().indexOf(`</${tag.name}`, at)
      at = close < 0 ? html.length : close
    }
  }
  return tags
}

/** What a page that runs nothing may hold: see `unsafeParts`. */
export interface SafePage {
  /** The element names it may hold. */
  elements: ReadonlySet<string>
  /** Where a picture (`<img src>`, `<image href>`) may come from. */
  pictures: RegExp
  /** Where a link (`<a href>`) may go. */
  links: RegExp
}

/** The URL a browser would follow: entities decoded, controls and spaces taken out (as its URL parser does), lower-cased. */
const urlOf = (value: string): string => value.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase()

/**
 * Every way `html` could run script or reach out, as words (empty when there is none): an element not in `page.elements`,
 * an event handler, an attribute that loads or runs something (`srcdoc`, `formaction`, `xlink:href`, an SVG animation's
 * `attributeName`/`values`/`to`), a style that loads something (`url(`, `@import`, `expression(`), a picture from
 * elsewhere, a link to a script.
 */
export function unsafeParts(html: string, page: SafePage): string[] {
  const found: string[] = []
  for (const tag of tagsOf(html)) {
    if (!page.elements.has(tag.name)) found.push(`<${tag.name}>`)
    for (const { name, value } of tag.attributes) {
      if (/^on/.test(name)) found.push(`<${tag.name} ${name}>`)
      if (["srcdoc", "formaction", "action", "xlink:href", "attributename", "values", "to", "from", "background", "lowsrc", "dynsrc", "poster", "data", "codebase", "ping"].includes(name)) {
        found.push(`<${tag.name} ${name}>`)
      }
      if (name === "style" && /url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(value)) found.push(`<${tag.name} style="${value}">`)
      if (name === "src" || (name === "href" && tag.name !== "a")) {
        if (!page.pictures.test(urlOf(value))) found.push(`<${tag.name} ${name}="${value}">`)
      }
      if (name === "href" && tag.name === "a" && !page.links.test(urlOf(value))) found.push(`<a href="${value}">`)
      if (name === "http-equiv" && !/^(content-security-policy)$/i.test(value)) found.push(`<${tag.name} http-equiv="${value}">`)
    }
  }
  return found
}

/** Everything the core's renderers write (blocks.ts, inline.ts, mathml.ts, drawing.ts, inkSnapshot.ts, quickLook.ts). */
export const RENDERER_ELEMENTS: ReadonlySet<string> = new Set([
  // The page.
  "html", "head", "meta", "style", "body", "div", "span", "b", "i", "s", "u", "a", "code", "pre", "br", "hr", "img", "mark",
  "table", "thead", "tbody", "tr", "th", "td", "sup", "sub",
  // The PDF's sheets.
  "section",
  // Drawings: the free ink, a drawing cell, a to-do's box.
  "svg", "path", "circle", "rect", "image", "foreignobject", "text", "tspan", "metadata",
  // Maths.
  "math", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mover",
  "munder", "munderover", "mtable", "mtr", "mtd", "mstyle", "mpadded", "mphantom", "menclose", "semantics", "annotation",
])
