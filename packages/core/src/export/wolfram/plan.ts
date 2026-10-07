/**
 * A note as the cells of a Wolfram notebook (File ▸ Export… ▸ Wolfram Notebook), and held cells as the cells a copy
 * puts on the clipboard for Mathematica (Sean, 2026-10-06: "add export to wolfram notebook.. also copying a drawing
 * cell should be pastable as a wolfram graphics to a wolfram notebook").
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * EVERY `Cell[…]` IS WRITTEN HERE, and nothing about a cell is decided anywhere else. What the kernel adds is BOXES
 * ONLY: a drawing turned into an Image's boxes, a maths cell's source typeset. Those are SLOTS in a planned cell — the
 * job the kernel answers, and what the cell is when it does not (`fallback`) — and `notebook.ts` puts the answers in.
 * So a machine with no Wolfram Engine, or one that does not answer, still gets a whole notebook: each drawing is a
 * closed initialization cell that makes it (`ImportString[svg, {"SVG", "Image"}]`), each maths cell its source.
 *
 * THE MAPPING, in the notebook's own styles: headings are Title, Chapter, Section, Subsection, Subsubsection and
 * Author (the app's ladder, `#` to `######`); text is Text; lists are Item / ItemNumbered and their Sub- and
 * Subsub- levels by the item's indentation; maths and Wolfram code are evaluable Input cells; Python is an
 * ExternalLanguage cell; an Out cell is Output. A drawing cell, a band of the floating layer and a picture are
 * Images. Every string goes through `wlString`, so the file is ASCII.
 */

import { colouring } from "../../eval/evaluator"
import { isOut } from "../../eval/output"
import { inkCellId, mediaFiles } from "../../markdown/images"
import { positioned, type Block } from "../../markdown/parser"
import { inlineSegments } from "../../markdown/sourceStyle"
import { isMathFence } from "../../math/typesetter"
import { spanDeclarations } from "../inline"
import { kernelSpelling, mathsCellSource } from "./maths"
import { shownAt } from "./svg"
import { wlColor, wlString } from "./text"

/** A drawing as the engine is handed it, and the width (points) it is shown at. */
export interface WolframSvg { svg: string; shown: number }
/** A band of the floating layer, and the cell it goes after (its source offset; null: before the first cell). */
export interface WolframBand extends WolframSvg { after: number | null }
/** The note's drawings, as the page measured them (renderer/wolframMedia.ts): ink cells by id, bands, the column's width. */
export interface WolframMedia { inks: Record<string, WolframSvg>; bands: WolframBand[]; column: number }

/** A picture cell's file, found by the main process: a file the engine imports, or a Mac PDF capture already an svg. */
export type ResolvedPicture =
  | { kind: "file"; path: string; format: "PNG" | "JPEG" | "GIF" | "SVG" }
  /** A PDF capture, already converted (`pictureSvg`). */
  | { kind: "svg"; svg: string }

/** One file of the kernel's job folder: `ink-N.svg`, `band-N.svg`, `pdf-N.svg`, `pic-N.txt` or `wl-N.wl`. */
export interface KernelJob { name: string; text: string }

/** What a picture cell is without an answer: its bytes, read when it is written, in an Input cell that imports them. */
export interface PictureFallback { picture: string; format: string; shown: number; words: string }

/** A place in a cell the kernel's boxes go (`job` is the job's name), and the cell it is without them. */
export type Slot =
  | { job: string; as: "image" | "maths" | "inline"; tag?: "ink" | "floating" | "picture"; fallback: string }
  | { job: string; as: "image"; tag: "picture"; fallback: PictureFallback }

/** One cell of the notebook: its text with slots in it, and whether it is a drawing (a cell of ink, a floating band). */
export interface PlannedCell { pieces: (string | Slot)[]; drawing: boolean }

export interface WolframPlan {
  cells: PlannedCell[]
  jobs: KernelJob[]
  /** How many cells are images (drawings, bands, pictures). */
  images: number
  /** A file (an image without its answer is a CLOSED initialization cell) or the clipboard (an open Input cell). */
  use: "file" | "clipboard"
}

type Pieces = (string | Slot)[]

/** The ink cells a note's markdown names, each once. */
export const inkIdsIn = (markdown: string): string[] =>
  [...new Set(mediaFiles(markdown).map(inkCellId).filter((id): id is string => id !== null))]

/** Where a picture line's picture is looked up in `pictures`: its media file, else its path as written. */
export const pictureKey = (block: { file: string | null; path: string }): string => block.file ?? block.path

const HEADING_STYLES = ["Title", "Chapter", "Section", "Subsection", "Subsubsection", "Author"]
const headingName = (level: number): string => HEADING_STYLES[Math.min(Math.max(level, 1), 6) - 1]!
/** A list item's style at a depth: Item, Subitem, Subsubitem (and their Numbered kin). */
const itemStyle = (depth: number, numbered: boolean): string =>
  (["Item", "Subitem", "Subsubitem"][depth] ?? "Item") + (numbered ? "Numbered" : "")
const tagging = (tag: string): string => `TaggingRules -> {"WriteMind" -> "${tag}"}`
const GREY = "FontColor -> GrayLevel[0.55]"

/** The code a drawing (or a converted picture) is without the engine: evaluated, it is the Image. */
export const drawingCode = (svg: string, shown: number, what: "drawing" | "picture"): string =>
  `(* WriteMind: a ${what}. Evaluate this cell to see it. *)\n`
  + `Image[ImportString[${wlString(svg)}, {"SVG", "Image"}, ImageResolution -> 144], ImageSize -> ${shown}]`

/** The code a picture file is without the engine: its bytes, imported, shown no wider than it was. */
export const pictureCode = (base64: string, format: string, shown: number): string =>
  `(* WriteMind: a picture. Evaluate this cell to see it. *)\n`
  + `With[{i = ImportByteArray[ByteArray[${wlString(base64)}], ${format === "SVG" ? "{\"SVG\", \"Image\"}" : wlString(format)}]}, `
  + `Image[i, ImageSize -> Min[${shown}, First[ImageDimensions[i]]]]]`

/**
 * The Input cell an image is without its answer. In a FILE it is closed and an initialization cell, so the notebook
 * opens on pictures-to-be rather than on thirty kilobytes of svg, and Evaluation ▸ Evaluate Initialization Cells
 * makes every one of them and runs nothing else (a code cell is an ordinary Input cell). On the CLIPBOARD it is open,
 * and Shift+Enter makes it.
 */
export const imageFallbackCell = (code: string, tag: string, use: "file" | "clipboard"): string =>
  `Cell[BoxData[${wlString(code)}], "Input", ${use === "file" ? "CellOpen -> False, InitializationCell -> True, " : ""}${tagging(tag)}]`

/** What a picture is when there is nothing to show: its alt words (or its file's name), in grey italics. */
const placeholder = (words: string): string =>
  `Cell[TextData[StyleBox[${wlString(words)}, FontSlant -> "Italic"]], "Text", ${GREY}]`

/** A link a notebook should follow (the web, mail); anything else is its words alone, as on paper. */
const followable = (href: string): boolean => /^(https?|mailto):/i.test(href.trim())

const hyperlink = (label: Pieces, href: string): Pieces => [
  "ButtonBox[", ...label, `, BaseStyle -> "Hyperlink", ButtonData -> {URL[${wlString(href.trim())}], None}, `
  + `ButtonNote -> ${wlString(href.trim())}]`,
]

/** The width (points) a converted picture's svg says it is shown at. */
const svgShown = (svg: string): number => {
  const found = /^<svg\b[^>]*?\swidth="([\d.]+)"/.exec(svg)
  return found ? shownAt(Number(found[1])) : 1
}

/** A list item's depth from its source indentation (a tab is four columns): 0, 1 or 2. */
export function listDepth(line: string): number {
  let width = 0
  for (const character of line) {
    if (character === " ") width += 1
    else if (character === "\t") width += 4
    else break
  }
  return Math.min(2, Math.floor((width + 2) / 4))
}

class Planner {
  readonly cells: PlannedCell[] = []
  readonly jobs: KernelJob[] = []
  images = 0
  private readonly named = new Map<string, string>()
  private readonly counts: Record<string, number> = {}

  constructor(readonly media: WolframMedia, readonly pictures: ReadonlyMap<string, ResolvedPicture | null>,
    readonly use: "file" | "clipboard") {}

  /** The job for this content: the same content twice is ONE job (`key`), so the kernel does it once. */
  job(kind: "ink" | "band" | "pdf" | "pic" | "wl", extension: string, key: string, text: string): string {
    const held = this.named.get(`${kind}:${key}`)
    if (held) return held
    const count = (this.counts[kind] ?? 0) + 1
    this.counts[kind] = count
    const name = `${kind}-${count}.${extension}`
    this.named.set(`${kind}:${key}`, name)
    this.jobs.push({ name, text })
    return name
  }

  add(pieces: Pieces, drawing = false): void {
    if (pieces.some((piece) => typeof piece !== "string" && piece.as === "image")) this.images++
    this.cells.push({ pieces, drawing })
  }

  /**
   * One line of inline markdown as runs: `"words"`, or a StyleBox for bold, italic, struck, underlined, highlighted,
   * a span's font, size and colour, and code (in the notebook's own monospace face — an `"InlineCode"` cell respaces
   * `f(x)` as `f ( x )`); a web link a Hyperlink ButtonBox; `wl:` maths an InlineFormula cell the kernel typesets.
   * `styled` is false when every run is plain, and the cell can then be one plain string.
   */
  runs(text: string): { runs: Pieces[]; styled: boolean; plain: string } {
    const runs: Pieces[] = []
    let styled = false
    let plain = ""
    for (const segment of inlineSegments(text)) {
      if (segment.image) {
        if (segment.image.alt) { runs.push([wlString(segment.image.alt)]); plain += segment.image.alt }
        continue
      }
      if (segment.math !== undefined) {
        const source = segment.math.trim()
        const spelled = kernelSpelling(source)
        styled = true
        plain += source
        runs.push([{
          job: this.job("wl", "wl", spelled, spelled), as: "inline",
          fallback: `Cell[BoxData[${wlString(spelled)}], "InlineFormula"]`,
        }])
        continue
      }
      const options: string[] = []
      if (segment.bold) options.push(`FontWeight -> "Bold"`)
      if (segment.italic) options.push(`FontSlant -> "Italic"`)
      const variations = [
        ...(segment.strike ? [`"StrikeThrough" -> True`] : []), ...(segment.underline ? [`"Underline" -> True`] : []),
      ]
      if (variations.length > 0) options.push(`FontVariations -> {${variations.join(", ")}}`)
      if (segment.highlight) options.push("Background -> RGBColor[1., 0.953, 0.627]")
      const span = segment.spanStyle ? spanDeclarations(segment.spanStyle) : {}
      if (segment.code) options.push(`FontFamily -> "Source Code Pro"`)
      else if (span.family) options.push(`FontFamily -> ${wlString(span.family)}`)
      if (span.size !== undefined) options.push(`FontSize -> ${Math.round(span.size * 100) / 100}`)
      const colour = span.color ? wlColor(span.color) : null
      if (colour) options.push(`FontColor -> ${colour}`)
      let run: Pieces = [options.length > 0 ? `StyleBox[${wlString(segment.text)}, ${options.join(", ")}]` : wlString(segment.text)]
      if (options.length > 0) styled = true
      if (segment.href !== undefined && followable(segment.href)) {
        run = hyperlink(run, segment.href)
        styled = true
      }
      plain += segment.text
      runs.push(run)
    }
    return { runs, styled, plain }
  }

  /** A run list as a cell's content: one plain string, or `TextData[{…}]`. */
  content(text: string, wrap?: (run: Pieces) => Pieces, lead: string[] = []): Pieces {
    const { runs, styled, plain } = this.runs(text)
    if (!styled && !wrap && lead.length === 0) return [wlString(plain)]
    const all: Pieces[] = [...lead.map((one) => [one]), ...(wrap ? runs.map(wrap) : runs)]
    return ["TextData[{", ...all.flatMap((run, index) => (index === 0 ? run : [", ", ...run])), "}]"]
  }

  /** One table entry: a plain string, or the entry's own TextData cell; a header entry bold. */
  entry(text: string, header: boolean): Pieces {
    const { runs, styled, plain } = this.runs(text)
    const inner: Pieces = styled
      ? ["Cell[TextData[{", ...runs.flatMap((run, index) => (index === 0 ? run : [", ", ...run])), "}]]"]
      : [wlString(plain)]
    return header ? ["StyleBox[", ...inner, `, FontWeight -> "Bold"]`] : inner
  }

  /** An image cell: a picture of any kind, as a slot. */
  image(slot: Slot, drawing: boolean): void {
    this.add([slot], drawing)
  }

  /** A picture line's file, as the cell it is: the engine's Image, or the placeholder when there is none. */
  picture(found: ResolvedPicture | null | undefined, words: string, drawing: boolean): void {
    if (!found) { this.add([placeholder(words)]); return }
    if (found.kind === "svg") {
      const shown = svgShown(found.svg)
      const job = this.job("pdf", "svg", found.svg, found.svg)
      this.image({ job, as: "image", tag: "picture", fallback: imageFallbackCell(drawingCode(found.svg, shown, "picture"), "picture", this.use) }, drawing)
      return
    }
    const shown = shownAt(this.media.column)
    const text = `{${wlString(found.path)}, ${shown}}`
    const job = this.job("pic", "txt", text, text)
    this.image({ job, as: "image", tag: "picture", fallback: { picture: found.path, format: found.format, shown, words } }, drawing)
  }

  block(block: Block, source: string): void {
    switch (block.kind) {
      case "heading":
        this.add(["Cell[", ...this.content(block.text), `, ${wlString(headingName(block.level))}]`])
        return
      case "paragraph":
        // A TEXT cell is its words as typed, every line break kept; a markdown cell is its inline markdown.
        if (!block.markdown) { this.add([`Cell[${wlString(block.text)}, "Text"]`]); return }
        this.add(["Cell[", ...this.content(block.text), `, "Text"]`])
        return
      case "bullets": case "dashes": case "numbered": {
        const lines = source.split("\n")
        const numbered = block.kind === "numbered"
        block.items.forEach((item, index) => {
          const style = itemStyle(listDepth(lines[index] ?? ""), numbered)
          const extra = [
            ...(block.kind === "dashes" ? [`CellDingbat -> "\\:2013"`] : []),
            // Each numbered list counts from one, as it does on the page.
            ...(numbered && index === 0 ? [`CounterAssignments -> {{"ItemNumbered", 0}}`] : []),
          ]
          this.add(["Cell[", ...this.content(item), `, ${wlString(style)}${extra.map((one) => ", " + one).join("")}]`])
        })
        return
      }
      case "todos": {
        const lines = source.split("\n")
        block.items.forEach((item, index) => {
          const style = itemStyle(listDepth(lines[index] ?? ""), false)
          const content = item.done
            ? this.content(item.text, (run) => ["StyleBox[", ...run, `, FontVariations -> {"StrikeThrough" -> True}, FontColor -> GrayLevel[0.5]]`], [wlString("☑ ")])
            : this.content(item.text, undefined, [wlString("☐ ")])
          this.add(["Cell[", ...content, `, ${wlString(style)}]`])
        })
        return
      }
      case "quote":
        this.add(["Cell[", ...this.content(block.text),
          `, "Text", CellFrame -> {{3, 0}, {0, 0}}, CellFrameColor -> GrayLevel[0.7], FontSlant -> "Italic"]`])
        return
      case "table": {
        const rows: Pieces[] = [block.header.map((words) => this.entry(words, true)), ...block.rows.map((row) => row.map((words) => this.entry(words, false)))]
          .map((entries) => ["{", ...entries.flatMap((entry, index) => (index === 0 ? entry : [", ", ...entry])), "}"])
        const align = block.header.map((_words, column) => {
          const one = block.align[column]
          return one === "center" ? "Center" : one === "right" ? "Right" : "Left"
        })
        this.add(["Cell[TextData[{Cell[BoxData[GridBox[{", ...rows.flatMap((row, index) => (index === 0 ? row : [", ", ...row])),
          `}, GridBoxDividers -> {"Columns" -> {{True}}, "Rows" -> {{True}}}, GridBoxAlignment -> {"Columns" -> {${align.join(", ")}}}]]]}], "Text"]`])
        return
      }
      case "rule":
        this.add([`Cell["", "Text", CellFrame -> {{0, 0}, {1, 0}}, CellFrameColor -> GrayLevel[0.78], Editable -> False]`])
        return
      case "blank":
        return
      case "code":
        this.code(block)
        return
      case "picture": {
        const found = this.pictures.get(pictureKey(block))
        if (block.ink !== null) {
          const ink = this.media.inks[block.ink]
          if (ink) {
            const job = this.job("ink", "svg", block.ink, ink.svg)
            this.image({ job, as: "image", tag: "ink", fallback: imageFallbackCell(drawingCode(ink.svg, ink.shown, "drawing"), "ink", this.use) }, true)
          } else if (found) {
            // A drawing cell the sidecar has no item for: its snapshot file is what there is.
            this.picture(found, block.alt || block.file || block.path, true)
          } else {
            this.add([`Cell["Drawing (not found)", "Text", ${GREY}]`])
          }
          return
        }
        if (block.file === null && /^https?:/i.test(block.path)) {
          // Nothing is fetched: the notebook links to it, as the page's words would.
          this.add(["Cell[TextData[{", ...hyperlink([wlString(block.alt || block.path)], block.path), `}], "Text"]`])
          return
        }
        this.picture(found, block.alt || block.file || block.path.split(/[\\/]/).pop() || block.path, false)
        return
      }
    }
  }

  code(block: Extract<Block, { kind: "code" }>): void {
    if (isOut(block)) {
      // An answer, as an Output cell: the backslash that kept a line of output from closing the fence comes off
      // again (output.ts `escapedOutLine`), and a run that printed nothing writes nothing.
      const body = block.body.split("\n").map((line) => (line.startsWith("\\") && line.slice(1).trim().startsWith("```") ? line.slice(1) : line)).join("\n")
      if (body.trim() === "[no output]") return
      this.add([`Cell[${wlString(body)}, "Output"]`])
      return
    }
    if (isMathFence(block.language)) {
      const source = mathsCellSource(block.body)
      if (source === "") return
      const spelled = kernelSpelling(source)
      const job = this.job("wl", "wl", spelled, spelled)
      this.add([{ job, as: "maths", fallback: `Cell[BoxData[${wlString(spelled)}], "Input", ${tagging("maths")}]` }])
      return
    }
    switch (colouring(block.language)) {
      case "wolfram": this.add([`Cell[BoxData[${wlString(block.body)}], "Input"]`]); return
      case "python": this.add([`Cell[${wlString(block.body)}, "ExternalLanguage", CellEvaluationLanguage -> "Python"]`]); return
      default: this.add([`Cell[${wlString(block.body)}, "Program"]`])
    }
  }

  band(band: WolframBand): void {
    const job = this.job("band", "svg", band.svg, band.svg)
    this.image({ job, as: "image", tag: "floating", fallback: imageFallbackCell(drawingCode(band.svg, band.shown, "drawing"), "floating", this.use) }, true)
  }
}

/**
 * The note (or the held cells' markdown) as planned cells and the kernel's jobs. `media` is what the page measured
 * (ink cells, floating bands, the column); `pictures` what the main process found for each picture line
 * (`pictureKey`; null: not there); `use` says whether this is a file or the clipboard.
 */
export function wolframPlan(markdown: string, media: WolframMedia,
  pictures: ReadonlyMap<string, ResolvedPicture | null>, use: "file" | "clipboard"): WolframPlan {
  const planner = new Planner(media, pictures, use)
  const blocks = positioned(markdown)
  const placed = new Set<number>()
  // A band above every cell goes first; the rest after the cell they float beside.
  const after = (offset: number | null) => media.bands.forEach((band, index) => {
    if (band.after !== offset || placed.has(index)) return
    placed.add(index)
    planner.band(band)
  })
  after(null)
  for (const one of blocks) {
    planner.block(one.block, markdown.slice(one.range.location, one.range.location + one.range.length))
    after(one.range.location)
  }
  // A band whose cell is not in this text (it moved since it was measured) still goes in, at the end.
  media.bands.forEach((band, index) => { if (!placed.has(index)) planner.band(band) })
  return { cells: planner.cells, jobs: planner.jobs, images: planner.images, use }
}
