// A DEVELOPMENT RUN ON A MAC SAYS "WriteMind", NOT "Electron" (Sean, 2026-10-05:
// "macos shows electron in the dock ... it should just show WriteMind with the
// WriteMind logo").
//
// `npm run dev` / `npm start` run inside node_modules/electron/dist/Electron.app,
// and the Dock takes its label (CFBundleName / CFBundleDisplayName), the menu
// bar's bold first title and the icon from THAT bundle - which nothing the app
// does at run time can change. So this gives the dev bundle WriteMind's name,
// its own bundle id (com.seancheren.writemind.dev: macOS keeps its camera
// permission apart from any other Electron app's) and the Mac app's icon, then
// re-seals it (ad-hoc `codesign`, since an edited bundle no longer matches the
// signature it came with) and tells LaunchServices it changed.
//
// SAFE TO RUN ANY TIME: a no-op off macOS, a no-op when the bundle already says
// WriteMind, and it only ever touches node_modules (an `npm ci` puts Electron
// back, and the next dev run patches it again). The PACKAGED app needs none of
// this: electron-builder.yml names it and gives it the icon.
//
//   node apps/desktop/scripts/mac-dev-identity.mjs
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writemindIcns } from "./icns.mjs"

export const DEV_IDENTITY = {
  name: "WriteMind",
  id: "com.seancheren.writemind.dev",
  // The camera prompt's wording, as the packaged app's (electron-builder.yml extendInfo).
  camera: "WriteMind uses the camera to take the writing off a notebook page.",
}

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const keyPattern = (key) => new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`)

/**
 * The bundle's Info.plist (XML) with WriteMind's name, display name, bundle id
 * and camera wording; CFBundleIconName dropped, so macOS draws the .icns rather
 * than an asset-catalog icon. Keys it lacks are added at the end of the top
 * dictionary, keys it has are changed in place, and nothing else moves - so a
 * second pass changes nothing. `iconFile` is the .icns the bundle names.
 */
export function patchInfoPlist(xml, identity = DEV_IDENTITY) {
  const values = {
    CFBundleName: identity.name,
    CFBundleDisplayName: identity.name,
    CFBundleIdentifier: identity.id,
    NSCameraUsageDescription: identity.camera,
  }
  let out = xml.replace(/[ \t]*<key>CFBundleIconName<\/key>\s*<string>[^<]*<\/string>[ \t]*\r?\n?/, "")
  const end = out.lastIndexOf("</dict>")
  if (end < 0 || !/<plist[\s>]/.test(out)) throw new Error("Info.plist: not an XML property list")
  const newline = out.includes("\r\n") ? "\r\n" : "\n"
  const added = []
  for (const [key, value] of Object.entries(values)) {
    const pattern = keyPattern(key)
    if (pattern.test(out)) out = out.replace(pattern, (_all, open, _old, close) => `${open}${escapeXml(value)}${close}`)
    else added.push(`\t<key>${key}</key>${newline}\t<string>${escapeXml(value)}</string>${newline}`)
  }
  if (added.length > 0) {
    const close = out.lastIndexOf("</dict>")
    out = out.slice(0, close) + added.join("") + out.slice(close)
  }
  const icon = out.match(keyPattern("CFBundleIconFile"))
  let iconFile = icon ? icon[2].trim() : ""
  if (!iconFile) {
    iconFile = "electron.icns"
    const close = out.lastIndexOf("</dict>")
    out = out.slice(0, close) + `\t<key>CFBundleIconFile</key>${newline}\t<string>${iconFile}</string>${newline}` + out.slice(close)
  }
  if (!iconFile.endsWith(".icns")) iconFile += ".icns"
  return { xml: out, iconFile }
}

/** node_modules/electron/dist/Electron.app, wherever npm put the electron package. */
export function electronAppPath() {
  const require = createRequire(import.meta.url)
  return path.join(path.dirname(require.resolve("electron/package.json")), "dist", "Electron.app")
}

/**
 * Patch the dev Electron.app (macOS only). Returns what it did: "not-mac",
 * "missing", "unchanged", "patched" or "failed". It never throws: a dev run
 * that cannot be renamed still runs, under Electron's name.
 */
export function applyDevIdentity({ platform = process.platform, app, log = (line) => console.log(line) } = {}) {
  if (platform !== "darwin") return "not-mac"
  try {
    const bundle = app ?? electronAppPath()
    const plist = path.join(bundle, "Contents", "Info.plist")
    if (!existsSync(plist)) {
      log(`WriteMind dev identity: no ${plist} (has Electron been downloaded? npm install); left as Electron`)
      return "missing"
    }
    if (readFileSync(plist).subarray(0, 6).toString("latin1") === "bplist") {
      execFileSync("plutil", ["-convert", "xml1", plist], { stdio: "ignore" })
    }
    const before = readFileSync(plist, "utf8")
    const { xml, iconFile } = patchInfoPlist(before)
    const iconPath = path.join(bundle, "Contents", "Resources", iconFile)
    const icns = writemindIcns()
    const iconSame = existsSync(iconPath) && readFileSync(iconPath).equals(icns)
    if (xml === before && iconSame) return "unchanged"

    if (xml !== before) writeFileSync(plist, xml, "utf8")
    if (!iconSame) writeFileSync(iconPath, icns)
    // An edited bundle no longer matches its signature: seal it again, ad hoc (no certificate needed).
    const sign = () => execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" })
    try {
      sign()
    } catch {
      // codesign refuses a bundle carrying extended attributes ("detritus not allowed"): clear them and try once more.
      try { execFileSync("xattr", ["-cr", bundle], { stdio: "ignore" }); sign() } catch {
        log("WriteMind dev identity: codesign is missing or failed; the bundle is renamed but not re-signed")
      }
    }
    // Finder and the Dock read names and icons from LaunchServices' cache: say the bundle changed.
    const now = new Date()
    utimesSync(bundle, now, now)
    if (existsSync(LSREGISTER)) {
      try { execFileSync(LSREGISTER, ["-f", bundle], { stdio: "ignore" }) } catch { /* the touch is the fallback */ }
    }
    log("WriteMind dev identity: Electron.app now shows as WriteMind (Dock name, menu bar, icon)")
    return "patched"
  } catch (error) {
    log(`WriteMind dev identity: skipped (${error instanceof Error ? error.message : String(error)})`)
    return "failed"
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) applyDevIdentity()
