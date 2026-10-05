#!/usr/bin/env node
// Start or stop ONE isolated offscreen instance by hand, to write or debug a script against it.
//
//   node e2e/instance.mjs start --name mine --port 9416 [--video chart|tilted] [--hold]
//     --hold keeps this command running while the app runs (needed where the shell kills its children when a
//     command returns, e.g. an AI agent's shell tool: run it in the background); Ctrl-C or `stop` ends both.
//   WM_PORT=9416 node e2e/suites/cells/selection.mjs            run a script against it
//   node e2e/instance.mjs stop --name mine                      stop it (by pid; removes its temp folder)
//   node e2e/instance.mjs list
//
// The same temp-profile / temp-notes / offscreen / WRITEMIND_E2E setup the runner uses (lib/instance.mjs).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startInstance, stopInstance, readInstance, sweep, alive } from "./lib/instance.mjs"
import { makeVideoFixtures } from "./lib/fixtures.mjs"

const argv = process.argv.slice(2)
const cmd = argv.shift()
const get = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt }
const name = get("--name", "dev")
const base = path.join(os.tmpdir(), "wm-e2e-dev")
const dir = path.join(base, name)

if (cmd === "start") {
  const video = get("--video")
  const fx = video ? makeVideoFixtures(path.join(base, "fixtures")) : null
  const inst = await startInstance({ dir, port: get("--port") ? Number(get("--port")) : 0, video: video ? fx[video] : undefined })
  console.log(`started ${name}: pid ${inst.pid}, port ${inst.port}\nnotes   ${inst.notes}\nprofile ${inst.profile}\nrun a script:  WM_PORT=${inst.port} node e2e/suites/<area>/<script>.mjs`)
  if (argv.includes("--hold")) {
    const stop = async () => { await stopInstance(inst); process.exit(0) }
    process.on("SIGINT", stop); process.on("SIGTERM", stop)
    while (alive(inst.pid) && fs.existsSync(path.join(dir, "instance.json"))) await new Promise((r) => setTimeout(r, 1000))
    await stopInstance(inst)
  }
} else if (cmd === "stop") {
  if (!fs.existsSync(path.join(dir, "instance.json"))) { console.log(`no instance ${name}`); process.exit(0) }
  const inst = readInstance(dir)
  await stopInstance(inst)
  console.log(`stopped ${name}; leftovers: ${sweep(inst.profile).length}`)
  if (!argv.includes("--keep")) fs.rmSync(dir, { recursive: true, force: true })
} else if (cmd === "list") {
  for (const n of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const f = path.join(base, n, "instance.json")
    if (fs.existsSync(f)) { const i = JSON.parse(fs.readFileSync(f, "utf8")); console.log(`${n}: pid ${i.pid} port ${i.port}`) }
  }
} else {
  console.log("usage: node e2e/instance.mjs start|stop|list [--name n] [--port p] [--video chart|tilted]")
  process.exit(2)
}
process.exit(0)
