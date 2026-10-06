/**
 * What File ▸ Language Setup… asks a program and what the answer means (`src/eval/probe.ts`). PORT-ONLY: the Mac has
 * no such screen and so no XCTest file behind this one. Pure — every outcome here is made by hand; nothing runs.
 */

import { describe, expect, it } from "vitest"
import { EVALUATORS } from "../src/eval/evaluator"
import { evalResult, type EvalResult } from "../src/eval/output"
import { identified, IDENTIFY_PYTHON, tested, TEST_SOURCE } from "../src/eval/probe"
import type { RunOutcome } from "../src/eval/run"

const ran = (fields: Partial<EvalResult>): { kind: "ran"; result: EvalResult } => ({ kind: "ran", result: evalResult(fields) })

describe("identifying a picked program (Choose… and Use)", () => {
  it("takes a Python 3 with its version and its own path, CRLF or not", () => {
    expect(identified("python", ran({ status: 0, stdout: "3.12.1\n/Users/s/venv/bin/python3\n" })))
      .toEqual({ ok: true, said: "Python 3.12.1 (/Users/s/venv/bin/python3)" })
    expect(identified("python", ran({ status: 0, stdout: "3.14.0\r\nC:\\Python314\\python.exe\r\n" })))
      .toEqual({ ok: true, said: "Python 3.14.0 (C:\\Python314\\python.exe)" })
    expect(identified("python", ran({ status: 0, stdout: "3.11.0\n" }))).toEqual({ ok: true, said: "Python 3.11.0" })
    expect(IDENTIFY_PYTHON).toContain("sys.version_info[:3]")
    expect(IDENTIFY_PYTHON).toContain("sys.executable")
  })

  it("refuses a Python 2, Windows' Store placeholder and Apple's stand-in, each by name", () => {
    expect(identified("python", ran({ status: 0, stdout: "2.7.18\n/usr/bin/python\n" })))
      .toEqual({ ok: false, problem: "This is Python 2.7.18. Python cells need Python 3." })
    const store = "This is Windows' shortcut to the Microsoft Store, not a Python. Install Python, or choose a python.exe."
    expect(identified("python", ran({ status: 9009 }))).toEqual({ ok: false, problem: store })
    expect(identified("python", ran({ status: 1, stdout: "Python was not found; run without arguments to install from the Microsoft Store" })))
      .toEqual({ ok: false, problem: store })
    expect(identified("python", ran({ status: 1, stderr: "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)" })))
      .toEqual({ ok: false, problem: "This is Apple's stand-in for python3, which needs Apple's Command Line Tools first.", command: "xcode-select --install" })
    expect(identified("python", ran({ status: 2, stderr: "  File \"<string>\", line 1\nSyntaxError: bad\n" })))
      .toEqual({ ok: false, problem: "It did not answer like Python 3 (exit 2: File \"<string>\", line 1)." })
  })

  it("says a program that hung, or would not start", () => {
    for (const evaluator of EVALUATORS) {
      expect(identified(evaluator, ran({ timedOut: true }))).toEqual({ ok: false, problem: "It did not answer within 10 seconds." })
      expect(identified(evaluator, { kind: "couldNotStart", why: "spawn EACCES" }))
        .toEqual({ ok: false, problem: "WriteMind could not start it: spawn EACCES." })
    }
    expect(identified("python", { kind: "cancelled" }).ok).toBe(false)
  })

  it("reads wolframscript's own -version line, and nothing else", () => {
    // Measured on this Mac, 2026-10-06: 0.02 s, no kernel started.
    expect(identified("wolfram", ran({ status: 0, stdout: "WolframScript 1.14.0 for Mac OS X ARM (64-bit)\n" })))
      .toEqual({ ok: true, said: "WolframScript 1.14.0 for Mac OS X ARM (64-bit)" })
    expect(identified("wolfram", ran({ status: 0, stdout: "Python 3.12.1\n" })))
      .toEqual({ ok: false, problem: "It did not answer like wolframscript." })
    expect(identified("wolfram", ran({ status: 0 }))).toEqual({ ok: false, problem: "It did not answer like wolframscript." })
  })

  it("takes a compiler that answers --version, and says the one that does not", () => {
    expect(identified("c", ran({ status: 0, stdout: "gcc (GCC) 14.2.0\nCopyright…\n" }))).toEqual({ ok: true, said: "gcc (GCC) 14.2.0" })
    expect(identified("rust", ran({ status: 0, stdout: "rustc 1.83.0 (90b35a623 2024-11-26)\n" })))
      .toEqual({ ok: true, said: "rustc 1.83.0 (90b35a623 2024-11-26)" })
    expect(identified("cpp", ran({ status: 1, stderr: "clang++: error: unknown argument\n" })))
      .toEqual({ ok: false, problem: "It did not answer to --version (exit 1: clang++: error: unknown argument)." })
    expect(identified("c", ran({ status: 1, stdout: "usage: cc\n" })))
      .toEqual({ ok: false, problem: "It did not answer to --version (exit 1: usage: cc)." })
  })
})

describe("testing a language (Test)", () => {
  const tool = "/opt/homebrew/bin/wolframscript"

  it("has a fixed program for every language, and never a note's text", () => {
    for (const evaluator of EVALUATORS) expect(TEST_SOURCE[evaluator].length, evaluator).toBeGreaterThan(0)
    expect(Object.keys(TEST_SOURCE).sort()).toEqual([...EVALUATORS].sort())
  })

  it("Wolfram: the version is the proof it works; nothing printed is the licence problem", () => {
    expect(tested("wolfram", ran({ status: 0, stdout: "14.1.0 for Mac OS X ARM (64-bit) (July 16, 2024)\n" }), tool))
      .toEqual({ kind: "works", said: "Wolfram Language 14.1.0 for Mac OS X ARM (64-bit) (July 16, 2024)" })
    expect(tested("wolfram", ran({ status: 0, stdout: "  \n" }), tool)).toEqual({
      kind: "failed",
      problem: "wolframscript ran and printed nothing, which is what it does when it cannot find its licence or settings.",
    })
  })

  it("Wolfram: not activated and no kernel each come with the command to type, for the program in use", () => {
    const locked = tested("wolfram", ran({ status: 255, stderr: "The Wolfram Engine requires one-time activation on this computer." }), tool)
    expect(locked).toMatchObject({ kind: "failed", command: "/opt/homebrew/bin/wolframscript -activate" })
    expect(locked.kind === "failed" && locked.problem).toContain("installed but not activated")
    const windows = "C:\\Program Files\\Wolfram Research\\Wolfram Engine\\15.0\\wolframscript.exe"
    const noKernel = tested("wolfram", ran({ status: 255, stderr: "A WolframKernel location could not be determined." }), windows)
    expect(noKernel).toMatchObject({ kind: "failed", command: `& "${windows}" -configure` })
    expect(noKernel.kind === "failed" && noKernel.problem).toContain("kernel was not found")
    expect(tested("wolfram", ran({ status: 3, stderr: "boom\nmore\n" }), tool))
      .toEqual({ kind: "failed", problem: "The engine did not start (exit 3: boom)." })
    expect(tested("wolfram", ran({ timedOut: true }), tool)).toEqual({
      kind: "failed", problem: "It did not answer within 20 seconds. The engine's first start can be slow: press Test again.",
    })
  })

  it("Python: the same rules as identifying it, and a failure ends in its exit", () => {
    expect(tested("python", ran({ status: 0, stdout: "3.12.1\n/v/bin/python3\n" }), "/v/bin/python3"))
      .toEqual({ kind: "works", said: "Python 3.12.1 (/v/bin/python3)" })
    expect(tested("python", ran({ status: 0, stdout: "2.7.18\n/usr/bin/python\n" }), null))
      .toEqual({ kind: "failed", problem: "This is Python 2.7.18. Python cells need Python 3." })
    expect(tested("python", ran({ status: 9009 }), null)).toMatchObject({ kind: "failed", problem: expect.stringContaining("Microsoft Store") })
    expect(tested("python", ran({ status: 1, stderr: "xcrun: error: invalid active developer path" }), null))
      .toMatchObject({ kind: "failed", command: "xcode-select --install" })
    expect(tested("python", ran({ status: 1, stderr: "Fatal Python error: init_fs_encoding\nmore\n" }), null))
      .toEqual({ kind: "failed", problem: "It stopped with exit 1: Fatal Python error: init_fs_encoding." })
    expect(tested("python", ran({ timedOut: true }), null)).toEqual({ kind: "failed", problem: "It did not answer within 20 seconds." })
  })

  it("C, C++ and Rust: what compiled and ran, what did not compile, a missing DLL, and the rest", () => {
    expect(tested("c", ran({ status: 0, stdout: "ok\n" }), "/usr/bin/cc")).toEqual({ kind: "works", said: "it compiled and ran a test program." })
    expect(tested("rust", ran({ status: 0, stdout: "ok\r\n" }), null)).toEqual({ kind: "works", said: "it compiled and ran a test program." })
    expect(tested("cpp", ran({ status: 1, stderr: "cell.cpp:1:10: fatal error: iostream: No such file\n", note: "it did not compile" }), null))
      .toEqual({ kind: "failed", problem: "It did not compile a test program: cell.cpp:1:10: fatal error: iostream: No such file" })
    // cl writes its diagnostics to stdout.
    expect(tested("c", ran({ status: 2, stdout: "cell.c(1): fatal error C1034: stdio.h: no include path set\n", note: "it did not compile" }), null))
      .toEqual({ kind: "failed", problem: "It did not compile a test program: cell.c(1): fatal error C1034: stdio.h: no include path set" })
    expect(tested("c", ran({ timedOut: true, note: "the compiler timed out" }), null))
      .toEqual({ kind: "failed", problem: "The compiler did not finish within 20 seconds." })
    for (const status of [3221225781, -1073741515]) {
      expect(tested("cpp", ran({ status }), null))
        .toEqual({ kind: "failed", problem: "The test program could not start: a DLL it needs is not on the PATH." })
    }
    expect(tested("c", ran({ status: 4, stderr: "Segmentation fault\n" }), null))
      .toEqual({ kind: "failed", problem: "The test program stopped with exit 4: Segmentation fault." })
    expect(tested("c", ran({ status: 0, stdout: "not ok\n" }), null))
      .toEqual({ kind: "failed", problem: "The test program stopped with exit 0: not ok." })
    expect(tested("c", ran({ timedOut: true }), null)).toEqual({ kind: "failed", problem: "It did not answer within 20 seconds." })
  })

  it("every language: refused, could not start, cancelled", () => {
    const refused: RunOutcome = { kind: "refused", refusal: { kind: "missingTool", evaluator: "rust", looked: ["rustc on the PATH"] } }
    expect(tested("rust", refused, null)).toEqual({ kind: "failed", problem: "Rust is not installed where WriteMind looks (rustc on the PATH)." })
    for (const evaluator of EVALUATORS) {
      expect(tested(evaluator, { kind: "couldNotStart", why: "spawn ENOENT" }, null))
        .toEqual({ kind: "failed", problem: "WriteMind could not start it: spawn ENOENT." })
      expect(tested(evaluator, { kind: "cancelled" }, null)).toEqual({ kind: "cancelled" })
    }
  })
})
