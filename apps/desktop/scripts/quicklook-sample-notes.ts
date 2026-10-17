// The words and drawings of the Quick Look sample notes (apps/desktop/scripts/quicklook-samples.ts writes them as .wm
// files for tools/check-quicklook.sh; apps/desktop/test/quickLook.test.ts reads them, so a sample that does not say what
// it means to show fails there and not in front of a photograph).

import { escapePlain, noTransform, type CanvasItem, type Drawing, type InkCell } from "@writemind/core"

export const stroke = (id: string, colorHex: string, points: [number, number][]): CanvasItem => ({
  kind: "stroke", stroke: { id, colorHex, width: 3, points: points.map(([x, y]) => ({ x, y })), transform: noTransform(), group: null },
})

/**
 * The text cell's words, as typed: asterisks that are not italics and a line break that is kept. Written the way the
 * app writes a text cell (`escapePlain`: `\*`), or the older-notes rule reads the unescaped stars as markdown and the
 * cell as a markdown cell (review of the preview, 2026-10-17).
 */
export const TEXT_CELL_WORDS = "A text cell, as typed: *not italic* and line breaks\nkept as they are."

/** plain.wm: headings, a text cell, a markdown cell, lists (a mixed one and to-dos), a quote, code, a table. */
export const PLAIN_TEXT = [
  "# A plain note",
  "",
  escapePlain(TEXT_CELL_WORDS),
  "",
  "<!-- markdown -->",
  "A markdown cell with **bold**, _italic_, ~~struck~~, `code` and a [link](https://example.com).",
  "",
  "## Lists",
  "",
  "- a dot",
  "* a dash",
  "1. numbered",
  "- [ ] to do",
  "- [x] done",
  "",
  "> A quote, in italics, with its bar.",
  "",
  "```js",
  "const answer = 42 // a comment",
  "```",
  "",
  "| Column | Right |",
  "|---|--:|",
  "| a | 1 |",
  "| b | 22 |",
  "",
  "---",
  "",
  "###### The author line",
].join("\n")

export const CELL = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
export const RICH_CELL: InkCell = {
  id: CELL, aspect: 0.3,
  items: [
    stroke("c1", "#2D7DD2", [[0.05, 0.05], [0.2, 0.2], [0.35, 0.08], [0.5, 0.25]]),
    { kind: "shape", shape: { id: "c2", kind: "oval", center: { x: 0.75, y: 0.15 }, width: 0.3, aspect: 0.4, colorHex: "#C0392B", lineWidth: 3, fillHex: null, label: "a node", transform: noTransform(), group: null } },
  ],
}

/** rich.wm's drawing: free ink (strokes, a text box, a picture) and the drawing cell. */
export const RICH_DRAWING: Drawing = {
  items: [
    stroke("f1", "#C0392B", [[0.62, 0.05], [0.75, 0.02], [0.92, 0.07], [0.95, 0.15]]),
    stroke("f2", "#000000", [[0.55, 0.45], [0.6, 0.5], [0.7, 0.42]]),
    { kind: "shape", shape: { id: "f3", kind: "text", center: { x: 0.8, y: 0.3 }, width: 0.25, aspect: 0.3, colorHex: "#1C1C1E", lineWidth: 2, fillHex: "#FFF3A0", label: "free ink: a text box over the page", transform: noTransform(), group: null } },
    { kind: "image", image: { id: "f4", file: "ink.png", center: { x: 0.85, y: 0.75 }, width: 0.2, aspect: 0.5, transform: noTransform(), hidden: false, group: null } },
    { kind: "cell", cell: RICH_CELL },
  ],
}

/** rich.wm: a typeset maths cell, inline maths, a picture cell, a drawing cell, a runnable cell with its answer. */
export const RICH_TEXT = [
  "# Maths, pictures and drawings",
  "",
  "<!-- markdown -->",
  "Inline maths `wl:x^2 + 1` in a line of words.",
  "",
  "```wl",
  "Integrate[Sin[x]^2, {x, 0, Pi}] == Pi/2",
  "```",
  "",
  "```wl",
  "Sqrt[a^2 + b^2]/(2 c)",
  "```",
  "",
  "A picture cell:",
  "",
  "![the reader's test page](media/page.png)",
  "",
  "A drawing cell:",
  "",
  `![ink](snapshots/ink-${CELL}.svg)`,
  "",
  "```python",
  "print(6 * 7)",
  "```",
  "",
  "```out",
  "42",
  "```",
].join("\n")

/** big.wm: 6 000 cells, more than a preview draws (its foot says so). */
export function bigText(): string {
  const big: string[] = ["# A long note", ""]
  for (let i = 1; i <= 6000; i++) {
    big.push(i % 50 === 0 ? `## Part ${i / 50}` : `Paragraph ${i}: the quick brown fox jumps over the lazy dog, again and again, to make a long note.`, "")
  }
  return big.join("\n")
}

/** hostile.wm: words that try to be HTML and script, a span whose style tries to break out, a link that runs script. */
export const HOSTILE_TEXT = [
  "# <script>alert('title')</script>",
  "",
  "<img src=x onerror=alert(1)> and </div></body><script>alert(2)</script>",
  "",
  "<!-- markdown -->",
  "<span style=\"color:red\" onmouseover=\"alert(3)\">a span</span> and [a link](javascript:alert(4)) and ![x](https://example.com/track.png)",
  "",
  "```html",
  "<script>alert(5)</script>",
  "```",
  "",
  "A drawing cell whose colours try to be script:",
  "",
  `![ink](snapshots/ink-${CELL}.svg)`,
].join("\n")

/** The mark a script that ran would leave on the page, for tools/quicklook/quicklook-shot.swift to look for. */
export const INJECTED = "data-wm-injected"

/**
 * hostile.wm's drawing: colours that try to end their attribute and run script, or load from `probe` (a local
 * server tools/check-quicklook.sh listens on, and counts what reaches it). Each payload, if it ran, would also mark the
 * page with `INJECTED`. Before drawing.ts wrote only real colours, Quick Look ran them (review, 2026-10-17).
 */
export function hostileDrawing(probe: string): Drawing {
  const run = (tag: string) => `fetch('${probe}/${tag}');document.documentElement.setAttribute('${INJECTED}','${tag}')`
  const fill = (tag: string) => `"><svg><image href="x" onerror="${run(tag)}"/></svg><x y="`
  const colour = (tag: string) => `"/><img src="${probe}/${tag}.png" onerror="${run(tag)}"><x y="`
  const style = (tag: string) => `red;background-image:url(${probe}/${tag}.png)`
  const t = noTransform()
  const box = (id: string, x: number, colorHex: string, fillHex: string, label: string): CanvasItem =>
    ({ kind: "shape", shape: { id, kind: "text", center: { x, y: 0.12 }, width: 0.22, aspect: 0.3, colorHex, lineWidth: 1, fillHex, label, transform: t, group: null } })
  // (A drawing cell's items are placed in a square frame its aspect shows the top of: 0.3 here, so they sit above that.)
  const node = (id: string, x: number, y: number, colorHex: string, fillHex: string): CanvasItem =>
    ({ kind: "shape", shape: { id, kind: "rectangle", center: { x, y }, width: 0.15, aspect: 0.5, colorHex, lineWidth: 2, fillHex, label: "node", transform: t, group: null } })
  return {
    items: [
      box("h1", 0.6, "#000000", fill("free-text-fill"), "a text box"),
      box("h2", 0.85, colour("free-text-colour"), style("free-text-style"), "another"),
      node("h3", 0.7, 0.5, colour("free-node-colour"), fill("free-node-fill")),
      { kind: "stroke", stroke: { id: "h4", colorHex: colour("free-stroke"), width: 3, points: [{ x: 0.6, y: 0.7 }, { x: 0.9, y: 0.75 }], pressures: [0.3, 0.8], transform: t, group: null } },
      { kind: "cell", cell: { id: CELL, aspect: 0.3, items: [
        box("c1", 0.3, "#000000", fill("cell-text-fill"), "in a cell"),
        node("c2", 0.7, 0.15, colour("cell-node-colour"), style("cell-node-style")),
      ] } },
    ],
  }
}

/**
 * slow.wm: lines crafted to be slow, which took the extension tens of seconds each before the renderer read links, bold
 * and tags in one pass (review, 2026-10-17): a heading of brackets, bold that never closes, pictures that never do.
 */
export const SLOW_TEXT = [
  `# ${"[".repeat(40_000)}`,
  "",
  "<!-- markdown -->",
  "**a ".repeat(15_000),
  "",
  "<!-- markdown -->",
  "![".repeat(30_000),
  "",
  "The end of a slow note.",
].join("\n")
