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
 */

import {
  evaluatorTitle, toolNames, wolframCommand, type Evaluator,
} from "@writemind/core"
import type { LanguageReport, LinkId, SetupAction } from "../shared/languages"

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
export const NOT_ACTIVATED = "Not activated yet: there is no licence file where activation leaves one. Activate it once with "
  + "your own Wolfram ID (free at wolfram.com)."

export function rowView(evaluator: Evaluator, report: LanguageReport, memory: RowMemory, caps: SetupCaps): RowView {
  const entry = report.tools[evaluator]
  const title = evaluatorTitle(evaluator)
  const chosen = entry.chosen
  const state: RowState = chosen ? (chosen.problem === null ? "chosen" : "chosenUnusable") : entry.path ? "found" : "notFound"
  let source: string
  switch (state) {
    case "found": source = "Found automatically."; break
    case "chosen": source = "Chosen by you."; break
    case "chosenUnusable":
      source = `${chosen!.problem === "gone" ? "The program you chose is not there any more" : "The program you chose is not a program WriteMind can start any more"}: `
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

  const offer = state === "notFound" ? installs(evaluator) : null
  const install = offer && caps.installsLanguages ? { label: offer.label, action: offer.action } : null
  const get = offer && !caps.installsLanguages ? { label: offer.get, link: offer.link } : null

  const running = report.setup.running
  const last = report.setup.last
  let setupLine: RowView["setupLine"] = null
  if (running && rowActions(evaluator).includes(running)) {
    setupLine = { text: running === "activate" ? "Sign in with your Wolfram ID in the window that opened."
      : "Installing in the window that opened. WriteMind looks again when it closes.", terms: false }
  } else if (last && rowActions(evaluator).includes(last.action)) {
    setupLine = { text: last.said, terms: false }
  } else if (install) {
    setupLine = install.action === "python" ? { text: INSTALL_PYTHON_LINE, terms: false } : { text: INSTALL_WOLFRAM_LINE, terms: true }
  } else if (get) {
    setupLine = { text: GET_LINE, terms: false }
  }

  return {
    evaluator, title, names: orList(toolNames(evaluator)), path: entry.path, state, source,
    amber: state === "chosenUnusable" || state === "notFound", alert: state === "chosenUnusable",
    busy, check: checkLine,
    problem: memory.problem ? { text: memory.problem.text, command: memory.problem.command ?? null } : null,
    licence,
    automatic: chosen !== undefined,
    test: entry.path !== null,
    install, get,
    setupBusy: running !== null,
    setupLine,
    others: report.others[evaluator] ?? [],
  }
}

/** Whether "C, C++ and Rust" opens: one of them has a choice, or the screen was opened at one of them. */
export function moreOpen(report: LanguageReport, focus: Evaluator | null): boolean {
  return MORE.some((evaluator) => report.tools[evaluator].chosen !== undefined) || (focus !== null && MORE.includes(focus))
}
