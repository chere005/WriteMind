// Compiles the macOS Vision helper where there is a Mac to compile it on.
// tools/build-vision.sh already does nothing elsewhere; this only keeps the
// build from needing `sh` on Windows.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

if (process.platform === "win32") {
  console.log("==> not macOS: no Vision helper, and the app will not offer what it does")
} else {
  const script = fileURLToPath(new URL("../../../tools/build-vision.sh", import.meta.url))
  const r = spawnSync("sh", [script], { stdio: "inherit" })
  process.exit(r.status ?? 1)
}
