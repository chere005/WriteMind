/**
 * What File ▸ Language Setup… shows, row by row (src/renderer/languageSetupView.ts): every state's exact words and
 * which buttons each state has. Pure: a report and a row's memory in, a row out. Port-only.
 */
import { describe, expect, it } from "vitest"
import { EVALUATORS, type Evaluator, type ToolEntry } from "@writemind/core"
import {
  GET_LINE, INSTALL_PYTHON_LINE, INSTALL_WOLFRAM_LINE, moreOpen, NO_MEMORY, NOT_ACTIVATED, rowView, type RowMemory, type SetupCaps,
} from "../src/renderer/languageSetupView"
import type { LanguageReport } from "../src/shared/languages"

const MAC: SetupCaps = { installsLanguages: false, activatesWolfram: false }
const WINDOWS: SetupCaps = { installsLanguages: true, activatesWolfram: true }

function report(tools: Partial<Record<Evaluator, ToolEntry>> = {}, more: Partial<LanguageReport> = {}): LanguageReport {
  const all = {} as LanguageReport["tools"]
  const others = {} as LanguageReport["others"]
  for (const evaluator of EVALUATORS) {
    all[evaluator] = tools[evaluator] ?? { path: null, looked: [`${evaluator} on the PATH`] }
    others[evaluator] = []
  }
  return { tools: all, others, licence: null, setup: { running: null, last: null }, ...more }
}
const found = (path: string): ToolEntry => ({ path, looked: ["x"] })
const chosen = (path: string, problem: "gone" | "notAProgram" | null = null): ToolEntry =>
  ({ path: problem ? null : path, looked: [`${path} (chosen in Language Setup)`], chosen: { path, problem } })

describe("a row's words", () => {
  it("found, chosen, a choice that has gone or is not a program any more, and nothing found", () => {
    const python = rowView("python", report({ python: found("/usr/bin/python3") }), NO_MEMORY, MAC)
    expect(python).toMatchObject({ title: "Python", names: "py, python3 or python", path: "/usr/bin/python3", state: "found",
      source: "Found automatically.", amber: false, alert: false })
    expect(rowView("python", report({ python: chosen("/v/bin/python3") }), NO_MEMORY, MAC))
      .toMatchObject({ path: "/v/bin/python3", state: "chosen", source: "Chosen by you.", amber: false })
    expect(rowView("python", report({ python: chosen("/v/bin/python3", "gone") }), NO_MEMORY, MAC)).toMatchObject({
      path: null, state: "chosenUnusable", amber: true, alert: true,
      source: "The program you chose is not there any more: /v/bin/python3. Python cells will not run until you choose another or press Find Automatically.",
    })
    expect(rowView("wolfram", report({ wolfram: chosen("/x/wolframscript", "notAProgram") }), NO_MEMORY, MAC).source).toBe(
      "The program you chose is not a program WriteMind can start any more: /x/wolframscript. Wolfram cells will not run until you choose another or press Find Automatically.")
    const missing = rowView("rust", report({ rust: { path: null, looked: ["rustc on the PATH", "/Users/s/.cargo/bin/rustc"] } }), NO_MEMORY, MAC)
    expect(missing).toMatchObject({ state: "notFound", amber: true, alert: false, title: "Rust", names: "rustc",
      source: "Not found. WriteMind looked for rustc on the PATH, /Users/s/.cargo/bin/rustc." })
    expect(rowView("c", report(), NO_MEMORY, MAC).names).toBe("gcc, clang or cl")
  })

  it("the check line: checking, testing (Wolfram warns the engine is slow to start), works, did not work with its command", () => {
    const at = (memory: RowMemory, evaluator: Evaluator = "python") =>
      rowView(evaluator, report({ [evaluator]: found("/p") }), memory, MAC)
    expect(at({ check: { kind: "identifying" }, problem: null })).toMatchObject({ busy: true, check: { text: "Checking…", command: null } })
    expect(at({ check: { kind: "testing" }, problem: null }).check!.text).toBe("Testing…")
    expect(at({ check: { kind: "testing" }, problem: null }, "wolfram").check!.text)
      .toBe("Testing… (the Wolfram engine can take a few seconds to start)")
    expect(at({ check: { kind: "works", said: "Python 3.12.1 (/p)", about: "/p" }, problem: null }))
      .toMatchObject({ busy: false, check: { text: "Works: Python 3.12.1 (/p)", command: null } })
    expect(at({ check: { kind: "failed", problem: "This is Apple's stand-in.", command: "xcode-select --install", about: "/p" }, problem: null }).check)
      .toEqual({ text: "Did not work: This is Apple's stand-in.", command: "xcode-select --install" })
    // An answer about another program says nothing about this one.
    expect(at({ check: { kind: "works", said: "Python 3.9.6", about: "/usr/bin/python3" }, problem: null }).check).toBeNull()
    expect(at(NO_MEMORY).check).toBeNull()
  })

  it("a refused choice is said with its command", () => {
    expect(rowView("python", report(), { check: null, problem: { text: "That is not a Python.", command: "x" } }, MAC).problem)
      .toEqual({ text: "That is not a Python.", command: "x" })
  })
})

describe("a row's buttons", () => {
  it("Find Automatically only with a choice; Test only with a program in use", () => {
    expect(rowView("python", report({ python: found("/p") }), NO_MEMORY, MAC)).toMatchObject({ automatic: false, test: true })
    expect(rowView("python", report({ python: chosen("/p") }), NO_MEMORY, MAC)).toMatchObject({ automatic: true, test: true })
    expect(rowView("python", report({ python: chosen("/p", "gone") }), NO_MEMORY, MAC)).toMatchObject({ automatic: true, test: false })
    expect(rowView("python", report(), NO_MEMORY, MAC)).toMatchObject({ automatic: false, test: false })
  })

  it("nothing found: Install where this machine can, else Get, and neither for C, C++ or Rust", () => {
    const winPython = rowView("python", report(), NO_MEMORY, WINDOWS)
    expect(winPython).toMatchObject({ install: { label: "Install Python…", action: "python" }, get: null,
      setupLine: { text: INSTALL_PYTHON_LINE, terms: false } })
    const winWolfram = rowView("wolfram", report(), NO_MEMORY, WINDOWS)
    expect(winWolfram).toMatchObject({ install: { label: "Install Wolfram Engine…", action: "wolfram" }, get: null,
      setupLine: { text: INSTALL_WOLFRAM_LINE, terms: true } })
    expect(rowView("python", report(), NO_MEMORY, MAC)).toMatchObject({ install: null, get: { label: "Get Python…", link: "python" },
      setupLine: { text: GET_LINE, terms: false } })
    expect(rowView("wolfram", report(), NO_MEMORY, MAC).get).toEqual({ label: "Get Wolfram Engine…", link: "wolframEngine" })
    // Windows with the script and no winget: Get, not a dead Install.
    expect(rowView("python", report(), NO_MEMORY, { installsLanguages: false, activatesWolfram: true }).get?.label).toBe("Get Python…")
    for (const evaluator of ["c", "cpp", "rust"] as const) {
      for (const caps of [MAC, WINDOWS]) {
        expect(rowView(evaluator, report(), NO_MEMORY, caps)).toMatchObject({ install: null, get: null, setupLine: null })
      }
    }
    // Found: nothing to install or get.
    expect(rowView("python", report({ python: found("/p") }), NO_MEMORY, WINDOWS)).toMatchObject({ install: null, get: null, setupLine: null })
  })

  it("a setup window: its row says so while it is open, and what it did after; Install and Activate wait for it", () => {
    const running = report({}, { setup: { running: "python", last: null } })
    expect(rowView("python", running, NO_MEMORY, WINDOWS)).toMatchObject({ setupBusy: true,
      setupLine: { text: "Installing in the window that opened. WriteMind looks again when it closes.", terms: false } })
    expect(rowView("wolfram", running, NO_MEMORY, WINDOWS)).toMatchObject({ setupBusy: true, setupLine: { text: INSTALL_WOLFRAM_LINE } })
    const activating = report({ wolfram: found("C:\\W\\wolframscript.exe") }, { licence: false, setup: { running: "activate", last: null } })
    expect(rowView("wolfram", activating, NO_MEMORY, WINDOWS).setupLine).toEqual({ text: "Sign in with your Wolfram ID in the window that opened.", terms: false })
    const after = report({ python: found("C:\\P\\python.exe") }, { setup: { running: null, last: { action: "python", said: "Python installed." } } })
    expect(rowView("python", after, NO_MEMORY, WINDOWS)).toMatchObject({ setupBusy: false, setupLine: { text: "Python installed.", terms: false } })
    expect(rowView("wolfram", after, NO_MEMORY, WINDOWS).setupLine).toEqual({ text: INSTALL_WOLFRAM_LINE, terms: true })
  })

  it("Wolfram not activated: Activate… where the script is, else the command to type; hidden once a Test works", () => {
    const mac = report({ wolfram: found("/opt/homebrew/bin/wolframscript") }, { licence: false })
    expect(rowView("wolfram", mac, NO_MEMORY, MAC).licence)
      .toEqual({ text: NOT_ACTIVATED, activate: false, command: "/opt/homebrew/bin/wolframscript -activate" })
    expect(rowView("wolfram", mac, NO_MEMORY, WINDOWS).licence).toEqual({ text: NOT_ACTIVATED, activate: true, command: null })
    const windows = report({ wolfram: found("C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe") }, { licence: false })
    expect(rowView("wolfram", windows, NO_MEMORY, MAC).licence?.command)
      .toBe('& "C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe" -activate')
    expect(rowView("wolfram", mac, { check: { kind: "works", said: "Wolfram Language 14.1", about: "/opt/homebrew/bin/wolframscript" }, problem: null }, MAC).licence)
      .toBeNull()
    expect(rowView("wolfram", report({ wolfram: found("/w") }, { licence: true }), NO_MEMORY, MAC).licence).toBeNull()
    expect(rowView("wolfram", report({}, { licence: null }), NO_MEMORY, MAC).licence).toBeNull()
    expect(rowView("python", report({ python: found("/p") }, { licence: false }), NO_MEMORY, MAC).licence).toBeNull()
    expect(NOT_ACTIVATED).toBe("Not activated yet: there is no licence file where activation leaves one. Activate it once with your own Wolfram ID (free at wolfram.com).")
  })

  it("lists the other copies to Use", () => {
    const withOthers = { ...report({ python: found("/usr/bin/python3") }) }
    withOthers.others = { ...withOthers.others, python: ["/opt/homebrew/bin/python3"] }
    expect(rowView("python", withOthers, NO_MEMORY, MAC).others).toEqual(["/opt/homebrew/bin/python3"])
  })
})

describe("C, C++ and Rust", () => {
  it("open when one of them has a choice or the screen was opened at one", () => {
    expect(moreOpen(report(), null)).toBe(false)
    expect(moreOpen(report(), "python")).toBe(false)
    expect(moreOpen(report(), "cpp")).toBe(true)
    expect(moreOpen(report({ rust: chosen("/r/rustc") }), null)).toBe(true)
    expect(moreOpen(report({ python: chosen("/p") }), null)).toBe(false)
  })
})
