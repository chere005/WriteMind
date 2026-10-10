// THIRD-PARTY-NOTICES.md and the app's notices.json, written from what is actually installed. Plain node, no
// network: it reads package-lock.json (which packages ship) and node_modules (their licence files).
//
//   node tools/gen-notices.mjs            write THIRD-PARTY-NOTICES.md          (npm run notices)
//   node tools/gen-notices.mjs --check    say whether that file is stale, change nothing
//   node tools/gen-notices.mjs --json F   also write the notices.json the About dialog reads, to F
//
// apps/desktop/scripts/build.mjs imports `generate` and writes out/notices.json on every build, so the About
// dialog's list is always the build's own. test/notices.test.ts runs `generate` and fails when the committed
// markdown differs, when a package that ships has no licence text, or when the Wolfram section is missing.
//
// WHAT SHIPS: every non-dev entry of package-lock.json, which is the production closure of the workspaces
// (apps/desktop's dependencies) and so what esbuild bundles into the main process, what vite bundles into the
// renderer, and what electron-builder packs as node_modules (koffi). Dev tools (vite, esbuild, vitest,
// typescript, electron-builder itself) never reach a user and are not listed. Electron and Chromium are the
// runtime and are listed on their own.
//
// THE KOFFI PLATFORM PACKAGES (@koromix/koffi-darwin-arm64 ...) are optional and only the build machine's own is
// installed, so the list is made from the lockfile and they are one entry, carrying koffi's licence.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")

export const PROJECT_URL = "https://github.com/chere005/WriteMind"
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.md"

// MARK: - What is said about names (one place: the markdown and the About dialog both read it from here)

/** The Wolfram statement, in full: THIRD-PARTY-NOTICES.md and the notices.json's `wolfram.full`. */
export const WOLFRAM_FULL = [
  "WriteMind is an independent project. It is not affiliated with, endorsed by or sponsored by Wolfram Research, Inc.",
  "WriteMind uses Wolfram software only as a user of it: it runs the Wolfram Engine or Mathematica that the person "
    + "has installed and licensed on their own computer, through wolframscript, and it ships none of that software. "
    + "A Wolfram Engine needs the user's own licence and activation, under Wolfram's terms.",
  "Wolfram, Wolfram Language, Wolfram Engine, Mathematica, WolframScript, the Wolfram logo and the spikey are "
    + "trademarks and/or copyrights of Wolfram Research, Inc. All Wolfram software and logos belong to Wolfram "
    + "Research. The logo is shown in WriteMind only to identify Wolfram cells.",
]

/** The same, shorter, for the About dialog. */
export const WOLFRAM_SHORT =
  "WriteMind is independent of Wolfram Research, Inc. and is not affiliated with, endorsed by or sponsored by it. "
  + "It uses Wolfram software only as a user, by running the Wolfram Engine or Mathematica you have installed and "
  + "licensed yourself, through wolframscript, and it ships none of it. Wolfram, Wolfram Language, Wolfram Engine, "
  + "Mathematica, WolframScript, the Wolfram logo and the spikey are trademarks and/or copyrights of Wolfram "
  + "Research, Inc.; all Wolfram software and logos belong to Wolfram Research. The logo is shown only to identify "
  + "Wolfram cells."

/** One line each for the other names a cell is labelled with. */
export const OTHER_NAMES = [
  "Python is a trademark of the Python Software Foundation.",
  "Rust is a name and logo of the Rust Foundation.",
  "The Python, Rust, C and C++ icons are WriteMind's own drawings.",
]

/** What WriteMind itself ships beside the app's code, and what it does not. */
export const OWN_TOOLS = [
  "The macOS helpers wm-vision (reads handwriting with Apple's Vision framework) and wm-pen (reads a Wacom tablet) "
    + "are WriteMind's own code, under WriteMind's licence; they link only Apple's system frameworks.",
  "The Windows helpers wm-ocr.ps1 and installer-tools.ps1 are WriteMind's own scripts; the OCR engine they call is "
    + "Windows' own.",
  "The Windows installer is made with NSIS, through electron-builder (MIT); both keep their own licences.",
  "Python, Tesseract and the Wolfram Engine are never shipped: WriteMind runs the copy a person has installed.",
]

// MARK: - Reading

const read = (file) => readFileSync(file, "utf8")
const readJson = (file) => JSON.parse(read(file))

/** A licence file as text: one line ending, no trailing blanks, nothing else changed. */
const tidy = (text) => text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").replace(/^\n+/, "").replace(/\n+$/, "")

const LICENCE_FILE = /^(licen[sc]e|copying)(\..*)?$/i

/** The licence file of the package in `dir`, as text, or null. */
function licenceTextOf(dir) {
  if (!existsSync(dir)) return null
  // Sorted, so a package with two files always gives the same one.
  const names = readdirSorted(dir).filter((name) => LICENCE_FILE.test(name))
  for (const name of names) {
    const file = path.join(dir, name)
    try { return tidy(read(file)) } catch { /* a folder named LICENSE */ }
  }
  return null
}

const readdirSorted = (dir) => readdirSync(dir).sort()

/** The first lines that state a copyright (not a sentence that mentions one), or null. */
export function copyrightOf(text) {
  const lines = text.split("\n").map((line) => line.trim().replace(/\s+/g, " ").replace(/[,;]$/, ""))
  const stated = lines.filter((line) => /^(Copyright|\(c\)|©)/.test(line) && !/^Copyright (notice|holders?|and related)\b/i.test(line))
  return stated.length > 0 ? stated.slice(0, 2).join("; ") : null
}

/** Packages whose licence file is a stock text with no notice of their own (argparse carries Python's). */
const COPYRIGHT_OVERRIDES = {
  argparse: "Copyright (c) Python Software Foundation and others, as in Python's licence text",
}

/** A git URL as a page a person can open. */
export function pageOf(pkg, name) {
  let url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url
  if (typeof url === "string") {
    url = url.trim()
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
    url = url.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://").replace(/^git@([^:]+):/, "https://$1/")
      .replace(/\.git$/, "")
  }
  if (typeof url === "string" && /^https?:\/\//.test(url)) return url
  if (typeof pkg.homepage === "string" && /^https?:\/\//.test(pkg.homepage)) return pkg.homepage
  return `https://www.npmjs.com/package/${name}`
}

const authorName = (pkg) => {
  const a = pkg.author
  const text = typeof a === "string" ? a : a?.name
  return typeof text === "string" ? text.replace(/\s*[<(].*$/, "").trim() || null : null
}

/** The standard text of a short licence, for the rare package that ships none (its holder from package.json). */
function standardText(license, holder) {
  if (license === "MIT" && holder) {
    return [
      "MIT License", "", `Copyright (c) ${holder}`, "",
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
      "of this software and associated documentation files (the \"Software\"), to deal",
      "in the Software without restriction, including without limitation the rights",
      "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
      "copies of the Software, and to permit persons to whom the Software is",
      "furnished to do so, subject to the following conditions:", "",
      "The above copyright notice and this permission notice shall be included in all",
      "copies or substantial portions of the Software.", "",
      "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
      "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
      "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
      "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
      "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
      "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
      "SOFTWARE.",
    ].join("\n")
  }
  return null
}

const NO_FILE_NOTE = "The package ships no licence file; this is the standard text of its declared licence, with the author named in its package.json."

// MARK: - The libraries

/** Lockfile entries that are one thing in the notices: koffi's per-platform prebuilt binaries. */
const FAMILIES = [{ prefix: "@koromix/koffi-", like: "koffi", label: "@koromix/koffi-* (prebuilt koffi binaries, one per platform)" }]

/**
 * Every library that ships: { name, version, license, copyright, url, text, note? }, sorted by name; and `problems`,
 * what could not be said (a missing licence text), which the CLI and the test treat as a failure.
 */
export function libraries(root = ROOT) {
  const lock = readJson(path.join(root, "package-lock.json"))
  const problems = []
  const out = []
  const family = new Map()
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || entry.dev || entry.devOptional || entry.link) continue
    if (key.startsWith("packages/") || key.startsWith("apps/")) continue
    const name = entry.name ?? key.replace(/^.*node_modules\//, "")
    const kin = FAMILIES.find((f) => name.startsWith(f.prefix))
    if (kin) { family.set(kin.prefix, [...(family.get(kin.prefix) ?? []), entry]); continue }
    const dir = path.join(root, key)
    const pkg = existsSync(path.join(dir, "package.json")) ? readJson(path.join(dir, "package.json")) : {}
    const license = entry.license ?? pkg.license
    if (typeof license !== "string") { problems.push(`${name}: no licence is declared`); continue }
    let text = licenceTextOf(dir)
    let note
    if (text === null) {
      text = standardText(license, authorName(pkg))
      if (text) note = NO_FILE_NOTE
    }
    if (text === null) { problems.push(`${name}@${entry.version}: no licence text (${key})`); continue }
    out.push({
      name, version: entry.version, license, copyright: COPYRIGHT_OVERRIDES[name] ?? copyrightOf(text) ?? (authorName(pkg) ? `Copyright (c) ${authorName(pkg)}` : "not stated"),
      url: pageOf(pkg, name), text, ...(note ? { note } : {}),
    })
  }
  for (const kin of FAMILIES) {
    const members = family.get(kin.prefix)
    if (!members) continue
    const host = out.find((one) => one.name === kin.like)
    if (!host) { problems.push(`${kin.label}: ${kin.like} itself is not in the lockfile`); continue }
    const versions = [...new Set(members.map((m) => m.version))].sort()
    out.push({ ...host, name: kin.label, version: versions.join(", ") })
  }
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") || a.version.localeCompare(b.version))
  return { libraries: out, problems }
}

/** Electron, the runtime. Chromium is inside it. */
export function electron(root = ROOT) {
  const dir = path.join(root, "node_modules", "electron")
  const pkg = existsSync(path.join(dir, "package.json")) ? readJson(path.join(dir, "package.json")) : null
  const text = licenceTextOf(dir)
  const problems = []
  if (!pkg) problems.push("electron is not installed")
  if (!text) problems.push("electron: no licence text")
  const pinned = readJson(path.join(root, "package.json")).devDependencies?.electron
  const version = pkg?.version ?? pinned ?? "unknown"
  return {
    problems,
    electron: {
      name: "Electron", version, license: "MIT", copyright: text ? copyrightOf(text) ?? "not stated" : "not stated",
      url: "https://www.electronjs.org", text: text ?? "",
    },
    chromium: {
      name: "Chromium", version: "in Electron", license: "BSD-3-Clause and others",
      copyright: "The Chromium Authors, and the authors of the components inside it",
      url: "https://www.chromium.org",
      text: "Chromium, and every component inside it, is licensed under its own terms. They are set out in full in "
        + "LICENSES.chromium.html, the file Electron ships: in the folder WriteMind is installed in on Windows and "
        + "Linux, and in WriteMind.app/Contents/Resources on macOS (electron-builder.yml copies it there). On Arch "
        + "Linux the system electron package carries it.",
    },
  }
}

// MARK: - The two outputs

const fence = (text) => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const bar = "`".repeat(longest + 1)
  return `${bar}text\n${text}\n${bar}`
}
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, " ")

/** Group entries whose licence text is exactly the same. */
export function groupTexts(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const group = groups.get(entry.text) ?? { text: entry.text, entries: [] }
    group.entries.push(entry)
    groups.set(entry.text, group)
  }
  return [...groups.values()]
}

/** What generate() returns: the markdown, the notices.json object, and the problems found. */
export function generate({ root = ROOT } = {}) {
  const { libraries: libs, problems } = libraries(root)
  const runtime = electron(root)
  problems.push(...runtime.problems)
  const ownLicence = tidy(read(path.join(root, "LICENSE")))
  const ownCopyright = copyrightOf(ownLicence) ?? "Copyright (c) 2026, Shahean Cheren"
  const app = readJson(path.join(root, "apps/desktop/package.json"))

  const listed = [runtime.electron, runtime.chromium, ...libs]
  const groups = groupTexts(libs.concat(runtime.electron.text ? [runtime.electron] : []))

  const md = []
  md.push(
    "# Third-party notices", "",
    "<!-- Generated by tools/gen-notices.mjs (npm run notices). Do not edit by hand. -->", "",
    `WriteMind: ${ownCopyright}. BSD 3-Clause licence (the file LICENSE). `
      + "This file names the work of others that WriteMind uses or shows, and gives their licences.", "",
    "## Wolfram", "", ...WOLFRAM_FULL.flatMap((p) => [p, ""]),
    "## Other names and icons", "", ...OTHER_NAMES.map((line) => `- ${line}`), "",
    "## WriteMind", "",
    `${ownCopyright}. Released under the BSD 3-Clause licence, which is the file LICENSE and is repeated here.`, "",
    fence(ownLicence), "",
    "## Electron and Chromium", "",
    `WriteMind runs on Electron ${runtime.electron.version} (MIT), which contains Chromium and Node.js. `
      + "The licences of Chromium and of the components inside it are in LICENSES.chromium.html, which Electron ships: "
      + "in the application's folder on Windows and Linux, and in WriteMind.app/Contents/Resources on macOS. "
      + "Electron's own licence is in the list below.", "",
    "## Tools shipped with WriteMind", "", ...OWN_TOOLS.map((line) => `- ${line}`), "",
    "## Libraries", "",
    `${listed.length} components ship in the app: Electron, Chromium, and the ${libs.length} libraries below, which are the `
      + "production dependencies of the app, including what is bundled into its code. Development tools are not shipped and are not listed.", "",
    "| Name | Version | Licence | Copyright | Source |", "| --- | --- | --- | --- | --- |",
    ...listed.map((one) => `| ${cell(one.name)} | ${cell(one.version)} | ${cell(one.license)} | ${cell(one.copyright)} | ${cell(one.url)} |`), "",
    "### Licence texts", "",
    "Each text is given once, under the components it applies to.", "",
  )
  groups.forEach((group, index) => {
    md.push(`#### ${index + 1}. ${group.entries.map((one) => one.name).join(", ")}`, "")
    const notes = [...new Set(group.entries.map((one) => one.note).filter(Boolean))]
    for (const note of notes) md.push(`${note}`, "")
    md.push(fence(group.text), "")
  })
  const markdown = md.join("\n").replace(/\n+$/, "") + "\n"

  const notices = {
    schema: 1,
    app: {
      name: "WriteMind", version: app.version, license: "BSD-3-Clause", copyright: ownCopyright, url: PROJECT_URL, text: ownLicence,
    },
    wolfram: { short: WOLFRAM_SHORT, full: WOLFRAM_FULL },
    names: OTHER_NAMES,
    libraries: listed.map(({ name, version, license, copyright, url, text, note }) =>
      ({ name, version, license, copyright, url, text, ...(note ? { note } : {}) })),
  }
  return { markdown, notices, problems }
}

// MARK: - The command line

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const { markdown, notices, problems } = generate()
  if (problems.length > 0) {
    console.error("notices: cannot be complete:\n  " + problems.join("\n  "))
    process.exit(1)
  }
  const target = path.join(ROOT, NOTICES_FILE)
  if (args.includes("--check")) {
    const have = existsSync(target) ? read(target) : ""
    if (have !== markdown) {
      console.error(`${NOTICES_FILE} is stale: run npm run notices`)
      process.exit(1)
    }
    console.log(`${NOTICES_FILE} is current (${notices.libraries.length} components)`)
  } else {
    writeFileSync(target, markdown)
    console.log(`wrote ${NOTICES_FILE} (${notices.libraries.length} components)`)
  }
  const at = args.indexOf("--json")
  if (at >= 0 && args[at + 1]) {
    const file = path.resolve(args[at + 1])
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(notices))
    console.log(`wrote ${file}`)
  }
}
