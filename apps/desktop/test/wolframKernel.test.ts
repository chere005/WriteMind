// Port-only: no XCTest. The kernel run's memory (main/wolfram/kernel.ts): the Wolfram export and a copy ask the engine
// once for what it has not answered before.
import { beforeEach, describe, expect, it } from "vitest"
import { evalResult, type KernelJob, type WolframJobOutcome } from "@writemind/core"
import { forgetKernelAnswers, runKernel } from "../src/main/wolfram/kernel"
import type { Runner } from "../src/main/eval/runner"

const bytes = (text: string) => new TextEncoder().encode(text)
const result = evalResult({ stdout: "", stderr: "", status: 0, signal: null, timedOut: false, truncated: false })

/** A runner whose kernel answers `answered` (by job name) and records every run it was asked for. */
function fake(answered: (names: string[], png: boolean) => Record<string, string> = (names) => Object.fromEntries(names.map((name) => [`${name}.boxes`, `Boxes[${name}]`])),
  extra: Partial<Extract<WolframJobOutcome, { kind: "ran" }>> = {}) {
  const runs: { id: string; names: string[]; timeoutMs: number }[] = []
  const runner: Pick<Runner, "wolframJob" | "tools"> = {
    wolframJob: async (id, inputs, timeoutMs) => {
      const names = inputs.map((input) => input.name)
      runs.push({ id, names, timeoutMs })
      const answers = new Map(Object.entries(answered(names.filter((name) => name !== "png"), names.includes("png"))).map(([name, text]) => [name, bytes(text)]))
      return { kind: "ran", finished: true, timedOut: false, result, answers, ...extra }
    },
    tools: () => ({ wolfram: { path: "/w/wolframscript" } }) as never,
  }
  return { runner, runs }
}

const ink = (n: number, text = `<svg id="${n}"/>`): KernelJob => ({ name: `ink-${n}.svg`, text })
const options = (over: { png?: boolean; id?: string; timeoutMs?: number; stamps?: Map<string, string> } = {}) =>
  ({ id: "wolfram:export:1", png: false, timeoutMs: 120_000, ...over })

beforeEach(() => forgetKernelAnswers())

describe("the kernel run's memory (main/wolfram/kernel.ts)", () => {
  it("asks the kernel once, with every job in ONE run, and gives the answers back by job name", async () => {
    const { runner, runs } = fake()
    const out = await runKernel([ink(1), ink(2)], options(), { runner })
    expect(runs).toEqual([{ id: "wolfram:export:1", names: ["ink-1.svg", "ink-2.svg"], timeoutMs: 120_000 }])
    expect([...out.answers]).toEqual([["ink-1.svg", "Boxes[ink-1.svg]"], ["ink-2.svg", "Boxes[ink-2.svg]"]])
    expect(out.state).toEqual({ kind: "answered" })
  })

  it("a second ask for the same drawings runs nothing", async () => {
    const { runner, runs } = fake()
    await runKernel([ink(1)], options(), { runner })
    // (Under another name: the key is the job's kind and text, not its number.)
    const again = await runKernel([ink(7, ink(1).text)], options({ id: "wolfram:copy" }), { runner })
    expect(runs.length).toBe(1)
    expect(again.answers.get("ink-7.svg")).toBe("Boxes[ink-1.svg]")
    expect(again.state).toEqual({ kind: "answered" })
  })

  it("a partly remembered ask runs only the rest", async () => {
    const { runner, runs } = fake()
    await runKernel([ink(1)], options(), { runner })
    const out = await runKernel([ink(1), ink(2)], options(), { runner })
    expect(runs[1]!.names).toEqual(["ink-2.svg"])
    expect([...out.answers.keys()]).toEqual(["ink-1.svg", "ink-2.svg"])
  })

  it("a changed drawing is asked again, and so is a picture whose file changed", async () => {
    const { runner, runs } = fake()
    await runKernel([ink(1, "<svg a/>")], options(), { runner })
    await runKernel([ink(1, "<svg b/>")], options(), { runner })
    expect(runs.length).toBe(2)
    const pic: KernelJob = { name: "pic-1.txt", text: `{"/m/cat.png", 200}` }
    await runKernel([pic], options({ stamps: new Map([["pic-1.txt", "1:10"]]) }), { runner })
    await runKernel([pic], options({ stamps: new Map([["pic-1.txt", "1:10"]]) }), { runner })
    await runKernel([pic], options({ stamps: new Map([["pic-1.txt", "2:10"]]) }), { runner })
    expect(runs.length).toBe(4)
  })

  it("a PNG wanted and not remembered runs again, with the empty png file, and is then remembered too", async () => {
    const { runner, runs } = fake((names, png) => Object.fromEntries(names.flatMap((name) => [[`${name}.boxes`, "B"], ...(png ? [[`${name}.png`, "PNGBYTES"]] : [])])))
    await runKernel([ink(1)], options(), { runner })
    // Remembered without a PNG (the export did not ask for one): a copy has to ask again…
    const copy = await runKernel([ink(1)], options({ png: true, id: "wolfram:copy" }), { runner })
    expect(runs[1]).toEqual({ id: "wolfram:copy", names: ["ink-1.svg", "png"], timeoutMs: 120_000 })
    expect(new TextDecoder().decode(copy.pngs.get("ink-1.svg"))).toBe("PNGBYTES")
    // …and then it is there.
    const third = await runKernel([ink(1)], options({ png: true, id: "wolfram:copy" }), { runner })
    expect(runs.length).toBe(2)
    expect(third.pngs.has("ink-1.svg")).toBe(true)
  })

  it("keeps what a run cut short did answer, and says it timed out", async () => {
    const { runner } = fake((names) => ({ [`${names[0]}.boxes`]: "B1" }), { finished: false, timedOut: true })
    const out = await runKernel([ink(1), ink(2)], options({ timeoutMs: 120_000 }), { runner })
    expect([...out.answers]).toEqual([["ink-1.svg", "B1"]])
    expect(out.state).toEqual({ kind: "timedOut", seconds: 120 })
  })

  it("a run that answered nothing is not remembered as an answer", async () => {
    const { runner, runs } = fake(() => ({}), { finished: false })
    const first = await runKernel([ink(1)], options(), { runner })
    expect(first.answers.size).toBe(0)
    expect(first.state.kind).toBe("silent")
    await runKernel([ink(1)], options(), { runner })
    expect(runs.length).toBe(2)
  })

  it("passes a refusal, a failure and a cancel through as the state, with no answers", async () => {
    const outcomes: WolframJobOutcome[] = [
      { kind: "refused", refusal: { kind: "missingTool", evaluator: "wolfram", looked: ["a"] } },
      { kind: "couldNotStart", why: "spawn EACCES" },
      { kind: "cancelled" },
    ]
    for (const outcome of outcomes) {
      const runner: Pick<Runner, "wolframJob" | "tools"> = { wolframJob: async () => outcome, tools: () => ({ wolfram: { path: null } }) as never }
      const out = await runKernel([ink(1)], options(), { runner })
      expect(out.answers.size).toBe(0)
      expect(out.state.kind).toBe({ refused: "missing", couldNotStart: "failed", cancelled: "cancelled" }[outcome.kind])
    }
  })

  it("forgets the oldest past 64 answers", async () => {
    const { runner, runs } = fake()
    for (let i = 0; i < 70; i++) await runKernel([ink(1, `<svg n="${i}"/>`)], options(), { runner })
    expect(runs.length).toBe(70)
    await runKernel([ink(1, `<svg n="69"/>`)], options(), { runner })
    expect(runs.length).toBe(70)
    await runKernel([ink(1, `<svg n="0"/>`)], options(), { runner })
    expect(runs.length).toBe(71)
  })

  it("asks nothing of an empty list of jobs", async () => {
    const { runner, runs } = fake()
    const out = await runKernel([], options(), { runner })
    expect(runs).toEqual([])
    expect(out.state).toEqual({ kind: "answered" })
  })
})
