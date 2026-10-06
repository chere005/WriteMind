// File ▸ Language Setup… (LanguageSetupDialog.tsx, main/eval/languages.ts), on this instance's own profile and notes
// folder. The menu item opens it with Wolfram and Python and C, C++ and Rust folded under them. On a Mac or Linux a
// stand-in python3 in a scratch folder (a shell script that answers the version probe as Python 3.11.0 would) is
// chosen through the picker; with an `eval python` note open, deleting it and bringing the window back to the front
// turns the cell's mark amber with the refusal's words, Shift+Enter says the same, Runs As ▸ Language Setup… opens
// the screen at Python, and Find Automatically puts the row back. On Windows with the installer's script and winget,
// Install Python… runs it as a dry run (WRITEMIND_E2E) and the row says so. Escape closes the screen.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  ok, skip, finish, js, sleep, waitFor, menuClick, pickNext, click, centerOf, key, seedNotes, openNote, VIEW, shot,
} from "../../lib/harness.mjs"

const J = async (expr) => JSON.parse(await js(`Promise.resolve(${expr}).then((value) => JSON.stringify(value ?? null))`))
const text = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`)
const press = async (selector) => {
  const at = await centerOf(selector)
  if (!at) return false
  await click(at.x, at.y)
  return true
}
const row = (evaluator, inner = "") => `[data-modal="languages"] [data-language-row="${evaluator}"] ${inner}`.trim()
const posix = process.platform !== "win32"

// Nothing chosen to start with, whatever an earlier run of this profile left.
for (const evaluator of ["wolfram", "python", "c", "cpp", "rust"]) await js(`window.wm.languages.automatic(${JSON.stringify(evaluator)})`)
await seedNotes({ "Languages.md": "# Languages\n\n```eval python\nprint(1)\n```\n" }, { clean: true })
await openNote("Languages")

// 1. File ▸ Language Setup…: the two rows, then the three folded.
ok("File ▸ Language Setup… is a menu item", await menuClick("languageSetup"))
await waitFor(`!!document.querySelector('${row("python")}')`, 10000)
const rows = await J(`[...document.querySelectorAll('[data-modal="languages"] [data-language-row]')].map((r) => r.dataset.languageRow + ":" + (r.closest("details") ? "folded" : "shown"))`)
ok("Wolfram and Python, then C, C++ and Rust folded under them",
  JSON.stringify(rows) === JSON.stringify(["wolfram:shown", "python:shown", "c:folded", "cpp:folded", "rust:folded"]), JSON.stringify(rows))
ok("the fold is closed while none of them has a choice", !(await js(`document.querySelector('[data-language-more]').open`)))
ok("Done has the keyboard", await js(`document.activeElement?.dataset.modal === "ok"`))
await shot("opened")

if (posix) {
  // 2. Choose…: the picker (answered ahead of time), the version probe, saved, and said.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-languages-"))
  const python = path.join(dir, "venv", "bin", "python3")
  fs.mkdirSync(path.dirname(python), { recursive: true })
  fs.writeFileSync(python, `#!/bin/sh\necho 3.11.0\necho '${python}'\n`)
  fs.chmodSync(python, 0o755)
  await pickNext(python)
  ok("Choose… is in the Python row", await press(row("python", '[data-language-action="choose"]')))
  await waitFor(`/^Works: Python 3\\.11\\.0/.test(document.querySelector('${row("python", "[data-language-check]")}')?.textContent ?? "")`, 15000)
  ok("the picked python3 answers as Python 3.11.0 and the row says it works", true)
  ok("the row shows it, chosen", (await text(row("python", "[data-language-path]"))) === python
    && (await text(row("python", "[data-language-source]"))) === "Chosen by you.")
  const report = await J(`window.wm.languages.report()`)
  ok("it is the choice the main process keeps", report.tools.python.chosen?.path === python && report.tools.python.chosen?.problem === null, JSON.stringify(report.tools.python))
  ok("the cell's mark is not amber", !(await js(`!!document.querySelector('.wm-eval-badge[data-eval-badge="python"].wm-eval-missing')`)))
  await shot("chosen")

  // 3. The chosen program goes; the window comes back to the front: the mark turns amber with the refusal's words.
  fs.rmSync(python)
  await js(`window.dispatchEvent(new Event("focus"))`)
  await waitFor(`!!document.querySelector('.wm-eval-badge[data-eval-badge="python"].wm-eval-missing')`, 8000)
  const title = await js(`document.querySelector('.wm-eval-badge[data-eval-badge="python"]')?.title ?? ""`)
  ok("the cell's mark turns amber, and its tooltip names the path and Language Setup", title.includes(python) && title.includes("Language Setup"), title)
  const source = await text(row("python", "[data-language-source]"))
  ok("the row says the program chosen is not there any more", source.startsWith(`The program you chose is not there any more: ${python}.`), source)
  ok("and reads it out", await js(`document.querySelector('${row("python", "[data-language-source]")}')?.getAttribute("role") === "alert"`))
  await shot("gone")

  // 4. Escape closes it; Shift+Enter in the cell refuses with the same sentence, and runs nothing.
  await key("Escape")
  await waitFor(`!document.querySelector('[data-modal="languages"]')`)
  ok("Escape closes it", true)
  await js(`(() => { const v = ${VIEW}; const at = v.state.doc.toString().indexOf("print(1)"); v.dispatch({ selection: { anchor: at + 3 } }); v.focus() })()`)
  await key("Enter", { shift: true })
  await waitFor(`!!document.querySelector('[data-eval-notice]')`, 8000)
  const notice = await text("[data-eval-notice]")
  ok("Shift+Enter refuses with a sentence naming Language Setup", notice.includes("Language Setup") && notice.includes(python), notice)
  ok("and writes no answer", !(await js(`${VIEW}.state.doc.toString().includes("\`\`\`out")`)))

  // 5. Runs As ▸ Language Setup… opens the screen at Python.
  ok("the cell's mark opens Runs As", await press('.wm-eval-badge[data-eval-badge="python"]'))
  await waitFor(`!!document.querySelector('[data-eval-setup]')`)
  ok("Runs As ends with Language Setup…", await press("[data-eval-setup]"))
  await waitFor(`!!document.querySelector('${row("python")}')`, 10000)
  await sleep(300)
  ok("it opens at Python's Choose…", await js(`document.activeElement?.dataset.languageAction === "choose" && document.activeElement.closest("[data-language-row]")?.dataset.languageRow === "python"`))

  // 6. Find Automatically: the choice is forgotten, and the row is what WriteMind finds by itself.
  ok("a choice has Find Automatically", await press(row("python", '[data-language-action="automatic"]')))
  await waitFor(`!/you chose/.test(document.querySelector('${row("python", "[data-language-source]")}')?.textContent ?? "you chose")`, 8000)
  const after = await text(row("python", "[data-language-source]"))
  ok("the row is back to what WriteMind finds by itself", after === "Found automatically." || after.startsWith("Not found."), after)
  ok("with no Find Automatically any more", !(await js(`!!document.querySelector('${row("python", '[data-language-action="automatic"]')}')`)))
  ok("and the main process keeps no choice", (await J(`window.wm.languages.report()`)).tools.python.chosen === undefined)
  await shot("automatic")
  fs.rmSync(dir, { recursive: true, force: true })
} else {
  skip("choosing a stand-in python3", "the stand-in is a shell script; a Windows program must be an .exe")
}

if (process.platform === "win32") {
  // 7. Install Python…, as a dry run: the installer's own script, in a window of its own, says what it would do.
  const caps = await J(`window.wm.capabilities()`)
  if (!caps.installsLanguages) {
    skip("Install Python… (dry run)", "no installer-tools.ps1 beside the app, or no winget on this machine")
  } else if (!(await js(`!!document.querySelector('${row("python", '[data-language-action="install"]')}')`))) {
    skip("Install Python… (dry run)", "Python is already on this machine, so there is nothing to install")
  } else {
    ok("Install Python… is offered", await press(row("python", '[data-language-action="install"]')))
    await waitFor(`/Dry run: nothing was installed\\./.test(document.querySelector('${row("python", "[data-language-setup]")}')?.textContent ?? "")`, 90000)
    ok("the dry run ends with \"Dry run: nothing was installed.\"", true)
    await shot("dry-run")
  }
}

// Escape closes it.
if (!(await js(`!!document.querySelector('[data-modal="languages"]')`))) await menuClick("languageSetup")
await waitFor(`!!document.querySelector('[data-modal="languages"]')`, 8000)
await js(`document.querySelector('[data-modal="languages"] [data-modal="ok"]')?.focus()`)
await key("Escape")
await sleep(300)
ok("Escape closes Language Setup", !(await js(`!!document.querySelector('[data-modal="languages"]')`)))
finish()
