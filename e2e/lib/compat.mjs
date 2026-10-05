// A drop-in for the older `C:\CLAUDIO\agents\cdp.mjs` (js, send, sleep, VIEW, shot, close, targets), on top of the
// harness, so a script written against that client can be moved into e2e/suites with only its import line changed:
//
//   import { js, send, sleep, VIEW, shot, close, targets } from "../../lib/compat.mjs"
//
// Its `shot(file)` writes the screenshot into the run's shots folder under the file's base name (an absolute path
// from another machine layout would not exist). `close()` closes the page connection (as the old one did), which is what lets a
// script that never calls finish() end. Scripts that print their own PASS / FAIL lines keep working under the runner (a FAIL line fails the
// script); new ones should use `ok` and `finish` from harness.mjs.
import path from "node:path"
import { js, send, sleep, VIEW, shot as harnessShot, closePage, PORT } from "./harness.mjs"
import { targetsOf } from "./cdp.mjs"

export { js, send, sleep, VIEW }
export const shot = (file) => harnessShot(path.basename(String(file)))
export const close = () => closePage()
export const targets = () => targetsOf(PORT)
