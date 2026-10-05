import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  aspectOf, fitRect, SHEET_REF, strokeUnder, TabletPage, type InkStroke,
} from "../src/renderer/tabletPage"

describe("the sheet is fitted inside whatever holds it, never stretched", () => {
  it("fills a container of its own shape", () => {
    expect(fitRect({ width: 1920, height: 1080 }, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })
  it("letterboxes in a taller pane and pillarboxes in a wider one, centred", () => {
    const tall = fitRect({ width: 500, height: 900 }, 16 / 9)
    expect(tall.width).toBe(500)
    expect(tall.height).toBeCloseTo(281.25, 6)
    expect(tall.y).toBeCloseTo((900 - 281.25) / 2, 6)
    expect(tall.x).toBe(0)
    const wide = fitRect({ width: 2000, height: 500 }, 16 / 9)
    expect(wide.height).toBe(500)
    expect(wide.width).toBeCloseTo(888.888, 2)
    expect(wide.x).toBeCloseTo((2000 - 888.888) / 2, 2)
    expect(tall.width / tall.height).toBeCloseTo(16 / 9, 9)
  })
  it("survives an empty container", () => {
    expect(fitRect({ width: 0, height: 0 }, 16 / 9)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
  it("takes the screen's shape, and ignores a nonsense one", () => {
    expect(aspectOf(2560, 1440)).toBeCloseTo(16 / 9, 9)
    expect(aspectOf(0, 0)).toBeCloseTo(16 / 9, 9)
    expect(aspectOf(10000, 100, 1.5)).toBe(1.5)
  })
})

describe("the sheet is resolution-independent", () => {
  const stroke = (width: number): InkStroke => ({ colorHex: "#000", width, points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] })
  it("keeps the shape it was made with", () => {
    expect(new TabletPage(16 / 10).aspect).toBeCloseTo(1.6, 9)
    expect(new TabletPage(0).aspect).toBeCloseTo(16 / 9, 9)
  })
  it("a stroke's width is in reference units, so the eraser reaches the same distance at any size", () => {
    // 3 px on a 500 px sheet is 6 units; on a 2000 px sheet the same stroke is 12 px wide.
    const strokes = [stroke(3 * SHEET_REF / 500)]
    const at = (dy: number, width: number) =>
      strokeUnder(strokes, { x: 0.5, y: 0.5 + dy }, { width, height: width / (16 / 9) }, 0, width / SHEET_REF)
    for (const width of [500, 2000]) {
      expect(at(0.004, width)).toBe(0)
      expect(at(0.02, width)).toBe(-1)
    }
  })
})

describe("NOTHING in the app can enter full screen (Sean never asked for it)", () => {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src")
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx|html)$/.test(name) ? [full] : []
    })
  const BANNED = /setFullScreen\(\s*true|setSimpleFullScreen|kiosk\s*:\s*true|\bfullscreen\s*:\s*true|togglefullscreen|requestFullscreen|webkitRequestFullscreen|enterPad|PadMode|"pad:enter"|tabletPad/i
  it("no source file asks for full screen, kiosk, a pad mode, or a Toggle Full Screen role", () => {
    const hits: string[] = []
    for (const file of files(src)) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (BANNED.test(line)) hits.push(`${path.relative(src, file)}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })
})
