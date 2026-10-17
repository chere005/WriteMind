// electron-builder.yml `mac.sign`: how WriteMind.app is signed, Developer ID or ad hoc alike. One thing more than
// electron-builder's own signing (@electron/osx-sign), which it then calls with the same options:
//
// THE QUICK LOOK EXTENSION (Contents/PlugIns/WriteMindPreview.appex, tools/build-quicklook.sh) IS SIGNED FIRST, WITH
// ITS OWN ENTITLEMENTS. electron-builder skips everything under Contents/PlugIns (MacTargetHelper's `ignore`), so left
// to itself it would seal the app round an extension still carrying the build's ad-hoc signature - which a Developer ID
// app cannot hold and notarization refuses. And it must not get the app's entitlements either (packaging/
// entitlements.mac.plist: JIT, the camera, no sandbox): macOS loads a Quick Look extension only when it is sandboxed.
// So it is signed here with the same identity, keychain, hardened runtime and timestamp the app is about to be signed
// with (`optionsForFile` for the app is what osx-sign itself will use), and apps/desktop/quicklook/
// WriteMindPreview.entitlements; then osx-sign signs the rest and the app, whose seal covers the extension.
//
// BOTH SIGNINGS ARE TRIED AGAIN AFTER A FAILURE, as electron-builder's own is (`retrying`): handing it a `mac.sign` hook
// replaces its signing, retry included, and Apple's timestamp server fails now and then.
//
// tools/verify-mac.sh checks the result (the extension present, signed, sandboxed, no JIT, the runtime when the app has it).
const { spawn } = require("node:child_process")
const { existsSync } = require("node:fs")
const path = require("node:path")

const ENTITLEMENTS = path.join(__dirname, "../quicklook/WriteMindPreview.entitlements")
const APPEX = "Contents/PlugIns/WriteMindPreview.appex"

/** The codesign arguments for the extension, from the options osx-sign is handed for the app. Exported for the test. */
function appexArguments(opts, appex) {
  const forApp = typeof opts.optionsForFile === "function" ? opts.optionsForFile(opts.app) || {} : {}
  const args = ["--sign", opts.identity, "--force"]
  if (opts.keychain) args.push("--keychain", opts.keychain)
  // As osx-sign does it: a timestamp server named (or `none`), else Apple's.
  args.push(forApp.timestamp ? `--timestamp=${forApp.timestamp}` : "--timestamp")
  if (forApp.hardenedRuntime) args.push("--options", "runtime")
  args.push("--entitlements", ENTITLEMENTS, appex)
  return args
}

/**
 * `task`, and again after a failure, as electron-builder signs when no hook is given (app-builder-lib's
 * macCodeSign.sign: builder-util's `retry`, three retries, 5 s apart and 5 s longer each time, so 5, 10 and 15 s).
 * `wait` and `log` are for the test.
 */
async function retrying(task, { retries = 3, interval = 5000, backoff = 5000, wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = (line) => console.log(line) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt >= retries) throw error
      const pause = interval + backoff * attempt
      log(`  • signing failed (${String(error && error.message || error).split("\n")[0]}); trying again in ${pause / 1000} s`)
      await wait(pause)
    }
  }
}

/** `codesign` with these arguments, its output shown; rejects when it fails. */
function codesign(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("codesign", args, { stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`codesign exited with ${signal ?? code}`)))
  })
}

async function sign(opts) {
  const appex = path.join(opts.app, APPEX)
  if (existsSync(appex)) {
    console.log(`  • signing the Quick Look extension  file=${path.relative(process.cwd(), appex)} identity=${opts.identity}`)
    await retrying(() => codesign(appexArguments(opts, appex)))
  } else {
    // (A Mac with no swiftc builds no extension; tools/verify-mac.sh fails such a package.)
    console.log("  • no Quick Look extension in the app (tools/build-quicklook.sh did not build one)")
  }
  const { signAsync } = require("@electron/osx-sign")
  await retrying(() => signAsync(opts))
}

module.exports = sign
module.exports.default = sign
module.exports.appexArguments = appexArguments
module.exports.retrying = retrying
module.exports.ENTITLEMENTS = ENTITLEMENTS
module.exports.APPEX = APPEX
