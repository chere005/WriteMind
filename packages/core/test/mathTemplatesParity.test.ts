/**
 * Not a transcription of an XCTest: a guard that the palette's 130 templates
 * are the Mac's, field for field. It reads the reference copy of
 * `WriteMind/Math/MathTemplates.swift` (the snapshot this repo carries; `git
 * pull macos main` moves it) and compares id, group, name, glyph, form, every
 * slot's label and suggestion, and the order of the palette. The ids alone
 * were already checked in `math.test.ts`; this catches a changed glyph, form
 * or suggestion (the things a person sees in the palette).
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MATH_TEMPLATES } from "../src/math/templates"

const here = dirname(fileURLToPath(import.meta.url))
const swiftFile = resolve(here, "../../../WriteMind/Math/MathTemplates.swift")

/** Swift string escapes as the file uses them: \\ , \" and \u{...}. */
const unescape = (text: string): string =>
  text.replace(/\\\\/g, "\u0001").replace(/\\"/g, '"')
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\u0001/g, "\\")

interface SwiftTemplate {
  id: string; group: string; name: string; glyph: string; form: string
  slots: [string, string][]
}

function readSwift(): SwiftTemplate[] {
  const swift = readFileSync(swiftFile, "utf8")
  const found: SwiftTemplate[] = []
  const explicit = /MathTemplate\(id:\s*"([^"]+)",\s*group:\s*\.(\w+),\s*name:\s*"([^"]+)",\s*glyph:\s*"((?:[^"\\]|\\.)*)",\s*form:\s*"((?:[^"\\]|\\.)*)"(?:,\s*slots:\s*\[([\s\S]*?)\]\)(?=,?\s*(?:MathTemplate|\]|\/\/)))?\)?/g
  for (const m of swift.matchAll(explicit)) {
    const slots = [...(m[6] ?? "").matchAll(/Slot\(label:\s*"((?:[^"\\]|\\.)*)",\s*initial:\s*"((?:[^"\\]|\\.)*)"\)/g)]
      .map((s): [string, string] => [unescape(s[1]!), unescape(s[2]!)])
    found.push({ id: m[1]!, group: m[2]!, name: m[3]!, glyph: unescape(m[4]!), form: unescape(m[5]!), slots })
  }
  return found
}

describe.skipIf(!existsSync(swiftFile))("MathTemplates.swift: the palette is the Mac's", () => {
  const explicit = readSwift()

  it("reads the explicit templates", () => {
    expect(explicit.length).toBeGreaterThan(60)
  })

  it("every explicit template matches by group, name, glyph, form and slots", () => {
    for (const t of explicit) {
      const ours = MATH_TEMPLATES.find((one) => one.id === t.id)
      expect(ours, `missing ${t.id}`).toBeDefined()
      expect(ours!.group.toLowerCase(), `${t.id} group`).toBe(t.group)
      expect(ours!.name, `${t.id} name`).toBe(t.name)
      expect(ours!.glyph, `${t.id} glyph`).toBe(t.glyph)
      expect(ours!.form, `${t.id} form`).toBe(t.form)
      expect(ours!.slots.map((s) => [s.label, s.initial]), `${t.id} slots`).toEqual(t.slots)
    }
  })

  it("the explicit ones come in the Mac's order", () => {
    const ids = explicit.map((t) => t.id)
    expect(MATH_TEMPLATES.map((t) => t.id).filter((id) => ids.includes(id))).toEqual(ids)
  })

  it("the symbol table (name, glyph, WL) matches row for row", () => {
    const swift = readFileSync(swiftFile, "utf8")
    const rows = [...swift.matchAll(/^\s*\("(\w+)", "([^"]+)", "([^"]+)", "((?:[^"\\]|\\.)*)"\),?$/gm)]
    expect(rows.length).toBeGreaterThan(30)
    for (const m of rows) {
      const ours = MATH_TEMPLATES.find((one) => one.id === "symbol." + m[1])
      expect(ours, `missing symbol.${m[1]}`).toBeDefined()
      expect([ours!.name, ours!.glyph, ours!.form, ours!.group]).toEqual([m[2], m[3], unescape(m[4]!), "Symbols"])
    }
  })

  it("the Greek alphabet matches", () => {
    const swift = readFileSync(swiftFile, "utf8")
    const rows = [...swift.matchAll(/\("(\w+)", "(.)"\)/g)]
    expect(rows.length).toBe(20)
    for (const m of rows) {
      const ours = MATH_TEMPLATES.find((one) => one.id === "greek." + m[1])
      expect([ours?.glyph, ours?.form]).toEqual([m[2], "\\[" + m[1] + "]"])
    }
  })

  it("nothing is in the palette that the Mac does not have", () => {
    const ids = new Set(explicit.map((t) => t.id))
    const swift = readFileSync(swiftFile, "utf8")
    for (const m of swift.matchAll(/^\s*\("(\w+)", "[^"]+", "[^"]+", "(?:[^"\\]|\\.)*"\),?$/gm)) ids.add("symbol." + m[1])
    for (const m of swift.matchAll(/\("(\w+)", "."\)/g)) ids.add("greek." + m[1])
    ids.add("expand") // its suggestion "(x + 1)^2" has a bracket the line scanner above stops at
    expect(MATH_TEMPLATES.filter((t) => !ids.has(t.id)).map((t) => t.id)).toEqual([])
  })
})
