import { describe, expect, it } from "vitest"
import path from "node:path"
import { positioned, blocks } from "../src/markdown/parser"
import { escapePlain, unescapePlain } from "../src/markdown/plainText"
import { inkCellMarkdown, mediaFile, mediaFiles, pictureMarkdown } from "../src/markdown/images"
import { decodeDrawing, writeDrawing } from "../src/drawing/model"
import { keepUnknown } from "../src/drawing/keep"
import { resolveLinkTarget } from "../src/notes/linking"
import { containerNames, newNames, rewriteLegacyText } from "../src/wm/legacy"
import {
  MIMETYPE_BYTES, WM_VERSION, WmError, entriesToWrite, entryNameError, foldedName, methodFor, newWmFile, openWm, parseManifest,
  readNamesError, sniffWm, textOfFile, utf8, withText, writeNamesError, type WmEntry,
} from "../src/index"
import {
  emptyProjectData, parseProjectData, resolvePaths, stringifyProjectData, writtenPath,
} from "../src/wm/projectFile"

// docs/SPEC-WM.md section 6.2: the conformance vectors that live in the model. (The ZIP bytes, the atomic write and the
// guard are tested in apps/desktop/test; the conversion, in apps/desktop/test/convert.test.ts.)

const APP = { name: "WriteMind", version: "2.16.0" }
const NOW = new Date("2026-10-08T09:14:03Z")
const text = (entries: WmEntry[], name: string): string => new TextDecoder().decode(entries.find((entry) => entry.name === name)!.data)

/** The three entries of a minimal file. */
const minimal = (body = "# T\n"): WmEntry[] => {
  const file = newWmFile(NOW, APP, body)
  const out = entriesToWrite(file, null)
  return out.entries
}

describe("vector 1: the minimal file", () => {
  it("starts with the mimetype entry, which is exactly the 34 bytes of the media type", () => {
    const [first, second, third] = minimal()
    expect(first!.name).toBe("mimetype")
    expect(new TextDecoder().decode(first!.data)).toBe("application/vnd.writemind.note+zip")
    expect(first!.data.length).toBe(34)
    expect(MIMETYPE_BYTES).toEqual(first!.data)
    expect([second!.name, third!.name]).toEqual(["manifest.json", "note.mdwm"])
  })

  it("opens, has the title's text, and a save with no edit writes the same decoded entries", () => {
    const entries = minimal()
    const file = openWm(entries)
    expect(textOfFile(file)).toBe("# T\n")
    expect(file.readOnly).toBe(false)
    const again = entriesToWrite(file, null).entries
    expect(again.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name))
    for (const [at, entry] of again.entries()) expect(Array.from(entry.data)).toEqual(Array.from(entries[at]!.data))
  })

  it("is sniffed from bytes 0-3, 30-37 and 38-71 alone (the ZIP header the codec writes is tested in zip.test.ts)", () => {
    const head = new Uint8Array(72)
    head.set([0x50, 0x4b, 0x03, 0x04], 0)
    head.set([8, 0, 0, 0], 26)
    head.set(utf8("mimetype"), 30)
    head.set(MIMETYPE_BYTES, 38)
    expect(sniffWm(head)).toBe(true)
    head[8] = 8 // a deflated mimetype is not the file the spec describes
    expect(sniffWm(head)).toBe(false)
    expect(sniffWm(head.subarray(0, 60))).toBe(false)
  })
})

describe("vector 2: what is a .wm and what is not", () => {
  it("(a) opens a repacked file whose mimetype is not first, and writes it back with the mimetype first", () => {
    const [mime, manifest, note] = minimal()
    const file = openWm([manifest!, note!, mime!])
    expect(entriesToWrite(file, null).entries[0]!.name).toBe("mimetype")
  })

  it("(b) refuses a mimetype that says another type", () => {
    const [, manifest, note] = minimal()
    expect(() => openWm([{ name: "mimetype", data: utf8("application/zip") }, manifest!, note!])).toThrow(WmError)
    expect(() => openWm([manifest!, note!])).toThrow(/mimetype/)
  })

  it("(c) refuses a manifest whose format is another (the file is not touched: nothing here writes)", () => {
    const [mime, , note] = minimal()
    const manifest = { name: "manifest.json", data: utf8(JSON.stringify({ format: "epub", version: 1 })) }
    expect(() => openWm([mime!, manifest, note!])).toThrow(/not a WriteMind note/)
    expect(parseManifest("{").ok).toBe(false)
    expect(parseManifest(JSON.stringify({ format: "writemind-note", version: 0 })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({ format: "writemind-note", version: 1.5 })).ok).toBe(false)
  })
})

describe("vector 3 (the model's half): what is not known survives a change of the text", () => {
  it("keeps an unknown entry in place, an unknown manifest key, and the drawing's unknown things", () => {
    const [mime, , note] = minimal()
    const manifest = JSON.stringify({
      format: "writemind-note", version: 1, id: "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10", created: "2026-10-08T09:14:03Z",
      modified: "2026-10-08T09:14:03Z", "x-future": { a: [1, 2] },
    })
    const drawing = JSON.stringify({
      zzz: 1,
      items: [
        { kind: "stroke", id: "a", points: [{ x: 0, y: 0 }], tag: "hi" },
        { kind: "sticker", id: "q" },
        { kind: "stroke", id: "b", points: [{ x: 1, y: 1 }] },
      ],
    })
    const file = openWm([
      mime!, { name: "manifest.json", data: utf8(manifest) }, note!,
      { name: "drawing.json", data: utf8(drawing) }, { name: "extra/x.bin", data: new Uint8Array([1, 2, 3]) },
    ])
    const edited = withText(file, "# T\nx\n")
    const out = entriesToWrite(edited, { now: new Date("2026-10-09T10:00:00Z"), app: APP })
    expect(out.entries.map((entry) => entry.name)).toEqual(["mimetype", "manifest.json", "note.mdwm", "drawing.json", "extra/x.bin"])
    expect(Array.from(out.entries.find((entry) => entry.name === "extra/x.bin")!.data)).toEqual([1, 2, 3])
    const written = JSON.parse(text(out.entries, "manifest.json"))
    expect(written["x-future"]).toEqual({ a: [1, 2] })
    expect(written.id).toBe("0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10")
    expect(written.modified).toBe("2026-10-09T10:00:00Z")
    expect(written.created).toBe("2026-10-08T09:14:03Z")
    expect(text(out.entries, "note.mdwm")).toBe("# T\nx\n")
    // The drawing the model would write after decoding this one, with what it dropped put back:
    const model = writeDrawing(decodeDrawing(drawing).drawing)
    expect(JSON.parse(model).items.map((item: { id: string }) => item.id)).toEqual(["a", "b"])
    const kept = JSON.parse(keepUnknown(drawing, model))
    expect(kept.zzz).toBe(1)
    expect(kept.items.map((item: { id: string }) => item.id)).toEqual(["a", "q", "b"])
    expect(kept.items[0].tag).toBe("hi")
  })
})

describe("vector 4 (the model's half): a newer version is read-only", () => {
  it("opens, is marked read-only, and the writer refuses it", () => {
    const [mime, , note] = minimal()
    const manifest = { name: "manifest.json", data: utf8(JSON.stringify({ format: "writemind-note", version: WM_VERSION + 1 })) }
    const file = openWm([mime!, manifest, note!, { name: "future/thing", data: new Uint8Array([9]) }])
    expect(file.readOnly).toBe(true)
    expect(file.version).toBe(2)
    expect(() => entriesToWrite(file, null)).toThrow(/newer WriteMind/)
  })
})

describe("vector 5: hostile names", () => {
  const bad = ["../x", "/abs", "a\\b", "C:/x", "media/../../x", "a//b", "media/x ", "media/x.", "a/\u0001b", "media/./x"]
  it.each(bad)("refuses %j on reading", (name) => {
    expect(entryNameError(name)).not.toBeNull()
    const [mime, manifest, note] = minimal()
    expect(() => openWm([mime!, manifest!, note!, { name, data: new Uint8Array(1) }])).toThrow(WmError)
  })

  it("refuses the same name twice on reading, and two that differ only by case on writing", () => {
    expect(readNamesError(["media/a.png", "media/a.png"])).toMatch(/twice/)
    expect(readNamesError(["media/A.png", "media/a.png"])).toBeNull()
    expect(writeNamesError(["media/A.png", "media/a.png"])).toMatch(/differ only by case/)
    expect(foldedName("Ä.png")).toBe(foldedName("A\u0308.png"))
    const file = openWm(minimal())
    const clash = { ...file, entries: [...file.entries, { name: "media/A.png", data: new Uint8Array(1) }, { name: "media/a.png", data: new Uint8Array(1) }] }
    expect(() => entriesToWrite(clash, null)).toThrow(/differ only by case/)
  })

  it("accepts the names a note really has, a directory entry, and refuses the over-long", () => {
    for (const name of ["note.mdwm", "media/3f9c2a7e5b1d4c80.png", "snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg", "legacy/sidecar.json", "media/", "media/é.png"]) {
      expect(entryNameError(name), name).toBeNull()
    }
    expect(entryNameError(`media/${"a".repeat(256)}`)).toMatch(/too long/)
    expect(entryNameError("a/".repeat(600) + "b")).toMatch(/too long/)
  })
})

describe("compression policy (1.4)", () => {
  it("stores the mimetype and already-compressed pictures, and deflates the rest", () => {
    expect(methodFor("mimetype")).toBe("store")
    expect(methodFor("media/a.PNG")).toBe("store")
    expect(methodFor("media/a.jpeg")).toBe("store")
    expect(methodFor("media/a.svg")).toBe("deflate")
    expect(methodFor("media/a.pdf")).toBe("deflate")
    expect(methodFor("note.mdwm")).toBe("deflate")
    expect(methodFor("snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg")).toBe("deflate")
  })
})

// MARK: - The text

const EXAMPLE = [
  "# Field notes",
  "",
  "Plain words, kept as typed.",
  "A second line stays a second line. \\# not a heading, \\*not bold* either.",
  "",
  "<a id=\"wm-5e6f7a8b\"></a>A text cell that other notes link to.",
  "",
  "<!-- markdown -->",
  "**Bold**, _italic_, <u>underline</u>, ~~strike~~, <span style=\"font-family: Georgia; font-size: 18px; color: #2D7DD2\">styled</span>, `code`, maths `wl:x^2 + 1` and a <mark id=\"wm-9c0d1e2f\">highlighted run</mark>. See [the plan](Plan.wm#wm-1a2b3c4d) and ![dot](media/3f9c2a7e5b1d4c80.png).",
  "",
  "## Lists",
  "",
  "- dot item",
  "- another dot",
  "* dash item",
  "- [ ] still to do",
  "- [x] done",
  "1. first",
  "2. second",
  "",
  "> a quote",
  "> over two lines",
  "",
  "---",
  "",
  "| Key | Does |",
  "|:----|-----:|",
  "| a   | b    |",
  "",
  "![a picture](media/3f9c2a7e5b1d4c80.png)",
  "",
  "![ink](snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg)",
  "",
  "```wl",
  "\\[Alpha]^2 + Sqrt[x]",
  "```",
  "",
  "```eval python",
  "print(6 * 7)",
  "```",
  "",
  "```out",
  "42",
  "```",
  "",
  "```python",
  "# code that is only coloured",
  "```",
  "",
].join("\n")

describe("vector 7: the text grammar", () => {
  it("parses the example of 2.8 to the cells the spec lists, and its pictures are the container's", () => {
    const cells = positioned(EXAMPLE).map((cell) => cell.block)
    const kinds = cells.filter((block) => block.kind !== "blank").map((block) =>
      block.kind === "paragraph" ? (block.markdown ? "markdown" : "text") : block.kind === "code" ? `code:${block.language}` : block.kind)
    expect(kinds).toEqual(["heading", "text", "text", "markdown", "heading", "bullets", "dashes", "todos", "numbered", "quote", "rule",
      "table", "picture", "picture", "code:wl", "code:eval python", "code:out", "code:python"])
    const first = cells.find((block) => block.kind === "paragraph")!
    expect(first).toMatchObject({ text: "Plain words, kept as typed.\nA second line stays a second line. # not a heading, *not bold* either." })
    const pictures = cells.filter((block) => block.kind === "picture")
    expect(pictures[0]).toMatchObject({ file: "3f9c2a7e5b1d4c80.png", ink: null })
    expect(pictures[1]).toMatchObject({ file: "ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg", ink: "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90" })
    expect(mediaFiles(EXAMPLE)).toEqual(["3f9c2a7e5b1d4c80.png", "ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg"])
  })

  it("splits `a`, two blank lines, `b`, three blank lines, `c` into paragraph, paragraph, blank (1), paragraph", () => {
    const kinds = blocks("a\n\n\nb\n\n\n\nc").map((block) => block.kind === "blank" ? `blank:${block.lines}` : block.kind)
    expect(kinds).toEqual(["paragraph", "paragraph", "blank:1", "paragraph"])
  })

  it("reads `-` alone, `- ` alone, `#nospace` and `####### seven` as paragraph lines", () => {
    for (const line of ["-", "- ", "#nospace", "####### seven"]) {
      const found = blocks(line).filter((block) => block.kind !== "blank")
      expect(found.map((block) => block.kind), line).toEqual(["paragraph"])
    }
  })

  it("makes an unclosed fence a code cell to the end, and `- [x]done` a dot item and not a task", () => {
    expect(blocks("```py\nx = 1\ny = 2").map((block) => block.kind)).toEqual(["code"])
    expect(blocks("- [x]done")).toEqual([{ kind: "bullets", items: ["[x]done"] }])
  })

  it("keeps `\\|` inside a table cell", () => {
    const table = blocks("| a | b |\n|---|---|\n| x \\| y | z |")[0]!
    expect(table).toMatchObject({ kind: "table", rows: [["x | y", "z"]] })
  })
})

describe("vector 8: the escape rule", () => {
  const visible = "# not a heading\n- or a list\n**x** 1. a_b"
  const file = "\\# not a heading\n\\- or a list\n\\*\\*x** 1. a_b"

  it("writes the visible words with a backslash in front of what would change the file's meaning, and reads them back", () => {
    expect(escapePlain(visible)).toBe(file)
    expect(unescapePlain(file)).toBe(visible)
  })

  it("parses to one text cell with those words; an unmarked `**x**` is a markdown cell; the marker line is not a word", () => {
    const cell = blocks(file)[0]!
    expect(cell).toMatchObject({ kind: "paragraph", text: visible })
    expect((cell as { markdown?: true }).markdown).toBeUndefined()
    expect(blocks("**x**")[0]).toMatchObject({ kind: "paragraph", markdown: true })
    expect(blocks("<!-- markdown -->\n**x**")[0]).toMatchObject({ kind: "paragraph", markdown: true, text: "**x**" })
    expect(escapePlain("<!-- markdown -->")).toBe("\\<!-- markdown -->")
    expect(blocks("\\<!-- markdown -->")[0]).toMatchObject({ kind: "paragraph", text: "<!-- markdown -->" })
  })
})

describe("references into the container (2.6.1)", () => {
  it("writes media/<name> and snapshots/<name>, percent-encoded, and never the old spelling", () => {
    expect(pictureMarkdown("3f9c2a7e5b1d4c80.png")).toBe("![](media/3f9c2a7e5b1d4c80.png)")
    expect(pictureMarkdown("a b!.png", 2, "alt")).toBe("![alt](media/a%20b%21.png)")
    expect(inkCellMarkdown("3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90", 3)).toBe("![ink](snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg)")
  })

  it("reads the new spelling, the 2.15.0 one (any depth, either slash), and nothing else", () => {
    expect(mediaFile("media/a.png")).toBe("a.png")
    expect(mediaFile("media/a%20b.png")).toBe("a b.png")
    expect(mediaFile("media/a%ZZ.png")).toBe("a%ZZ.png")
    expect(mediaFile("snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg")).toBe("ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg")
    expect(mediaFile("snapshots/other.svg")).toBeNull()
    expect(mediaFile(".drawings/media/a.png")).toBe("a.png")
    expect(mediaFile("../../.drawings/media/a.png")).toBe("a.png")
    expect(mediaFile(".\\.drawings\\media\\a.png")).toBe("a.png")
    for (const other of ["./media/a.png", "../media/a.png", "/media/a.png", "media/sub/a.png", "media/..", "https://x/media/a.png", "other/a.png", "media/"]) {
      expect(mediaFile(other), other).toBeNull()
    }
  })
})

describe("vector 9: tolerant decode, and what is kept", () => {
  const json = `{"zzz":1,"strokes":[{"points":[]},{"id":"x","points":[{"x":0,"y":0}]}],"items":[{"kind":"sticker"},{"kind":"shape","id":"h","shapeKind":"hexagon"},{"kind":"stroke","id":"p","points":[{"x":0,"y":0},{"x":1,"y":1}],"pressures":[1]},null]}`

  it("decodes to the items x (stroke), h (rectangle, defaults) and p (stroke, no pressures), and says it is damaged", () => {
    const read = decodeDrawing(json)
    expect(read.damaged).toBe(true)
    expect(read.drawing.items.map((item) => item.kind)).toEqual(["stroke", "shape", "stroke"])
    const [x, h, p] = read.drawing.items
    expect(x).toMatchObject({ kind: "stroke", stroke: { id: "x" } })
    expect(h).toMatchObject({ kind: "shape", shape: { id: "h", kind: "rectangle", width: 0.18, aspect: 0.55 } })
    expect((p as { stroke: { pressures?: number[] } }).stroke.pressures).toBeUndefined()
  })

  it("is saved back with zzz, the sticker, the original shapeKind, the stroke with no points and the null still in the file", () => {
    const saved = JSON.parse(keepUnknown(json, writeDrawing(decodeDrawing(json).drawing)))
    expect(saved.zzz).toBe(1)
    expect("strokes" in saved).toBe(false)
    const items = saved.items as ({ id?: string; kind?: string; shapeKind?: string; points?: unknown[] } | null)[]
    expect(items.some((item) => item?.kind === "sticker")).toBe(true)
    expect(items.some((item) => item === null)).toBe(true)
    expect(items.some((item) => item?.points && item.points.length === 0)).toBe(true)
    expect(items.find((item) => item?.id === "h")?.shapeKind).toBe("hexagon")
    expect(items.filter((item) => item?.id).map((item) => item!.id)).toEqual(["x", "h", "p"])
  })

  it("keeps an opaque item after the item it followed, whatever its neighbours do, and drops what the model deleted", () => {
    const before = JSON.stringify({ items: [
      { kind: "stroke", id: "a", points: [{ x: 0, y: 0 }], tag: 1 },
      { kind: "sticker", id: "s1" },
      { kind: "stroke", id: "b", points: [{ x: 0, y: 0 }] },
      { kind: "sticker", id: "s2" },
    ] })
    const model = decodeDrawing(before).drawing
    // The model reorders (b to the bottom) and deletes a.
    const reordered = writeDrawing({ items: [model.items[1]!] })
    const after = JSON.parse(keepUnknown(before, reordered)).items.map((item: { id: string }) => item.id)
    expect(after).toEqual(["s1", "b", "s2"])
    // A new item and an edit keep the unknown field of an item that stays.
    const edited = writeDrawing({ items: [...model.items, { ...model.items[0]!, stroke: { ...(model.items[0] as { stroke: object }).stroke, id: "n" } } as never] })
    const again = JSON.parse(keepUnknown(before, edited)).items as { id: string; tag?: number }[]
    expect(again.find((item) => item.id === "a")?.tag).toBe(1)
    expect(again.find((item) => item.id === "n")?.tag).toBeUndefined()
  })

  it("keeps the unknown things inside a drawing cell, and gives back the new file when the old one was no drawing", () => {
    const before = JSON.stringify({ items: [{ kind: "cell", id: "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90", aspect: 0.3, ink: "future", items: [
      { kind: "stroke", id: "c", points: [{ x: 0.1, y: 0.1 }] }, { kind: "sticker" }] }] })
    const saved = JSON.parse(keepUnknown(before, writeDrawing(decodeDrawing(before).drawing)))
    expect(saved.items[0].ink).toBe("future")
    expect(saved.items[0].items.map((item: { kind: string }) => item.kind)).toEqual(["stroke", "sticker"])
    expect(keepUnknown(null, '{"items":[]}')).toBe('{"items":[]}')
    expect(keepUnknown("not json", '{"items":[]}')).toBe('{"items":[]}')
  })
})

describe("vector 11 (b), (a): names inside one container, and the new names of the notes", () => {
  it("a name that equals another's after case folding gets -2, -3 before its extension, in the order met", () => {
    expect([...containerNames(["X.png", "x.png", "y.png", "X.PNG", "noext", "NOEXT", "x.png"])]).toEqual([
      ["X.png", "X.png"], ["x.png", "x-2.png"], ["y.png", "y.png"], ["X.PNG", "X-3.PNG"], ["noext", "noext"], ["NOEXT", "NOEXT-2"],
    ])
  })

  it("A.md and A.markdown become A.wm and A 2.wm, in file-name order and then extension order; a name that is taken is skipped", () => {
    const names = newNames([{ relative: "A.markdown" }, { relative: "a.md" }, { relative: "Sec/B.md" }], (dir) => new Set(dir === "Sec" ? ["B.wm"] : []))
    expect(names.get("a.md")).toBe("a.wm")
    expect(names.get("A.markdown")).toBe("A 2.wm")
    expect(names.get("Sec/B.md")).toBe("B 2.wm")
    // An earlier run's names are kept, and reserved.
    const kept = newNames([{ relative: "A.md" }, { relative: "A.markdown" }], () => new Set(["A.wm"]), new Map([["A.markdown", "A.wm"]]))
    expect(kept.get("A.markdown")).toBe("A.wm")
    expect(kept.get("A.md")).toBe("A 2.wm")
  })

  it("rewrites what the spec lists and nothing else: pictures and links in markdown cells, never a text cell, a fence or a code span", () => {
    const text = [
      "# H [x](A.md)", "", "a text cell: words, escaped \\[x](A.md) and .drawings/media/a.png", "",
      "<!-- markdown -->", "see [x](A.md#h) and `[y](A.md)` and ![](../.drawings/media/a%20b.png) and [z](https://e.com/A.md)", "",
      "```", "[x](A.md)", "```", "", "![](.drawings/media/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg)", "",
      "- item with ![](./.drawings/media/gone.png) and [w](Other.md)",
    ].join("\n")
    const out = rewriteLegacyText(text, {
      renamed: new Map([["a b.png", "a b-2.png"]]), missing: new Set(["gone.png"]),
      link: (file) => (file === "A.md" ? "A.wm" : null),
    })
    expect(out).toBe([
      "# H [x](A.wm)", "", "a text cell: words, escaped \\[x](A.md) and .drawings/media/a.png", "",
      "<!-- markdown -->", "see [x](A.wm#h) and `[y](A.md)` and ![](media/a%20b-2.png) and [z](https://e.com/A.md)", "",
      "```", "[x](A.md)", "```", "", "![](snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg)", "",
      "- item with ![](./.drawings/media/gone.png) and [w](Other.md)",
    ].join("\n"))
  })
})

describe("vector 12: links", () => {
  const notes = ["/r/Other.wm", "/r/Sec/Other.wm"]
  const from = "/r/Sec/A.wm"
  it("resolves Other.wm to the nearest, Other.md to it too (rule 6), Other (rule 4), ../Other.wm, and Nope.md to nothing", () => {
    expect(resolveLinkTarget(notes, from, "Other.wm")).toBe("/r/Sec/Other.wm")
    expect(resolveLinkTarget(notes, from, "Other.md")).toBe("/r/Sec/Other.wm")
    expect(resolveLinkTarget(notes, from, "Other")).toBe("/r/Sec/Other.wm")
    expect(resolveLinkTarget(notes, from, "../Other.wm")).toBe("/r/Other.wm")
    expect(resolveLinkTarget(notes, from, "Nope.md")).toBeNull()
    expect(resolveLinkTarget(notes, from, "../Other.md")).toBe("/r/Other.wm")
    expect(resolveLinkTarget(notes, from, "other.MARKDOWN")).toBe("/r/Sec/Other.wm")
    expect(resolveLinkTarget(["/r/a.md"], "/r/b.wm", "a.md")).toBe("/r/a.md")
  })
})

describe("vector 13: the project file", () => {
  const foreign = (value: string) => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
  const posix = path.posix

  it("(a) reads the Mac's shape with no files, and writes it back in 4.1's layout with an empty files list", () => {
    const data = parseProjectData('{"excluded":[],"folders":["/a"],"version":1}')!
    expect(data.files).toEqual([])
    expect(stringifyProjectData(data)).toBe('{\n  "excluded" : [\n\n  ],\n  "files" : [\n\n  ],\n  "folders" : [\n    "/a"\n  ],\n  "version" : 1\n}')
  })

  it("prints the spec's example exactly", () => {
    const data = { ...emptyProjectData(), excluded: ["/Users/s/Documents/WriteMind/Archive"],
      files: ["Notes/Today.wm", "/Users/s/Desktop/Scratch.wm"], folders: ["Notes"] }
    expect(stringifyProjectData(data)).toBe([
      "{", '  "excluded" : [', '    "/Users/s/Documents/WriteMind/Archive"', "  ],", '  "files" : [', '    "Notes/Today.wm",',
      '    "/Users/s/Desktop/Scratch.wm"', "  ],", '  "folders" : [', '    "Notes"', "  ],", '  "version" : 1', "}",
    ].join("\n"))
  })

  it("(b) resolves a relative file against the project file's folder, and writes x-future back and the file relative", () => {
    const data = parseProjectData('{"x-future":{"a":1},"files":["Notes/T.wm"],"folders":["/p/Notes"],"version":1}')!
    const file = "/p/proj.writemind-project"
    expect(resolvePaths(data.files, file, posix, foreign, false)).toEqual(["/p/Notes/T.wm"])
    const back = {
      ...data,
      files: resolvePaths(data.files, file, posix, foreign, false).map((one) => writtenPath(one, file, posix, foreign, false)),
      folders: data.folders.map((one) => writtenPath(one, file, posix, foreign, false)),
    }
    const printed = stringifyProjectData(back)
    expect(printed).toContain('"x-future" : {\n    "a" : 1\n  }')
    expect(printed).toContain('"Notes/T.wm"')
    expect(printed).toContain('    "Notes"')
    expect(parseProjectData(printed)!.extra).toEqual({ "x-future": { a: 1 } })
  })

  it("writes a path outside the project file's folder absolute, and an untitled project's paths as they are", () => {
    expect(writtenPath("/elsewhere/x.wm", "/p/proj.writemind-project", posix, foreign, false)).toBe("/elsewhere/x.wm")
    expect(writtenPath("/p/proj.writemind-project", "/p/proj.writemind-project", posix, foreign, false)).toBe("proj.writemind-project")
    expect(writtenPath("/p/Notes/T.wm", null, posix, foreign, false)).toBe("/p/Notes/T.wm")
    expect(resolvePaths(["../x/y.wm"], "/p/q/proj.writemind-project", posix, foreign, false)).toEqual(["/p/x/y.wm"])
  })

  it("(c) keeps a drive path read on a Mac as written, and (d) lists a duplicate path once", () => {
    expect(resolvePaths(["C:\\Users\\x", "/a", "/a", "/a/../a"], null, posix, foreign, false)).toEqual(["C:\\Users\\x", "/a"])
    expect(writtenPath("C:\\Users\\x", "/p/proj.writemind-project", posix, foreign, false)).toBe("C:\\Users\\x")
    expect(resolvePaths(["/A", "/a"], null, posix, foreign, true)).toEqual(["/A"])
  })

  it("ignores entries that are not strings and a version that is not a number; a newer version is kept", () => {
    const data = parseProjectData('{"folders":["/a",1,null],"files":"no","version":"x"}')!
    expect(data).toMatchObject({ folders: ["/a"], files: [], version: 1 })
    expect(parseProjectData('{"version":3}')!.version).toBe(3)
    expect(stringifyProjectData(parseProjectData('{"version":3}')!)).toContain('"version" : 3')
    expect(parseProjectData("[1]")).toBeNull()
    expect(parseProjectData("nope")).toBeNull()
  })
})
