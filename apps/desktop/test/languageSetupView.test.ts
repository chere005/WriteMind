/**
 * What File ▸ Language Setup… shows, row by row (src/renderer/languageSetupView.ts): every state's exact words and
 * which buttons each state has. Pure: a report and a row's memory in, a row out. Port-only.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EVALUATORS, type Evaluator, type ToolEntry } from "@writemind/core"
import {
  APPLE_PYTHON_LINE, GET_LINE, INSTALL_PYTHON_LINE, INSTALL_WOLFRAM_LINE, keyboardHome, moreOpen, NO_MEMORY, NOT_ACTIVATED, rowView,
  type RowMemory, type SetupCaps,
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
  return { tools: all, others, licence: null, foundPython: null, setup: { running: null, last: null }, ...more }
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

  it("Language Setup's own file unreadable: said, in amber, and no Find Automatically (that is a write too)", () => {
    const unreadable: ToolEntry = { path: null, looked: [], chosen: { path: "/u/languages.json", problem: "unreadable" } }
    expect(rowView("python", report({ python: unreadable }), NO_MEMORY, MAC)).toMatchObject({
      state: "chosenUnusable", amber: true, alert: true, automatic: false, test: false,
      source: "WriteMind could not read the file that keeps your choices (/u/languages.json), so it does not know what you chose. "
        + "Python cells will not run until it can; it reads the file again each time it looks.",
    })
  })
})

describe("a Python that is only a stand-in", () => {
  const STORE = "C:\\Users\\X\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe"

  // BREAK-IT: watched failing against Install offered only for "notFound": a stock Windows, whose Store shortcut
  // counts as found, had no Install Python… at all.
  it("Windows' Store shortcut: said in amber, with Install Python…", () => {
    const view = rowView("python", report({ python: found(STORE) }, { foundPython: "storeAlias" }), NO_MEMORY, WINDOWS)
    expect(view).toMatchObject({
      state: "found", path: STORE, amber: true, sourceCommand: null,
      source: "Found automatically, but this is Windows' shortcut to the Microsoft Store, not a Python.",
      install: { label: "Install Python…", action: "python" }, get: null,
      setupLine: { text: INSTALL_PYTHON_LINE, terms: false },
    })
    // Without winget: Get Python….
    expect(rowView("python", report({ python: found(STORE) }, { foundPython: "storeAlias" }), NO_MEMORY, { installsLanguages: false, activatesWolfram: true }).get)
      .toEqual({ label: "Get Python…", link: "python" })
    // A py launcher with nothing behind it is the same.
    expect(rowView("python", report({ python: found("C:\\Windows\\py.exe") }, { foundPython: "pyLauncher" }), NO_MEMORY, WINDOWS)).toMatchObject({
      amber: true, install: { label: "Install Python…" },
      source: "Found automatically, but this is only the py launcher, and WriteMind found no Python 3 installed for it to start.",
    })
  })

  it("a Mac: Apple's stand-in says so with the command, and both Apple's python3s offer Get Python…", () => {
    const standIn = rowView("python", report({ python: found("/usr/bin/python3") }, { foundPython: "appleStandIn" }), NO_MEMORY, MAC)
    expect(standIn).toMatchObject({
      amber: true, sourceCommand: "xcode-select --install", get: { label: "Get Python…", link: "python" }, install: null,
      source: "Found automatically, but this is Apple's stand-in for python3, which runs nothing until Apple's Command Line Tools are installed.",
      setupLine: { text: GET_LINE, terms: false },
    })
    // With the Command Line Tools it runs: not amber, but a newer Python is still one click away.
    const apple = rowView("python", report({ python: found("/usr/bin/python3") }, { foundPython: "apple" }), NO_MEMORY, MAC)
    expect(apple).toMatchObject({ amber: false, source: "Found automatically.", sourceCommand: null,
      get: { label: "Get Python…", link: "python" }, setupLine: { text: APPLE_PYTHON_LINE, terms: false } })
  })

  it("never for a chosen Python, nor for the other languages", () => {
    expect(rowView("python", report({ python: chosen(STORE) }, { foundPython: "storeAlias" }), NO_MEMORY, WINDOWS))
      .toMatchObject({ amber: false, install: null, source: "Chosen by you." })
    expect(rowView("wolfram", report({ wolfram: found("/w") }, { foundPython: "appleStandIn" }), NO_MEMORY, MAC))
      .toMatchObject({ amber: false, get: null, source: "Found automatically." })
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
    expect(rowView("python", running, NO_MEMORY, WINDOWS, ["python"])).toMatchObject({ setupBusy: true, setupSaid: null,
      setupLine: { text: "Installing in the window that opened. WriteMind looks again when it closes.", terms: false } })
    expect(rowView("wolfram", running, NO_MEMORY, WINDOWS)).toMatchObject({ setupBusy: true, setupLine: { text: INSTALL_WOLFRAM_LINE } })
    const activating = report({ wolfram: found("C:\\W\\wolframscript.exe") }, { licence: false, setup: { running: "activate", last: null } })
    expect(rowView("wolfram", activating, NO_MEMORY, WINDOWS).setupLine).toEqual({ text: "Sign in with your Wolfram ID in the window that opened.", terms: false })
    const after = report({ python: found("C:\\P\\python.exe") }, { setup: { running: null, last: { action: "python", said: "Python installed." } } })
    expect(rowView("python", after, NO_MEMORY, WINDOWS, ["python"])).toMatchObject({ setupBusy: false, setupSaid: "Python installed.", setupLine: null })
    expect(rowView("wolfram", after, NO_MEMORY, WINDOWS, ["python"])).toMatchObject({ setupSaid: null, setupLine: { text: INSTALL_WOLFRAM_LINE, terms: true } })
  })

  // BREAK-IT: watched failing against the said sentence standing INSTEAD of the install line, and shown in every
  // Language Setup opened after.
  it("what a setup said is said beside the offer to try again, and only in the dialog that started it", () => {
    const failed = "winget stopped (exit code 0x8A150011). Nothing was installed; the window said why, and the details are in C:\\l.log."
    const declined = report({}, { setup: { running: null, last: { action: "wolfram", said: failed } } })
    // The UAC prompt was declined: Install is offered again, and its licence notice with it.
    expect(rowView("wolfram", declined, NO_MEMORY, WINDOWS, ["wolfram"])).toMatchObject({
      install: { label: "Install Wolfram Engine…" }, setupSaid: failed, setupLine: { text: INSTALL_WOLFRAM_LINE, terms: true },
    })
    // A Language Setup opened afterwards did not ask: it shows the row as it is.
    expect(rowView("wolfram", declined, NO_MEMORY, WINDOWS)).toMatchObject({ setupSaid: null, setupLine: { text: INSTALL_WOLFRAM_LINE, terms: true } })
    // Activate's sentence goes once the shell has taken it back (the licence is there: `last` is null).
    const signedIn = report({ wolfram: found("C:\\W\\wolframscript.exe") }, { licence: true })
    expect(rowView("wolfram", signedIn, NO_MEMORY, WINDOWS, ["activate"])).toMatchObject({ setupSaid: null, setupLine: null, licence: null })
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

describe("the keyboard stays in the dialog", () => {
  it("goes back to the row it was in — Stop while a check runs there, else Choose… — or to Done", () => {
    expect(keyboardHome(rowView("python", report({ python: found("/p") }), NO_MEMORY, MAC))).toBe("choose")
    expect(keyboardHome(rowView("python", report({ python: found("/p") }), { check: { kind: "identifying" }, problem: null }, MAC))).toBe("stop")
    expect(keyboardHome(null)).toBe("done")
  })

  // BREAK-IT: watched failing against the dialog as it was, whose Escape only worked while a focused button lived.
  it("the dialog gives it back after every change, when a press took away the button that had it", () => {
    const dialog = readFileSync(path.join(__dirname, "../src/renderer/LanguageSetupDialog.tsx"), "utf8").replace(/\r\n/g, "\n")
    // Each row says when it has the keyboard…
    expect(dialog).toMatch(/data-language-row=\{e\} onFocus=\{\(\) => \{ keyboardRow\.current = e \}\}/)
    // …and an effect that runs after every render puts it back when it is outside the dialog or on a disabled button.
    const effect = /useEffect\(\(\) => \{\n(\s+const here = dialog\.current[\s\S]*?keyboardHome\([\s\S]*?)\n {2}\}\)\n/.exec(dialog)
    expect(effect, "the effect").not.toBeNull()
    expect(effect![1]).toMatch(/here\.contains\(active\)/)
    expect(effect![1]).toMatch(/active\.disabled/)
    expect(effect![1]).toMatch(/done\.current\?\.focus\(\)/)
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
