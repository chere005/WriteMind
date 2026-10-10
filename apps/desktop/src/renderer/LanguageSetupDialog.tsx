/**
 * File ▸ Language Setup… (main/eval/languages.ts, shared/languages.ts): the program each kind of evaluation cell runs
 * with, and choosing another. Port-only — the Mac's is `defaults write … evalTool.<name>`, with no screen. The app's
 * own small dialog, shaped as CleanUpDialog is: one row per language (languageSetupView.ts says what each row
 * shows), Wolfram and Python always, C, C++ and Rust folded under them. Every choice is saved when it is made, so
 * there is [Done] and nothing to apply or cancel; Escape or a click outside is Done too, and takes back a check or a
 * test still running.
 *
 * OPENING IT STARTS NOTHING. It reads the report (the file system) when it opens and again whenever the window comes
 * back to the front — the way an install finished in another window is seen — and follows the shell's push. A
 * program is started only from a press: Choose… and Use ask it its version, Test runs a fixed program. The calls that
 * do that are in the `press…` functions below and are reached from `onClick` and nothing else
 * (test/evalRunner.test.ts reads this file to keep it so).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { EVALUATORS, type Evaluator, type TestAnswer } from "@writemind/core"
import { Modal } from "./Modal"
import {
  ALWAYS_SHOWN, keyboardHome, LANGUAGE_SETUP_INTRO, LANGUAGE_SETUP_TITLE, MORE, moreOpen, NO_MEMORY, rowView,
  type RowMemory, type RowView, type SetupCaps,
} from "./languageSetupView"
import type { ChooseAnswer, LanguageReport, LinkId, SetupAction } from "../shared/languages"
import type { Platform } from "./wm"
import "./cleanUp.css"
import "./languageSetup.css"

interface Props {
  platform: string
  /** What this machine can do (`app:capabilities`): Install and Activate are offered only where it can. */
  capabilities: Platform | null
  /** The language the screen opens at (the Runs As menu's Language Setup…), or null. */
  focus: Evaluator | null
  onClose(): void
}

type Memory = Partial<Record<Evaluator, RowMemory>>

/** A command to type, with a button that puts it on the clipboard. */
function Command({ command }: { command: string }) {
  return (
    <span className="language-command">
      <code>{command}</code>
      <button type="button" data-language-action="copy" onClick={() => { void navigator.clipboard?.writeText(command).catch(() => undefined) }}>
        Copy Command
      </button>
    </span>
  )
}

export function LanguageSetupDialog({ platform, capabilities, focus, onClose }: Props) {
  const [report, setReport] = useState<LanguageReport | null>(null)
  const [memory, setMemory] = useState<Memory>({})
  const [more, setMore] = useState<boolean | null>(null)
  /** The setups pressed in THIS dialog: what their windows said is said here, and not in a later Language Setup. */
  const [started, setStarted] = useState<SetupAction[]>([])
  const done = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  /** The row the keyboard was last in (each row's onFocus), so it can be given back there. */
  const keyboardRow = useRef<Evaluator | null>(focus)
  const reportNow = useRef<LanguageReport | null>(null)
  reportNow.current = report
  const memoryNow = useRef<Memory>(memory)
  memoryNow.current = memory
  const caps: SetupCaps = {
    installsLanguages: capabilities?.installsLanguages === true,
    activatesWolfram: capabilities?.activatesWolfram === true,
  }

  // THE REPORT: now, whenever the window comes back to the front, and whenever the shell says it changed.
  useEffect(() => {
    const api = window.wm.languages
    let live = true
    const look = () => { void api?.report().then((now) => { if (live) setReport(now) }, () => undefined) }
    look()
    window.addEventListener("focus", look)
    const off = api?.onChanged((now) => { if (live) setReport(now) }) ?? (() => {})
    done.current?.focus()
    return () => {
      live = false
      window.removeEventListener("focus", look)
      off()
    }
  }, [])

  // The first report decides whether C, C++ and Rust are open, and where the keyboard goes: Done, or the Choose… of
  // the language the screen was opened at.
  useEffect(() => {
    if (!report || more !== null) return
    setMore(moreOpen(report, focus))
  }, [report, more, focus])
  const placed = useRef(false)
  useEffect(() => {
    // Once, when the rows first appear.
    if (placed.current || more === null) return
    placed.current = true
    if (focus === null) return
    const choose = dialog.current?.querySelector<HTMLButtonElement>(`[data-language-row="${focus}"] [data-language-action="choose"]`)
    if (!choose) return
    choose.focus()
    choose.scrollIntoView({ block: "nearest" })
  }, [more, focus])

  // THE KEYBOARD STAYS IN THE DIALOG. A press can take away the very button that had it — Find Automatically once
  // nothing is chosen, a Use whose copy is now in use, Install… once the language is found, Choose… while its own
  // check runs — and the focus then falls to the page behind, where Escape and Tab no longer reach this dialog.
  // After every change, a dialog that has lost it gives it back (`keyboardHome`): CleanUpDialog's rule, kept to the
  // moments the focus was actually lost, so a person's own Tab is never overridden.
  useEffect(() => {
    const here = dialog.current
    if (!here || !report) return
    const active = document.activeElement
    if (active instanceof HTMLElement && here.contains(active) && !(active instanceof HTMLButtonElement && active.disabled)) return
    const evaluator = keyboardRow.current
    const home = keyboardHome(evaluator ? rowView(evaluator, report, memory[evaluator] ?? NO_MEMORY, caps, started) : null)
    const button = home === "done" ? null
      : here.querySelector<HTMLButtonElement>(`[data-language-row="${evaluator}"] [data-language-action="${home}"]`)
    button?.focus()
    // A row folded away under C, C++ and Rust cannot take it: Done can.
    if (document.activeElement !== button) done.current?.focus()
  })

  const remember = (evaluator: Evaluator, next: RowMemory) => setMemory((was) => ({ ...was, [evaluator]: next }))

  const close = useCallback(() => {
    // Whatever a row is still checking or testing is taken back with the screen.
    for (const evaluator of EVALUATORS) {
      const check = memoryNow.current[evaluator]?.check
      if (check?.kind === "identifying" || check?.kind === "testing") void window.wm.languages?.cancel(evaluator)
    }
    onClose()
  }, [onClose])

  /** What a Choose… or a Use came back with, said in its row. */
  const chooseAnswered = (evaluator: Evaluator, before: RowMemory, answer: ChooseAnswer | undefined) => {
    if (!answer || answer.kind === "cancelled") { remember(evaluator, { ...before, problem: null }); return }
    if (answer.kind === "refused") {
      remember(evaluator, { check: before.check, problem: { text: answer.problem, ...(answer.command ? { command: answer.command } : {}) } })
      return
    }
    setReport(answer.report)
    const about = answer.report.tools[evaluator].path
    remember(evaluator, { check: answer.said ? { kind: "works", said: answer.said, about } : null, problem: null })
  }

  // MARK: The presses. Each is reached from an onClick and from nothing else.

  const pressChoose = async (evaluator: Evaluator) => {
    const before = memoryNow.current[evaluator] ?? NO_MEMORY
    remember(evaluator, { check: { kind: "identifying" }, problem: null })
    const answer = await window.wm.languages?.choose(evaluator).catch((error: unknown) =>
      ({ kind: "refused", problem: error instanceof Error ? error.message : String(error) }) as ChooseAnswer)
    chooseAnswered(evaluator, before, answer)
  }

  const pressUse = async (evaluator: Evaluator, file: string) => {
    const before = memoryNow.current[evaluator] ?? NO_MEMORY
    remember(evaluator, { check: { kind: "identifying" }, problem: null })
    const answer = await window.wm.languages?.use(evaluator, file).catch((error: unknown) =>
      ({ kind: "refused", problem: error instanceof Error ? error.message : String(error) }) as ChooseAnswer)
    chooseAnswered(evaluator, before, answer)
  }

  const pressTest = async (evaluator: Evaluator) => {
    const about = reportNow.current?.tools[evaluator].path ?? null
    remember(evaluator, { check: { kind: "testing" }, problem: null })
    const answer: TestAnswer = await window.wm.languages?.test(evaluator).catch((error: unknown) =>
      ({ kind: "failed", problem: error instanceof Error ? error.message : String(error) }) as TestAnswer)
      ?? { kind: "cancelled" }
    if (answer.kind === "cancelled") { remember(evaluator, NO_MEMORY); return }
    remember(evaluator, {
      check: answer.kind === "works" ? { kind: "works", said: answer.said, about }
        : { kind: "failed", problem: answer.problem, ...(answer.command ? { command: answer.command } : {}), about },
      problem: null,
    })
  }

  const automatic = (evaluator: Evaluator) => {
    remember(evaluator, NO_MEMORY)
    void window.wm.languages?.automatic(evaluator).then(setReport, (error: unknown) =>
      remember(evaluator, { check: null, problem: { text: error instanceof Error ? error.message : String(error) } }))
  }

  const stop = (evaluator: Evaluator) => { void window.wm.languages?.cancel(evaluator) }

  const setUp = (evaluator: Evaluator, action: SetupAction) => {
    setStarted((was) => (was.includes(action) ? was : [...was, action]))
    void window.wm.languages?.setup(action).then((answer) => {
      if (answer.kind === "refused") remember(evaluator, { ...(memoryNow.current[evaluator] ?? NO_MEMORY), problem: { text: answer.problem } })
    })
  }

  const open = (link: LinkId) => { void window.wm.languages?.open(link) }

  const row = (view: RowView) => {
    const e = view.evaluator
    return (
      <div key={e} className="language-row" data-language-row={e} onFocus={() => { keyboardRow.current = e }}>
        <div className="language-head">
          <span className="language-title">{view.title}</span>
          <span className="language-names">{view.names}</span>
        </div>
        {view.path && <div className="language-path" data-language-path>{view.path}</div>}
        <div className={`language-source${view.amber ? " amber" : ""}`} data-language-source
             {...(view.alert ? { role: "alert" } : {})}>
          {view.source}{view.sourceCommand && <> <Command command={view.sourceCommand} /></>}
        </div>
        <div className="language-check" data-language-check aria-live="polite">
          {view.check && <>{view.check.text}{view.check.command && <> <Command command={view.check.command} /></>}</>}
        </div>
        {view.licence && (
          <div className="language-licence" data-language-licence>
            {view.licence.text}
            {view.licence.activate
              ? <> <button type="button" data-language-action="activate" disabled={view.setupBusy}
                          onClick={() => setUp(e, "activate")}>Activate…</button></>
              : <> Run this once in a terminal: <Command command={view.licence.command!} /></>}
          </div>
        )}
        {view.problem && (
          <p className="problem" role="alert" data-language-problem>
            {view.problem.text}{view.problem.command && <> <Command command={view.problem.command} /></>}
          </p>
        )}
        <div className="language-actions">
          <button type="button" data-language-action="choose" disabled={view.busy} onClick={() => { void pressChoose(e) }}>Choose…</button>
          {view.automatic && (
            <button type="button" data-language-action="automatic" disabled={view.busy} onClick={() => automatic(e)}>Find Automatically</button>
          )}
          {view.busy
            ? <button type="button" data-language-action="stop" onClick={() => stop(e)}>Stop</button>
            : view.test && <button type="button" data-language-action="test" onClick={() => { void pressTest(e) }}>Test</button>}
          {view.install && (
            <button type="button" data-language-action="install" disabled={view.busy || view.setupBusy}
                    onClick={() => setUp(e, view.install!.action)}>{view.install.label}</button>
          )}
          {view.get && (
            <button type="button" data-language-action="get" disabled={view.busy} onClick={() => open(view.get!.link)}>{view.get.label}</button>
          )}
        </div>
        {(view.setupSaid || view.setupLine) && (
          <div className="language-setup" data-language-setup>
            {view.setupSaid && <div data-language-said>{view.setupSaid}</div>}
            {view.setupLine && (
              <div>
                {view.setupLine.text}
                {view.setupLine.terms && <> <button type="button" className="link" data-language-action="terms" onClick={() => open("wolframTerms")}>Wolfram's Licence</button></>}
              </div>
            )}
          </div>
        )}
        {view.others.length > 0 && (
          <div className="language-others" data-language-others>
            <span>Also on this computer:</span>
            <ul>
              {view.others.map((file) => (
                <li key={file}>
                  <span className="language-other-path">{file}</span>
                  <button type="button" data-language-action="use" disabled={view.busy} onClick={() => { void pressUse(e, file) }}>Use</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  const views = (list: Evaluator[]) =>
    report ? list.map((evaluator) => row(rowView(evaluator, report, memory[evaluator] ?? NO_MEMORY, caps, started))) : null

  return (
    <Modal hook="languages" className="languages" label={LANGUAGE_SETUP_TITLE} sheetRef={dialog} backdropData={{ "data-platform": platform }} onClose={close}>
      <h3>{LANGUAGE_SETUP_TITLE}</h3>
      <div className="languages-body">
        <p>{LANGUAGE_SETUP_INTRO}</p>
        {views(ALWAYS_SHOWN)}
        {report && (
          <details data-language-more open={more ?? false}
                   onToggle={(event) => { const opened = event.currentTarget.open; setMore((was) => (was === null ? was : opened)) }}>
            <summary>C, C++ and Rust</summary>
            {views(MORE)}
          </details>
        )}
      </div>
      <div className="buttons">
        <button ref={done} data-modal="ok" className="default" onClick={close}>Done</button>
      </div>
    </Modal>
  )
}
