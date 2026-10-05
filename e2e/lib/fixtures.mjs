// Synthetic "camera" feeds for the camera e2e suites (Chromium's fake capture device plays a .y4m).
//   chart.y4m  - a flowchart drawn on white paper, filling the frame
//   tilted.y4m - a page seen in perspective on a mid-grey desk (a thick border and a cross on it)
//   moving.y4m - paper with some writing and a block that steps along the bottom (Hold image)
import fs from "node:fs"
import path from "node:path"
const W = 640, H = 480

class Gray {
  constructor(w, h, v) { this.w = w; this.h = h; this.d = new Uint8Array(w * h).fill(v) }
  rect(x, y, w, h, v) {
    for (let j = Math.max(0, Math.round(y)); j < Math.min(this.h, Math.round(y + h)); j++)
      for (let i = Math.max(0, Math.round(x)); i < Math.min(this.w, Math.round(x + w)); i++) this.d[j * this.w + i] = v
  }
  disc(cx, cy, r, v) {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++)
        if (i >= 0 && j >= 0 && i < this.w && j < this.h && (i - cx) ** 2 + (j - cy) ** 2 <= r * r) this.d[j * this.w + i] = v
  }
  line(x0, y0, x1, y1, t, v) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
    for (let k = 0; k <= n; k++) this.disc(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, t / 2, v)
  }
  box(x, y, w, h, t, v) { this.rect(x, y, w, t, v); this.rect(x, y + h - t, w, t, v); this.rect(x, y, t, h, v); this.rect(x + w - t, y, t, h, v) }
  tri(a, b, c, v) {
    const minX = Math.floor(Math.min(a.x, b.x, c.x)), maxX = Math.ceil(Math.max(a.x, b.x, c.x))
    const minY = Math.floor(Math.min(a.y, b.y, c.y)), maxY = Math.ceil(Math.max(a.y, b.y, c.y))
    const s = (p, q, r) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y)
    for (let j = minY; j <= maxY; j++) for (let i = minX; i <= maxX; i++) {
      const p = { x: i + 0.5, y: j + 0.5 }
      const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a)
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) this.d[j * this.w + i] = v
    }
  }
}
const arrow = (g, x0, y0, x1, y1) => {
  g.line(x0, y0, x1, y1, 4, 25)
  const ang = Math.atan2(y1 - y0, x1 - x0), L = 20
  g.tri({ x: x1, y: y1 }, { x: x1 - L * Math.cos(ang - 0.45), y: y1 - L * Math.sin(ang - 0.45) },
    { x: x1 - L * Math.cos(ang + 0.45), y: y1 - L * Math.sin(ang + 0.45) }, 25)
}

function y4m(file, gray) {
  const header = Buffer.from(`YUV4MPEG2 W${gray.w} H${gray.h} F10:1 Ip A1:1 C420jpeg\n`)
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Buffer.from(gray.d), Buffer.alloc((gray.w / 2) * (gray.h / 2) * 2, 128)])
  fs.writeFileSync(file, Buffer.concat([header, frame, frame, frame]))
}

/** moving.y4m: the block is at x = MOVING_X0 + k * MOVING_DX (frame pixels) in frame k, rows 380-440. */
export const MOVING_STEPS = 10, MOVING_X0 = 30, MOVING_DX = 56

function y4mFrames(file, grays, fps) {
  const { w, h } = grays[0]
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F${fps}:1 Ip A1:1 C420jpeg\n`)
  const chroma = Buffer.alloc((w / 2) * (h / 2) * 2, 128)
  fs.writeFileSync(file, Buffer.concat([header, ...grays.flatMap((g) => [Buffer.from("FRAME\n"), Buffer.from(g.d), chroma])]))
}

// 1. The flowchart: Start (rounded) -> Decision (diamond) -> Process, and Decision -> Other process.
/** Write chart.y4m, tilted.y4m and tilted-quad.json into `dir`; returns their paths. */
export function makeVideoFixtures(dir) {
fs.mkdirSync(dir, { recursive: true })
const out = { chart: path.join(dir, "chart.y4m"), tilted: path.join(dir, "tilted.y4m"), tiltedQuad: path.join(dir, "tilted-quad.json"), moving: path.join(dir, "moving.y4m") }
{
  const g = new Gray(W, H, 235)
  g.box(60, 40, 150, 70, 4, 25)               // top box
  g.box(60, 330, 150, 70, 4, 25)              // bottom-left box
  g.box(400, 185, 150, 70, 4, 25)             // right box
  arrow(g, 135, 114, 135, 326)                // top -> bottom-left
  arrow(g, 214, 75, 396, 218)                 // top -> right (diagonal; routed to right angles)

  y4m(out.chart, g)
}

// 2. A page in perspective: a thick border, a cross, and a corner mark so the orientation is known.
{
  const PW = 500, PH = 700   // page units, 5:7
  const page = (u, v) => {
    const x = u * PW, y = v * PH
    const border = (x > 40 && x < 460 && y > 40 && y < 660) && !(x > 58 && x < 442 && y > 58 && y < 642)
    const cross = (Math.abs(x - 250) < 5 && y > 40 && y < 660) || (Math.abs(y - 350) < 5 && x > 40 && x < 460)
    const mark = x > 70 && x < 130 && y > 70 && y < 130          // top-left blob
    return border || cross || mark ? 25 : 235
  }
  // The page's corners in the frame (y down) - what the "Straighten" corners must be dragged to.
  // A real pinhole camera (f = 520px, principal point at the frame centre) looking at a 5:7 page
  // tilted 38 degrees about the x axis and 14 about y: the quad a real phone would see.
  const project = (u, v) => {
    let X = (u - 0.5) * 500, Y = (v - 0.5) * 700, Z = 0
    const tx = 38 * Math.PI / 180, ty = 14 * Math.PI / 180
    let y2 = Y * Math.cos(tx) - Z * Math.sin(tx), z2 = Y * Math.sin(tx) + Z * Math.cos(tx); Y = y2; Z = z2
    let x2 = X * Math.cos(ty) + Z * Math.sin(ty); z2 = -X * Math.sin(ty) + Z * Math.cos(ty); X = x2; Z = z2
    Z += 1000
    return [W / 2 + 520 * X / Z, H / 2 + 20 + 520 * Y / Z]
  }
  const quad = { tl: project(0, 0), tr: project(1, 0), br: project(1, 1), bl: project(0, 1) }
  fs.writeFileSync(out.tiltedQuad, JSON.stringify(quad))
  // unit square -> quad (Heckbert), then invert
  const [x0, y0] = quad.tl, [x1, y1] = quad.tr, [x2, y2] = quad.br, [x3, y3] = quad.bl
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  const det = dx1 * dy2 - dx2 * dy1
  const gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det
  const m = [x1 - x0 + gg * x1, x3 - x0 + hh * x3, x0, y1 - y0 + gg * y1, y3 - y0 + hh * y3, y0, gg, hh, 1]
  const [a, b, c, d, e, f, g2, h2, i2] = m
  const A = e * i2 - f * h2, B = -(d * i2 - f * g2), C = d * h2 - e * g2
  const dt = a * A + b * B + c * C
  const inv = [A, -(b * i2 - c * h2), b * f - c * e, B, a * i2 - c * g2, -(a * f - c * d), C, -(a * h2 - b * g2), a * e - b * d].map((v) => v / dt)
  const g = new Gray(W, H, 140)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const w = inv[6] * (x + 0.5) + inv[7] * (y + 0.5) + inv[8]
    const u = (inv[0] * (x + 0.5) + inv[1] * (y + 0.5) + inv[2]) / w
    const v = (inv[3] * (x + 0.5) + inv[4] * (y + 0.5) + inv[5]) / w
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      // 3x3 supersample for smooth edges
      let s = 0
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const xx = x + (sx + 0.5) / 3, yy = y + (sy + 0.5) / 3
        const ww = inv[6] * xx + inv[7] * yy + inv[8]
        s += page((inv[0] * xx + inv[1] * yy + inv[2]) / ww, (inv[3] * xx + inv[4] * yy + inv[5]) / ww)
      }
      g.d[y * W + x] = Math.round(s / 9)
    }
  }
  y4m(out.tilted, g)
}

// 3. A feed that MOVES (for Hold image): paper with a word of strokes and a box, and a dark block that steps
//    along the bottom, one place a frame (MOVING_STEPS frames at 5 fps, looped). Where the block is says which frame it is.
{
  const frames = []
  for (let k = 0; k < MOVING_STEPS; k++) {
    const g = new Gray(W, H, 235)
    // A "word" of short pen strokes top left (no closed outline, so a Writing capture of it reads no chart), a box top right.
    g.line(80, 70, 105, 125, 4, 25); g.line(105, 125, 130, 70, 4, 25)
    g.line(150, 70, 150, 125, 4, 25); g.line(150, 97, 185, 97, 4, 25); g.line(185, 70, 185, 125, 4, 25)
    g.line(205, 125, 225, 70, 4, 25); g.line(225, 70, 245, 125, 4, 25)
    g.box(390, 60, 180, 90, 4, 25)
    g.rect(MOVING_X0 + k * MOVING_DX, 380, 40, 60, 20)
    frames.push(g)
  }
  y4mFrames(out.moving, frames, 5)
}
return out
}
