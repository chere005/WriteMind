/**
 * Ink graphics (renderer/inkGraphics.ts; Sean, 2026-10-10: "add a color picker for imported stroke graphics objects"):
 * a picture is asked about ONCE and the answer is kept by its file name; a photo is never read; a recolour saves a NEW
 * picture and leaves the old one where Undo can find it. PORT-ONLY.
 */

import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { inkGraphicFill, inkSvg } from "@writemind/core"
import { InkGraphics, type InkDeps } from "../src/renderer/inkGraphics"

const traced = (colour: string) => inkSvg([[{ x: 3, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 3, y: 7 }]], { width: 12, height: 12 }, colour)!
const nameOf = (bytes: Uint8Array, extension: string) => `${createHash("sha1").update(bytes).digest("hex").slice(0, 16)}${extension}`

/** A note's media as the shell holds it: files by name, named by their contents, and a log of what was asked. */
function shell(files: Record<string, string>) {
  const held = new Map(Object.entries(files))
  const log = { reads: [] as string[], saves: [] as { extension: string; note: string | null }[] }
  const deps: InkDeps = {
    readText: async (file) => { log.reads.push(file); return held.get(file) ?? null },
    save: async (bytes, extension, note) => {
      log.saves.push({ extension, note })
      const name = nameOf(bytes, extension)
      held.set(name, new TextDecoder().decode(bytes))
      return { file: name }
    },
  }
  return { deps, held, log }
}

describe("which pictures are ink graphics", () => {
  it("reads a picture once and keeps the answer by its file name", async () => {
    const s = shell({ "a.svg": traced("#2D7DD2") })
    const ink = new InkGraphics(() => s.deps)
    expect(ink.fill("a.svg")).toBeUndefined()
    expect(await ink.read("a.svg", "n.wm")).toBe("#2D7DD2")
    expect(ink.fill("a.svg")).toBe("#2D7DD2")
    expect(await ink.read("a.svg", "n.wm")).toBe("#2D7DD2")
    expect(s.log.reads).toEqual(["a.svg"])
  })

  it("asks at once from several places, and the shell is asked once", async () => {
    const s = shell({ "a.svg": traced("#000000") })
    const ink = new InkGraphics(() => s.deps)
    const answers = await Promise.all([ink.read("a.svg", null), ink.read("a.svg", null), ink.read("a.svg", null)])
    expect(answers).toEqual(["#000000", "#000000", "#000000"])
    expect(s.log.reads).toEqual(["a.svg"])
  })

  it("a photo, a PNG or any file that is not an SVG is never read: it is not one", async () => {
    const s = shell({ "p.png": "x", "q.jpg": "x", "r.gif": "x" })
    const ink = new InkGraphics(() => s.deps)
    for (const file of ["p.png", "q.jpg", "r.gif", "s.webp"]) {
      expect(ink.fill(file)).toBeNull()
      expect(await ink.read(file, null)).toBeNull()
    }
    expect(s.log.reads).toEqual([])
  })

  it("an SVG that is not a traced graphic (a logo, a chart, several fills) is read once and is not one", async () => {
    const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/><circle r="3" fill="#00ff00"/></svg>'
    const twoPaths = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path fill="#000000" d="M0 0L4 0L4 4Z"/><path fill="#ff0000" d="M5 5L9 5L9 9Z"/></svg>'
    const s = shell({ "logo.svg": logo, "two.svg": twoPaths })
    const ink = new InkGraphics(() => s.deps)
    expect(await ink.read("logo.svg", null)).toBeNull()
    expect(await ink.read("two.svg", null)).toBeNull()
    expect(ink.fill("logo.svg")).toBeNull()
    expect(await ink.read("logo.svg", null)).toBeNull()
    expect(s.log.reads).toEqual(["logo.svg", "two.svg"])
  })

  it("a picture the shell cannot find yet is not remembered as 'not one': the next ask tries again", async () => {
    const s = shell({})
    const ink = new InkGraphics(() => s.deps)
    expect(await ink.read("late.svg", "n.wm")).toBeNull()
    expect(ink.fill("late.svg")).toBeUndefined()
    s.held.set("late.svg", traced("#F5B700"))
    expect(await ink.read("late.svg", "n.wm")).toBe("#F5B700")
    expect(s.log.reads).toEqual(["late.svg", "late.svg"])
    // ...and a shell that throws is the same as not finding it
    const broken = new InkGraphics(() => ({ readText: async () => { throw new Error("gone") }, save: async () => ({ file: "x" }) }))
    expect(await broken.read("a.svg", null)).toBeNull()
    expect(broken.fill("a.svg")).toBeUndefined()
  })
})

describe("recolouring a picture that is one", () => {
  it("saves the graphic in the new colour as a new picture of the note, and that picture is known", async () => {
    const before = traced("#2D7DD2")
    const s = shell({ "a.svg": before })
    const ink = new InkGraphics(() => s.deps)
    const file = await ink.recolour("a.svg", "#F2542D", "/notes/n.wm")
    expect(file).not.toBeNull()
    expect(file).not.toBe("a.svg")
    expect(file).toMatch(/^[0-9a-f]{16}\.svg$/)
    expect(s.log.saves).toEqual([{ extension: ".svg", note: "/notes/n.wm" }])
    // The old picture is as it was (Undo goes back to it); the new one is the same graphic in the new fill.
    expect(s.held.get("a.svg")).toBe(before)
    const after = s.held.get(file!)!
    expect(inkGraphicFill(after)).toBe("#F2542D")
    expect(after).toBe(before.replace("#2D7DD2", "#F2542D"))
    expect(ink.fill(file!)).toBe("#F2542D")
    expect(ink.fill("a.svg")).toBe("#2D7DD2")
  })

  it("the same colour is the picture it was: the name is the contents", async () => {
    const same = nameOf(new TextEncoder().encode(traced("#2D7DD2")), ".svg")
    const s = shell({ [same]: traced("#2D7DD2") })
    const ink = new InkGraphics(() => s.deps)
    expect(await ink.recolour(same, "#2D7DD2", null)).toBe(same)
  })

  it("saves NOTHING for a picture that is not an ink graphic: a photo, another SVG, one with other fills", async () => {
    const other = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>'
    const s = shell({ "logo.svg": other, "p.png": "bytes" })
    const ink = new InkGraphics(() => s.deps)
    expect(await ink.recolour("logo.svg", "#000000", null)).toBeNull()
    expect(await ink.recolour("p.png", "#000000", null)).toBeNull()
    expect(await ink.recolour("missing.svg", "#000000", null)).toBeNull()
    expect(s.log.saves).toEqual([])
    expect(ink.fill("logo.svg")).toBeNull()
  })

  it("saves nothing for a colour that is not #rrggbb", async () => {
    const s = shell({ "a.svg": traced("#2D7DD2") })
    const ink = new InkGraphics(() => s.deps)
    for (const bad of ["red", "#12", "", "#gggggg", 'x" onload="y']) expect(await ink.recolour("a.svg", bad, null)).toBeNull()
    expect(s.log.saves).toEqual([])
  })
})
