import { beforeEach, describe, expect, it, vi } from "vitest"
import { ENV_SCRIPT, ENV_TTL_MS, collectEnv, parseProbe, resetEnvCache, runPowershell } from "../../src/main/pen/env"
import type { EnvDepsX } from "../../src/main/pen/env"

// What this machine printed on 2026-10-03 (design appendix A.3): the tablet in problem 10.
const SEAN_NOW = '{"tablet":[{"instanceId":"USB\\\\VID_056A&PID_037A\\\\2DA00L1059230","name":"Wacom Tablet","class":"HIDClass","status":"Error","problem":"CM_PROB_FAILED_START","problemCode":10}],"service":"Running","driver":"6.4.14-1"}'
const HEALTHY = '{"tablet":[{"instanceId":"HID\\\\VID_056A&PID_037A&COL03\\\\7&1","name":"HID-compliant pen","class":"HIDClass","status":"OK","problem":"CM_PROB_NONE","problemCode":0},{"instanceId":"USB\\\\VID_056A&PID_037A\\\\2DA","name":"Wacom Tablet","class":"HIDClass","status":"OK","problem":"CM_PROB_NONE","problemCode":0}],"service":"Running","driver":"6.4.14-1"}'

let clock = 0
let calls = 0
const deps = (stdout: string | null, over: Partial<EnvDepsX> = {}): EnvDepsX => ({
  appVersion: "0.2.0",
  wintabFacts: () => ({ devices: 1 }),
  rawDevices: () => [],
  koffiLoaded: () => true,
  displays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1200 }, scale: 1, primary: true }],
  powershell: async () => { calls++; return stdout },
  now: () => clock,
  platform: "win32",
  env: {},
  exists: () => true,
  ...over,
})

beforeEach(() => { resetEnvCache(); clock = 1_000_000; calls = 0 })

describe("env probe parsing", () => {
  it("reads Sean's machine as it is now: present, status Error, problem 10 with its symbolic name", () => {
    const p = parseProbe(SEAN_NOW)!
    expect(p.tablet).toEqual({
      present: true, status: "Error", problem: "CM_PROB_FAILED_START (problem 10)", name: "Wacom Tablet",
      instanceId: "USB\\VID_056A&PID_037A\\2DA00L1059230", note: null,
    })
    expect(p.service).toBe("Running")
    expect(p.driver).toBe("6.4.14-1")
  })

  it("a healthy tablet has no problem; a child with a problem outranks a healthy one", () => {
    expect(parseProbe(HEALTHY)!.tablet).toMatchObject({ present: true, status: "OK", problem: null, name: "Wacom Tablet" })
    const mixed = JSON.stringify({ tablet: [
      { instanceId: "USB\\VID_056A", name: "A", status: "OK", problem: "CM_PROB_NONE", problemCode: 0 },
      { instanceId: "HID\\VID_056A", name: "B", status: "Error", problem: "CM_PROB_DISABLED", problemCode: 22 },
    ], service: null, driver: null })
    expect(parseProbe(mixed)!.tablet).toMatchObject({ name: "B", problem: "CM_PROB_DISABLED (problem 22)" })
  })

  it("no device is tablet: null; one device not wrapped in an array still parses", () => {
    expect(parseProbe('{"tablet":[],"service":null,"driver":null}')).toEqual({ tablet: null, service: null, driver: null })
    expect(parseProbe('{"tablet":{"instanceId":"USB\\\\VID_056A","name":"W","status":"OK","problemCode":0},"service":"Stopped","driver":null}')!.tablet)
      .toMatchObject({ present: true, name: "W", problem: null })
  })

  it("tolerates noise around the JSON line, and refuses garbage", () => {
    expect(parseProbe(`WARNING: x\r\n${SEAN_NOW}\r\n`)!.driver).toBe("6.4.14-1")
    expect(parseProbe("not json")).toBeNull()
    expect(parseProbe("{broken")).toBeNull()
    expect(parseProbe(null)).toBeNull()
    expect(parseProbe("")).toBeNull()
  })
})

describe("collectEnv", () => {
  it("assembles the summary from the probe and the injected facts", async () => {
    const env = await collectEnv(deps(SEAN_NOW))
    expect(env).toMatchObject({
      platform: "win32", appVersion: "0.2.0", koffi: true, wintabDll: true, wacomDriver: "6.4.14-1", wacomService: "Running",
      wintab: { devices: 1 },
    })
    expect(env.tablet!.problem).toContain("problem 10")
    expect(env.displays).toHaveLength(1)
  })

  it("caches for 30 s and shares one in-flight call", async () => {
    const d = deps(SEAN_NOW)
    const [a, b] = await Promise.all([collectEnv(d), collectEnv(d)])
    expect(a).toBe(b)
    expect(calls).toBe(1)
    clock += ENV_TTL_MS - 1
    await collectEnv(d)
    expect(calls).toBe(1)
    clock += 2
    await collectEnv(d)
    expect(calls).toBe(2)
  })

  it("a failed or slow query is a note, not 'no tablet', and is not cached", async () => {
    const env = await collectEnv(deps(null))
    expect(env.tablet).toMatchObject({ present: false, note: expect.stringContaining("did not answer") })
    await collectEnv(deps(SEAN_NOW))
    expect(calls).toBe(2) // both ran: the failure was not cached, so the second collectEnv asked again
  })

  it("a query that throws is also a note", async () => {
    const env = await collectEnv(deps(null, { powershell: async () => { throw new Error("spawn failed") } }))
    expect(env.tablet?.note).toContain("did not answer")
  })

  it("is skipped under E2E unless the native switch is on", async () => {
    const ps = vi.fn(async () => SEAN_NOW)
    const e2e = await collectEnv(deps(SEAN_NOW, { powershell: ps, env: { WRITEMIND_E2E: "1" } }))
    expect(ps).not.toHaveBeenCalled()
    expect(e2e.tablet).toMatchObject({ present: false, note: "skipped under E2E" })
    resetEnvCache()
    const native = await collectEnv(deps(SEAN_NOW, { powershell: ps, env: { WRITEMIND_E2E: "1", WRITEMIND_PEN_NATIVE: "1" } }))
    expect(ps).toHaveBeenCalledTimes(1)
    expect(native.tablet?.present).toBe(true)
  })

  it("does not run PowerShell off Windows", async () => {
    const ps = vi.fn(async () => SEAN_NOW)
    const env = await collectEnv(deps(SEAN_NOW, { powershell: ps, platform: "linux" }))
    expect(ps).not.toHaveBeenCalled()
    expect(env).toMatchObject({ platform: "linux", tablet: null, wintabDll: false })
  })

  it("a throwing fact provider never breaks the summary", async () => {
    const env = await collectEnv(deps(HEALTHY, {
      wintabFacts: () => { throw new Error("koffi") }, rawDevices: () => { throw new Error("x") }, displays: () => { throw new Error("y") }, koffiLoaded: () => { throw new Error("z") },
    }))
    expect(env).toMatchObject({ wintab: null, rawDevices: [], displays: [], koffi: false })
  })

  it("reports whether wintab32.dll is where Windows keeps it", async () => {
    const seen: string[] = []
    const env = await collectEnv(deps(HEALTHY, { env: { WINDIR: "D:\\Win" }, exists: (f) => { seen.push(f); return false } }))
    expect(env.wintabDll).toBe(false)
    expect(seen[0]).toMatch(/Win[\\/]System32[\\/]wintab32\.dll$/)
  })
})

describe("the script", () => {
  it("is read-only: only Get-* cmdlets, nothing that writes or restarts", () => {
    expect(ENV_SCRIPT).not.toMatch(/\b(Set|New|Remove|Restart|Stop|Start|Disable|Enable|Add|Clear)-\w+/)
    expect(ENV_SCRIPT).toContain("Get-PnpDevice")
    expect(ENV_SCRIPT).toContain("ConvertTo-Json")
  })

  // The real thing on this machine: read-only, about a second. Gated so CI on another OS never runs it.
  const real = process.platform === "win32" && process.env.WM_PEN_REAL === "1"
  it.skipIf(!real)("runs for real and parses (WM_PEN_REAL=1)", async () => {
    const out = await runPowershell(ENV_SCRIPT, 15000)
    expect(out).not.toBeNull()
    const p = parseProbe(out)
    expect(p).not.toBeNull()
  }, 20000)
})
