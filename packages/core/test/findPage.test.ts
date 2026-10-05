import { describe, expect, it } from "vitest"
import { findPage, type PageCorners } from "../src/index"
import { distance, notebook, project, random, render, W, H, wood, type Corners4, type RGB, type Scene } from "./scene"

/**
 * No Swift original: the Mac asks Vision for the page (`NotebookCapture.pageQuad`), which is Apple's. These are photographs
 * made BY a pinhole camera looking at a dotted notebook page on a desk (`scene.ts`) — with the things that make a real desk
 * hard (shadow gradients, wood grain, a pen across the edge, writing on the page, clutter near the page) — and the finder has to
 * put the four corners back where the projection put them.
 */

/** Worst distance from a found corner to the true one, as a fraction of the frame's diagonal. */
function error(found: PageCorners, truth: Corners4): number {
  const diagonal = Math.hypot(W, H)
  return Math.max(
    distance(found.topLeft, truth.tl), distance(found.topRight, truth.tr),
    distance(found.bottomRight, truth.br), distance(found.bottomLeft, truth.bl)) / diagonal
}

describe("finding the page in the frame", () => {
  it("finds a tilted dotted page on a wooden desk", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 38, tiltY: 14, distance: 1000, f: 520, shiftY: 10 })
    const pixels = render({ W, H, page: notebook(), desk: wood(W, H) }, truth)
    const found = findPage(pixels, W, H)
    expect(found).not.toBeNull()
    expect(error(found!.corners, truth)).toBeLessThan(0.01)
    expect(found!.coverage).toBeGreaterThan(0.2)
    expect(found!.coverage).toBeLessThan(0.9)
  })

  it("names the corners by where they are in the picture", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 25, tiltY: -18, distance: 1100, f: 520 })
    const found = findPage(render({ W, H, page: notebook(), desk: wood(W, H) }, truth), W, H)!
    const { topLeft, topRight, bottomRight, bottomLeft } = found.corners
    expect(topLeft.x).toBeLessThan(topRight.x)
    expect(bottomLeft.x).toBeLessThan(bottomRight.x)
    expect(topLeft.y).toBeLessThan(bottomLeft.y)
    expect(topRight.y).toBeLessThan(bottomRight.y)
  })

  it("is not fooled by a shadow across half the page, nor by a pen lying over its edge", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 30, tiltY: 10, distance: 1000, f: 520, shiftY: 5 })
    const scene: Scene = {
      W, H, page: notebook(), desk: wood(W, H),
      over: (x, y, rgb) => {
        // A soft shadow over the right 40 % of the frame.
        const shade = x > 380 ? Math.max(0.55, 1 - (x - 380) / 300) : 1
        let out: RGB = [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade]
        // A pen lying across the page's bottom-left edge: a thick dark bar.
        const along = (x - 120) * 0.97 + (y - 400) * 0.25, across = -(x - 120) * 0.25 + (y - 400) * 0.97
        if (Math.abs(across) < 6 && along > 0 && along < 220) out = [25, 25, 30]
        return out
      },
    }
    const found = findPage(render(scene, truth), W, H)
    expect(found).not.toBeNull()
    expect(error(found!.corners, truth)).toBeLessThan(0.02)
  })

  it("finds a page lying on a bright, cluttered desk", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 20, tiltY: -8, distance: 1000, f: 520 })
    const scene: Scene = {
      W, H, page: notebook(), desk: wood(W, H),
      over: (x, y, rgb) => {
        // A mug (a dark disc) and a paperclip tray (a dark rectangle) near, but not on, the page.
        if (Math.hypot(x - 60, y - 70) < 32) return [40, 60, 90]
        if (x > 560 && x < 620 && y > 380 && y < 450) return [50, 50, 55]
        // A white eraser well away from the page: bright, small, separate.
        if (x > 20 && x < 50 && y > 420 && y < 440) return [235, 235, 230]
        return rgb
      },
    }
    const found = findPage(render(scene, truth), W, H)
    expect(found).not.toBeNull()
    expect(error(found!.corners, truth)).toBeLessThan(0.015)
  })

  it("finds a page turned a long way round (landscape on the desk)", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 30, tiltY: 0, roll: 80, distance: 1150, f: 520 })
    const found = findPage(render({ W, H, page: notebook(), desk: wood(W, H) }, truth), W, H)
    expect(found).not.toBeNull()
    const corners = [truth.tl, truth.tr, truth.br, truth.bl]
    // Whichever way round the corners are called, each real corner has a found one beside it.
    const list = [found!.corners.topLeft, found!.corners.topRight, found!.corners.bottomRight, found!.corners.bottomLeft]
    for (const corner of corners) {
      expect(Math.min(...list.map((one) => distance(one, corner))) / Math.hypot(W, H)).toBeLessThan(0.015)
    }
  })

  it("finds a page that runs off the edge of the frame", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 20, tiltY: 5, distance: 780, f: 520 })
    const found = findPage(render({ W, H, page: notebook(), desk: wood(W, H) }, truth), W, H)
    expect(found).not.toBeNull()
    // The edges still on screen are found; the corners that are off it are put on the frame's edge.
    expect(found!.coverage).toBeGreaterThan(0.4)
  })

  it("finds a pale page on a pale desk by its edges (a thin shadow line is all there is)", () => {
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 22, tiltY: 9, distance: 1000, f: 520 })
    const scene: Scene = {
      W, H,
      // A page that is only a little brighter than the desk, with a darker border line where its edge shades.
      page: (u, v) => {
        const edge = Math.min(u, 1 - u, v, 1 - v)
        return edge < 0.006 ? [150, 150, 148] : notebook(false)(u, v)
      },
      desk: () => [235, 232, 221],
    }
    const found = findPage(render(scene, truth), W, H)
    expect(found).not.toBeNull()
    expect(found!.method).toBe("lines")
    expect(error(found!.corners, truth)).toBeLessThan(0.02)
  })

  it("gives nothing for a desk with no page on it", () => {
    const scene: Scene = {
      W, H, page: notebook(), desk: wood(W, H),
      over: (x, y, rgb) => (Math.hypot(x - 300, y - 200) < 40 ? [200, 200, 200] : rgb),
    }
    // A page placed completely out of the frame.
    const truth = project(W, H, { pageW: 500, pageH: 700, tiltX: 20, tiltY: 0, distance: 1000, f: 520, shiftX: 2000 })
    expect(findPage(render(scene, truth), W, H)).toBeNull()
  })

  it("gives nothing for noise", () => {
    const noise = random(7)
    const pixels = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      const v = 100 + noise() * 60
      pixels[i * 4] = v; pixels[i * 4 + 1] = v; pixels[i * 4 + 2] = v; pixels[i * 4 + 3] = 255
    }
    expect(findPage(pixels, W, H)).toBeNull()
  })

  it("says when the page IS the frame (so the caller can tell nothing was found)", () => {
    const truth: Corners4 = { tl: { x: -5, y: -5 }, tr: { x: W + 5, y: -5 }, br: { x: W + 5, y: H + 5 }, bl: { x: -5, y: H + 5 } }
    const found = findPage(render({ W, H, page: notebook(), desk: wood(W, H) }, truth), W, H)
    if (found) expect(found.coverage).toBeGreaterThan(0.95)
  })

  it("lands within a pixel or two on a clean, large view", () => {
    const truth = project(1280, 720, { pageW: 500, pageH: 700, tiltX: 35, tiltY: 12, distance: 1500, f: 900 })
    const scene: Scene = { W: 1280, H: 720, page: notebook(), desk: wood(1280, 720), noise: 2 }
    const found = findPage(render(scene, truth), 1280, 720)!
    expect(found).not.toBeNull()
    const worst = Math.max(
      distance(found.corners.topLeft, truth.tl), distance(found.corners.topRight, truth.tr),
      distance(found.corners.bottomRight, truth.br), distance(found.corners.bottomLeft, truth.bl))
    expect(worst).toBeLessThan(8)
  })

  it("is quick enough to run when a button is pressed", () => {
    const truth = project(1280, 720, { pageW: 500, pageH: 700, tiltX: 35, tiltY: 12, distance: 1500, f: 900 })
    const pixels = render({ W: 1280, H: 720, page: notebook(), desk: wood(1280, 720) }, truth)
    const start = performance.now()
    findPage(pixels, 1280, 720)
    expect(performance.now() - start).toBeLessThan(800)
  })
})

describe("finding the page, whatever the angle and the desk", () => {
  it("puts all four corners within 1.5% of the frame's diagonal over a sweep of random views", () => {
    const next = random(99)
    let tried = 0
    const failures: string[] = []
    for (let i = 0; i < 40; i++) {
      const tiltX = 10 + next() * 40, tiltY = (next() - 0.5) * 50
      const roll = (next() - 0.5) * 60 + (next() < 0.25 ? 90 : 0)
      const away = 950 + next() * 350, shiftX = (next() - 0.5) * 120, shiftY = (next() - 0.5) * 80
      const truth = project(W, H, { pageW: 500, pageH: 700, tiltX, tiltY, roll, distance: away, f: 520, shiftX, shiftY })
      const light = next() < 0.5
      const writing = next() < 0.7
      const scene: Scene = {
        W, H, seed: i + 1, noise: 4, page: notebook(writing),
        // A pale, striped, shaded desk is the hard one: the paper is only a step brighter than it.
        desk: light ? (x, y) => [190 - x / 20 + Math.sin(y * 0.3) * 8, 170 - x / 20, 150] : wood(W, H),
        over: (x, _y, rgb) => {
          const shade = 1 - 0.15 * Math.max(0, (x - 350) / 290)
          return [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade]
        },
      }
      const corners = [truth.tl, truth.tr, truth.br, truth.bl]
      if (!corners.every((p) => p.x > 2 && p.x < W - 2 && p.y > 2 && p.y < H - 2)) continue
      tried++
      const found = findPage(render(scene, truth), W, H)
      const tag = `#${i} tilt ${tiltX.toFixed(0)}/${tiltY.toFixed(0)} roll ${roll.toFixed(0)} ${light ? "pale" : "wood"}`
      if (!found) { failures.push(`${tag}: nothing`); continue }
      const list = [found.corners.topLeft, found.corners.topRight, found.corners.bottomRight, found.corners.bottomLeft]
      const worst = Math.max(...corners.map((c) => Math.min(...list.map((o) => distance(o, c))))) / Math.hypot(W, H)
      if (worst > 0.015) failures.push(`${tag}: ${(worst * 100).toFixed(1)}% off by ${found.method}`)
    }
    expect(tried).toBeGreaterThan(25)
    expect(failures).toEqual([])
  }, 60000)
})

describe("finding the page through a real camera's faults", () => {
  /** A box blur: a camera that is a little out of focus, or moving. */
  function blurred(pixels: Uint8ClampedArray, radius: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(pixels.length)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        sum += pixels[(yy * W + xx) * 4 + c]!
        count++
      }
      out[(y * W + x) * 4 + c] = sum / count
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255
    return out
  }

  it("a vignette, a glare, a bright sheet beside the page, heavy noise and an out-of-focus lens: all four corners within 2%", () => {
    const faults: Record<string, Scene["over"]> = {
      "vignette (the corners of the lens are dark)": (x, y, rgb) => {
        const d = Math.hypot((x - 320) / 320, (y - 240) / 240) / 1.41, f = 1 - 0.45 * d * d
        return [rgb[0] * f, rgb[1] * f, rgb[2] * f]
      },
      "glare (a lamp's reflection on the paper)": (x, y, rgb) => {
        const g = Math.max(0, 1 - Math.hypot(x - 330, y - 200) / 70) * 60
        return [rgb[0] + g, rgb[1] + g, rgb[2] + g]
      },
      "a second, bright sheet lying beside the page": (x, y, rgb) => (x > 20 && x < 110 && y > 300 && y < 460 ? [232, 230, 225] : rgb),
      "plain, but blurred and noisy": (_x, _y, rgb) => rgb,
    }
    const failures: string[] = []
    for (const [name, over] of Object.entries(faults)) {
      const next = random(7)
      let tried = 0, good = 0
      for (let i = 0; i < 5; i++) {
        const truth = project(W, H, {
          pageW: 500, pageH: 700, tiltX: 12 + next() * 36, tiltY: (next() - 0.5) * 40, roll: (next() - 0.5) * 50,
          distance: 1000 + next() * 250, f: 520, shiftX: (next() - 0.5) * 80, shiftY: (next() - 0.5) * 50,
        })
        const corners = [truth.tl, truth.tr, truth.br, truth.bl]
        if (!corners.every((p) => p.x > 2 && p.x < W - 2 && p.y > 2 && p.y < H - 2)) continue
        tried++
        const scene: Scene = { W, H, seed: i + 3, noise: 14, page: notebook(true), desk: () => [150, 148, 142], over }
        const found = findPage(blurred(render(scene, truth), 2), W, H)
        if (!found) continue
        const list = [found.corners.topLeft, found.corners.topRight, found.corners.bottomRight, found.corners.bottomLeft]
        const worst = Math.max(...corners.map((c) => Math.min(...list.map((o) => distance(o, c))))) / Math.hypot(W, H)
        if (worst <= 0.02) good++
      }
      if (good < tried) failures.push(`${name}: ${good} of ${tried}`)
    }
    expect(failures).toEqual([])
  }, 60000)
})
