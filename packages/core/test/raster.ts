/**
 * A tiny stand-in for the Core Graphics context the Swift tests draw into:
 * a white page, black round-capped strokes of a given width, thresholded
 * at 128 into a 0/1 ink mask with the origin at the top left.
 *
 * Not a test file: shared by flow.test.ts.
 */

export interface Pt { x: number; y: number }

export class Canvas {
  readonly data: Float32Array
  lineWidth = 3

  constructor(readonly width: number, readonly height: number) {
    this.data = new Float32Array(width * height).fill(255)
  }

  private stamp(cx: number, cy: number, radius: number): void {
    const r = Math.max(0.5, radius)
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.width - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.height - 1, Math.ceil(cy + r))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.data[y * this.width + x] = 0
      }
    }
  }

  line(a: Pt, b: Pt): void {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(length * 2))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      this.stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, this.lineWidth / 2)
    }
  }

  polyline(points: Pt[], closed = false): void {
    for (let i = 0; i + 1 < points.length; i++) this.line(points[i]!, points[i + 1]!)
    if (closed && points.length > 2) this.line(points[points.length - 1]!, points[0]!)
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true)
  }

  strokeEllipse(x: number, y: number, w: number, h: number): void {
    const points: Pt[] = []
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * 2 * Math.PI
      points.push({ x: x + w / 2 + (w / 2) * Math.cos(a), y: y + h / 2 + (h / 2) * Math.sin(a) })
    }
    this.polyline(points, true)
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.height, Math.ceil(y + h)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.width, Math.ceil(x + w)); xx++) {
        this.data[yy * this.width + xx] = 0
      }
    }
  }

  /** The page thresholded the way a photograph of it would be. */
  mask(): Uint8Array {
    const out = new Uint8Array(this.width * this.height)
    for (let i = 0; i < out.length; i++) out[i] = this.data[i]! < 128 ? 1 : 0
    return out
  }
}
