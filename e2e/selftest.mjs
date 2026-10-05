#!/usr/bin/env node
// The runner's own test: it runs the runner over a throw-away suite of scripts that pass, fail, crash, report nothing,
// hang past their timeout, fail once and then pass (flaky), and checks that every one is reported the way it
// should be, that the exit code is 1, and that no electron is left behind.
//
//   npm run e2e:selftest        (needs the app built: it starts a real instance)
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-selftest-"))
const suites = path.join(root, "suites", "probe")
fs.mkdirSync(suites, { recursive: true })
const marker = path.join(root, "flaky-marker").replace(/\\/g, "/")
const harness = path.join(here, "lib", "harness.mjs").replace(/\\/g, "/")
const write = (name, body) => fs.writeFileSync(path.join(suites, name), body)
const head = `import { ok, finish, js, note } from ${JSON.stringify("file:///" + harness.replace(/^\//, ""))}\n`

write("a-pass.mjs", head + `ok("the page answers", (await js("1 + 1")) === 2)\nnote("a note")\nfinish()\n`)
write("b-fail.mjs", head + `ok("fine", true)\nok("this one is wrong", false, "on purpose")\nfinish()\n`)
write("c-crash.mjs", head + `ok("fine", true)\nthrow new Error("boom")\n`)
write("d-nochecks.mjs", head + `finish()\n`)
write("e-hang.mjs", `// @e2e timeout=4\n` + head + `ok("started", true)\nawait new Promise(() => {})\n`)
write("f-flaky.mjs", `// @e2e flaky\nimport fs from "node:fs"\n` + head + `const m = ${JSON.stringify(marker)}\nif (!fs.existsSync(m)) { fs.writeFileSync(m, "1"); ok("first try fails", false, "flaky on purpose") } else ok("second try passes", true)\nfinish()\n`)
write("g-skip.mjs", head + `import { skip } from ${JSON.stringify("file:///" + harness.replace(/^\//, ""))}\nok("one", true)\nskip("a skipped check", "because")\nfinish()\n`)

const results = path.join(root, "results")
const run = spawnSync(process.execPath, [path.join(here, "run.mjs"), "--suites-dir", path.join(root, "suites"), "--results", results], { encoding: "utf8", timeout: 240000 })

let failed = 0
const ok = (name, cond, extra = "") => { if (!cond) failed++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + extra)) }

ok("the runner exits 1 when scripts failed", run.status === 1, `exit ${run.status}\n${run.stdout}\n${run.stderr}`.slice(0, 1200))
const dirs = fs.existsSync(results) ? fs.readdirSync(results).filter((n) => /^\d{4}-/.test(n)) : []
ok("a results folder was written", dirs.length === 1, String(dirs))
if (dirs.length === 1) {
  const report = JSON.parse(fs.readFileSync(path.join(results, dirs[0], "report.json"), "utf8"))
  const scripts = Object.fromEntries(report.suites.flatMap((s) => s.scripts.map((x) => [x.file, x])))
  const status = (f) => scripts[f]?.status
  ok("a passing script is PASS", status("a-pass.mjs") === "pass", status("a-pass.mjs"))
  ok("its note is kept", scripts["a-pass.mjs"]?.notes?.includes("a note"))
  ok("a script with a false check is FAIL, with the detail", status("b-fail.mjs") === "fail" && scripts["b-fail.mjs"].checks.some((c) => c.status === "fail" && c.detail.includes("on purpose")), JSON.stringify(scripts["b-fail.mjs"]?.checks))
  ok("a crashing script is FAIL", status("c-crash.mjs") === "fail", status("c-crash.mjs"))
  ok("a script that reports nothing is FAIL", status("d-nochecks.mjs") === "fail" && /no checks/.test(scripts["d-nochecks.mjs"].reason), scripts["d-nochecks.mjs"]?.reason)
  ok("a hanging script is stopped at its timeout and FAILs", status("e-hang.mjs") === "fail" && /timed out/.test(scripts["e-hang.mjs"].reason), scripts["e-hang.mjs"]?.reason)
  ok("a flaky script that passes on the retry is FLAKY, not FAIL", status("f-flaky.mjs") === "flaky" && scripts["f-flaky.mjs"].attempts === 2, JSON.stringify([status("f-flaky.mjs"), scripts["f-flaky.mjs"]?.attempts]))
  ok("a skipped check is counted as skipped", status("g-skip.mjs") === "pass" && scripts["g-skip.mjs"].checks.some((c) => c.status === "skip"))
  ok("no electron process was left", report.leftoverProcesses === 0, String(report.leftoverProcesses))
  ok("the text report and the markdown report exist", fs.existsSync(path.join(results, dirs[0], "report.txt")) && fs.existsSync(path.join(results, dirs[0], "report.md")))
}
fs.rmSync(root, { recursive: true, force: true })
console.log(failed ? `${failed} FAILED` : "ALL PASSED")
process.exit(failed ? 1 : 0)
