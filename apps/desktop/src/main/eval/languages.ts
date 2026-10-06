/**
 * File ▸ Language Setup…, the main process's half: the CHOICES (userData/languages.json, `createLanguageStore`) and
 * the screen's questions (`registerLanguages`; shared/languages.ts names the channels and holds the pure rules).
 * Port-only — the Mac's override is `evalTool.<name>` in its defaults, with no screen.
 *
 * NOTHING HERE STARTS A PROCESS ITSELF (this file is in main/eval, and a test fails if anything in that folder but
 * runner.ts so much as names Node's process module). The two things a press here does start go through the runner, which holds
 * every guard a cell's run has: Choose… and Use ask a picked program its version (`Runner.identify`), and Test runs a
 * FIXED program (`TEST_SOURCE`) as a cell is run — never a path or a source the page names. The Windows setup window
 * is the installer's own script, started by main/toolSetup.ts (not a person's tool, so not in this folder).
 *
 * WHAT OPENING THE SCREEN DOES: reads the file system (`report`), and nothing else. Apple's `/usr/bin/python3` asks
 * to install the Command Line Tools when it is merely run, so a screen that probed every copy it found on open would
 * put that dialog up for opening a window.
 */

import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import type { IpcMain, WebContents } from "electron"
import {
  EVALUATORS, identified, isEvaluator, TEST_SOURCE, tested, type Evaluator, type TestAnswer,
} from "@writemind/core"
import {
  isLinkId, isSetupAction, LANGUAGE_CHANNELS, LINKS, pickerOptions, readLanguageSettings, setupSentence,
  writeLanguageSettings, type ChooseAnswer, type LanguageReport, type PickerOptions, type SetupAction, type SetupAnswer,
} from "../../shared/languages"
import { writeFileAtomic } from "../atomic"
import type { Runner } from "./runner"
import {
  choiceProblem, foundTools, identifyArguments, resolveChoice, toolReport, wolframLicence, type ToolPlaces,
} from "./tools"

// MARK: - The choices

export interface LanguageStore {
  /** The choices as the file has them now: read again whenever the file changed (a hand edit, a folder move). */
  get(): Partial<Record<Evaluator, string>>
  /** Choose (a path) or forget (null) one language's program: written first, and only then taken as the choice. */
  set(evaluator: Evaluator, file: string | null): Promise<void>
}

/** The file system the store uses; the real one unless a test hands it another. */
export interface StoreFs {
  /** Null when there is no file. */
  stat(file: string): { mtimeMs: number; size: number } | null
  /** Throws when the file is there and cannot be read. */
  read(file: string): string
  write(file: string, text: string): Promise<void>
  copy(from: string, to: string): void
  makeFolder(dir: string): void
}

const realFs: StoreFs = {
  stat: (file) => {
    try {
      const facts = statSync(file)
      return { mtimeMs: facts.mtimeMs, size: facts.size }
    } catch { return null }
  },
  read: (file) => readFileSync(file, "utf8"),
  write: (file, text) => writeFileAtomic(file, text),
  copy: (from, to) => copyFileSync(from, to),
  makeFolder: (dir) => { mkdirSync(dir, { recursive: true }) },
}

/**
 * userData/languages.json. `get()` is asked for every run (the runner's places), so it is a `stat` and, only when
 * the file's time or size moved, a read: a hand edit — or `notesFolderMove.rewriteRemembered`, which rewrites every
 * JSON file there — applies at the next run without a restart. `set()`s go one after another; each writes the whole
 * file (atomically) and only THEN becomes the choice, so a write that fails leaves the choices what the disk says.
 * A file that is there but could not be taken whole (not JSON, another version, an entry the reader dropped) is
 * copied aside as `languages.unreadable-<time>.json` before the first write replaces it — the sheets.ts rule: a
 * person's file is never lost to a write of ours.
 */
export function createLanguageStore(file: string, platform: string, fsDeps: StoreFs = realFs): LanguageStore {
  let memory: Partial<Record<Evaluator, string>> = {}
  /** The file as it was when `memory` was read from it (null: no file); undefined until it has been looked at. */
  let seen: { mtimeMs: number; size: number } | null | undefined
  let keepAside = false
  let queue: Promise<unknown> = Promise.resolve()

  const sameFile = (a: { mtimeMs: number; size: number } | null, b: { mtimeMs: number; size: number } | null) =>
    a === null || b === null ? a === b : a.mtimeMs === b.mtimeMs && a.size === b.size

  /** Whether the reader took every entry the text has: if not, the text holds something a write would lose. */
  const takenWhole = (text: string, read: Partial<Record<Evaluator, string>>): boolean => {
    try {
      const parsed = JSON.parse(text.replace(/^﻿/, "")) as { version?: unknown; tools?: unknown } | null
      const tools = parsed?.tools
      return parsed?.version === 1 && typeof tools === "object" && tools !== null && !Array.isArray(tools)
        && Object.keys(tools).length === Object.keys(read).length
    } catch { return false }
  }

  function get(): Partial<Record<Evaluator, string>> {
    const now = fsDeps.stat(file)
    if (seen !== undefined && sameFile(now, seen)) return memory
    seen = now
    if (now === null) { memory = {}; keepAside = false; return memory }
    let text: string
    try {
      text = fsDeps.read(file)
    } catch {
      // Locked or unreadable: no choices for now (asked again at the next look, a lock being a moment's), and the
      // file is kept aside before anything replaces it.
      memory = {}
      keepAside = true
      seen = undefined
      return memory
    }
    memory = readLanguageSettings(text, platform)
    keepAside = text.trim().length > 0 && !takenWhole(text, memory)
    return memory
  }

  function set(evaluator: Evaluator, chosen: string | null): Promise<void> {
    const turn = queue.then(async () => {
      const next = { ...get() }
      if (chosen === null) delete next[evaluator]
      else next[evaluator] = chosen
      fsDeps.makeFolder(path.dirname(file))
      if (keepAside) {
        try {
          fsDeps.copy(file, path.join(path.dirname(file), `languages.unreadable-${Date.now()}.json`))
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error
        }
        keepAside = false
      }
      await fsDeps.write(file, writeLanguageSettings(next))
      // ONLY NOW is it the choice: the disk has it.
      memory = next
      seen = fsDeps.stat(file)
    })
    queue = turn.catch(() => undefined)
    return turn
  }

  return { get, set }
}

// MARK: - The screen's questions

/** The installer's script, run for the screen (main/toolSetup.ts): the result INI it wrote, or null when none. */
export interface ToolSetup {
  start(action: SetupAction, wolframscript: string | null): Promise<Record<string, string> | null>
}

export interface LanguagesHost {
  store: LanguageStore
  runner: Runner
  platform: string
  /** This machine's places with the store's choices (`placesFromProcess(store.get())`), afresh for each question. */
  places(): ToolPlaces
  /** The open panel (main.ts `askOpen`, which an end-to-end script can answer ahead of time). */
  ask(options: PickerOptions): Promise<{ canceled: boolean; filePaths: string[] }>
  /** A page in the browser. */
  open(url: string): Promise<void> | void
  /** Null where the installer's script is not beside the app (everywhere but an installed Windows copy). */
  setup: ToolSetup | null
  /** Whether winget is there (Install needs it; Activate does not). */
  winget: boolean
  /** Where the setup window writes its log (said when something went wrong). */
  log: string
  /** Tell the window (the screen and every open note's cell marks) what is in use now. */
  broadcast(report: LanguageReport): void
}

/** Larger than any path; a payload past it is not one. */
const MAX_FILE = 4096

/** The Store's app execution aliases: in use when nothing else is there, never offered as "also on this computer". */
const STORE_ALIAS = /[\\/]Microsoft[\\/]WindowsApps[\\/]/i

const identifyId = (evaluator: Evaluator) => `languages:identify:${evaluator}`
const testId = (evaluator: Evaluator) => `languages:test:${evaluator}`

export function registerLanguages(ipc: Pick<IpcMain, "handle">, host: LanguagesHost): void {
  let running: SetupAction | null = null
  let last: { action: SetupAction; said: string } | null = null
  /** What the window was last told is in use, so a look that finds the same thing tells it nothing. */
  let lastSent: string | null = null

  const owned = new Map<number, Set<string>>()
  const own = (sender: WebContents, id: string) => {
    let ids = owned.get(sender.id)
    if (!ids) {
      ids = new Set()
      owned.set(sender.id, ids)
      const senderId = sender.id
      // The page closed or reloaded: a check or a test it started is nobody's any more.
      sender.once("destroyed", () => {
        for (const one of owned.get(senderId) ?? []) host.runner.cancel(one)
        owned.delete(senderId)
      })
    }
    ids.add(id)
  }
  const disown = (sender: WebContents, id: string) => { owned.get(sender.id)?.delete(id) }

  /** The screen's report: the file system and nothing else. */
  function report(): LanguageReport {
    const places = host.places()
    const tools = toolReport(places)
    const real = places.realPath ?? ((file: string) => file)
    const key = (file: string) => (host.platform === "win32" ? real(file).toLowerCase() : real(file))
    const others = {} as Record<Evaluator, string[]>
    for (const evaluator of EVALUATORS) {
      const inUse = tools[evaluator].path
      others[evaluator] = foundTools(evaluator, places)
        .filter((file) => !STORE_ALIAS.test(file) && (inUse === null || key(file) !== key(inUse)))
        .slice(0, 5)
    }
    return { tools, others, licence: tools.wolfram.path === null ? null : wolframLicence(places), setup: { running, last } }
  }

  const push = (now: LanguageReport) => {
    lastSent = JSON.stringify(now.tools)
    host.broadcast(now)
  }

  /** The picked program asked what it is, then saved, then the window told. Nothing is saved or told on a refusal. */
  async function confirm(sender: WebContents, evaluator: Evaluator, file: string): Promise<ChooseAnswer> {
    let said: string | null = null
    if (identifyArguments(evaluator, file) !== null) {
      const id = identifyId(evaluator)
      own(sender, id)
      try {
        const outcome = await host.runner.identify(id, evaluator, file)
        if (outcome.kind === "cancelled") return { kind: "cancelled" }
        const answer = identified(evaluator, outcome)
        if (!answer.ok) return { kind: "refused", problem: answer.problem, ...(answer.command ? { command: answer.command } : {}) }
        said = answer.said
      } finally { disown(sender, id) }
    }
    try {
      await host.store.set(evaluator, file)
    } catch (error) {
      return { kind: "refused", problem: `WriteMind could not save the choice: ${error instanceof Error ? error.message : String(error)}.` }
    }
    const now = report()
    push(now)
    return { kind: "chosen", report: now, said }
  }

  const notALanguage: ChooseAnswer = { kind: "refused", problem: "That is not a language WriteMind runs." }

  ipc.handle(LANGUAGE_CHANNELS.report, () => {
    const now = report()
    // A look that finds something new (an install finished in another window) tells the open notes too.
    if (JSON.stringify(now.tools) !== lastSent) push(now)
    return now
  })

  ipc.handle(LANGUAGE_CHANNELS.choose, async (event, raw: unknown): Promise<ChooseAnswer> => {
    if (!isEvaluator(raw)) return notALanguage
    const evaluator = raw
    const entry = toolReport(host.places())[evaluator]
    const picked = await host.ask(pickerOptions(evaluator, host.platform, entry.path ?? entry.chosen?.path ?? null))
    const first = picked.filePaths[0]
    if (picked.canceled || typeof first !== "string" || first.length === 0) return { kind: "cancelled" }
    const places = host.places()
    const resolved = resolveChoice(evaluator, first, places)
    if ("problem" in resolved) return { kind: "refused", problem: resolved.problem }
    const problem = choiceProblem(evaluator, resolved.file, places)
    if (problem) return { kind: "refused", problem }
    return confirm(event.sender, evaluator, resolved.file)
  })

  ipc.handle(LANGUAGE_CHANNELS.use, async (event, raw: unknown, file: unknown): Promise<ChooseAnswer> => {
    if (!isEvaluator(raw)) return notALanguage
    if (typeof file !== "string" || file.length === 0 || file.length > MAX_FILE) {
      return { kind: "refused", problem: "That is not a program WriteMind found." }
    }
    const places = host.places()
    // ONLY ONE OF THE COPIES THE SCREEN WAS SHOWN: the page cannot name any other file and have it run.
    if (!foundTools(raw, places).includes(file)) return { kind: "refused", problem: "That is not a program WriteMind found." }
    const problem = choiceProblem(raw, file, places)
    if (problem) return { kind: "refused", problem }
    return confirm(event.sender, raw, file)
  })

  ipc.handle(LANGUAGE_CHANNELS.automatic, async (_event, raw: unknown): Promise<LanguageReport> => {
    if (!isEvaluator(raw)) return report()
    await host.store.set(raw, null)
    const now = report()
    push(now)
    return now
  })

  ipc.handle(LANGUAGE_CHANNELS.test, async (event, raw: unknown): Promise<TestAnswer> => {
    if (!isEvaluator(raw)) return { kind: "failed", problem: "That is not a language WriteMind runs." }
    const evaluator = raw
    // The program is the main process's answer, never the page's: the one a cell would run with now.
    const tool = host.runner.tools()[evaluator].path
    const id = testId(evaluator)
    own(event.sender, id)
    try {
      const outcome = await host.runner.run({ id, evaluator, source: TEST_SOURCE[evaluator] })
      return tested(evaluator, outcome, tool)
    } finally { disown(event.sender, id) }
  })

  ipc.handle(LANGUAGE_CHANNELS.cancel, (_event, raw: unknown) => {
    if (!isEvaluator(raw)) return
    host.runner.cancel(identifyId(raw))
    host.runner.cancel(testId(raw))
  })

  ipc.handle(LANGUAGE_CHANNELS.setup, (_event, raw: unknown): SetupAnswer => {
    if (!isSetupAction(raw)) return { kind: "refused", problem: "That is not something Language Setup does." }
    const setup = host.setup
    if (!setup) return { kind: "refused", problem: "WriteMind cannot set languages up on this computer." }
    if (raw !== "activate" && !host.winget) return { kind: "refused", problem: "winget is not on this computer, so nothing can be installed from here." }
    if (running) return { kind: "refused", problem: "Another setup window is still open." }
    const action = raw
    running = action
    last = null
    // Activate the program the cells actually use, not whichever the script would find by itself.
    const wolframscript = toolReport(host.places()).wolfram.path
    push(report())
    const finish = (result: Record<string, string> | null) => {
      running = null
      const places = host.places()
      const tools = toolReport(places)
      const foundAfter = action === "python" ? tools.python.path !== null
        : action === "wolfram" ? tools.wolfram.path !== null
          : wolframLicence(places)
      last = { action, said: setupSentence(action, result, foundAfter, host.log) }
      push(report())
    }
    void setup.start(action, wolframscript).then(finish, () => finish(null))
    return { kind: "started" }
  })

  ipc.handle(LANGUAGE_CHANNELS.open, async (_event, raw: unknown) => {
    if (isLinkId(raw)) await host.open(LINKS[raw])
  })
}
