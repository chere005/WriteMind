// The main process and the preload, bundled: the main as ESM (the package
// is a module, and Electron takes an ESM entry point), the preload as CJS
// (a preload is require()d, whatever the package says).
import { build } from "esbuild"

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "warning",
}

await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "out/main/main.mjs", format: "esm" })
await build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "out/preload/preload.cjs", format: "cjs" })
// The helpers that are scripts rather than programs (Windows' OCR) ship as they are, beside
// the main bundle where `shipped(here, "../helpers/...")` looks - and `asarUnpack`
// (electron-builder.yml) takes them out of the archive, where nothing can run.
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs"
mkdirSync("out/helpers", { recursive: true })
cpSync("src/helpers", "out/helpers", { recursive: true })
// The Windows installer's own optional-tools script, for File > Language Setup...'s Install and Activate buttons
// (main/toolSetup.ts, helpers.ts `toolsScript`): the same file the installer embeds from the build resources, so the
// two cannot drift. `asarUnpack: out/helpers/**` already takes it out of the archive.
copyFileSync("../../packaging/installer-tools.ps1", "out/helpers/installer-tools.ps1")
// THE ICONS a Mac needs (Sean, 2026-10-05: the Dock must show WriteMind, not Electron): the rounded logo the main
// process sets as a dev run's dock tile (main/macIdentity.ts), and the .icns electron-builder.yml gives WriteMind.app,
// made from the Mac app's own icon set (scripts/icns.mjs). Built on every platform, so every out/ is the same.
import { ROUNDED_ICON, writemindIcns } from "./icns.mjs"
mkdirSync("out/icons", { recursive: true })
copyFileSync(ROUNDED_ICON, "out/icons/icon.png")
writeFileSync("out/icons/WriteMind.icns", writemindIcns())
// THE NOTICES (Sean, 2026-10-07: attribution for Wolfram and for every library, in the About dialog): the list of what
// ships, with each licence's text, written from package-lock.json and node_modules by tools/gen-notices.mjs - the same
// generator that writes THIRD-PARTY-NOTICES.md, so the dialog and the file cannot disagree. A library with no licence
// text stops the build. main/about.ts reads it.
import { generate } from "../../../tools/gen-notices.mjs"
const { notices, problems } = generate()
if (problems.length > 0) throw new Error("notices: " + problems.join("; "))
writeFileSync("out/notices.json", JSON.stringify(notices))
console.log("main and preload built; helpers, icons and notices written")
