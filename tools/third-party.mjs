// Writes docs/THIRD-PARTY.md from package-lock.json: every package that ships inside the app (not "dev")
// with its version and licence, then the build-and-test tools counted by licence. Run it after a dependency
// changes: `node tools/third-party.mjs`.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"))

const licenceOf = (dir, entry) => {
  if (entry.license) return typeof entry.license === "string" ? entry.license : entry.license.type
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8"))
    if (pkg.license) return typeof pkg.license === "string" ? pkg.license : pkg.license.type
    if (pkg.licenses) return pkg.licenses.map((l) => l.type ?? l).join(" OR ")
  } catch {}
  return "UNKNOWN"
}

const seen = new Set()
const rows = []
for (const [dir, entry] of Object.entries(lock.packages)) {
  if (!dir.includes("node_modules/") || entry.link) continue
  const name = dir.slice(dir.lastIndexOf("node_modules/") + "node_modules/".length)
  const key = `${name}@${entry.version}`
  if (seen.has(key)) continue
  seen.add(key)
  rows.push({ name, version: entry.version, licence: licenceOf(dir, entry), dev: !!entry.dev, optional: !!entry.optional })
}
const shipped = rows.filter((r) => !r.dev).sort((a, b) => a.name.localeCompare(b.name))
const tools = rows.filter((r) => r.dev)
const byLicence = {}
for (const r of tools) byLicence[r.licence] = (byLicence[r.licence] ?? 0) + 1

// THE BUNDLED OCR ENGINE (docs/OCR-BUNDLED.md) is not an npm dependency of the app: scripts/build.mjs bundles
// onnxruntime-web (and onnxruntime-common) into its worker and copies the WebAssembly runtime and the model files.
const bundledRuntime = rows.filter((r) => r.name === "onnxruntime-web" || r.name === "onnxruntime-common")
const models = JSON.parse(fs.readFileSync(path.join(root, "apps", "desktop", "scripts", "ocr-models.json"), "utf8")).models
const bundled = [
  "## Bundled by the build: the OCR engine",
  "",
  "Not npm dependencies of the app: `apps/desktop/scripts/build.mjs` bundles these into the bundled OCR engine's",
  "worker and copies its WebAssembly runtime and model files (docs/OCR-BUNDLED.md).",
  "",
  "| Software | Version | Licence |",
  "| --- | --- | --- |",
  ...bundledRuntime.map((r) => `| ${r.name} | ${r.version} | ${r.licence} |`),
  ...models.map((m) => `| ${m.file} (${m.what}; PaddleOCR PP-OCRv5, ONNX by RapidOCR) | sha256 ${m.sha256.slice(0, 12)}… | Apache-2.0 |`),
  "",
]

const out = [
  "# Third-party software",
  "",
  "Generated from `package-lock.json` by `node tools/third-party.mjs`; do not edit by hand.",
  "",
  "WriteMind's own code is BSD 3-Clause ([LICENSE](../LICENSE)). The app also ships the packages below, all",
  "under permissive licences, and Electron's runtime (Chromium and Node.js), whose notices are in",
  "`LICENSES.chromium.html` inside every installed copy. The README says what each main package is used for.",
  "",
  `## Shipped inside the app (${shipped.length})`,
  "",
  "Packages marked *optional* are platform-specific builds; only the one for the machine is installed.",
  "",
  "| Package | Version | Licence |",
  "| --- | --- | --- |",
  ...shipped.map((r) => `| ${r.name}${r.optional ? " *(optional)*" : ""} | ${r.version} | ${r.licence} |`),
  "",
  ...bundled,
  `## Build and test tools only, never shipped (${tools.length})`,
  "",
  "These include Electron's npm package (its runtime is listed above), electron-builder, TypeScript, Vite,",
  "esbuild and Vitest, and everything they depend on.",
  "",
  "| Licence | Packages |",
  "| --- | --- |",
  ...Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`),
  "",
]
fs.writeFileSync(path.join(root, "docs", "THIRD-PARTY.md"), out.join("\n"))
console.log(`docs/THIRD-PARTY.md: ${shipped.length} shipped, ${tools.length} build-only`)
