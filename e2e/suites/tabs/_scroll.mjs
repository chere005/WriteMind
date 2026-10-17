// What the scroll scripts share (tabs/07, editor/13): the notes they scroll through, and the line at the top of the page read
// off the page itself — the content's first child whose bottom is below the scroller's top edge, with its text, its offset
// in the note and how far its top is from the edge. Read with the page's own geometry, not with the code under test
// (packages/editor/src/scrollPlace.ts), so a place put back wrong is seen as wrong.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { js, send, sleep, click, VIEW } from "../../lib/harness.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

/** A long note of numbered lines, lists, long wrapped paragraphs and headings: every line says which it is. */
export function longNote(title = "Long note") {
  const parts = [`# ${title}`, ""]
  for (let i = 1; i <= 140; i++) {
    if (i % 20 === 0) parts.push(`## Section ${i / 20}`, "")
    if (i % 7 === 0) parts.push(`- item ${i} a`, `- item ${i} b`, `- item ${i} c`, "")
    else if (i % 11 === 0) parts.push(`Paragraph ${i}: ` + "a long paragraph that wraps over several lines of the page, ".repeat(7).trim(), "")
    else parts.push(`Line ${i} of the long note, with a few words after it.`, "")
  }
  return parts.join("\n")
}

/** A note with a picture (its height known only once it has loaded) and typeset maths ABOVE the place it is scrolled to. */
export function picturesNote() {
  const parts = ["# Pictures", "", "Words over the picture.", "", "![](media/pic.png)", "", "```wl", "Integrate[x^2, {x, 0, 1}] + Sum[1/k^2, {k, 1, n}]", "```", ""]
  for (let i = 1; i <= 90; i++) parts.push(`Row ${i} under the picture and the maths.`, "")
  return parts.join("\n")
}
/** The picture the pictures note holds (a real PNG, 701 × 580). */
export const PICTURE = { "media/pic.png": fs.readFileSync(path.join(here, "../../../apps/desktop/test/fixtures/ocr-handwriting.png")) }

/** The line at the top of the page: { text, pos, y (its top less the page's top edge), scrollTop, max }. */
export const topLine = async () => JSON.parse(await js(`(() => {
  const v = ${VIEW}; const box = v.scrollDOM.getBoundingClientRect(); const edge = box.top + v.scrollDOM.clientTop
  const kids = [...v.contentDOM.children]
  const el = kids.find((k) => k.getBoundingClientRect().bottom > edge + 0.5 && (k.textContent || '').trim().length > 0)
    || kids.find((k) => k.getBoundingClientRect().bottom > edge + 0.5)
  if (!el) return 'null'
  const r = el.getBoundingClientRect()
  return JSON.stringify({ text: (el.textContent || '').slice(0, 70), pos: v.posAtDOM(el), y: Math.round((r.top - edge) * 10) / 10,
    scrollTop: Math.round(v.scrollDOM.scrollTop), max: Math.round(v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight),
    rendered: v.dom.classList.contains('wm-rendered') })
})()`))

/** The first words shown at the top of the page (what a person reads there): the run or the line at the edge. */
export const topWords = async () => js(`(() => {
  const v = ${VIEW}; const box = v.scrollDOM.getBoundingClientRect(); const edge = box.top + v.scrollDOM.clientTop
  const runs = [...v.contentDOM.querySelectorAll('.cm-line, [data-s]')].filter((n) => !n.closest('.cm-line') || n.classList.contains('cm-line'))
  for (const n of runs) { const r = n.getBoundingClientRect(); if (r.bottom > edge + 2 && (n.textContent || '').trim()) return n.textContent.trim().slice(0, 70) }
  return ''
})()`)

/** Which numbered line of the long note a piece of text is ("Line 57", "item 63 b", "Paragraph 66", "Row 12", "Section 2"). */
export const which = (text) => (/(Line|item|Paragraph|Row|Section) (\d+)( [abc])?/.exec(text ?? "") ?? [""])[0]

/** The wheel, over the middle of the page: `ticks` turns of `dy` pixels. */
export async function wheel(ticks, dy = 120) {
  const at = JSON.parse(await js(`JSON.stringify((() => { const r = ${VIEW}.scrollDOM.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })())`))
  for (let i = 0; i < ticks; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY: dy })
    await sleep(30)
  }
  await sleep(500)
}

/** Wheel down until the page is scrolled past `fraction` of the way. */
export async function wheelTo(fraction) {
  for (let i = 0; i < 80; i++) {
    const now = await topLine()
    if (now.max > 0 && now.scrollTop >= now.max * fraction) return now
    await wheel(3, 150)
  }
  return topLine()
}

/** Wheel down in small steps until the line at the top is the one asked for ("Row 4"). */
export async function wheelUntil(name) {
  for (let i = 0; i < 120; i++) {
    const now = await topLine()
    if (which(now.text) === name) return now
    await wheel(1, 40)
  }
  return topLine()
}

/** Click a tab (a real mouse click on its middle), by the start of its label. */
export async function clickTab(name) {
  const at = JSON.parse(await js(`JSON.stringify((() => {
    const t = [...document.querySelectorAll('.tab')].find((one) => one.textContent.replace('×', '').startsWith(${JSON.stringify(name)}))
    if (!t) return null
    t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = t.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 3), y: r.y + r.height / 2 }
  })())`))
  if (!at) throw new Error("no tab " + name)
  await click(at.x, at.y)
  await sleep(900)
}

/** The same line at the top, at the same height within `px`. */
export const sameTop = (a, b, px = 3) => !!a && !!b && a.pos === b.pos && Math.abs(a.y - b.y) <= px
export const show = (a) => (a ? `${which(a.text) || JSON.stringify(a.text.slice(0, 30))} @${a.pos} y=${a.y} top=${a.scrollTop}/${a.max}${a.rendered ? " rendered" : ""}` : "none")
