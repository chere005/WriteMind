// REAL HANDWRITING for the scripts that read ink: the red felt-tip lines of the OCR fixture ("The quick brown fox / jumps over the lazy
// dog. / 0123456789", apps/desktop/test/fixtures/ocr-handwriting.png), thinned to one-pixel lines and traced into polylines, one per pen
// stroke. A stick-letter drawing is not what the reader is for (it finds nothing in one); this is a person's writing.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, "../../apps/desktop/test/fixtures/ocr-handwriting.png")

/** The red writing's rows in the fixture: three lines, at about y = 385, 450 and 520. */
export const RED = { top: 350, bottom: 570, firstLine: [350, 415], secondLine: [415, 480], thirdLine: [480, 570] }

/**
 * The traced strokes of the fixture's rows [y0, y1): an array of polylines, each an array of [x, y] in the fixture's own pixels
 * (701 wide), thinned and thinned to every third point.
 * @param {(expression: string) => Promise<any>} js the harness's evaluator
 */
export async function traceHandwriting(js, y0 = RED.top, y1 = RED.bottom) {
  const png = fs.readFileSync(FIXTURE).toString("base64")
  return js(`(async (b64, Y0, Y1) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const W = img.naturalWidth, H = Y1 - Y0
    const c = document.createElement('canvas'); c.width = W; c.height = img.naturalHeight; const cx = c.getContext('2d'); cx.drawImage(img, 0, 0)
    const px = cx.getImageData(0, Y0, W, H).data
    const g = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) { const r = px[4 * i], gr = px[4 * i + 1], b = px[4 * i + 2]; g[i] = r > 170 && gr < 120 && b < 140 ? 1 : 0 }
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : g[y * W + x])
    for (let changed = true; changed;) {
      changed = false
      for (let pass = 0; pass < 2; pass++) {
        const del = []
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          if (!g[y * W + x]) continue
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
          const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (n < 2 || n > 6) continue
          const q = [p2, p3, p4, p5, p6, p7, p8, p9, p2]; let a = 0
          for (let k = 0; k < 8; k++) if (q[k] === 0 && q[k + 1] === 1) a++
          if (a !== 1) continue
          if (pass === 0 ? (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) : (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0)) continue
          del.push(y * W + x)
        }
        for (const i of del) { g[i] = 0; changed = true }
      }
    }
    const D = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
    const seen = new Uint8Array(W * H), chains = []
    const nb = (x, y) => D.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => at(a, b) && !seen[b * W + a])
    const ends = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) && D.filter(([dx, dy]) => at(x + dx, y + dy)).length === 1) ends.push([x, y])
    const walk = (sx, sy) => { const chain = [[sx, sy]]; seen[sy * W + sx] = 1; let [x, y] = [sx, sy]
      for (;;) { const next = nb(x, y); if (!next.length) break; [x, y] = next[0]; seen[y * W + x] = 1; chain.push([x, y]) } return chain }
    for (const [x, y] of ends) if (!seen[y * W + x]) chains.push(walk(x, y))
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) && !seen[y * W + x]) chains.push(walk(x, y))
    return chains.filter((ch) => ch.length >= 6).map((ch) => ch.filter((_, i) => i % 3 === 0 || i === ch.length - 1).map(([x, y]) => [x, y + Y0]))
  })(${JSON.stringify(png)}, ${y0}, ${y1})`)
}
