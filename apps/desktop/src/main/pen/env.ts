/**
 * main/pen/env.ts - the environment probe (docs/spikes/DESIGN-pen-capture.md section 9.1 `env`, appendix A.3). Owner: IMPL-B (wimpl-b-webhid).
 *
 * What Windows says about the tablet, in ONE read-only PowerShell call (about 1 s cold): the PnP state of VID_056A with its problem
 * code, the Wacom service state, the installed Wacom driver version. Everything else in `EnvSummary` (Wintab facts, Raw Input devices,
 * displays, koffi) comes in through `EnvDeps`, so this file has no koffi in it and tests fake the whole machine.
 *
 *  - Cached for 30 s (the check and Copy diagnostics ask repeatedly); concurrent callers share the one call.
 *  - Skipped under WRITEMIND_E2E unless WRITEMIND_PEN_NATIVE=1: tablet = {present:false, note:"skipped under E2E"}.
 *  - A failed or timed out query is a tablet object with a `note` (so the advice never says "check the cable" because of a slow
 *    PowerShell); `tablet: null` means the query WORKED and Windows lists no VID_056A device.
 *  - `tablet.problem` reads "CM_PROB_FAILED_START (problem 10)": the symbolic name and the number together, so the chip can show
 *    "problem 10" and the advice the name (a Decision, appended to the design).
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EnvSummary } from "../../shared/pen"
import type { CollectEnv, EnvDeps } from "./types"

export const ENV_TTL_MS = 30_000
export const ENV_TIMEOUT_MS = 6000

/** The one script (Windows PowerShell 5.1, read-only). Output: one line of compact JSON. */
export const ENV_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
$out = [ordered]@{}
$devs = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_056A' })
$out.tablet = @($devs | ForEach-Object {
  $code = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode').Data
  [ordered]@{ instanceId = $_.InstanceId; name = $_.FriendlyName; class = $_.Class; status = [string]$_.Status; problem = [string]$_.Problem; problemCode = $code }
})
$svc = Get-Service -Name WTabletServicePro
$out.service = if ($svc) { [string]$svc.Status } else { $null }
$ver = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -eq 'Wacom Tablet' } | Select-Object -First 1
$out.driver = if ($ver) { [string]$ver.DisplayVersion } else { $null }
$out | ConvertTo-Json -Compress -Depth 4`

export interface EnvDepsX extends EnvDeps {
  /** Tests: the clock, the platform, the environment variables, the file check. */
  now?: () => number
  platform?: string
  env?: NodeJS.ProcessEnv
  exists?: (file: string) => boolean
}

interface ProbeJson {
  tablet?: unknown
  service?: unknown
  driver?: unknown
}

interface PnpEntry { instanceId?: unknown; name?: unknown; class?: unknown; status?: unknown; problem?: unknown; problemCode?: unknown }

export interface ProbeResult {
  tablet: EnvSummary["tablet"]
  service: string | null
  driver: string | null
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** Parse the script's stdout. Null when there is no JSON object in it. */
export function parseProbe(stdout: string | null): ProbeResult | null {
  if (!stdout) return null
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).reverse().find((l) => l.startsWith("{") && l.endsWith("}"))
  if (!line) return null
  let json: ProbeJson
  try {
    json = JSON.parse(line) as ProbeJson
  } catch {
    return null
  }
  const raw = json.tablet
  const entries: PnpEntry[] = Array.isArray(raw) ? (raw as PnpEntry[]) : raw && typeof raw === "object" ? [raw as PnpEntry] : []
  let tablet: EnvSummary["tablet"] = null
  if (entries.length) {
    // the USB parent is the device the person plugged in; its problem code is the one that matters
    const withProblem = entries.find((e) => typeof e.problemCode === "number" && e.problemCode !== 0)
    const usb = entries.find((e) => typeof e.instanceId === "string" && e.instanceId.toUpperCase().startsWith("USB\\"))
    const e = withProblem ?? usb ?? entries[0]!
    const code = typeof e.problemCode === "number" ? e.problemCode : null
    const name = str(e.problem)
    const symbolic = name && name !== "CM_PROB_NONE" ? name : null
    const problem = code !== null && code !== 0 ? `${symbolic ?? "CM_PROB"} (problem ${code})` : symbolic
    tablet = { present: true, status: str(e.status), problem, name: str(e.name), instanceId: str(e.instanceId), note: null }
  }
  return { tablet, service: str(json.service), driver: str(json.driver) }
}

/** The real PowerShell runner: `powershell.exe` with the script as an encoded command, killed at the timeout. Null on any failure. */
export function runPowershell(script: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const encoded = Buffer.from(script, "utf16le").toString("base64")
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20, encoding: "utf8" },
        (error, stdout) => resolve(error ? null : stdout),
      )
    } catch {
      resolve(null)
    }
  })
}

let cache: { at: number; value: EnvSummary } | null = null
let inflight: Promise<EnvSummary> | null = null

/** Tests (and a re-plug) drop the cache. */
export function resetEnvCache(): void {
  cache = null
  inflight = null
}

function wintabDllPresent(env: NodeJS.ProcessEnv, exists: (f: string) => boolean): boolean {
  const win = env.WINDIR ?? env.SystemRoot ?? "C:\\Windows"
  try {
    return exists(path.join(win, "System32", "wintab32.dll"))
  } catch {
    return false
  }
}

export const collectEnv: CollectEnv = (deps: EnvDepsX): Promise<EnvSummary> => {
  const now = deps.now ?? (() => Date.now())
  if (cache && now() - cache.at < ENV_TTL_MS) return Promise.resolve(cache.value)
  if (inflight) return inflight
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const exists = deps.exists ?? ((f) => fs.existsSync(f))
  const skipped = !!env.WRITEMIND_E2E && env.WRITEMIND_PEN_NATIVE !== "1"

  const base = (): EnvSummary => ({
    platform,
    os: platform === "win32" ? `Windows ${safeOsRelease()}` : platform,
    electron: process.versions.electron ?? "",
    appVersion: deps.appVersion,
    koffi: safe(() => deps.koffiLoaded(), false),
    wintabDll: platform === "win32" && wintabDllPresent(env, exists),
    tablet: null,
    wacomDriver: null,
    wacomService: null,
    displays: safe(() => deps.displays(), []),
    rawDevices: safe(() => deps.rawDevices(), []),
    wintab: safe(() => deps.wintabFacts(), null),
  })

  const run = async (): Promise<EnvSummary> => {
    const summary = base()
    if (platform !== "win32") return summary
    if (skipped) {
      summary.tablet = { present: false, status: null, problem: null, name: null, instanceId: null, note: "skipped under E2E" }
      return summary
    }
    let stdout: string | null = null
    try {
      stdout = await deps.powershell(ENV_SCRIPT, ENV_TIMEOUT_MS)
    } catch {
      stdout = null
    }
    const probe = parseProbe(stdout)
    if (!probe) {
      summary.tablet = { present: false, status: null, problem: null, name: null, instanceId: null, note: "the Windows device query did not answer" }
      return summary
    }
    summary.tablet = probe.tablet
    summary.wacomDriver = probe.driver
    summary.wacomService = probe.service
    return summary
  }

  inflight = run().then((value) => {
    // a query that failed is not worth remembering for 30 s
    if (!value.tablet || !value.tablet.note || value.tablet.note === "skipped under E2E") cache = { at: now(), value }
    inflight = null
    return value
  }, (error) => {
    inflight = null
    throw error
  })
  return inflight
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function safeOsRelease(): string {
  try {
    return os.release()
  } catch {
    return ""
  }
}
