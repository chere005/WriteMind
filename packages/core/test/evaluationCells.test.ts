/**
 * Evaluation cells: what runs, what is refused, and what the answer looks like in the note.
 * Transcribed from `WriteMindTests/EvaluationCellTests.swift` (C:\GIT\WriteMindSwift, Mac commits 0bf52b5, 765195a,
 * 4fad93e, 799b13b, df166db, 859aa6c) and the evaluation half of `WriteMindTests/CellTypeTests.swift` (29149b9).
 * Where a test had to change for Windows it says so.
 */

import { describe, expect, it } from "vitest"
import { positioned } from "../src/markdown/parser"
import { fenced } from "../src/markdown/formatting"
import { languageFrom } from "../src/markdown/code"
import { isMathFence } from "../src/math/typesetter"
import { replacing, type Edit, type Range } from "../src/text/range"
import {
  colouring, compileArguments, DEFAULT_EVALUATOR, EVALUATORS, evaluatorBadge, evaluatorFence, evaluatorFrom,
  evaluatorTitle, isCompiled, isEvaluation, isRunKey, isToolName, refusalMessage, resolveEvaluator, sourceFile, toolNames,
  type Refusal,
} from "../src/eval/evaluator"
import {
  evalResult, isOut, outBody, outCell, withoutTrailingNull, wolframCommand, wolframNote, wolframTrouble,
} from "../src/eval/output"
import {
  caretUnder, evalGroups, groupRange, isAnswerCell, isGroupedCell, landingOf, makeEvaluation, markLanguage, markTitle, outAfter,
  offsetShiftedByEdit, pairNumber, runnableCell, seamAfter, setEnvironment, shiftedByEdit, writeAnswer,
} from "../src/eval/cells"
import { landingFor, missingToolRefusal } from "../src/eval/run"
import { ALL_KINDS, kindName, openCell } from "../src/cells/types"

const cell = (text: string, index: number): Range => positioned(text)[index]!.range
const applied = (text: string, edit: Edit): string => replacing(text, edit.range, edit.replacement)

describe("an evaluation cell is not a code cell", () => {
  it("is its own fence, and a code cell is not one", () => {
    expect(evaluatorFrom("eval python")).toBe("python")
    expect(evaluatorFrom("eval c++")).toBe("cpp")
    expect(evaluatorFrom("eval wl")).toBe("wolfram")
    // A CODE cell of the same language is not an evaluation cell and never runs — that is the whole distinction.
    for (const code of ["python", "cpp", "c++", "wl", "wls", "mathematica"]) {
      expect(evaluatorFrom(code)).toBeNull()
      expect(isEvaluation(code)).toBe(false)
      expect(resolveEvaluator(code)).toEqual({ ok: false, refusal: { kind: "notAnEvaluationCell" } })
    }
  })

  it("still resolves what somebody might type by hand", () => {
    expect(evaluatorFrom("eval py")).toBe("python")
    expect(evaluatorFrom("eval cpp")).toBe("cpp")
    expect(evaluatorFrom("eval mathematica")).toBe("wolfram")
    expect(evaluatorFrom("EVAL Python")).toBe("python")
  })

  it("leaves the maths fence alone: `wl` is maths and `eval wl` is not", () => {
    expect(isMathFence("wl")).toBe(true)
    expect(isMathFence(evaluatorFence("wolfram"))).toBe(false)
    expect(isEvaluation("wl")).toBe(false)
    expect(languageFrom("wl")).toBeNull()
  })

  it("is still coloured for its language", () => {
    expect(colouring("eval python")).toBe("python")
    expect(colouring("eval c++")).toBe("cpp")
    expect(colouring("eval wl")).toBe("wolfram")
    // A code cell is coloured as it always was.
    expect(colouring("python")).toBe("python")
    // And an evaluation cell naming something unknown is not guessed at.
    expect(colouring("eval fortran")).toBe("plain")
  })

  it("says so when the environment is unknown rather than running", () => {
    expect(resolveEvaluator("eval fortran")).toEqual({ ok: false, refusal: { kind: "unknownEnvironment", tag: "fortran" } })
    expect(refusalMessage({ kind: "unknownEnvironment", tag: "fortran" })).toContain("fortran")
    const all: Refusal[] = [{ kind: "notAnEvaluationCell" }, { kind: "unknownEnvironment", tag: "x" },
      { kind: "missingTool", evaluator: "python", looked: ["py"] }, { kind: "unclosed" }]
    for (const refusal of all) expect(refusalMessage(refusal).length).toBeGreaterThan(0)
  })

  it("offers the environments he named, in the order he wants them, Wolfram first", () => {
    expect(EVALUATORS.map(evaluatorBadge)).toEqual(["WL", "PY", "C", "C++", "RS"])
    expect(EVALUATORS.map(evaluatorFence)).toEqual(["eval wl", "eval python", "eval c", "eval c++", "eval rust"])
    expect(EVALUATORS[0]).toBe("wolfram")
    // Sean's own ask (Mac TODO a608cc3, not built there): a new evaluation cell is Wolfram.
    expect(DEFAULT_EVALUATOR).toBe("wolfram")
  })

  it("names the compiled ones' source and standard", () => {
    for (const evaluator of EVALUATORS.filter(isCompiled)) {
      expect(sourceFile(evaluator) ?? "").toMatch(/^cell\./)
      const args = compileArguments(evaluator, "/tmp/in", "/tmp/out")
      expect(args.slice(-3)).toEqual(["-o", "/tmp/out", "/tmp/in"])
      expect(args.length).toBeGreaterThan(3)
    }
    expect(EVALUATORS.filter(isCompiled).sort()).toEqual(["c", "cpp", "rust"])
    expect(sourceFile("wolfram")).toBeNull()
    expect(sourceFile("python")).toBe("cell.py")
  })

  it("hands Microsoft's cl its own flags, still naming the standard (port-only)", () => {
    expect(compileArguments("c", "cell.c", "cell.exe", "msvc")).toEqual(["/nologo", "/std:c17", "/EHsc", "/Fe:cell.exe", "cell.c"])
    expect(compileArguments("cpp", "cell.cpp", "cell.exe", "msvc")).toContain("/std:c++20")
    // rustc is rustc whichever C compiler is about.
    expect(compileArguments("rust", "in", "out", "msvc")).toEqual(compileArguments("rust", "in", "out"))
  })

  it("names every environment there is in the unknown-environment sentence", () => {
    const message = refusalMessage({ kind: "unknownEnvironment", tag: "fortran" })
    for (const evaluator of EVALUATORS) expect(message).toContain(evaluatorTitle(evaluator))
  })

  /** Changed for Windows: the Mac lists ABSOLUTE paths (launchd's PATH); here the tools are names found on the PATH. */
  it("looks for each tool by more than one name where there is more than one, and Python by its launcher first", () => {
    for (const evaluator of ["python", "c", "cpp"] as const) expect(toolNames(evaluator).length).toBeGreaterThan(1)
    expect(toolNames("python")[0]).toBe("py")
    expect(toolNames("wolfram")).toEqual(["wolframscript"])
    expect(toolNames("rust")).toEqual(["rustc"])
    const missing = refusalMessage({ kind: "missingTool", evaluator: "c", looked: ["gcc", "clang", "cl"] })
    expect(missing).toContain("C is not installed")
    expect(missing).toContain("gcc, clang, cl")
  })

  /** Both wolframscript failures exit 255 with nothing on stdout, so stderr has to tell them apart. */
  it("tells the two Wolfram failures apart by stderr", () => {
    const notActivated = evalResult({
      stderr: "The Wolfram Engine requires one-time activation on this computer.\n"
        + "Visit https://wolfram.com/engine/free-license to get your free license.\n"
        + "Wolfram ID: Password: \nIncorrect username or password",
      status: 255,
    })
    expect(wolframNote(notActivated, "wolfram")).toContain("not activated")
    expect(wolframNote(notActivated, "wolfram")).toContain("wolframscript -activate")
    const noKernel = evalResult({ stderr: "A WolframKernel location could not be determined. Use -configure…", status: 255 })
    expect(wolframNote(noKernel, "wolfram")).toContain("kernel was not found")
    expect(wolframNote(evalResult({ status: 0 }), "wolfram")).toBeNull()
    expect(wolframNote(notActivated, "python")).toBeNull()
    // The engine's own installer leaves wolframscript off the PATH: the note names the one that was found, quoted.
    const found = "C:\\Program Files\\Wolfram Research\\Wolfram Engine\\15.0\\wolframscript.exe"
    expect(wolframNote(notActivated, "wolfram", found)).toContain(`& "${found}" -activate`)
    expect(wolframNote(noKernel, "wolfram", found)).toContain(`"${found}" -configure`)
  })

  it("drops a lone trailing Null from Wolfram's -code answer, and only that", () => {
    expect(withoutTrailingNull("hello\nNull\n")).toBe("hello")
    expect(withoutTrailingNull("x^3/3\n")).toBe("x^3/3\n")
    expect(withoutTrailingNull("Null is a word\n")).toBe("Null is a word\n")
  })
})

/**
 * PORT-ONLY: File ▸ Language Setup… (the Mac has `defaults write … evalTool.<name>` and no screen). A program chosen
 * there is the ONLY one its language uses, and a chosen one that has gone is said rather than replaced.
 */
describe("a program chosen in Language Setup (port-only)", () => {
  it("knows each language's program by its name: every name the PATH search uses, and their usual spellings", () => {
    for (const evaluator of EVALUATORS) {
      for (const name of toolNames(evaluator)) {
        expect(isToolName(evaluator, name), `${evaluator} ${name}`).toBe(true)
        expect(isToolName(evaluator, `${name}.exe`), `${evaluator} ${name}.exe`).toBe(true)
      }
    }
    for (const name of ["python3.12", "python3.13t", "py.exe", "Python.EXE", "pypy3", "pypy3.10", "python3.12.exe"]) {
      expect(isToolName("python", name), name).toBe(true)
    }
    expect(isToolName("c", "x86_64-w64-mingw32-gcc.exe")).toBe(true)
    expect(isToolName("c", "gcc-14")).toBe(true)
    expect(isToolName("c", "cc")).toBe(true)
    expect(isToolName("cpp", "clang++-18")).toBe(true)
    expect(isToolName("cpp", "x86_64-w64-mingw32-g++.exe")).toBe(true)
    expect(isToolName("c", "cl.exe")).toBe(true)
    expect(isToolName("cpp", "cl.exe")).toBe(true)
    expect(isToolName("wolfram", "wolframscript.exe")).toBe(true)
  })

  it("refuses what is not one: pythonw (no console), rm, a .cmd shim, the kernel, the other language's compiler", () => {
    expect(isToolName("python", "pythonw.exe")).toBe(false)
    expect(isToolName("python", "rm")).toBe(false)
    expect(isToolName("python", "python.cmd")).toBe(false)
    expect(isToolName("python", "python.bat")).toBe(false)
    expect(isToolName("wolfram", "WolframKernel")).toBe(false)
    expect(isToolName("wolfram", "wolframscript.cmd")).toBe(false)
    expect(isToolName("c", "g++")).toBe(false)
    expect(isToolName("cpp", "gcc")).toBe(false)
    expect(isToolName("rust", "cargo")).toBe(false)
    expect(isToolName("c", "")).toBe(false)
  })

  it("says a chosen program that has gone, naming it and Language Setup; without a choice the sentence is the old one", () => {
    const gone = refusalMessage({ kind: "missingTool", evaluator: "python", looked: ["x"], chosen: { path: "/v/bin/python3", problem: "gone" } })
    expect(gone).toBe("Python is set to “/v/bin/python3” in Language Setup, which is not there any more. "
      + "Choose another in File ▸ Language Setup…, or press Find Automatically there.")
    const notOne = refusalMessage({ kind: "missingTool", evaluator: "wolfram", looked: [], chosen: { path: "/x/wolframscript", problem: "notAProgram" } })
    expect(notOne).toContain("“/x/wolframscript”")
    expect(notOne).toContain("is not a program WriteMind can start")
    expect(notOne).toContain("Language Setup")
    expect(refusalMessage({ kind: "missingTool", evaluator: "c", looked: ["gcc, clang, cl on the PATH"] }))
      .toBe("C is not installed where WriteMind looks (gcc, clang, cl on the PATH).")
    // Language Setup's file could not be read: which program was chosen is not known, and that is what is said.
    expect(refusalMessage({ kind: "missingTool", evaluator: "python", looked: [], chosen: { path: "/u/languages.json", problem: "unreadable" } }))
      .toBe("WriteMind could not read Language Setup's choices (“/u/languages.json”), so it does not know which program "
        + "Python cells run with. It reads that file again at the next run.")
  })

  it("builds every missing-tool refusal in one place, with the choice only when the choice is the problem", () => {
    expect(missingToolRefusal("c", { path: null, looked: ["gcc"] }))
      .toEqual({ kind: "missingTool", evaluator: "c", looked: ["gcc"] })
    expect(missingToolRefusal("python", { path: null, looked: ["/v (chosen in Language Setup)"], chosen: { path: "/v", problem: "gone" } }))
      .toEqual({ kind: "missingTool", evaluator: "python", looked: ["/v (chosen in Language Setup)"], chosen: { path: "/v", problem: "gone" } })
    // A choice that works has no problem to report.
    expect(missingToolRefusal("python", { path: "/v", looked: [], chosen: { path: "/v", problem: null } }))
      .toEqual({ kind: "missingTool", evaluator: "python", looked: [] })
  })

  it("writes the Wolfram command as the terminal it was found for can type it", () => {
    // Port-only. Windows: PowerShell's call operator, unchanged.
    const windows = "C:\\Program Files\\Wolfram Research\\Wolfram Engine\\15.0\\wolframscript.exe"
    expect(wolframCommand(windows)).toBe(`& "${windows}"`)
    expect(wolframCommand("C:/Tools/wolframscript.exe")).toBe('& "C:/Tools/wolframscript.exe"')
    // A Mac or Linux path goes into zsh or bash, where `& "…"` is a parse error: bare when it can be.
    expect(wolframCommand("/opt/homebrew/bin/wolframscript")).toBe("/opt/homebrew/bin/wolframscript")
    expect(wolframCommand("/Applications/Wolfram Engine.app/Contents/MacOS/wolframscript"))
      .toBe("'/Applications/Wolfram Engine.app/Contents/MacOS/wolframscript'")
    expect(wolframCommand("/Users/o'neil/bin/wolframscript")).toBe("'/Users/o'\\''neil/bin/wolframscript'")
    expect(wolframCommand()).toBe("wolframscript")
    expect(wolframCommand("wolframscript")).toBe("wolframscript")
    // And the note says the same command.
    const locked = evalResult({ stderr: "requires one-time activation", status: 255 })
    expect(wolframNote(locked, "wolfram", "/opt/homebrew/bin/wolframscript"))
      .toContain("run `/opt/homebrew/bin/wolframscript -activate` once")
  })

  it("names the two not-activated failures once, for the Out cell and for Test alike", () => {
    expect(wolframTrouble(evalResult({ stderr: "The Wolfram Engine requires one-time activation", status: 255 }))).toBe("notActivated")
    expect(wolframTrouble(evalResult({ stderr: "A WolframKernel location could not be determined.", status: 255 }))).toBe("noKernel")
    expect(wolframTrouble(evalResult({ stderr: "Syntax::sntxi: Incomplete expression", status: 1 }))).toBeNull()
  })
})

describe("the Out cell", () => {
  it("is an out fence, and an out fence is not a code language", () => {
    expect(outCell(evalResult({ stdout: "4\n", status: 0 }))).toBe("```out\n4\n```")
    expect(languageFrom("out")).toBeNull()
    expect(isMathFence("out")).toBe(false)
    expect(isOut({ kind: "code", language: "out", body: "4" })).toBe(true)
    expect(isOut({ kind: "code", language: "eval python", body: "print(4)" })).toBe(false)
    expect(isOut({ kind: "paragraph", text: "out" })).toBe(false)
  })

  it("is never an empty fence", () => {
    expect(outBody(evalResult({ status: 0 }))).toBe("[no output]")
    expect(outBody(evalResult({ stdout: "   \n\n", status: 0 }))).toBe("[no output]")
  })

  it("puts the app's own words in square brackets and the program's not", () => {
    const body = outBody(evalResult({
      stdout: "hello", stderr: "boom", status: 2, timedOut: true, truncated: true, note: "it did not compile",
    }))
    expect(body.split("\n")[0]).toBe("hello")
    for (const part of ["[stderr]", "boom", "[it did not compile]", "[output cut at 64 KB]", "[timed out]", "[exit 2]"]) {
      expect(body).toContain(part)
    }
    // A clean run says nothing about its exit.
    expect(outBody(evalResult({ stdout: "hi", status: 0 }))).not.toContain("[exit")
  })

  /** Port-only: a Windows program ends its lines with CR LF, and the note's lines end with LF. */
  it("takes the carriage returns off a Windows program's lines", () => {
    expect(outBody(evalResult({ stdout: "a\r\nb\r\n", status: 0 }))).toBe("a\nb")
  })

  it("cannot be ended by output that prints a fence", () => {
    const written = outCell(evalResult({ stdout: "before\n```\n   ```swift\nafter", status: 0 }))
    const blocks = positioned("```eval python\nx\n```\n\n" + written)
    expect(blocks.length).toBe(2)
    const last = blocks[1]!.block
    expect(last.kind).toBe("code")
    if (last.kind !== "code") return
    expect(last.language).toBe("out")
    expect(last.body).toContain("after")
  })
})

const note = "# Notes\n\n```eval python\nprint(2 + 2)\n```\n\nAfter it."

describe("where the answer goes", () => {
  it("puts a new cell under the code on the first run and leaves the rest alone", () => {
    const after = applied(note, writeAnswer(evalResult({ stdout: "4", status: 0 }), cell(note, 1), note))
    expect(after).toBe("# Notes\n\n```eval python\nprint(2 + 2)\n```\n\n```out\n4\n```\n\nAfter it.")
    expect(positioned(after).length).toBe(4)
  })

  it("replaces the first answer on a second run rather than piling up", () => {
    const once = applied(note, writeAnswer(evalResult({ stdout: "4", status: 0 }), cell(note, 1), note))
    const twice = applied(once, writeAnswer(evalResult({ stdout: "5", status: 0 }), cell(once, 1), once))
    expect(twice).toBe("# Notes\n\n```eval python\nprint(2 + 2)\n```\n\n```out\n5\n```\n\nAfter it.")
    expect(positioned(twice).length).toBe(4)
    expect(twice.endsWith("After it.")).toBe(true)
  })

  it("never mistakes a plain block under the code for an answer", () => {
    const hand = "```eval python\nprint(1)\n```\n\n```\nmine\n```"
    expect(outAfter(cell(hand, 0), hand)).toBeNull()
    const after = applied(hand, writeAnswer(evalResult({ stdout: "1", status: 0 }), cell(hand, 0), hand))
    expect(after).toContain("mine")
    expect(positioned(after).length).toBe(3)
  })

  it("gives an answer only to the cell directly above it", () => {
    const two = "```eval python\na\n```\n\n```out\nA\n```\n\n```eval python\nb\n```"
    expect(outAfter(cell(two, 0), two)).not.toBeNull()
    expect(outAfter(cell(two, 2), two)).toBeNull()
  })

  it("runs only a fenced cell", () => {
    expect(runnableCell(12, note)).not.toBeNull()
    expect(runnableCell(2, note)).toBeNull()
  })
})

describe("picking the environment", () => {
  it("rewrites the fence and nothing else", () => {
    const edit = setEnvironment("cpp", cell(note, 1), note)
    expect(edit).not.toBeNull()
    expect(applied(note, edit!)).toBe("# Notes\n\n```eval c++\nprint(2 + 2)\n```\n\nAfter it.")
    // Picking the one it already is changes nothing at all.
    expect(setEnvironment("python", cell(note, 1), note)).toBeNull()
  })

  it("does nothing on something that is not a fence", () => {
    expect(setEnvironment("python", cell(note, 0), note)).toBeNull()
  })
})

describe("in and out are one group", () => {
  it("makes an evaluation cell and its answer one group", () => {
    const text = "# Notes\n\n```eval python\nx\n```\n\n```out\n1\n```\n\nAfter it."
    const groups = evalGroups(text)
    expect(groups.length).toBe(1)
    expect(groups[0]!.input).toEqual(cell(text, 1))
    expect(groups[0]!.output).toEqual(cell(text, 2))
    const whole = groupRange(groups[0]!)
    expect(text.slice(whole.location, whole.location + whole.length)).toBe("```eval python\nx\n```\n\n```out\n1\n```")
    expect(isGroupedCell(cell(text, 1), groups)).toBe(true)
    expect(isGroupedCell(cell(text, 2), groups)).toBe(true)
    expect(isGroupedCell(cell(text, 0), groups)).toBe(false)
    expect(isGroupedCell(cell(text, 3), groups)).toBe(false)
  })

  it("is no group for a cell with no answer yet, nor for two answers in a row", () => {
    expect(evalGroups("```eval python\nx\n```")).toEqual([])
    expect(evalGroups("# Notes\n\nWords.")).toEqual([])
    expect(evalGroups("```out\n1\n```\n\n```out\n2\n```")).toEqual([])
  })

  it("is still a pair when the code above is a plain code cell (an answer is an answer, whatever ran)", () => {
    const older = "```python\nprint(1+2)\n```\n\n```out\n3\n```"
    const groups = evalGroups(older)
    expect(groups.length).toBe(1)
    expect(groups[0]!.input).toEqual(cell(older, 0))
    expect(groups[0]!.output).toEqual(cell(older, 1))
  })

  it("is not unpaired by a blank cell in the gap", () => {
    const spaced = "```eval python\nx\n```\n\n\n\n```out\n1\n```"
    const groups = evalGroups(spaced)
    expect(groups.length).toBe(1)
    expect(outAfter(cell(spaced, 0), spaced)).not.toBeNull()
    expect(isGroupedCell(cell(spaced, 1), groups)).toBe(true)
  })

  it("numbers a pair by its place in the note", () => {
    const text = "```eval python\na\n```\n\n```out\nA\n```\n\n"
      + "```eval wl\nb\n```\n\n```out\nB\n```\n\n```eval python\nc\n```"
    const groups = evalGroups(text)
    expect(pairNumber(cell(text, 0), groups)).toBe(1)
    expect(pairNumber(cell(text, 1), groups)).toBe(1)
    expect(pairNumber(cell(text, 2), groups)).toBe(2)
    expect(pairNumber(cell(text, 3), groups)).toBe(2)
    expect(pairNumber(cell(text, 4), groups)).toBeNull()
    expect(isAnswerCell(cell(text, 0), groups)).toBe(false)
    expect(isAnswerCell(cell(text, 1), groups)).toBe(true)
    expect(isAnswerCell(cell(text, 4), groups)).toBe(false)
  })

  it("marks the environment until the cell has run, and the number afterwards", () => {
    expect(markTitle({ kind: "input", fence: "eval python", number: null })).toBe("PY")
    expect(markTitle({ kind: "input", fence: "eval wl", number: null })).toBe("WL")
    expect(markTitle({ kind: "input", fence: "eval python", number: 3 })).toBe("In[3]")
    expect(markTitle({ kind: "output", number: 3 })).toBe("Out[3]")
    expect(markTitle({ kind: "input", fence: "eval fortran", number: null })).toBe("\u2014")
  })

  it("names the language beside In[n] too, and never beside Out[n] (Sean, 2026-10-05)", () => {
    expect(markLanguage({ kind: "input", fence: "eval python", number: 3 })).toBe("PY")
    expect(markLanguage({ kind: "input", fence: "eval wl", number: 100 })).toBe("WL")
    expect(markLanguage({ kind: "input", fence: "eval c", number: null })).toBe("C")
    expect(markLanguage({ kind: "input", fence: "eval c++", number: 9 })).toBe("C++")
    expect(markLanguage({ kind: "input", fence: "eval rust", number: 10 })).toBe("RS")
    expect(markLanguage({ kind: "input", fence: "eval fortran", number: 2 })).toBe("\u2014")
    expect(markLanguage({ kind: "output", number: 3 })).toBeNull()
    // The number is still the mark's first word: the language goes beside it, not into it.
    expect(markTitle({ kind: "input", fence: "eval python", number: 10 })).toBe("In[10]")
  })

  it("makes every pair in a note its own group", () => {
    const two = "```eval python\na\n```\n\n```out\nA\n```\n\n```eval wl\nb\n```\n\n```out\nB\n```"
    const groups = evalGroups(two)
    expect(groups.length).toBe(2)
    expect(new Set(groups.map((g) => g.key)).size).toBe(2)
  })
})

describe("where the cursor is left", () => {
  const answered = "```eval python\nx\n```\n\n```out\n1\n```\n\nAfter it."

  it("puts the bar under the answer and not inside it", () => {
    const bar = seamAfter(cell(answered, 1), answered)
    expect(bar).toBe(cell(answered, 2).location)
    expect(answered.slice(bar)).toBe("After it.")
  })

  it("puts the caret in the seam and not in the cell below it", () => {
    const out = cell(answered, 1)
    const caret = caretUnder(out, answered)
    expect(caret).toBeLessThan(seamAfter(out, answered))
    expect(caret).toBe(out.location + out.length + 1)
    const lineStart = answered.lastIndexOf("\n", caret - 1) + 1
    const lineEnd = answered.indexOf("\n", caret)
    expect(answered.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim()).toBe("")
  })

  it("leaves the caret at the end of the note when the answer is the last thing in it", () => {
    const last = "```eval python\nx\n```\n\n```out\n1\n```"
    expect(caretUnder(cell(last, 1), last)).toBe(last.length)
    expect(seamAfter(cell(last, 1), last)).toBe(last.length)
  })
})

describe("which cell the answer belongs to", () => {
  it("lands on the copy that was run and not the first one", () => {
    const twice = "```eval python\nx\n```\n\nWords.\n\n```eval python\nx\n```"
    const first = cell(twice, 0)
    const second = cell(twice, 2)
    expect(first.location).not.toBe(second.location)
    const opening = twice.slice(second.location, second.location + second.length)
    expect(landingOf(opening, twice, second.location)?.range).toEqual(second)
    expect(landingOf(opening, twice, first.location)?.range).toEqual(first)
  })

  it("drops the answer of a cell that is gone", () => {
    expect(landingOf("```eval python\nx\n```", "# Nothing here", 0)).toBeNull()
  })

  it("reports an unclosed fence by an empty close", () => {
    expect(fenced("```eval python\nx\n```")?.close).toBe("```")
    expect(fenced("```eval python\nx")?.close).toBe("")
  })
})

describe("only Shift+Enter runs", () => {
  const keys = (shiftKey: boolean, ctrlKey = false, altKey = false, metaKey = false) => ({ shiftKey, ctrlKey, altKey, metaKey })
  it("is shift alone", () => {
    expect(isRunKey(keys(true))).toBe(true)
    expect(isRunKey(keys(false))).toBe(false)
    expect(isRunKey(keys(true, false, false, true))).toBe(false)
    expect(isRunKey(keys(true, false, true))).toBe(false)
    expect(isRunKey(keys(false, true))).toBe(false)
    expect(isRunKey(keys(true, true))).toBe(false)
  })
})

describe("Ctrl+9 makes the cell", () => {
  it("turns a code cell into an evaluation cell keeping the code", () => {
    const code = "# Notes\n\n```python\nprint(1)\n```\n\nAfter it."
    const after = applied(code, makeEvaluation("python", cell(code, 1), code))
    expect(after).toBe("# Notes\n\n```eval python\nprint(1)\n```\n\nAfter it.")
    expect(positioned(after).length).toBe(3)
  })

  it("puts a new empty cell after anything else, with the caret inside it", () => {
    const prose = "# Notes\n\nJust words."
    const edit = makeEvaluation("wolfram", cell(prose, 1), prose)
    const after = applied(prose, edit)
    expect(after).toBe("# Notes\n\nJust words.\n\n```eval wl\n\n```")
    expect(after.slice(edit.selection.location - "```eval wl\n".length, edit.selection.location)).toBe("```eval wl\n")
  })

  it("appends one when nothing is open", () => {
    expect(makeEvaluation("cpp", null, "").replacement).toBe("```eval c++\n\n```")
    expect(applied("Words.", makeEvaluation("cpp", null, "Words."))).toBe("Words.\n\n```eval c++\n\n```")
  })

  it("keeps a cell that already is one", () => {
    const already = "```eval python\nx\n```"
    expect(applied(already, makeEvaluation("python", cell(already, 0), already)).startsWith("```eval python\nx\n```")).toBe(true)
  })
})

describe("what moves when an answer lands", () => {
  it("moves what is below the answer and not what is above it", () => {
    const edit: Edit = { range: { location: 10, length: 0 }, replacement: "12345", selection: { location: 10, length: 0 } }
    expect(shiftedByEdit({ location: 4, length: 2 }, edit)).toEqual({ location: 4, length: 2 })
    expect(shiftedByEdit({ location: 20, length: 2 }, edit)).toEqual({ location: 25, length: 2 })
    expect(offsetShiftedByEdit(30, edit)).toBe(35)
    expect(offsetShiftedByEdit(3, edit)).toBe(3)
  })
})

describe("what lands for an outcome (NoteStore.landed)", () => {
  it("writes a run and a tool that would not start, says a refusal, and drops a cancel", () => {
    expect(landingFor({ kind: "ran", result: evalResult({ stdout: "4", status: 0 }) }, "python").kind).toBe("write")
    const failed = landingFor({ kind: "couldNotStart", why: "ENOENT" }, "rust")
    expect(failed.kind === "write" && outBody(failed.result)).toBe("[could not start Rust: ENOENT]")
    const refused = landingFor({ kind: "refused", refusal: { kind: "missingTool", evaluator: "c", looked: ["gcc"] } }, "c")
    expect(refused.kind === "say" && refused.message).toContain("C is not installed")
    expect(landingFor({ kind: "cancelled" }, "python").kind).toBe("nothing")
  })
})

// CellTypeTests.swift (29149b9): Cmd-9 at a bar makes the evaluation cell there.
describe("an evaluation cell at the bar", () => {
  const between = "First cell\n\nSecond cell"
  it("is made at the bar with its own fence", () => {
    expect(openCell({ kind: "evaluation", evaluator: "python" }, between, 12, "x").markdown)
      .toBe("First cell\n\n```eval python\nx\n```\n\nSecond cell")
    expect(openCell({ kind: "evaluation", evaluator: "wolfram" }, between, 12, "x").markdown)
      .toBe("First cell\n\n```eval wl\nx\n```\n\nSecond cell")
    for (const evaluator of EVALUATORS) {
      const opened = openCell({ kind: "evaluation", evaluator }, between, 12, "x")
      const made = positioned(opened.markdown)[1]!
      expect(made.block.kind).toBe("code")
      if (made.block.kind !== "code") continue
      expect(isEvaluation(made.block.language)).toBe(true)
      expect(evaluatorFrom(made.block.language)).toBe(evaluator)
      expect(made.range).toEqual(opened.cell)
    }
  })

  it("is not on the + menu", () => {
    expect(ALL_KINDS.some((kind) => kind.kind === "evaluation")).toBe(false)
    expect(kindName({ kind: "evaluation", evaluator: "rust" })).toBe("Rust Evaluation Cell")
  })
})
