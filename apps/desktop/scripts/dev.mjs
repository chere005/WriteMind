// One command for the loop: vite serving the renderer, esbuild building the
// shell, electron on top of both. The window reloads on save; a change to
// the MAIN process needs the command again, which is the one thing a dev
// server cannot do for you.
import { spawn } from "node:child_process"
import { setTimeout as wait } from "node:timers/promises"

const run = (command, args, env) =>
  spawn(command, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } })

await import("./build.mjs")
const vite = run("npx", ["vite", "--port", "5173", "--strictPort"])
await wait(1200)
const electron = run("npx", ["electron", "."], { WRITEMIND_DEV: "1" })

const stop = () => { vite.kill(); electron.kill(); process.exit(0) }
electron.on("exit", stop)
process.on("SIGINT", stop)
