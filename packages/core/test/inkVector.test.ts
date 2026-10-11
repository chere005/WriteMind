import { describe, expect, it } from "vitest"
import { inkGraphicFill, inkOutlines, inkPathData, inkSvg, inkVector, recolouredInkSvg, type Point } from "../src/index"

/**
 * Transcribed from `WriteMindTests/InkVectorTests.swift`. The Mac writes a PDF
 * and rasterises it with Core Graphics to look at what it paints; here the
 * loops are written as an SVG path, and the test fills them even-odd itself.
 */

/** A square mask with ink inside `rect`, minus `hole` (both in pixels). */
function mask(size: number, rect: { x: number; y: number; width: number; height: number } | null,
  hole?: { x: number; y: number; width: number; height: number }): Uint8Array {
  const pixels = new Uint8Array(size * size)
  const inside = (r: { x: number; y: number; width: number; height: number }, px: number, py: number) =>
    px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!rect || !inside(rect, x + 0.5, y + 0.5)) continue
      if (hole && inside(hole, x + 0.5, y + 0.5)) continue
      pixels[y * size + x] = 1
    }
  }
  return pixels
}

const whole = { x: 0, y: 0, width: 12, height: 12 }

/** Even-odd fill of the loops, sampled at (x, y) in a picture `scale` times the mask: 0 or 255. */
function filled(loops: Point[][], x: number, y: number, scale: number): number {
  const px = (x + 0.5) / scale, py = (y + 0.5) / scale
  let crossings = 0
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!
      if ((a.y > py) !== (b.y > py) && px < a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)) crossings++
    }
  }
  return crossings % 2 === 1 ? 255 : 0
}

describe("tracing the writing into outlines", () => {
  it("a solid block traces to one rectangle", () => {
    const traced = inkOutlines(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, whole)
    expect(traced).toHaveLength(1)
    expect(traced[0]).toHaveLength(4)   // a rectangle needs four corners and no staircase
    const xs = traced[0]!.map((p) => p.x), ys = traced[0]!.map((p) => p.y)
    expect(Math.min(...xs)).toBe(3)
    expect(Math.max(...xs)).toBe(8)
    expect(Math.min(...ys)).toBe(4)
    expect(Math.max(...ys)).toBe(7)
  })

  it("a hole is traced as its own loop and stays empty", () => {
    const ring = mask(12, { x: 2, y: 2, width: 8, height: 8 }, { x: 4, y: 4, width: 4, height: 4 })
    const traced = inkOutlines(ring, 12, 12, whole)
    expect(traced).toHaveLength(2)   // the outside of the o and the inside of it
    expect(filled(traced, 3, 3, 1)).toBeGreaterThan(200)   // the ring is inked
    expect(filled(traced, 6, 6, 1)).toBeLessThan(40)       // the hole in the middle of it is not
  })

  it("nothing is traced from a blank page", () => {
    expect(inkOutlines(mask(12, null), 12, 12, whole)).toEqual([])
    expect(inkVector(mask(12, null), 12, 12, whole, "#000000")).toBeNull()
  })

  it("the staircase is thinned away", () => {
    // A diagonal stroke: one loop, and far fewer points than the hundreds of
    // unit steps its boundary is made of.
    const pixels = new Uint8Array(60 * 60)
    for (let i = 4; i < 56; i++) for (let w = 0; w < 3; w++) pixels[i * 60 + i + w] = 1
    const traced = inkOutlines(pixels, 60, 60, { x: 0, y: 0, width: 60, height: 60 })
    expect(traced).toHaveLength(1)
    expect(traced[0]!.length).toBeLessThan(40)   // a straight stroke is a few corners, not a staircase
    expect(traced[0]!.length).toBeGreaterThan(3)
  })

  it("the file is an SVG the size of the writing, in the pen's colour", () => {
    const svg = inkVector(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, whole, "#2d7dd2")
    expect(svg).not.toBeNull()
    expect(svg!.startsWith("<svg ")).toBe(true)
    expect(svg).toContain('width="12"')
    expect(svg).toContain('height="12"')
    expect(svg).toContain('viewBox="0 0 12 12"')
    expect(svg).toContain('fill="#2d7dd2"')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain("M3 4L8 4L8 7L3 7Z")
  })

  it("a part of the page is traced in the part's own pixels", () => {
    const traced = inkOutlines(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, { x: 2, y: 2, width: 8, height: 8 })
    const xs = traced[0]!.map((p) => p.x)
    expect(Math.min(...xs)).toBe(1)   // 3 - 2
    expect(Math.max(...xs)).toBe(6)
  })

  it("scales without going soft: eight times up the edge is still an edge", () => {
    const loops = inkOutlines(mask(12, { x: 3, y: 4, width: 5, height: 3 }), 12, 12, whole)
    const middle = 8 * 5 + 4
    expect(filled(loops, 8 * 3 + 4, middle, 8)).toBeGreaterThan(240)   // inside the stroke
    expect(filled(loops, 8 * 3 - 4, middle, 8)).toBeLessThan(15)       // outside it
    // A raster blown up eight times ramps across eight pixels; the outline is a step.
    const across: number[] = []
    for (let x = 8 * 3 - 4; x <= 8 * 3 + 4; x++) across.push(filled(loops, x, middle, 8))
    expect(across.filter((v) => v >= 16 && v < 240).length).toBeLessThanOrEqual(1)
  })

  it("writes path data and refuses an empty or colourless graphic", () => {
    expect(inkPathData([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]])).toBe("M0 0L4 0L4 4Z")
    expect(inkSvg([], { width: 10, height: 10 }, "#000000")).toBeNull()
    expect(inkSvg([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]], { width: 10, height: 10 }, "red"))
      .toContain('fill="#000000"')   // an unreadable colour is not written into the file
  })
})

/**
 * PORT-ONLY (Sean, 2026-10-10: "add a color picker for imported stroke graphics objects"): a capture's traced graphic can
 * be recoloured, and nothing else can. The file `inkSvg` writes is the only shape that counts as one.
 */
describe("recolouring a traced graphic", () => {
  const loops: Point[][] = [[{ x: 3, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 3, y: 7 }]]
  const traced = inkSvg(loops, { width: 12, height: 12 }, "#2D7DD2")!

  it("reads the fill of what inkSvg wrote, and writes it back in another colour, changing nothing else", () => {
    expect(inkGraphicFill(traced)).toBe("#2D7DD2")
    const red = recolouredInkSvg(traced, "#F2542D")!
    expect(red).toBe(traced.replace("#2D7DD2", "#F2542D"))
    expect(inkGraphicFill(red)).toBe("#F2542D")
    // The outline, the evenodd rule and the size are as they were; the colour is the only difference.
    expect(red).toContain('fill-rule="evenodd"')
    expect(red).toContain('d="M3 4L8 4L8 7L3 7Z"')
    expect(red).toContain('viewBox="0 0 12 12"')
    expect(recolouredInkSvg(red, "#2D7DD2")).toBe(traced)
  })

  it("takes the fill and no other attribute: fill-rule is not a fill", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><path fill-rule="evenodd" fill="#112233" d="M0 0L4 0L4 4Z"/></svg>'
    expect(recolouredInkSvg(svg, "#ffffff")).toBe(svg.replace("#112233", "#ffffff"))
  })

  it("reads another writer's spelling of the same graphic (single quotes, an end tag, a prolog, whitespace)", () => {
    const svg = `<?xml version="1.0"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'>\n  <path fill='#aabbcc' fill-rule='evenodd' d='M0 0L4 0L4 4Z'></path>\n</svg>\n`
    expect(inkGraphicFill(svg)).toBe("#aabbcc")
    // (the fill is written in the file's own way, double-quoted; everything else is as it was)
    expect(recolouredInkSvg(svg, "#000000")).toBe(svg.replace("fill='#aabbcc'", 'fill="#000000"'))
  })

  it("a graphic that has other fills in it is not one: a second path, a rect, a group, a style, a gradient", () => {
    const head = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">'
    const path = '<path fill="#000000" fill-rule="evenodd" d="M0 0L4 0L4 4Z"/>'
    const others = [
      `${head}${path}<path fill="#ff0000" d="M5 5L9 5L9 9Z"/></svg>`,
      `${head}<rect width="10" height="10" fill="#ffffff"/>${path}</svg>`,
      `${head}<g fill="#00ff00">${path}</g></svg>`,
      `${head}<style>path{fill:red}</style>${path}</svg>`,
      `${head}<defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path fill="#000000" stroke="#ff0000" d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path fill="#000000" style="fill:#ff0000" d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path fill="#000000" opacity="0.5" d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path fill="red" d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path fill="#000" d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path d="M0 0L4 0L4 4Z"/></svg>`,
      `${head}<path fill="#000000"/></svg>`,
      `${head}<path fill="#000000" fill="#ffffff" d="M0 0L4 0L4 4Z"/></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="#ffffff"><path fill="#000000" d="M0 0L4 0L4 4Z"/></svg>`,
    ]
    for (const svg of others) {
      expect(inkGraphicFill(svg), svg).toBeNull()
      expect(recolouredInkSvg(svg, "#123456"), svg).toBeNull()
    }
  })

  it("something that is not an SVG of paths is not one: a photo's bytes, a PNG, a script, empty, a half file", () => {
    const head = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
    for (const text of ["", "\u0089PNG\r\n\u001a\n", "\u00ff\u00d8\u00ff\u00e0 JFIF", "not svg at all", `${head}<script>alert(1)</script></svg>`,
      traced.slice(0, traced.length - 8), `${traced}<!-- more -->`, `<html>${traced}</html>`,
      `${head}<path fill="#000000" d="M0 0 alert(1)"/></svg>`]) {
      expect(inkGraphicFill(text), text).toBeNull()
      expect(recolouredInkSvg(text, "#123456"), text).toBeNull()
    }
  })

  it("a colour that is not #rrggbb is refused, and never written into the file", () => {
    for (const bad of ["", "red", "#12", "#1234", "#12345", "#1234567", "123456", "#gggggg", "rgb(1,2,3)", 'url(#x)', '#000000" onload="x', "#000000 "]) {
      expect(recolouredInkSvg(traced, bad), bad).toBeNull()
    }
    expect(recolouredInkSvg(traced, "#abcdef")).toContain('fill="#abcdef"')
    expect(recolouredInkSvg(traced, "#ABCDEF")).toContain('fill="#ABCDEF"')
  })
})
