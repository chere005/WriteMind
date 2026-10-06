/**
 * File ▸ Language Setup…, the main process's half (src/main/eval/languages.ts): the settings store, on a real file in
 * a temp folder, and the screen's questions, with the runner, the picker and the places FAKED — nothing here starts a
 * process, opens a panel or reads a real tool. Port-only (the Mac keeps `evalTool.<name>` in its defaults).
 */
import { EventEmitter } from "node:events"
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { IpcMain } from "electron"
import { afterEach, describe, expect, it } from "vitest"
import {
  evalResult, IDENTIFY_PYTHON, TEST_SOURCE, type Evaluator, type ProbeOutcome, type RunOutcome, type RunRequest,
} from "@writemind/core"
import { createLanguageStore, registerLanguages, type LanguageStore, type ToolSetup } from "../src/main/eval/languages"
import type { Runner } from "../src/main/eval/runner"
import { toolReport, type ToolPlaces } from "../src/main/eval/tools"
import {
  LANGUAGE_CHANNELS, LINKS, writeLanguageSettings, type LanguageReport, type PickerOptions,
} from "../src/shared/languages"

const temps: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wm-languages-"))
  temps.push(dir)
  return dir
}
afterEach(() => {
  // A folder a test made read-only is given back, so the temp folder can be cleaned like any other.
  for (const dir of temps.splice(0)) { try { chmodSync(dir, 0o755) } catch { /* gone */ } }
})

class FakeSender extends EventEmitter { constructor(readonly id: number) { super() } }

interface Rig {
  store: LanguageStore
  file: string
  call(channel: string, ...args: unknown[]): Promise<any>
  pushes: LanguageReport[]
  asked: PickerOptions[]
  answer: { canceled: boolean; filePaths: string[] }
  identified: { id: string; evaluator: Evaluator; file: string }[]
  identifyWith: ProbeOutcome | (() => Promise<ProbeOutcome>)
  runs: RunRequest[]
  runWith: RunOutcome | (() => Promise<RunOutcome>)
  cancelled: string[]
  opened: string[]
  files: string[]
  dirs: string[]
  sender: FakeSender
  setups: { action: string; wolframscript: string | null }[]
  finishSetup: ((result: Record<string, string> | null) => void) | null
}

/** A Windows machine's places, for the rig's `places` option. */
const WINDOWS: Partial<ToolPlaces> = {
  platform: "win32", pathVariable: "C:\\Windows;C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps", home: "C:\\Users\\S",
  programFiles: ["C:\\Program Files"], localAppData: "C:\\Users\\S\\AppData\\Local",
  appData: "C:\\Users\\S\\AppData\\Roaming", programData: "C:\\ProgramData",
}
const STORE_STUB = "C:\\Users\\S\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe"

function rig(options: { setup?: boolean; winget?: boolean; files?: string[]; places?: Partial<ToolPlaces> } = {}): Rig {
  const dir = scratch()
  const file = path.join(dir, "languages.json")
  const platform = options.places?.platform ?? "darwin"
  const store = createLanguageStore(file, platform)
  const handlers = new Map<string, (event: { sender: FakeSender }, ...args: unknown[]) => unknown>()
  const r: Rig = {
    store, file, pushes: [], asked: [], answer: { canceled: true, filePaths: [] }, identified: [],
    identifyWith: { kind: "ran", result: evalResult({ status: 0, stdout: "3.12.1\n/Users/s/venv/bin/python3\n" }) },
    runs: [], runWith: { kind: "ran", result: evalResult({ status: 0, stdout: "3.12.1\n/usr/bin/python3\n" }) },
    cancelled: [], opened: [], files: options.files ?? ["/usr/bin/python3", "/opt/homebrew/bin/python3"], dirs: [],
    sender: new FakeSender(7), setups: [], finishSetup: null,
    call: async (channel, ...args) => handlers.get(channel)!({ sender: r.sender }, ...args),
  }
  const places = (): ToolPlaces => ({
    platform: "darwin", pathVariable: "/usr/bin:/bin", home: "/Users/s", programFiles: [],
    isFile: (one) => r.files.includes(one), isDirectory: (one) => r.dirs.includes(one),
    ...options.places,
    chosen: store.get(),
  })
  const runner: Runner = {
    run: async (request) => { r.runs.push(request); return typeof r.runWith === "function" ? r.runWith() : r.runWith },
    identify: async (id, evaluator, one) => {
      r.identified.push({ id, evaluator, file: one })
      return typeof r.identifyWith === "function" ? r.identifyWith() : r.identifyWith
    },
    cancel: (id) => { r.cancelled.push(id) },
    cancelAll: () => {},
    tools: () => toolReport(places()),
    inFlight: () => 0,
  }
  const setup: ToolSetup = {
    start: (action, wolframscript) => {
      r.setups.push({ action, wolframscript })
      return new Promise((resolve) => { r.finishSetup = resolve })
    },
  }
  registerLanguages({ handle: (channel: string, fn: never) => { handlers.set(channel, fn) } } as unknown as IpcMain, {
    store, runner, platform, places,
    ask: async (picker) => { r.asked.push(picker); return r.answer },
    open: (url) => { r.opened.push(url) },
    setup: options.setup === false ? null : setup,
    winget: options.winget ?? true,
    log: "/Users/s/Library/Application Support/WriteMind/tools-setup.log",
    broadcast: (report) => { r.pushes.push(report) },
  })
  return r
}

const onDisk = (r: Rig): unknown => (existsSync(r.file) ? JSON.parse(readFileSync(r.file, "utf8")) : null)

describe("the screen's questions (registerLanguages)", () => {
  it("refuses every malformed payload and leaves the store untouched", async () => {
    const r = rig()
    expect(await r.call(LANGUAGE_CHANNELS.choose, "bash")).toEqual({ kind: "refused", problem: "That is not a language WriteMind runs." })
    expect(await r.call(LANGUAGE_CHANNELS.choose, { evaluator: "python" })).toMatchObject({ kind: "refused" })
    expect(await r.call(LANGUAGE_CHANNELS.use, "python", 3)).toMatchObject({ kind: "refused" })
    expect(await r.call(LANGUAGE_CHANNELS.use, "python", `/${"x".repeat(5000)}`)).toMatchObject({ kind: "refused" })
    expect(await r.call(LANGUAGE_CHANNELS.use, "perl", "/usr/bin/python3")).toMatchObject({ kind: "refused" })
    expect(await r.call(LANGUAGE_CHANNELS.test, "perl")).toMatchObject({ kind: "failed" })
    expect(await r.call(LANGUAGE_CHANNELS.setup, "rm -rf")).toMatchObject({ kind: "refused" })
    await r.call(LANGUAGE_CHANNELS.automatic, "nope")
    await r.call(LANGUAGE_CHANNELS.cancel, 42)
    expect(onDisk(r)).toBeNull()
    expect(r.asked).toEqual([])
    expect(r.identified).toEqual([])
    expect(r.runs).toEqual([])
    expect(r.cancelled).toEqual([])
    expect(r.setups).toEqual([])
  })

  it("a cancelled picker saves nothing and tells nobody", async () => {
    const r = rig()
    expect(await r.call(LANGUAGE_CHANNELS.choose, "python")).toEqual({ kind: "cancelled" })
    expect(r.asked[0]!.buttonLabel).toBe("Use")
    // The picker opens where the program in use is.
    expect(r.asked[0]!.defaultPath).toBe("/usr/bin")
    expect(onDisk(r)).toBeNull()
    expect(r.pushes).toEqual([])
  })

  it("a valid pick is asked its version, saved as the program inside the folder picked, and told once", async () => {
    const r = rig()
    r.dirs.push("/Users/s/venv")
    r.files.push("/Users/s/venv/bin/python3")
    r.answer = { canceled: false, filePaths: ["/Users/s/venv"] }
    const answer = await r.call(LANGUAGE_CHANNELS.choose, "python")
    expect(answer).toMatchObject({ kind: "chosen", said: "Python 3.12.1 (/Users/s/venv/bin/python3)" })
    expect(answer.report.tools.python).toEqual({ path: "/Users/s/venv/bin/python3", looked: ["/Users/s/venv/bin/python3 (chosen in Language Setup)"],
      chosen: { path: "/Users/s/venv/bin/python3", problem: null } })
    expect(r.identified).toEqual([{ id: "languages:identify:python", evaluator: "python", file: "/Users/s/venv/bin/python3" }])
    expect(onDisk(r)).toEqual({ version: 1, tools: { python: "/Users/s/venv/bin/python3" } })
    expect(r.store.get()).toEqual({ python: "/Users/s/venv/bin/python3" })
    expect(r.pushes.length).toBe(1)
    expect(r.pushes[0]!.tools.python.path).toBe("/Users/s/venv/bin/python3")
    // The others: what else is there, not the one in use.
    expect(answer.report.others.python).toEqual(["/usr/bin/python3", "/opt/homebrew/bin/python3"])
  })

  // BREAK-IT: watched failing against "Also on this computer" keyed by the fully resolved file: the venv's link and
  // Homebrew's lead to one Cellar file, so Homebrew's Python dropped out of the list the moment the venv was chosen.
  it("a venv in use still lists the Python it was made from, so there is one click back to it", async () => {
    const cellar = "/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14"
    const venv = "/Users/s/proj/.venv/bin/python3"
    const links: Record<string, string> = { "/opt/homebrew/bin/python3": cellar, [venv]: cellar }
    const r = rig({ files: ["/opt/homebrew/bin/python3", venv, "/Users/s/proj/.venv/pyvenv.cfg"],
      places: { realPath: (one) => links[one] ?? one } })
    r.dirs.push("/Users/s/proj/.venv")
    r.answer = { canceled: false, filePaths: ["/Users/s/proj/.venv"] }
    const answer = await r.call(LANGUAGE_CHANNELS.choose, "python")
    expect(answer.report.tools.python.path).toBe(venv)
    expect(answer.report.others.python).toEqual(["/opt/homebrew/bin/python3"])
    // And Use takes it back.
    expect(await r.call(LANGUAGE_CHANNELS.use, "python", "/opt/homebrew/bin/python3")).toMatchObject({ kind: "chosen" })
    expect(onDisk(r)).toEqual({ version: 1, tools: { python: "/opt/homebrew/bin/python3" } })
  })

  it("marks a Python found by itself that is only a stand-in, and never a chosen one", async () => {
    // A stock Windows with no Python: only the Store's shortcut, which the PATH search does find.
    const bare = rig({ files: [STORE_STUB], places: WINDOWS })
    const report: LanguageReport = await bare.call(LANGUAGE_CHANNELS.report)
    expect(report.tools.python.path).toBe(STORE_STUB)
    expect(report.foundPython).toBe("storeAlias")
    // A Mac without the Command Line Tools: Apple's stand-in, read and not run.
    const mac = rig({ files: ["/usr/bin/python3"] })
    expect((await mac.call(LANGUAGE_CHANNELS.report)).foundPython).toBe("appleStandIn")
    expect(mac.runs).toEqual([])
    expect(mac.identified).toEqual([])
    mac.files.push("/Library/Developer/CommandLineTools/usr/bin/python3")
    expect((await mac.call(LANGUAGE_CHANNELS.report)).foundPython).toBe("apple")
    // Chosen: asked its version when it was chosen, so nothing is said about it here.
    await mac.store.set("python", "/usr/bin/python3")
    expect((await mac.call(LANGUAGE_CHANNELS.report)).foundPython).toBeNull()
    // Homebrew's: a Python.
    expect((await rig({ files: ["/opt/homebrew/bin/python3"] }).call(LANGUAGE_CHANNELS.report)).foundPython).toBeNull()
  })

  it("a file that cannot be chosen, or a program that does not answer as one, saves nothing and tells nobody", async () => {
    const r = rig()
    r.files.push("/bin/rm")
    r.answer = { canceled: false, filePaths: ["/bin/rm"] }
    expect(await r.call(LANGUAGE_CHANNELS.choose, "python"))
      .toEqual({ kind: "refused", problem: "That is not a Python: WriteMind runs a program called python, python3, python3.N or py." })
    expect(r.identified).toEqual([])
    r.files.push("/old/bin/python")
    r.answer = { canceled: false, filePaths: ["/old/bin/python"] }
    r.identifyWith = { kind: "ran", result: evalResult({ status: 0, stdout: "2.7.18\n/old/bin/python\n" }) }
    expect(await r.call(LANGUAGE_CHANNELS.choose, "python"))
      .toEqual({ kind: "refused", problem: "This is Python 2.7.18. Python cells need Python 3." })
    r.answer = { canceled: false, filePaths: ["/usr/bin/python3"] }
    r.identifyWith = { kind: "ran", result: evalResult({ status: 1, stderr: "xcrun: error: invalid active developer path" }) }
    expect(await r.call(LANGUAGE_CHANNELS.choose, "python")).toMatchObject({ kind: "refused", command: "xcode-select --install" })
    // Stopped while it was being asked: nothing.
    r.identifyWith = { kind: "cancelled" }
    expect(await r.call(LANGUAGE_CHANNELS.choose, "python")).toEqual({ kind: "cancelled" })
    expect(onDisk(r)).toBeNull()
    expect(r.pushes).toEqual([])
  })

  it("Use takes only a copy WriteMind found by itself", async () => {
    const r = rig()
    r.files.push("/Users/s/anything/python3")
    expect(await r.call(LANGUAGE_CHANNELS.use, "python", "/Users/s/anything/python3"))
      .toEqual({ kind: "refused", problem: "That is not a program WriteMind found." })
    expect(r.identified).toEqual([])
    expect(await r.call(LANGUAGE_CHANNELS.use, "python", "/opt/homebrew/bin/python3")).toMatchObject({ kind: "chosen" })
    expect(r.identified.map((one) => one.file)).toEqual(["/opt/homebrew/bin/python3"])
    expect(onDisk(r)).toEqual({ version: 1, tools: { python: "/opt/homebrew/bin/python3" } })
  })

  it("Find Automatically forgets the choice and tells the window", async () => {
    const r = rig()
    await r.store.set("python", "/opt/homebrew/bin/python3")
    await r.store.set("rust", "/Users/s/.cargo/bin/rustc")
    const report: LanguageReport = await r.call(LANGUAGE_CHANNELS.automatic, "python")
    expect(report.tools.python).toEqual({ path: "/usr/bin/python3", looked: expect.any(Array) })
    expect(onDisk(r)).toEqual({ version: 1, tools: { rust: "/Users/s/.cargo/bin/rustc" } })
    expect(r.pushes.length).toBe(1)
  })

  it("Test runs the fixed program with the program main says is in use, under the row's own id", async () => {
    const r = rig()
    const answer = await r.call(LANGUAGE_CHANNELS.test, "python")
    expect(r.runs).toEqual([{ id: "languages:test:python", evaluator: "python", source: TEST_SOURCE.python }])
    expect(answer).toEqual({ kind: "works", said: "Python 3.12.1 (/usr/bin/python3)" })
    r.runWith = { kind: "ran", result: evalResult({ status: 255, stderr: "requires one-time activation" }) }
    r.files.push("/opt/homebrew/bin/wolframscript")
    expect(await r.call(LANGUAGE_CHANNELS.test, "wolfram")).toMatchObject({ command: "/opt/homebrew/bin/wolframscript -activate" })
  })

  it("Stop cancels the row's check and its test; a page that goes away cancels what it started", async () => {
    const r = rig()
    await r.call(LANGUAGE_CHANNELS.cancel, "wolfram")
    expect(r.cancelled).toEqual(["languages:identify:wolfram", "languages:test:wolfram"])
    r.cancelled.length = 0
    let release: () => void = () => {}
    r.runWith = () => new Promise((resolve) => { release = () => resolve({ kind: "cancelled" }) })
    const pending = r.call(LANGUAGE_CHANNELS.test, "c")
    await new Promise((resolve) => setTimeout(resolve, 5))
    r.sender.emit("destroyed")
    expect(r.cancelled).toEqual(["languages:test:c"])
    release()
    expect(await pending).toEqual({ kind: "cancelled" })
  })

  it("a report reads files only, and tells the window only when what is in use changed", async () => {
    const r = rig()
    const first: LanguageReport = await r.call(LANGUAGE_CHANNELS.report)
    expect(first.tools.python.path).toBe("/usr/bin/python3")
    expect(first.licence).toBeNull()
    expect(r.pushes.length).toBe(1)
    await r.call(LANGUAGE_CHANNELS.report)
    expect(r.pushes.length).toBe(1)
    // Something installed in another window: the next look tells the open notes.
    r.files.push("/Users/s/.cargo/bin/rustc")
    const third: LanguageReport = await r.call(LANGUAGE_CHANNELS.report)
    expect(third.tools.rust.path).toBe("/Users/s/.cargo/bin/rustc")
    expect(r.pushes.length).toBe(2)
    expect(r.identified).toEqual([])
    expect(r.runs).toEqual([])
    // The licence is asked only of a wolframscript in use.
    r.files.push("/opt/homebrew/bin/wolframscript")
    expect((await r.call(LANGUAGE_CHANNELS.report)).licence).toBe(false)
    r.files.push("/Users/s/Library/WolframEngine/Licensing/mathpass")
    expect((await r.call(LANGUAGE_CHANNELS.report)).licence).toBe(true)
  })

  it("Set Up: refused with nothing to run it or no winget to install with, one window at a time, and said when it ends", async () => {
    expect(await rig({ setup: false }).call(LANGUAGE_CHANNELS.setup, "python")).toMatchObject({ kind: "refused" })
    const noWinget = rig({ winget: false })
    expect(await noWinget.call(LANGUAGE_CHANNELS.setup, "python")).toMatchObject({ kind: "refused" })
    expect(await noWinget.call(LANGUAGE_CHANNELS.setup, "wolfram")).toMatchObject({ kind: "refused" })
    // Activate needs only the script.
    expect(await noWinget.call(LANGUAGE_CHANNELS.setup, "activate")).toEqual({ kind: "started" })
    // (Windows' places: Install is Windows' alone. Python 3.14 installed per user, where python.org's installer puts it.)
    const local = "C:\\Users\\S\\AppData\\Local\\Programs\\Python"
    const r = rig({ files: [], places: { ...WINDOWS, folders: (dir) => (dir === local ? ["Python314"] : []) } })
    expect(await r.call(LANGUAGE_CHANNELS.setup, "python")).toEqual({ kind: "started" })
    expect(r.setups).toEqual([{ action: "python", wolframscript: null }])
    expect(r.pushes.at(-1)!.setup).toEqual({ running: "python", last: null })
    expect(await r.call(LANGUAGE_CHANNELS.setup, "activate")).toEqual({ kind: "refused", problem: "Another setup window is still open." })
    r.files.push(`${local}\\Python314\\python.exe`)
    r.finishSetup!({ python: "installed", wolfram: "not asked", activate: "not asked" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(r.pushes.at(-1)!.setup).toEqual({ running: null, last: { action: "python", said: "Python installed." } })
    // The next one may start, and Activate is handed the wolframscript the cells use.
    const ws = "C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe"
    r.files.push(ws)
    expect(await r.call(LANGUAGE_CHANNELS.setup, "activate")).toEqual({ kind: "started" })
    expect(r.setups.at(-1)).toEqual({ action: "activate", wolframscript: ws })
    expect(r.pushes.at(-1)!.setup.last).toBeNull()
    r.finishSetup!(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(r.pushes.at(-1)!.setup.last?.said).toBe("The setup window closed before it finished. The details are in /Users/s/Library/Application Support/WriteMind/tools-setup.log.")
  })

  // BREAK-IT: watched failing against `foundAfter = tools.python.path !== null`, which the Store's shortcut made true
  // on every stock Windows.
  it("an install that leaves only the Store's shortcut is not \"Python installed.\"", async () => {
    const r = rig({ files: [STORE_STUB], places: WINDOWS })
    await r.call(LANGUAGE_CHANNELS.setup, "python")
    r.finishSetup!({ python: "installed", wolfram: "not asked", activate: "not asked" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(r.pushes.at(-1)!.setup.last?.said).toBe("Python is installed, but not where WriteMind looks. Use Choose… to point at it.")
  })

  // BREAK-IT: watched failing against a `last` kept until the next setup: the sign-in sentence stayed under a row
  // that was already activated.
  it("a setup's sentence about something not there yet is taken back once it is there; one that ended well stays", async () => {
    const ws = "C:\\Program Files\\Wolfram Research\\WolframScript\\wolframscript.exe"
    const r = rig({ files: [ws], places: WINDOWS })
    await r.call(LANGUAGE_CHANNELS.setup, "activate")
    r.finishSetup!({ python: "not asked", wolfram: "not asked", activate: "opened" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const opened = "Sign in with your Wolfram ID in the window that opened. WriteMind looks again when you come back."
    expect(r.pushes.at(-1)!.setup.last).toEqual({ action: "activate", said: opened })
    // Not signed in yet: the sentence stays.
    expect(((await r.call(LANGUAGE_CHANNELS.report)) as LanguageReport).setup.last?.said).toBe(opened)
    // Signed in: the licence is there, and the next look says nothing about a window that is done.
    r.files.push("C:\\Users\\S\\AppData\\Roaming\\WolframEngine\\Licensing\\mathpass")
    const after: LanguageReport = await r.call(LANGUAGE_CHANNELS.report)
    expect(after.licence).toBe(true)
    expect(after.setup.last).toBeNull()
    // "Python installed." was true when it was said: a look does not take it back.
    const local = "C:\\Users\\S\\AppData\\Local\\Programs\\Python"
    const p = rig({ files: [], places: { ...WINDOWS, folders: (dir) => (dir === local ? ["Python314"] : []) } })
    await p.call(LANGUAGE_CHANNELS.setup, "python")
    p.files.push(`${local}\\Python314\\python.exe`)
    p.finishSetup!({ python: "installed", wolfram: "not asked", activate: "not asked" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(((await p.call(LANGUAGE_CHANNELS.report)) as LanguageReport).setup.last?.said).toBe("Python installed.")
  })

  it("opens only the pages it names", async () => {
    const r = rig()
    await r.call(LANGUAGE_CHANNELS.open, "python")
    await r.call(LANGUAGE_CHANNELS.open, "https://example.com")
    await r.call(LANGUAGE_CHANNELS.open, "constructor")
    expect(r.opened).toEqual([LINKS.python])
  })

  it("asks a Python with the identity line, never a note's text", () => {
    expect(IDENTIFY_PYTHON).not.toMatch(/\n/)
  })
})

describe("the choices on disk (createLanguageStore)", () => {
  it("sees a hand edit at the next look, by the file's time", async () => {
    const dir = scratch()
    const file = path.join(dir, "languages.json")
    const store = createLanguageStore(file, "darwin")
    expect(store.get()).toEqual({})
    writeFileSync(file, writeLanguageSettings({ python: "/a/bin/python3" }))
    expect(store.get()).toEqual({ python: "/a/bin/python3" })
    // Same size, new time: read again.
    writeFileSync(file, writeLanguageSettings({ python: "/b/bin/python3" }))
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    expect(store.get()).toEqual({ python: "/b/bin/python3" })
  })

  // BREAK-IT: watched failing against a store that took the choice before the write had landed.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a write that fails is refused, and the choices stay what the disk says", async () => {
    const dir = scratch()
    const file = path.join(dir, "languages.json")
    writeFileSync(file, writeLanguageSettings({ python: "/a/bin/python3" }))
    const store = createLanguageStore(file, "darwin")
    expect(store.get()).toEqual({ python: "/a/bin/python3" })
    chmodSync(dir, 0o555)
    await expect(store.set("python", "/b/bin/python3")).rejects.toThrow()
    expect(store.get()).toEqual({ python: "/a/bin/python3" })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, tools: { python: "/a/bin/python3" } })
    chmodSync(dir, 0o755)
    // And the next one, once it can, goes through.
    await store.set("python", "/c/bin/python3")
    expect(store.get()).toEqual({ python: "/c/bin/python3" })
  })

  it("applies sets in the order they were asked", async () => {
    const dir = scratch()
    const file = path.join(dir, "deeper", "languages.json")
    const store = createLanguageStore(file, "darwin")
    await Promise.all([
      store.set("python", "/a/bin/python3"),
      store.set("rust", "/r/rustc"),
      store.set("python", "/b/bin/python3"),
      store.set("rust", null),
    ])
    expect(store.get()).toEqual({ python: "/b/bin/python3" })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, tools: { python: "/b/bin/python3" } })
  })

  it("copies a file it could not take whole aside before the first write replaces it", async () => {
    for (const text of ["{ not json", JSON.stringify({ version: 2, tools: { python: "/x/bin/python3" } }),
      JSON.stringify({ version: 1, tools: { python: "/a/bin/python3", bash: "/bin/bash" } })]) {
      const dir = scratch()
      const file = path.join(dir, "languages.json")
      writeFileSync(file, text)
      const store = createLanguageStore(file, "darwin")
      store.get()
      await store.set("rust", "/r/rustc")
      const aside = readdirSync(dir).filter((name) => /^languages\.unreadable-\d+\.json$/.test(name))
      expect(aside.length, text).toBe(1)
      expect(readFileSync(path.join(dir, aside[0]!), "utf8")).toBe(text)
      // Once, not on every write after.
      await store.set("rust", "/s/rustc")
      expect(readdirSync(dir).filter((name) => name.startsWith("languages.unreadable-")).length).toBe(1)
    }
    // A file it took whole is simply replaced.
    const dir = scratch()
    const file = path.join(dir, "languages.json")
    writeFileSync(file, writeLanguageSettings({ python: "/a/bin/python3" }))
    const store = createLanguageStore(file, "darwin")
    await store.set("rust", "/r/rustc")
    expect(readdirSync(dir).filter((name) => name.startsWith("languages.unreadable-"))).toEqual([])
    expect(store.get()).toEqual({ python: "/a/bin/python3", rust: "/r/rustc" })
  })

  /** A file held by another program while `locked` says so: every read throws EBUSY, and every write is kept. */
  function lockable(text: string) {
    const disk = { text, mtimeMs: 1, locked: false }
    const reads: string[] = []
    const writes: string[] = []
    const copies: string[] = []
    const fsDeps = {
      stat: () => ({ mtimeMs: disk.mtimeMs, size: disk.text.length }),
      read: (one: string) => {
        reads.push(one)
        if (disk.locked) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" })
        return disk.text
      },
      write: async (_one: string, next: string) => { writes.push(next); disk.text = next; disk.mtimeMs++ },
      copy: (_from: string, to: string) => { copies.push(to) },
      makeFolder: () => {},
    }
    return { disk, reads, writes, copies, fsDeps }
  }

  // BREAK-IT: watched failing against a store that read a locked file as "no choices": every run fell back to the
  // copy found by itself, and the set that followed wrote `{ rust }` over the person's Python and Wolfram.
  it("a file held by another program keeps the choices last read, refuses a write, and is asked again at every look", async () => {
    const lock = lockable(writeLanguageSettings({ python: "/v/bin/python3", wolfram: "/w/wolframscript" }))
    const store = createLanguageStore(path.join("/p", "languages.json"), "darwin", lock.fsDeps)
    expect(store.get()).toEqual({ python: "/v/bin/python3", wolfram: "/w/wolframscript" })
    // Held, and changed in the meantime (so the store must read it again): the last choices stay the choices.
    lock.disk.locked = true
    lock.disk.mtimeMs = 50
    expect(store.get()).toEqual({ python: "/v/bin/python3", wolfram: "/w/wolframscript" })
    expect(store.get()).toEqual({ python: "/v/bin/python3", wolfram: "/w/wolframscript" })
    expect(lock.reads.length).toBe(3)
    expect(store.unreadable()).toBeNull()
    // A choice made now is refused, and nothing is copied or written.
    await expect(store.set("rust", "/r/rustc")).rejects.toThrow(/languages\.json could not be read just now \(EBUSY\)/)
    expect(lock.writes).toEqual([])
    expect(lock.copies).toEqual([])
    // Let go: the next choice is written over what the file says, every other language kept.
    lock.disk.locked = false
    await store.set("rust", "/r/rustc")
    expect(lock.writes.length).toBe(1)
    expect(JSON.parse(lock.writes[0]!)).toEqual({ version: 1, tools: { wolfram: "/w/wolframscript", python: "/v/bin/python3", rust: "/r/rustc" } })
    expect(lock.copies).toEqual([])
  })

  it("a file that could never be read is named, so every language refuses rather than guess, and nothing is written over it", async () => {
    const lock = lockable(writeLanguageSettings({ python: "/v/bin/python3" }))
    lock.disk.locked = true
    const file = path.join("/p", "languages.json")
    const store = createLanguageStore(file, "darwin", lock.fsDeps)
    expect(store.get()).toEqual({})
    expect(store.unreadable()).toBe(file)
    await expect(store.set("rust", "/r/rustc")).rejects.toThrow(/could not be read just now/)
    await expect(store.set("python", null)).rejects.toThrow(/could not be read just now/)
    expect(lock.writes).toEqual([])
    // Let go: read, named no more, and the choice in it is the choice.
    lock.disk.locked = false
    expect(store.get()).toEqual({ python: "/v/bin/python3" })
    expect(store.unreadable()).toBeNull()
    // Held again after a read: the choices last read, not "nothing known".
    lock.disk.locked = true
    lock.disk.mtimeMs = 99
    expect(store.unreadable()).toBeNull()
    expect(store.get()).toEqual({ python: "/v/bin/python3" })
    // No file at all is not unreadable: it is no choices.
    const none = createLanguageStore(file, "darwin", { ...lock.fsDeps, stat: () => null })
    expect(none.unreadable()).toBeNull()
  })

  // The mode does not hold on Windows, nor for root.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("the IPC says a refused write in the row, and saves nothing", async () => {
    const r = rig()
    await r.store.set("wolfram", "/w/wolframscript")
    chmodSync(r.file, 0o000)
    const later = new Date(Date.now() + 5000)
    utimesSync(r.file, later, later)
    try {
      expect(await r.call(LANGUAGE_CHANNELS.use, "python", "/opt/homebrew/bin/python3")).toMatchObject({
        kind: "refused", problem: expect.stringMatching(/^WriteMind could not save the choice: languages\.json could not be read just now \(EACCES\)/),
      })
      expect(r.store.get()).toEqual({ wolfram: "/w/wolframscript" })
    } finally { chmodSync(r.file, 0o644) }
    expect(onDisk(r)).toEqual({ version: 1, tools: { wolfram: "/w/wolframscript" } })
  })
})
