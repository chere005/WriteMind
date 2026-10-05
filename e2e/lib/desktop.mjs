// Helpers for the DESKTOP suites (e2e/suites/grab): they need the real desktop because they inject OS-level pen
// and mouse input (a synthetic Windows Ink pen, the mouse, SetCursorPos) and the app puts a transparent overlay over
// the display. They are skipped unless the runner gets --desktop, and they move the real mouse: leave it alone.
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { connectCdp } from "./cdp.mjs"
import { PORT } from "./harness.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

/** Another page of the instance (the grab overlay is target("grab=1")): { send, js, close, url }. */
export const target = (match) => connectCdp({ port: PORT, match })

/**
 * A persistent injector process (lib/inject.ps1): `await inj.cmd("pen hover 100 100")`, "pen down x y [pressure]",
 * "pen move", "pen up", "pen leave", "mouse move x y", "mouse down/up", "sig move x y" (a mouse move carrying the
 * pen signature Windows gives pen-promoted mouse input), "cursor x y". Coordinates are in a 1920x1200 reference
 * display and are scaled to the real primary display. `inj.quit()` stops it (always call it in a finally).
 */
export function injector() {
  const p = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "inject.ps1")], { stdio: ["pipe", "pipe", "inherit"] })
  let buf = ""
  const q = []
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); q.shift()?.(l) } })
  const ready = new Promise((r) => q.push(r))
  const cmd = async (c) => { await ready; return new Promise((res) => { q.push(res); p.stdin.write(c + "\n") }) }
  const quit = () => { try { p.stdin.write("quit\n") } catch { /* gone */ } setTimeout(() => { try { p.kill() } catch { /* gone */ } }, 1500).unref() }
  process.on("exit", () => { try { p.kill() } catch { /* gone */ } })
  return { cmd, quit, pid: p.pid }
}
