// Port-only: no XCTest. The clipboard types a drawing cell copied into Mathematica goes under
// (src/export/wolfram/clipboard.ts), and which types a second write keeps.
import { describe, expect, it } from "vitest"
import { clipboardKeeps, svgClipboardFor, wolframClipboardFor } from "../src/export/wolfram/clipboard"

describe("wolframClipboardFor", () => {
  it("names the front end's own pasteboard type and the raw PNG on a Mac", () => {
    expect(wolframClipboardFor("darwin")).toEqual({ cell: "dyn.ah62d4rv4gk8y8xnfk6", png: "public.png" })
  })
  it("names nothing of its own where the front end's format is not known", () => {
    expect(wolframClipboardFor("win32")).toEqual({ cell: null, png: null })
    expect(wolframClipboardFor("linux")).toEqual({ cell: null, png: null })
  })
})

describe("svgClipboardFor (Copy Cell's file and markup for the other apps)", () => {
  it("on a Mac: the file and the SVG are raw types of ONE pasteboard item (file-url, svg-image), no line end", () => {
    expect(svgClipboardFor("darwin")).toEqual({ svg: "public.svg-image", file: "public.file-url", end: "" })
  })
  it("elsewhere: the file is the standard text/uri-list (a line ending in CRLF) and the SVG the registered image/svg+xml", () => {
    expect(svgClipboardFor("win32")).toEqual({ svg: "image/svg+xml", file: null, end: "\r\n" })
    expect(svgClipboardFor("linux")).toEqual({ svg: "image/svg+xml", file: null, end: "\r\n" })
  })
  it("is never a type a second write would keep: the page's words and custom data only", () => {
    expect(clipboardKeeps(`electron application/osclipboard;format="public.file-url"`)).toBe(false)
    expect(clipboardKeeps(`electron application/osclipboard;format="public.svg-image"`)).toBe(false)
    expect(clipboardKeeps("text/uri-list")).toBe(false)
  })
})

describe("clipboardKeeps", () => {
  it("keeps the plain text and the page's own custom data, on either system", () => {
    expect(clipboardKeeps("text/plain")).toBe(true)
    expect(clipboardKeeps(`electron application/osclipboard;format="org.chromium.web-custom-data"`)).toBe(true)
    expect(clipboardKeeps(`electron application/osclipboard;format="Chromium Web Custom MIME Data Format"`)).toBe(true)
  })
  it("drops what a write of its own put there, and anything else", () => {
    for (const type of [
      `electron application/osclipboard;format="dyn.ah62d4rv4gk8y8xnfk6"`,
      `electron application/osclipboard;format="CorePasteboardFlavorType 0x4F4D4547"`,
      `electron application/osclipboard;format="public.png"`, "image/png",
      `electron application/osclipboard;format="public.tiff"`, "electron application/bookmark", "text/html",
    ]) expect(clipboardKeeps(type), type).toBe(false)
  })
})
