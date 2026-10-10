// Compiles the macOS tablet helper (wm-pen) where there is a Mac to compile it on.
// tools/build-helpers.sh already does nothing elsewhere; this only keeps the
// build from needing `sh` on Windows.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

if (process.platform === "win32") {
  console.log("==> not macOS: no native helper to build")
} else {
  const script = fileURLToPath(new URL("../../../tools/build-helpers.sh", import.meta.url))
  const r = spawnSync("sh", [script], { stdio: "inherit" })
  process.exit(r.status ?? 1)
}
