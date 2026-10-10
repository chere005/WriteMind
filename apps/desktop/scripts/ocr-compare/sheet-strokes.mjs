// Pen strokes from a raster of text: the stand-in for "a person writing on the tablet" in the OCR comparison
// (sheet-capture.e2e.mjs). The text is drawn by make-pictures.swift in a handwriting-style font as black on white
// (`sheet-source.pgm`); this thins it to its centre lines (Zhang-Suen), cuts the thin lines into strokes at the ends and
// the crossings, and simplifies each to a few points. A SYNTHETIC HAND: the strokes of a font's skeleton, drawn one by
// one with the app's own e2e pen, are what the tablet sheet's picture holds - they are not how a person's pen moves.
// No dependencies.

import { readFileSync } from "node:fs"

export function readPgm(file) {
  const buffer = readFileSync(file)
  let at = 0
  const token = () => {
    while (/\s/.test(String.fromCharCode(buffer[at]))) at++
    let out = ""
    while (!/\s/.test(String.fromCharCode(buffer[at]))) out += String.fromCharCode(buffer[at++])
    return out
  }
  if (token() !== "P5") throw new Error("not a binary PGM")
  const width = Number(token()), height = Number(token())
  token()
  at++
  return { width, height, pixels: buffer.subarray(at, at + width * height) }
}

/** Zhang-Suen thinning of a boolean image (1 = ink), in place. */
export function thin(ink, width, height) {
  const at = (x, y) => y * width + x
  let changed = true
  while (changed) {
    changed = false
    for (const step of [0, 1]) {
      const kill = []
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (!ink[at(x, y)]) continue
          const p2 = ink[at(x, y - 1)], p3 = ink[at(x + 1, y - 1)], p4 = ink[at(x + 1, y)], p5 = ink[at(x + 1, y + 1)]
          const p6 = ink[at(x, y + 1)], p7 = ink[at(x - 1, y + 1)], p8 = ink[at(x - 1, y)], p9 = ink[at(x - 1, y - 1)]
          const around = [p2, p3, p4, p5, p6, p7, p8, p9]
          const neighbours = around.reduce((a, b) => a + b, 0)
          if (neighbours < 2 || neighbours > 6) continue
          let transitions = 0
          for (let i = 0; i < 8; i++) if (!around[i] && around[(i + 1) % 8]) transitions++
          if (transitions !== 1) continue
          if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue
          kill.push(at(x, y))
        }
      }
      for (const i of kill) ink[i] = 0
      if (kill.length > 0) changed = true
    }
  }
}

const OFFSETS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

/**
 * The thin lines as paths of [x, y]. A greedy walk: start at an end (a pixel with one neighbour), keep going to the
 * unvisited neighbour that bends least, stop when there is none; what is left (a branch off the way, a loop) starts
 * the next stroke from the pixel it hangs on, so a crossing is two strokes through it, as a pen would write it.
 */
export function paths(ink, width, height, shortest = 4) {
  const at = (x, y) => y * width + x
  const seen = new Uint8Array(width * height)
  const free = (i) => {
    const x = i % width, y = (i / width) | 0
    const out = []
    for (const [dx, dy] of OFFSETS) {
      const n = at(x + dx, y + dy)
      if (ink[n] && !seen[n]) out.push(n)
    }
    return out
  }
  const out = []
  const pixels = []
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (ink[at(x, y)]) pixels.push(at(x, y))
  const tracing = (first, hangsOn) => {
    const route = hangsOn === undefined ? [first] : [hangsOn, first]
    seen[first] = 1
    let current = first, heading = hangsOn === undefined ? null : [(first % width) - (hangsOn % width), ((first / width) | 0) - ((hangsOn / width) | 0)]
    for (;;) {
      const next = free(current)
      if (next.length === 0) break
      const x = current % width, y = (current / width) | 0
      let best = next[0], bestTurn = Infinity
      for (const n of next) {
        const d = [(n % width) - x, ((n / width) | 0) - y]
        const turn = heading ? Math.abs(Math.atan2(heading[0] * d[1] - heading[1] * d[0], heading[0] * d[0] + heading[1] * d[1])) : Math.hypot(...d)
        if (turn < bestTurn) { bestTurn = turn; best = n }
      }
      heading = [(best % width) - x, ((best / width) | 0) - y]
      seen[best] = 1; route.push(best); current = best
    }
    if (route.length >= shortest) out.push(route.map((i) => [i % width, (i / width) | 0]))
  }
  // ends first, then whatever is left (a loop, a branch)
  for (const i of pixels) if (!seen[i] && free(i).length <= 1 && (() => { const x = i % width, y = (i / width) | 0; return OFFSETS.filter(([dx, dy]) => ink[at(x + dx, y + dy)]).length === 1 })()) tracing(i)
  for (let again = 0; again < 8; again++) {
    for (const i of pixels) {
      if (seen[i]) continue
      const x = i % width, y = (i / width) | 0
      const hung = OFFSETS.map(([dx, dy]) => at(x + dx, y + dy)).find((n) => ink[n] && seen[n])
      tracing(i, hung)
    }
  }
  return out
}

/** Ramer-Douglas-Peucker. */
export function simplify(points, epsilon) {
  if (points.length < 3) return points
  const [x1, y1] = points[0], [x2, y2] = points.at(-1)
  const length = Math.hypot(x2 - x1, y2 - y1) || 1
  let worst = 0, index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs((y2 - y1) * points[i][0] - (x2 - x1) * points[i][1] + x2 * y1 - y2 * x1) / length
    if (d > worst) { worst = d; index = i }
  }
  if (worst <= epsilon) return [points[0], points.at(-1)]
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)]
}

/**
 * The strokes of a text raster, fitted into a box (x, y, w, h in the sheet's own pixels): [[x, y], ...] each, in
 * left-to-right order of where they start, so the sheet is written the way a hand goes.
 */
export function strokesFor(pgmFile, box, { epsilon = 2 } = {}) {
  const { width, height, pixels } = readPgm(pgmFile)
  const ink = new Uint8Array(width * height)
  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[y * width + x] < 128) {
    ink[y * width + x] = 1
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  thin(ink, width, height)
  const scale = Math.min(box.w / (maxX - minX + 1), box.h / (maxY - minY + 1))
  const place = ([x, y]) => [Math.round((box.x + (x - minX) * scale) * 10) / 10, Math.round((box.y + (y - minY) * scale) * 10) / 10]
  const rows = paths(ink, width, height).filter((route) => route.length >= 3)
  // reading order: lines top to bottom (a band as tall as the writing's x-height), then left to right
  const band = (maxY - minY) / 2
  rows.sort((a, b) => (Math.floor(a[0][1] / band) - Math.floor(b[0][1] / band)) || (a[0][0] - b[0][0]))
  return rows.map((route) => simplify(route, epsilon / Math.max(scale, 0.1)).map(place))
}
