// Shared by the export scripts: the Wolfram engine THIS machine has, and whether it answers.
import fs from "node:fs"
import { spawnSync } from "node:child_process"

const WOLFRAMSCRIPTS = ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript", "/Applications/Wolfram Engine.app/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript",
  "/Applications/Wolfram.app/Contents/MacOS/wolframscript", "/Applications/Mathematica.app/Contents/MacOS/wolframscript"]

/**
 * The engine, for the half of a script that needs the kernel's own answers: `{ script }` when wolframscript is installed
 * AND evaluates something (a Wolfram Engine that was never activated starts, says its version, and then answers every run
 * with a licence message, so finding the program is not enough), else `{ script: null, why }` with the words a SKIP gives.
 */
export function wolframEngine() {
  const found = WOLFRAMSCRIPTS.find((file) => fs.existsSync(file))
  if (!found) return { script: null, why: "no wolframscript here" }
  const run = spawnSync(found, ["-code", "Print[1 + 1]"], { encoding: "utf8", timeout: 90000 })
  if (run.status === 0 && run.stdout.trim() === "2") return { script: found, why: "" }
  const said = `${run.stdout}${run.stderr}`.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? `exit ${run.status}`
  return { script: null, why: `wolframscript is installed but does not evaluate (${said.slice(0, 120)})` }
}
