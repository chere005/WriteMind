// Port-only: no XCTest. The one kernel run as data (src/export/wolfram/kernel.ts): the script never evaluates a
// note's text and writes only its answers, the inputs it may be handed, the cache key, what an outcome means.
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { evalResult } from "../src/eval/output"
import { engineState, jobKey, KERNEL_INPUT, KERNEL_SCRIPT_FILE, sha1, WOLFRAM_KERNEL_SCRIPT } from "../src/export/wolfram/kernel"

describe("the script", () => {
  it("reads its folder from its command line and from nowhere else", () => {
    expect(WOLFRAM_KERNEL_SCRIPT).toContain("SetDirectory[$ScriptCommandLine[[2]]];")
    expect(WOLFRAM_KERNEL_SCRIPT.match(/SetDirectory\[/g)).toHaveLength(1)
    expect(WOLFRAM_KERNEL_SCRIPT).not.toMatch(/\$HomeDirectory|\$UserDocumentsDirectory|Environment\[/)
    expect(KERNEL_SCRIPT_FILE).toBe("writemind.wls")
    expect(WOLFRAM_KERNEL_SCRIPT).toContain(`Quiet@RemoveBackground[img]`)
    expect(WOLFRAM_KERNEL_SCRIPT).toContain(`FileExistsQ["remove-background"]`)
  })

  it("holds every ToExpression, and evaluates nothing it reads", () => {
    const calls = WOLFRAM_KERNEL_SCRIPT.split("ToExpression[").slice(1)
    expect(calls.length).toBe(2)
    for (const call of calls) expect(call.startsWith("read[f], InputForm, HoldComplete]")).toBe(true)
    expect(WOLFRAM_KERNEL_SCRIPT).not.toMatch(/\bGet\[|<<|\bRunProcess\b|\bRun\[|ReleaseHold|\bEvaluate\[/)
  })

  it("writes only its answers, their partial files and done", () => {
    const writes = [...WOLFRAM_KERNEL_SCRIPT.matchAll(/(?:Export|RenameFile|put)\[([^,]+),/g)].map((match) => match[1]!.trim())
    expect(new Set(writes)).toEqual(new Set([`f <> ".part"`, `f <> ".boxes"`, `f <> ".png"`, `"done"`, "f_"]))
    expect(WOLFRAM_KERNEL_SCRIPT).toContain(`RenameFile[f <> ".part", f, OverwriteTarget -> True]`)
    // `done` is the very last thing it does.
    expect(WOLFRAM_KERNEL_SCRIPT.trim().split("\n").pop()).toBe(`put["done", ToString[$VersionNumber]];`)
  })
})

describe("the inputs", () => {
  it("are the job files the plan names, and an empty png, and nothing else", () => {
    for (const name of ["ink-1.svg", "band-12.svg", "pdf-3.svg", "pic-4.txt", "wl-5.wl", "png", "remove-background"]) expect(KERNEL_INPUT.test(name), name).toBe(true)
    for (const name of ["writemind.wls", "ink-1.svg.boxes", "../ink-1.svg", "ink-.svg", "pic-1.svg", "x.wl", "done", "ink-1.svg/..", "PNG", "wl-1.wls"]) {
      expect(KERNEL_INPUT.test(name), name).toBe(false)
    }
  })
})

describe("the cache key", () => {
  it("is the job's kind and text, whatever its number, and changes with the stamp", () => {
    const one = jobKey({ name: "ink-1.svg", text: "<svg/>" })
    expect(one).toMatch(/^[0-9a-f]{40}$/)
    expect(jobKey({ name: "ink-7.svg", text: "<svg/>" })).toBe(one)
    expect(jobKey({ name: "band-1.svg", text: "<svg/>" })).not.toBe(one)
    expect(jobKey({ name: "ink-1.svg", text: "<svg />" })).not.toBe(one)
    const picture = { name: "pic-1.txt", text: `{"/m/a.png", 640}` }
    expect(jobKey(picture, "100:2048")).not.toBe(jobKey(picture, "101:2048"))
    expect(jobKey(picture, "100:2048")).toBe(jobKey(picture, "100:2048"))
    expect(jobKey({ name: "ink-1.svg", text: "<svg/>" }, "", true)).not.toBe(jobKey({ name: "ink-1.svg", text: "<svg/>" }))
  })

  it("is SHA-1 of the UTF-8 bytes", () => {
    // FIPS 180's examples, the empty string, and one past a 64-byte block with a character outside ASCII.
    expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d")
    expect(sha1("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1")
    expect(sha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709")
    expect(sha1("é".repeat(40))).toBe(createHash("sha1").update("é".repeat(40), "utf8").digest("hex"))
    expect(sha1("a".repeat(1000))).toBe(createHash("sha1").update("a".repeat(1000)).digest("hex"))
  })
})

describe("what an outcome means", () => {
  const ran = (finished: boolean, timedOut = false) =>
    ({ kind: "ran" as const, finished, timedOut, result: evalResult({ status: 0 }), answers: new Map<string, Uint8Array>() })

  it("is answered when the script got to `done`, even past the timeout", () => {
    expect(engineState(ran(true), "/w")).toEqual({ kind: "answered" })
    expect(engineState(ran(true, true), "/w")).toEqual({ kind: "answered" })
  })

  it("is a timeout, in seconds, when it was stopped first", () => {
    expect(engineState(ran(false, true), "/w", 120_000)).toEqual({ kind: "timedOut", seconds: 120 })
    expect(engineState(ran(false, true), "/w", 20_000)).toEqual({ kind: "timedOut", seconds: 20 })
  })

  it("is silent when it ended without `done`, naming the program", () => {
    expect(engineState(ran(false), "/opt/homebrew/bin/wolframscript")).toMatchObject({ kind: "silent", path: "/opt/homebrew/bin/wolframscript" })
  })

  it("is missing, failed or cancelled as the runner said", () => {
    const refusal = { kind: "missingTool" as const, evaluator: "wolfram" as const, looked: ["x"] }
    expect(engineState({ kind: "refused", refusal }, null)).toEqual({ kind: "missing", refusal })
    expect(engineState({ kind: "couldNotStart", why: "EACCES" }, "/w")).toEqual({ kind: "failed", why: "EACCES" })
    expect(engineState({ kind: "cancelled" }, "/w")).toEqual({ kind: "cancelled" })
  })
})
