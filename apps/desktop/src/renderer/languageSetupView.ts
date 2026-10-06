/**
 * WHAT FILE ▸ LANGUAGE SETUP… SHOWS, row by row — pure, so every sentence and every button rule is a test
 * (test/languageSetupView.test.ts) and LanguageSetupDialog.tsx only draws what this returns. Port-only.
 *
 * A row is one language: what it runs with (the path), where that came from (found by itself, chosen, a choice that
 * has gone, or nothing found), the last check or test said in a line, and the buttons that make sense for that
 * state. THE SIDE THAT CANNOT DO A THING SHOWS NOTHING: Install is offered only where the installer's script and
 * winget are there (`installsLanguages`), Activate only where the script is (`activatesWolfram`), and everywhere
 * else the same rows offer the download page (Get …) and the command to type instead. C, C++ and Rust have no
 * installer of their own to point at, so they get neither.
 *
 * A PYTHON THAT IS ONLY A FILE CALLED PYTHON IS NOT A PYTHON (`report.foundPython`, read off the file system):
 * Windows' Microsoft Store shortcut is on the PATH of every stock Windows, and Apple's /usr/bin/python3 is on every
 * Mac, so "found" alone would hide Install Python… and Get Python… on exactly the machines that need them. Such a
 * row says what it found, in amber, and offers them as if nothing were found.
 */

import {
  evaluatorTitle, toolNames, wolframCommand, type Evaluator,
} from "@writemind/core"
import { isPlaceholder, type FoundPython, type LanguageReport, type LinkId, type SetupAction } from "../shared/languages"

export const LANGUAGE_SETUP_TITLE = "Language Setup"
export const LANGUAGE_SETUP_INTRO = "The program each kind of evaluation cell runs with. WriteMind finds these by itself; "
  + "choose one to use a different program, such as the Python in a virtual environment. A change applies the next time a cell runs."

/** Wolfram and Python are always shown; these three sit in a section that opens when one of them is asked for. */
export const ALWAYS_SHOWN: Evaluator[] = ["wolfram", "python"]
export const MORE: Evaluator[] = ["c", "cpp", "rust"]

/** A row's own memory, kept by the dialog while it is open. */
export interface RowMemory {
  /** A check running now, or the last one's answer and the program it was about (null: nothing said yet). */
  check:
    | { kind: "identifying" }
    | { kind: "testing" }
    | { kind: "works"; said: string; about: string | null }
    | { kind: "failed"; problem: string; command?: string; about: string | null }
    | null
  /** Choose… or Use refused: the sentence, until the row's next press. */
  problem: { text: string; command?: string } | null
}

export const NO_MEMORY: RowMemory = { check: null, problem: null }

/** What this machine can do for a language, from the one place that asks (`capabilitiesFor`). */
export interface SetupCaps { installsLanguages: boolean; activatesWolfram: boolean }

export type RowState = "found" | "chosen" | "chosenUnusable" | "notFound"

export interface RowView {
  evaluator: Evaluator
  title: string
  /** The program's names, grey beside the title: "py, python3 or python". */
  names: string
  /** The program in use, or null. */
  path: string | null
  state: RowState
  /** Where the program came from, in a sentence. */
  source: string
  /** A command to copy after it (Apple's stand-in: `xcode-select --install`), or null. */
  sourceCommand: string | null
  /** The source line is a warning: drawn amber, and read out (`role=alert`) for a choice that has gone. */
  amber: boolean
  alert: boolean
  /** A check or a test is running in this row: its buttons wait, and Stop takes it back. */
  busy: boolean
  /** "Checking…", "Testing…", "Works: …", "Did not work: …" — with a command to copy when there is one. */
  check: { text: string; command: string | null } | null
  problem: { text: string; command: string | null } | null
  /** Wolfram's "not activated yet", with Activate… or the command to type. */
  licence: { text: string; activate: boolean; command: string | null } | null
  automatic: boolean
  test: boolean
  /** Install… (the setup window) and Get… (the download page): at most one of them, and neither for C, C++, Rust. */
  install: { label: string; action: SetupAction } | null
  get: { label: string; link: LinkId } | null
  /** A setup window is open (anywhere): Install and Activate wait for it. */
  setupBusy: boolean
  /**
   * What the last setup window this dialog started for the row said when it ended — beside the setup line, never
   * instead of it: a failed Install Wolfram Engine… is offered again, and its licence notice goes with it.
   */
  setupSaid: string | null
  /** The line under the buttons about setting the language up, and whether the licence link goes with it. */
  setupLine: { text: string; terms: boolean } | null
  /** "Also on this computer": other copies, each with Use. */
  others: string[]
}

/** "gcc, clang or cl". */
export const orList = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`

/** Which setup a language's row shows the state of (Activate is the Wolfram row's too). */
const rowActions = (evaluator: Evaluator): SetupAction[] =>
  evaluator === "python" ? ["python"] : evaluator === "wolfram" ? ["wolfram", "activate"] : []

const installs = (evaluator: Evaluator): { label: string; action: SetupAction; get: string; link: LinkId } | null =>
  evaluator === "python" ? { label: "Install Python…", action: "python", get: "Get Python…", link: "python" }
    : evaluator === "wolfram" ? { label: "Install Wolfram Engine…", action: "wolfram", get: "Get Wolfram Engine…", link: "wolframEngine" }
      : null

export const INSTALL_PYTHON_LINE = "Python 3.14 from python.org, for you only (no administrator). winget installs it in a window "
  + "of its own; WriteMind looks again when that window closes."
export const INSTALL_WOLFRAM_LINE = "Free for developers; about 3 GB. Windows asks to allow it (it goes in Program Files), and "
  + "installing it accepts Wolfram's licence. A window then opens where you sign in with your own Wolfram ID; WriteMind never sees it."
export const GET_LINE = "Opens the download page. Install it, then come back to this window."
export const APPLE_PYTHON_LINE = "This is Apple's python3, an older Python that comes with Apple's Command Line Tools. "
  + "A python.org or Homebrew Python is newer and more complete: Get Python… opens the download page."
export const NOT_ACTIVATED = "Not activated yet: there is no licence file where activation leaves one. Activate it once with "
  + "your own Wolfram ID (free at wolfram.com)."

/** What a row says about a Python that is only a stand-in, after "Found automatically, but". */
const STAND_IN: Record<Exclude<FoundPython, "apple">, string> = {
  storeAlias: "this is Windows' shortcut to the Microsoft Store, not a Python.",
  pyLauncher: "this is only the py launcher, and WriteMind found no Python 3 installed for it to start.",
  appleStandIn: "this is Apple's stand-in for python3, which runs nothing until Apple's Command Line Tools are installed.",
}

/**
 * One row. `started` is the setups THIS dialog started: what a setup window said when it ended is said in the
 * dialog that asked for it, and not in every Language Setup opened afterwards ("Python installed." under a row
 * that has long been fine).
 */
export function rowView(evaluator: Evaluator, report: LanguageReport, memory: RowMemory, caps: SetupCaps,
  started: readonly SetupAction[] = []): RowView {
  const entry = report.tools[evaluator]
  const title = evaluatorTitle(evaluator)
  const chosen = entry.chosen
  const state: RowState = chosen ? (chosen.problem === null ? "chosen" : "chosenUnusable") : entry.path ? "found" : "notFound"
  // Only a Python found by itself can be a stand-in; a chosen one was asked its version before it was kept.
  const foundPython = evaluator === "python" && state === "found" ? report.foundPython ?? null : null
  const standIn = isPlaceholder(foundPython)
  let source: string
  let sourceCommand: string | null = null
  switch (state) {
    case "found":
      source = standIn ? `Found automatically, but ${STAND_IN[foundPython as Exclude<FoundPython, "apple">]}` : "Found automatically."
      if (foundPython === "appleStandIn") sourceCommand = "xcode-select --install"
      break
    case "chosen": source = "Chosen by you."; break
    case "chosenUnusable":
      source = chosen!.problem === "unreadable"
        ? `WriteMind could not read the file that keeps your choices (${chosen!.path}), so it does not know what you chose. `
          + `${title} cells will not run until it can; it reads the file again each time it looks.`
        : `${chosen!.problem === "gone" ? "The program you chose is not there any more" : "The program you chose is not a program WriteMind can start any more"}: `
          + `${chosen!.path}. ${title} cells will not run until you choose another or press Find Automatically.`
      break
    case "notFound": source = `Not found. WriteMind looked for ${entry.looked.join(", ")}.`; break
  }

  const check = memory.check
  const busy = check?.kind === "identifying" || check?.kind === "testing"
  let checkLine: RowView["check"] = null
  if (check?.kind === "identifying") checkLine = { text: "Checking…", command: null }
  else if (check?.kind === "testing") {
    checkLine = { text: evaluator === "wolfram" ? "Testing… (the Wolfram engine can take a few seconds to start)" : "Testing…", command: null }
  } else if (check && check.about === entry.path) {
    // An answer is about the program it was asked of: once another is in use, it says nothing about this one.
    checkLine = check.kind === "works"
      ? { text: `Works: ${check.said}`, command: null }
      : { text: `Did not work: ${check.problem}`, command: check.command ?? null }
  }
  const works = checkLine !== null && check?.kind === "works"

  // NOT ACTIVATED: only for a wolframscript in use, only when no licence file is where activation leaves one, and
  // never under a Test that just showed it working (a site licence, a network one: the file is not the only way).
  const licence: RowView["licence"] = evaluator === "wolfram" && entry.path !== null && report.licence === false && !works
    ? caps.activatesWolfram
      ? { text: NOT_ACTIVATED, activate: true, command: null }
      : { text: NOT_ACTIVATED, activate: false, command: `${wolframCommand(entry.path)} -activate` }
    : null

  // Nothing found, or a Python that is only a stand-in: Install or Get. Apple's real python3 is offered Get too —
  // it runs, and it is old (the Mac has no Install).
  const offer = state === "notFound" || foundPython !== null ? installs(evaluator) : null
  const install = offer && caps.installsLanguages ? { label: offer.label, action: offer.action } : null
  const get = offer && !caps.installsLanguages ? { label: offer.get, link: offer.link } : null

  const running = report.setup.running
  const last = report.setup.last
  const setupSaid = !running && last && rowActions(evaluator).includes(last.action) && started.includes(last.action) ? last.said : null
  let setupLine: RowView["setupLine"] = null
  if (running && rowActions(evaluator).includes(running)) {
    setupLine = { text: running === "activate" ? "Sign in with your Wolfram ID in the window that opened."
      : "Installing in the window that opened. WriteMind looks again when it closes.", terms: false }
  } else if (install) {
    setupLine = install.action === "python" ? { text: INSTALL_PYTHON_LINE, terms: false } : { text: INSTALL_WOLFRAM_LINE, terms: true }
  } else if (get) {
    setupLine = { text: foundPython === "apple" ? APPLE_PYTHON_LINE : GET_LINE, terms: false }
  }

  return {
    evaluator, title, names: orList(toolNames(evaluator)), path: entry.path, state, source, sourceCommand,
    amber: state === "chosenUnusable" || state === "notFound" || standIn, alert: state === "chosenUnusable",
    busy, check: checkLine,
    problem: memory.problem ? { text: memory.problem.text, command: memory.problem.command ?? null } : null,
    licence,
    // Not for a settings file that cannot be read: forgetting a choice is a write, and that file is refused one.
    automatic: chosen !== undefined && chosen.problem !== "unreadable",
    test: entry.path !== null,
    install, get,
    setupBusy: running !== null,
    setupSaid,
    setupLine,
    others: report.others[evaluator] ?? [],
  }
}

/**
 * WHERE THE KEYBOARD GOES BACK TO when a press took away the very button that had it (Find Automatically once
 * nothing is chosen, a Use whose copy is now in use, Install… once the language is found, Choose… while its check
 * runs) and the focus fell to the page behind the dialog, where Escape and Tab no longer reach it: the row it was
 * in — its Stop while a check runs there (Choose… waits then), else its Choose… — or Done when no row had it.
 */
export function keyboardHome(view: RowView | null): "stop" | "choose" | "done" {
  return view === null ? "done" : view.busy ? "stop" : "choose"
}

/** Whether "C, C++ and Rust" opens: one of them has a choice, or the screen was opened at one of them. */
export function moreOpen(report: LanguageReport, focus: Evaluator | null): boolean {
  return MORE.some((evaluator) => report.tools[evaluator].chosen !== undefined) || (focus !== null && MORE.includes(focus))
}
