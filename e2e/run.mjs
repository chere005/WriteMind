#!/usr/bin/env node
// The end-to-end runner.
//
//   npm run e2e                          every suite
//   npm run e2e -- --suite cells         one suite (comma list, or repeat the flag)
//   npm run e2e -- --suite cells/brackets   one script of a suite
//   npm run e2e -- --file path/to/script.mjs   run one script (anywhere) against a fresh instance
//   npm run e2e -- --list                what there is
//   npm run e2e -- --port 9416           use exactly this debugging port (default: any free one)
//   npm run e2e -- --snapshot            test a COPY of the build taken now (when others rebuild apps/desktop/out meanwhile)
//
// For each suite it starts an ISOLATED, OFFSCREEN instance of the built app (apps/desktop/out must be built:
// `npm run build`) with a temp profile, a temp notes folder, the occlusion flags, WRITEMIND_OFFSCREEN=1 and
// WRITEMIND_E2E=1, runs the suite's scripts in order (each a node process that prints PASS / FAIL lines), stops
// the instance, and writes a JSON and a readable report into e2e/.results/<timestamp>/ (and .results/latest.*).
// Exit code 1 if anything failed. It never touches your own WriteMind or your notes, and it leaves no electron
// process behind (it stops its instances by pid, and sweeps by the unique temp profile as a safety net).
//
// A suite is a folder in e2e/suites/ holding .mjs scripts (run in name order). Optional suite.json:
//   { "description": "...", "video": "chart" | "tilted",     the fake camera plays this feed
//     "isolation": "suite" | "script",                         one instance for all scripts (default) or one each
//     "scriptTimeoutSec": 120, "timeoutSec": 600,
//     "flaky": ["name.mjs"],                                   a failure is retried once on a fresh instance
//     "desktop": true,                                         needs the real desktop (injected input): --desktop
//     "args": ["--extra-electron-arg"] }
// A script can also say `// @e2e flaky` or `// @e2e desktop` or `// @e2e video=tilted` or `// @e2e isolated`
// in its first lines.

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { startInstance, stopInstance, readInstance, killTree, sweep, repoRoot, appDir, makeTempDir, snapshotApp } from "./lib/instance.mjs"
import { makeVideoFixtures } from "./lib/fixtures.mjs"
import { targetsOf, sleep } from "./lib/cdp.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
let suitesDir = path.join(here, "suites")

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2)
const opt = { suites: [], list: false, port: process.env.WM_E2E_PORT ? Number(process.env.WM_E2E_PORT) : 0, keep: false, desktop: false, retry: true, results: "", scriptTimeout: 0, suiteTimeout: 0, help: false, failFast: false, repeat: 1, grep: "", snapshot: process.env.WM_E2E_SNAPSHOT === "1", file: "" }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const val = () => argv[++i]
  if (a === "--suite" || a === "-s") opt.suites.push(...String(val()).split(","))
  else if (a.startsWith("--suite=")) opt.suites.push(...a.slice(8).split(","))
  else if (a === "--list") opt.list = true
  else if (a === "--port") opt.port = Number(val())
  else if (a.startsWith("--port=")) opt.port = Number(a.slice(7))
  else if (a === "--keep") opt.keep = true
  else if (a === "--desktop") opt.desktop = true
  else if (a === "--no-retry") opt.retry = false
  else if (a === "--results") opt.results = path.resolve(val())
  else if (a === "--script-timeout") opt.scriptTimeout = Number(val())
  else if (a === "--suite-timeout") opt.suiteTimeout = Number(val())
  else if (a === "--file") opt.file = path.resolve(val())
  else if (a === "--suites-dir") suitesDir = path.resolve(val())
  else if (a === "--fail-fast") opt.failFast = true
  else if (a === "--snapshot") opt.snapshot = true
  else if (a === "--repeat") opt.repeat = Number(val())
  else if (a === "--grep") opt.grep = val()
  else if (a === "--help" || a === "-h") opt.help = true
  else if (!a.startsWith("-")) opt.suites.push(...a.split(","))
  else { console.error(`unknown option ${a}`); process.exit(2) }
}
if (opt.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 26).map((l) => l.slice(3)).join("\n"))
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------------------------
function readMeta(file) {
  const head = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(0, 12).join("\n")
  const meta = {}
  for (const m of head.matchAll(/^\/\/\s*@e2e\s+(.*)$/gm)) {
    for (const word of m[1].split(/[\s,]+/).filter(Boolean)) {
      const [k, v] = word.split("=")
      meta[k] = v ?? true
    }
  }
  return meta
}
function discover() {
  const found = []
  if (!fs.existsSync(suitesDir)) return found
  for (const name of fs.readdirSync(suitesDir).sort()) {
    const dir = path.join(suitesDir, name)
    if (!fs.statSync(dir).isDirectory() || name.startsWith("_") || name.startsWith(".")) continue
    let conf = {}
    const confFile = path.join(dir, "suite.json")
    if (fs.existsSync(confFile)) conf = JSON.parse(fs.readFileSync(confFile, "utf8"))
    const all = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
    const order = conf.order ?? []
    all.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib)
      return a.localeCompare(b)
    })
    const scripts = all.map((file) => {
      const meta = readMeta(path.join(dir, file))
      return {
        file, path: path.join(dir, file), meta,
        flaky: !!meta.flaky || (conf.flaky ?? []).includes(file),
        desktop: !!meta.desktop || !!conf.desktop,
        video: meta.video || conf.video || null,
        isolated: !!meta.isolated || conf.isolation === "script",
        timeoutSec: Number(meta.timeout) || conf.scriptTimeoutSec || 0,
      }
    })
    if (scripts.length) found.push({ name, dir, conf, scripts })
  }
  return found
}

let suites = discover()
if (opt.file) {
  suites = [{ name: "adhoc", dir: path.dirname(opt.file), conf: {}, scripts: [{ file: path.basename(opt.file), path: opt.file, meta: readMeta(opt.file), flaky: false, desktop: false, video: readMeta(opt.file).video || null, isolated: false, timeoutSec: 0 }] }]
} else if (opt.suites.length) {
  const wanted = opt.suites.map((s) => s.replace(/\.mjs$/, ""))
  const picked = []
  for (const suite of suites) {
    const whole = wanted.includes(suite.name)
    const some = suite.scripts.filter((s) => wanted.includes(`${suite.name}/${s.file.replace(/\.mjs$/, "")}`))
    if (whole) picked.push(suite)
    else if (some.length) picked.push({ ...suite, scripts: some })
  }
  const known = new Set(suites.map((s) => s.name))
  for (const w of wanted) if (!known.has(w.split("/")[0])) { console.error(`no such suite: ${w}  (try --list)`); process.exit(2) }
  suites = picked
}
if (opt.grep) for (const s of suites) s.scripts = s.scripts.filter((x) => x.file.includes(opt.grep))
suites = suites.filter((s) => s.scripts.length)

if (opt.list) {
  for (const s of suites) {
    console.log(`${s.name}${s.conf.description ? "  - " + s.conf.description : ""}${s.conf.desktop ? "  [desktop]" : ""}`)
    for (const x of s.scripts) console.log(`    ${x.file}${x.flaky ? "  (flaky)" : ""}${x.desktop ? "  (desktop)" : ""}${x.video ? "  (video " + x.video + ")" : ""}`)
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0")
const nowLocal = new Date()
const stamp = `${nowLocal.getFullYear()}-${pad2(nowLocal.getMonth() + 1)}-${pad2(nowLocal.getDate())}_${pad2(nowLocal.getHours())}-${pad2(nowLocal.getMinutes())}-${pad2(nowLocal.getSeconds())}`
const resultsRoot = opt.results || path.join(here, ".results")
const runDir = path.join(resultsRoot, stamp)
// Housekeeping: keep the last 20 runs, and drop build snapshots a crashed run left behind.
try {
  const old = fs.readdirSync(resultsRoot).filter((n) => /^\d{4}-\d\d-\d\d_/.test(n)).sort()
  for (const n of old.slice(0, Math.max(0, old.length - 19))) fs.rmSync(path.join(resultsRoot, n), { recursive: true, force: true })
  const snaps = path.join(here, ".snapshot")
  if (fs.existsSync(snaps)) for (const n of fs.readdirSync(snaps)) if (Date.now() - fs.statSync(path.join(snaps, n)).mtimeMs > 3600e3) fs.rmSync(path.join(snaps, n), { recursive: true, force: true })
} catch { /* housekeeping only */ }
fs.mkdirSync(runDir, { recursive: true })
const shotsDir = path.join(runDir, "shots")
fs.mkdirSync(shotsDir, { recursive: true })
const tmpRoot = makeTempDir("wm-e2e-")
const log = (...a) => console.log(...a)

if (!fs.existsSync(path.join(appDir, "out", "main", "main.mjs")) || !fs.existsSync(path.join(appDir, "out", "renderer", "index.html"))) {
  console.error("The app is not built (apps/desktop/out). Run `npm run build` first.")
  process.exit(2)
}

let fixtures = null
let appCopy = null
if (opt.snapshot) {
  appCopy = snapshotApp(path.join(here, ".snapshot", stamp))
  console.log(`testing a snapshot of the build: ${path.relative(process.cwd(), appCopy)}`)
}
const needFixtures = () => (fixtures ??= makeVideoFixtures(path.join(tmpRoot, "fixtures")))

// Checks that fail for a bug tracked elsewhere (see lib/harness.mjs). { "script": "suite/name", "check": "substring of the check name", "reason": "..." }
const knownIssues = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, "known-issues.json"), "utf8")).issues ?? [] } catch { return [] } })()

const report = {
  startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0,
  node: process.version, platform: `${process.platform} ${os.release()}`, repo: repoRoot,
  options: { suites: opt.suites, port: opt.port || "auto", desktop: opt.desktop, retry: opt.retry },
  totals: { suites: 0, scripts: 0, scriptsFailed: 0, scriptsFlaky: 0, scriptsSkipped: 0, pass: 0, fail: 0, skip: 0, known: 0, fixed: 0 },
  leftoverProcesses: 0, suites: [],
}

const statusMark = { pass: "PASS ", fail: "FAIL ", flaky: "FLAKY", skipped: "SKIP ", error: "ERROR" }

// ---------------------------------------------------------------------------------------------------------------
// Never leave an electron behind: whatever way we exit
// ---------------------------------------------------------------------------------------------------------------
let current = null          // the instance dir in use
let currentScript = null    // the running script child
const instancesStarted = new Set()
function emergency() {
  try { if (currentScript?.pid) killTree(currentScript.pid) } catch { /* */ }
  for (const dir of instancesStarted) {
    try { const inst = readInstance(dir); killTree(inst.pid); sweep(inst.profile, true) } catch { /* */ }
  }
}
process.on("exit", emergency)
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => { emergency(); process.exit(130) })
process.on("uncaughtException", (e) => { console.error("runner crashed:", e); emergency(); process.exit(2) })

// ---------------------------------------------------------------------------------------------------------------
// Running one script
// ---------------------------------------------------------------------------------------------------------------
function runScript(script, suite, inst, logFile, timeoutMs) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      WM_PORT: String(inst.port), WM_NOTES: inst.notes, WM_PROFILE: inst.profile, WM_INSTANCE_DIR: inst.dir,
      WM_SUITE: suite.name, WM_SCRIPT: script.file.replace(/\.mjs$/, ""), WM_SHOTS: shotsDir,
      WM_KNOWN: JSON.stringify(knownIssues.filter((k) => k.script === `${suite.name}/${script.file.replace(/\.mjs$/, "")}`)),
      WM_FIXTURE_CHART: fixtures?.chart ?? "", WM_FIXTURE_TILTED: fixtures?.tilted ?? "", WM_FIXTURE_TILTED_QUAD: fixtures?.tiltedQuad ?? "",
    }
    const started = Date.now()
    const child = spawn(process.execPath, [script.path], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] })
    currentScript = child
    let out = ""
    let timedOut = false
    const sink = fs.createWriteStream(logFile)
    const onData = (d) => { const s = d.toString(); out += s; sink.write(s) }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid) }, timeoutMs)
    child.on("close", (code) => {
      clearTimeout(timer)
      sink.end()
      currentScript = null
      resolve({ code, out, timedOut, durationMs: Date.now() - started })
    })
  })
}

function parse(out) {
  const checks = []
  const notes = []
  for (const raw of out.split(/\r?\n/)) {
    const m = /^(PASS|FAIL|SKIP|XFAIL|XPASS) (.*)$/.exec(raw)
    if (m) {
      const [name, ...detail] = m[2].split(/ {2,}/)
      checks.push({ status: m[1].toLowerCase(), name: name.trim(), detail: detail.join("  ").trim() })
    } else if (raw.startsWith("NOTE ")) notes.push(raw.slice(5))
  }
  return { checks, notes }
}

async function alivePage(port) {
  try {
    const t = await Promise.race([targetsOf(port), sleep(3000).then(() => null)])
    return !!t && t.some((x) => x.type === "page")
  } catch { return false }
}

// ---------------------------------------------------------------------------------------------------------------
// Running a suite
// ---------------------------------------------------------------------------------------------------------------
async function runSuite(suite, round) {
  const entry = { name: suite.name, description: suite.conf.description ?? "", status: "pass", durationMs: 0, scripts: [], error: null }
  report.suites.push(entry)
  const t0 = Date.now()
  const suiteDeadline = t0 + 1000 * (opt.suiteTimeout || suite.conf.timeoutSec || 900)
  const runnable = suite.scripts.filter((s) => {
    if ((s.desktop || suite.conf.desktop) && !opt.desktop) {
      entry.scripts.push({ file: s.file, status: "skipped", reason: "needs the real desktop (--desktop)", checks: [], notes: [], attempts: 0, durationMs: 0 })
      report.totals.scriptsSkipped++
      return false
    }
    return true
  })
  let inst = null
  let instVideo = null
  let instNo = 0
  /** Stop the instance, keeping what the app itself printed (main-process console, crashes) with the logs. */
  const release = async () => {
    if (!inst) return
    try { fs.mkdirSync(path.join(runDir, "logs", suite.name), { recursive: true }); fs.copyFileSync(inst.logFile, path.join(runDir, "logs", suite.name, `app-${instNo}.log`)) } catch { /* no log */ }
    const gone = inst
    inst = null
    await stopInstance(gone)
  }
  const bring = async (script) => {
    const wantVideo = script.video ? (needFixtures()[script.video] ?? null) : (suite.conf.video ? needFixtures()[suite.conf.video] : null)
    if (inst && wantVideo === instVideo && await alivePage(inst.port)) return inst
    if (inst) { await release();  }
    const dir = path.join(tmpRoot, `${suite.name}-${round}-${++instNo}`)
    inst = await startInstance({ dir, port: opt.port || 0, video: wantVideo ?? undefined, args: suite.conf.args ?? [], appDir: appCopy ?? undefined })
    instancesStarted.add(dir)
    instVideo = wantVideo
    current = dir
    return inst
  }
  try {
    for (const script of runnable) {
      const sEntry = { file: script.file, status: "pass", attempts: 0, durationMs: 0, checks: [], notes: [], exitCode: null, log: "", reason: "" }
      entry.scripts.push(sEntry)
      if (Date.now() > suiteDeadline) { sEntry.status = "error"; sEntry.reason = "suite timeout reached before this script ran"; continue }
      const maxAttempts = 1 + (opt.retry && script.flaky ? 1 : 0)
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        sEntry.attempts = attempt
        let result
        try {
          if (script.isolated && inst) { await release();  }
          if (attempt > 1 && inst) { await release();  }   // a retry gets a fresh app
          const i = await bring(script)
          const logFile = path.join(runDir, "logs", suite.name, script.file.replace(/\.mjs$/, "") + (attempt > 1 ? `.try${attempt}` : "") + ".log")
          fs.mkdirSync(path.dirname(logFile), { recursive: true })
          const timeoutMs = 1000 * (opt.scriptTimeout || script.timeoutSec || 120)
          result = await runScript(script, suite, i, logFile, timeoutMs)
          sEntry.log = path.relative(runDir, logFile).replace(/\\/g, "/")
        } catch (error) {
          sEntry.status = "error"
          sEntry.reason = `could not start the app: ${error.message}`
          if (inst) { await release();  }
          break
        }
        const { checks, notes } = parse(result.out)
        sEntry.checks = checks
        sEntry.notes = notes
        sEntry.exitCode = result.code
        sEntry.durationMs += result.durationMs
        const failedChecks = checks.filter((c) => c.status === "fail").length
        const passedChecks = checks.filter((c) => c.status === "pass").length
        let bad = ""
        if (result.timedOut) bad = `timed out after ${Math.round(result.durationMs / 1000)}s`
        else if (failedChecks) bad = `${failedChecks} check(s) failed`
        else if (result.code !== 0) bad = `exit code ${result.code}`
        else if (passedChecks === 0) bad = "reported no checks"
        if (!bad) { sEntry.status = attempt > 1 ? "flaky" : "pass"; sEntry.reason = attempt > 1 ? "passed on the retry" : ""; break }
        sEntry.status = "fail"
        sEntry.reason = bad
        if (result.timedOut) sEntry.checks.push({ status: "fail", name: "script finished in time", detail: bad })
        else if (!failedChecks) sEntry.checks.push({ status: "fail", name: "script ran cleanly", detail: bad + " " + result.out.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 300) })
        if (attempt < maxAttempts) log(`  retry (flaky): ${script.file} - ${bad}`)
      }
      // tally
      const p = sEntry.checks.filter((c) => c.status === "pass").length
      const f = sEntry.checks.filter((c) => c.status === "fail").length
      const k = sEntry.checks.filter((c) => c.status === "skip").length
      const xf = sEntry.checks.filter((c) => c.status === "xfail").length, xp = sEntry.checks.filter((c) => c.status === "xpass").length
      report.totals.pass += p + xp; report.totals.fail += f; report.totals.skip += k; report.totals.known += xf; report.totals.fixed += xp
      if (sEntry.status === "fail" || sEntry.status === "error") report.totals.scriptsFailed++
      if (sEntry.status === "flaky") report.totals.scriptsFlaky++
      log(`  ${statusMark[sEntry.status]} ${suite.name}/${script.file}  (${p} pass, ${f} fail${k ? `, ${k} skip` : ""}${xf ? `, ${xf} known issue(s)` : ""}${xp ? `, ${xp} FIXED` : ""}, ${(sEntry.durationMs / 1000).toFixed(1)}s)${sEntry.reason ? "  - " + sEntry.reason : ""}`)
      for (const c of sEntry.checks.filter((c) => c.status === "fail")) log(`        FAIL ${c.name}${c.detail ? "  " + c.detail.slice(0, 240) : ""}`)
      for (const c of sEntry.checks.filter((c) => c.status === "xpass")) log(`        FIXED ${c.name}  - remove it from e2e/known-issues.json`)
      writeReports()
      if (opt.failFast && (sEntry.status === "fail" || sEntry.status === "error")) break
    }
  } finally {
    if (inst) await release()
    current = null
  }
  entry.durationMs = Date.now() - t0
  entry.status = entry.scripts.some((s) => s.status === "fail" || s.status === "error") ? "fail" : entry.scripts.some((s) => s.status === "flaky") ? "flaky" : "pass"
  report.totals.scripts += entry.scripts.length
  writeReports()
}

// ---------------------------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------------------------
function textReport() {
  const t = report.totals
  const lines = []
  lines.push(`WriteMind end-to-end report  ${report.startedAt}`)
  lines.push(`${report.platform}, node ${report.node}, ${(report.durationMs / 1000).toFixed(0)}s`)
  lines.push(`${t.suites} suite(s), ${t.scripts} script(s): ${t.pass} checks passed, ${t.fail} failed, ${t.skip} skipped, ${t.known} known issue(s); ${t.scriptsFailed} script(s) failed, ${t.scriptsFlaky} flaky, ${t.scriptsSkipped} skipped`)
  if (report.leftoverProcesses) lines.push(`WARNING: ${report.leftoverProcesses} leftover electron process(es) had to be stopped`)
  lines.push("")
  for (const s of report.suites) {
    lines.push(`${statusMark[s.status] ?? s.status} ${s.name}  (${(s.durationMs / 1000).toFixed(1)}s)${s.description ? "  " + s.description : ""}`)
    for (const x of s.scripts) {
      const p = x.checks.filter((c) => c.status === "pass").length, f = x.checks.filter((c) => c.status === "fail").length
      lines.push(`  ${statusMark[x.status]} ${x.file}  ${p} pass, ${f} fail${x.attempts > 1 ? `, ${x.attempts} attempts` : ""}${x.reason ? "  - " + x.reason : ""}`)
      for (const c of x.checks.filter((c) => c.status === "fail")) lines.push(`        FAIL ${c.name}${c.detail ? "  " + c.detail.slice(0, 300) : ""}`)
      for (const c of x.checks.filter((c) => c.status === "xfail")) lines.push(`        KNOWN ${c.name}${c.detail ? "  " + c.detail.slice(0, 300) : ""}`)
      for (const c of x.checks.filter((c) => c.status === "xpass")) lines.push(`        FIXED ${c.name}  (remove it from e2e/known-issues.json)`)
      for (const c of x.checks.filter((c) => c.status === "skip")) lines.push(`        skip ${c.name}${c.detail ? "  " + c.detail.slice(0, 200) : ""}`)
      for (const n of x.notes.slice(0, 4)) lines.push(`        note ${n.slice(0, 200)}`)
    }
  }
  return lines.join("\n") + "\n"
}
function markdownReport() {
  const t = report.totals
  const out = [`## WriteMind end-to-end`, ``, `${t.pass} checks passed, **${t.fail} failed**, ${t.skip} skipped, ${t.known} known issue(s). ${t.scriptsFailed} script(s) failed, ${t.scriptsFlaky} flaky.`, ``, `| Suite | Script | Result | Checks |`, `|---|---|---|---|`]
  for (const s of report.suites) for (const x of s.scripts) {
    const p = x.checks.filter((c) => c.status === "pass").length, f = x.checks.filter((c) => c.status === "fail").length
    out.push(`| ${s.name} | ${x.file} | ${x.status}${x.reason ? " (" + x.reason + ")" : ""} | ${p} pass / ${f} fail |`)
  }
  const bad = report.suites.flatMap((s) => s.scripts.flatMap((x) => x.checks.filter((c) => c.status === "fail").map((c) => `- \`${s.name}/${x.file}\` ${c.name} ${c.detail ? "- " + c.detail.slice(0, 200) : ""}`)))
  if (bad.length) out.push(``, `### Failures`, ...bad)
  return out.join("\n") + "\n"
}
function writeReports() {
  report.totals.suites = report.suites.length
  report.durationMs = Date.now() - startedMs
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(runDir, "report.txt"), textReport())
  fs.writeFileSync(path.join(runDir, "report.md"), markdownReport())
}
const startedMs = Date.now()

// ---------------------------------------------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------------------------------------------
log(`WriteMind e2e: ${suites.length} suite(s), results in ${path.relative(process.cwd(), runDir) || runDir}`)
for (let round = 1; round <= Math.max(1, opt.repeat); round++) {
  for (const suite of suites) {
    log(`\n[${suite.name}] ${suite.conf.description ?? ""}`)
    await runSuite(suite, round)
    if (opt.failFast && report.totals.scriptsFailed) break
  }
}

// Nothing of ours may be left running.
const left = sweep(tmpRoot, true)
report.leftoverProcesses = left.length
writeReports()
for (const f of ["report.json", "report.txt", "report.md"]) {
  try { fs.copyFileSync(path.join(runDir, f), path.join(resultsRoot, "latest" + path.extname(f))) } catch { /* */ }
}
if (appCopy) { try { fs.rmSync(appCopy, { recursive: true, force: true }) } catch { /* */ } }
if (!opt.keep) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); break } catch { await sleep(500) }
  }
} else log(`kept ${tmpRoot}`)
if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownReport()) } catch { /* */ } }

const t = report.totals
log(`\n${t.fail || t.scriptsFailed ? "FAILED" : "PASSED"}: ${t.pass} checks passed, ${t.fail} failed, ${t.skip} skipped; ${t.scriptsFailed} script(s) failed, ${t.scriptsFlaky} flaky, ${t.scriptsSkipped} skipped.`)
if (left.length) log(`WARNING: ${left.length} leftover electron process(es) were stopped.`)
log(`Report: ${path.join(runDir, "report.txt")}`)
process.exit(t.fail || t.scriptsFailed || left.length ? 1 : 0)
