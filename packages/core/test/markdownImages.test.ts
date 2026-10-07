import { describe, expect, it } from "vitest"
import {
  inkCellId, inkCellMarkdown, inkFileName, isInkId, mediaFile, mediaFiles, pictureLine, pictureMarkdown,
} from "../src/markdown/images"

/**
 * The Mac's planned `WriteMind/Editor/MarkdownImages.swift` (C:\GIT\WriteMindSwift\docs\PLAN-docking.md, "The model"; not
 * built on the Mac yet), transcribed: `markdown(file:alt:)`, `picture(in: line)` (only a line that is nothing but the
 * image), `mediaFile(at: path)` (only the note's own media), `mediaFiles(in: markdown)` (what a sweep must keep).
 * Plus the port's own: `../` prefixes for notes in section folders and the ink cell's `ink-<uuid>.svg` name
 * (docs\PLAN-docking-ink-cells.md (a)).
 */

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"

describe("pictureLine: the picture a line IS", () => {
  it("is the line's alt words and path when the line is nothing but one image", () => {
    expect(pictureLine("![](.drawings/media/a1b2.jpg)")).toEqual({ alt: "", path: ".drawings/media/a1b2.jpg" })
    expect(pictureLine("![a cat](cat.png)")).toEqual({ alt: "a cat", path: "cat.png" })
    // Spaces either side are still nothing but the image.
    expect(pictureLine("   ![](x.png)  ")).toEqual({ alt: "", path: "x.png" })
  })

  it("is nothing when there are words round the image: that is a paragraph carrying a picture", () => {
    expect(pictureLine("before ![](x.png)")).toBeNull()
    expect(pictureLine("![](x.png) after")).toBeNull()
    expect(pictureLine("![a](x.png)![b](y.png)")).toBeNull()
    expect(pictureLine("- ![](x.png)")).toBeNull()
    expect(pictureLine("> ![](x.png)")).toBeNull()
  })

  it("is nothing for a link, an empty path, or something that only looks like one", () => {
    expect(pictureLine("[](x.png)")).toBeNull()
    expect(pictureLine("![]()")).toBeNull()
    expect(pictureLine("![](  )")).toBeNull()
    expect(pictureLine("![](x.png")).toBeNull()
    expect(pictureLine("")).toBeNull()
  })

  it("takes angle brackets and a title off the path", () => {
    expect(pictureLine("![](<my picture.png>)")?.path).toBe("my picture.png")
    expect(pictureLine(`![](x.png "a title")`)?.path).toBe("x.png")
    expect(pictureLine("![](x.png 'a title')")?.path).toBe("x.png")
  })
})

describe("mediaFile: the note's OWN media only", () => {
  it("is the basename of a path into .drawings/media, after any number of ../", () => {
    expect(mediaFile(".drawings/media/a1b2.jpg")).toBe("a1b2.jpg")
    expect(mediaFile("./.drawings/media/a1b2.jpg")).toBe("a1b2.jpg")
    expect(mediaFile("../.drawings/media/a1b2.jpg")).toBe("a1b2.jpg")
    expect(mediaFile("../../../.drawings/media/a1b2.jpg")).toBe("a1b2.jpg")
    expect(mediaFile("..\\.drawings\\media\\a1b2.jpg")).toBe("a1b2.jpg")
    expect(mediaFile(".drawings/media/a%20b.png")).toBe("a b.png")
  })

  it("is nothing for a picture that lives anywhere else", () => {
    expect(mediaFile("cat.png")).toBeNull()
    expect(mediaFile("pictures/cat.png")).toBeNull()
    expect(mediaFile("https://example.com/.drawings/media/a.jpg")).toBeNull()
    expect(mediaFile("/home/sean/.drawings/media/a.jpg")).toBeNull()
    expect(mediaFile("C:/notes/.drawings/media/a.jpg")).toBeNull()
    expect(mediaFile(".drawings/media/sub/a.jpg")).toBeNull()
    expect(mediaFile(".drawings/media/")).toBeNull()
    expect(mediaFile(".drawings/a.jpg")).toBeNull()
  })
})

describe("ink cells are known by their file name alone", () => {
  it("reads the id out of ink-<uuid>.svg", () => {
    expect(inkCellId(`ink-${ID}.svg`)).toBe(ID)
    expect(inkCellId(`ink-${ID.toUpperCase()}.SVG`)).toBe(ID)
    expect(inkFileName(ID)).toBe(`ink-${ID}.svg`)
    expect(isInkId(ID)).toBe(true)
  })

  it("is nothing for any other name", () => {
    expect(inkCellId(null)).toBeNull()
    expect(inkCellId("a1b2.jpg")).toBeNull()
    expect(inkCellId("ink-123.svg")).toBeNull()
    expect(inkCellId(`ink-${ID}.png`)).toBeNull()
    expect(inkCellId(`xink-${ID}.svg`)).toBeNull()
    expect(inkCellId(`ink-${ID}.svg.svg`)).toBeNull()
    expect(isInkId("../../evil")).toBe(false)
  })
})

describe("the lines docking writes", () => {
  it("writes a picture on a line of its own, naming the entry of the note's container (no ../ per section any more)", () => {
    expect(pictureMarkdown("a1b2.jpg")).toBe("![](media/a1b2.jpg)")
    expect(pictureMarkdown("a1b2.jpg", 2)).toBe("![](media/a1b2.jpg)")
    // Alt words that would end the brackets early, or the line, are not let through.
    expect(pictureMarkdown("a.jpg", 0, "a [cat]\non a mat")).toBe("![a cat on a mat](media/a.jpg)")
  })

  it("writes an ink cell's line, and both read back as what they were written for", () => {
    expect(inkCellMarkdown(ID)).toBe(`![ink](snapshots/ink-${ID}.svg)`)
    expect(inkCellMarkdown(ID, 1)).toBe(`![ink](snapshots/ink-${ID}.svg)`)
    for (const depth of [0, 1, 3]) {
      const ink = pictureLine(inkCellMarkdown(ID, depth))!
      expect(inkCellId(mediaFile(ink.path))).toBe(ID)
      const picture = pictureLine(pictureMarkdown("f00d.png", depth))!
      expect(mediaFile(picture.path)).toBe("f00d.png")
      expect(inkCellId(mediaFile(picture.path))).toBeNull()
    }
  })
})

describe("mediaFiles: what a media sweep must keep", () => {
  it("is every own media file the markdown points at, cells and inline pictures alike, each once", () => {
    const note = [
      "# Trip",
      "",
      "![](.drawings/media/aa.jpg)",
      "",
      `![ink](../.drawings/media/ink-${ID}.svg)`,
      "",
      "words with ![a](.drawings/media/bb.png) inside",
      "- a list ![](.drawings/media/cc.png)",
      "> ![](.drawings/media/dd.png)",
      "![](https://example.com/ee.png)",
      "![](elsewhere/ff.png)",
      "![](.drawings/media/aa.jpg)",
    ].join("\n")
    expect(mediaFiles(note)).toEqual(["aa.jpg", `ink-${ID}.svg`, "bb.png", "cc.png", "dd.png"])
    expect(mediaFiles("no pictures at all")).toEqual([])
  })
})
