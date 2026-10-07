/**
 * THIRD-PARTY-NOTICES.md and the notices.json the About dialog reads (tools/gen-notices.mjs). Port-only.
 *
 * The committed markdown is checked against a fresh run of the generator in memory: a stale file (a dependency was
 * added, upgraded or dropped and `npm run notices` was not run) fails here, and so does a shipped package with no
 * licence text. The Wolfram section is held to what Sean asked for, word for word where it matters: independent,
 * not affiliated, used only as a user, the trademarks, the logo's purpose.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  copyrightOf, generate, groupTexts, libraries, NOTICES_FILE, OTHER_NAMES, pageOf, WOLFRAM_FULL, WOLFRAM_SHORT,
} from "../../../tools/gen-notices.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const committed = readFileSync(path.join(root, NOTICES_FILE), "utf8")
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { dev?: boolean; link?: boolean }> }
const desktop = JSON.parse(readFileSync(path.join(root, "apps/desktop/package.json"), "utf8")) as { dependencies: Record<string, string> }

describe("THIRD-PARTY-NOTICES.md", () => {
  const made = generate({ root })

  it("is what the generator writes now (run `npm run notices` when this fails)", () => {
    expect(made.markdown).toBe(committed)
  })

  it("has a licence text for every package that ships, and nothing it could not say", () => {
    expect(made.problems).toEqual([])
    for (const one of made.notices.libraries) {
      expect(one.text.length, one.name).toBeGreaterThan(100)
      expect(one.license, one.name).toMatch(/\S/)
      expect(one.copyright, one.name).toMatch(/\S/)
      expect(one.copyright, one.name).not.toBe("not stated")
      expect(one.url, one.name).toMatch(/^https:\/\//)
    }
  })

  it("lists what the app is built from: the app's own dependencies, Electron, Chromium and the editor's libraries", () => {
    const names = made.notices.libraries.map((one: { name: string }) => one.name)
    for (const own of Object.keys(desktop.dependencies)) expect(names, own).toContain(own)
    for (const name of ["Electron", "Chromium", "react-dom", "@lezer/lr", "crelt", "style-mod", "w3c-keyname", "builder-util-runtime"]) {
      expect(names, name).toContain(name)
    }
    // Development tools never reach a user.
    for (const name of ["vite", "esbuild", "vitest", "typescript", "electron-builder"]) expect(names, name).not.toContain(name)
  })

  it("lists every non-dev package of the lockfile once (koffi's per-platform binaries as one entry)", () => {
    const shipped = Object.entries(lock.packages).filter(([key, entry]) =>
      key !== "" && !entry.dev && !entry.link && !key.startsWith("packages/") && !key.startsWith("apps/") && !key.includes("@koromix/koffi-"))
    const names = made.notices.libraries.map((one: { name: string }) => one.name)
    for (const [key] of shipped) expect(names, key).toContain(key.replace(/^.*node_modules\//, ""))
    expect(names.filter((name: string) => name.startsWith("@koromix/koffi-"))).toHaveLength(1)
  })

  it("starts with Wolfram, and says what Sean asked it to say", () => {
    const headings = [...committed.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(headings[0]).toBe("Wolfram")
    const section = committed.slice(committed.indexOf("## Wolfram"), committed.indexOf("## Other names"))
    for (const phrase of [
      "independent project",
      "not affiliated with, endorsed by or sponsored by Wolfram Research, Inc.",
      "only as a user of it",
      "installed and licensed on their own computer",
      "through wolframscript",
      "ships none of that software",
      "the user's own licence and activation",
      "Wolfram, Wolfram Language, Wolfram Engine, Mathematica, WolframScript, the Wolfram logo and the spikey are trademarks and/or copyrights of Wolfram Research, Inc.",
      "All Wolfram software and logos belong to Wolfram Research",
      "only to identify Wolfram cells",
    ]) expect(section, phrase).toContain(phrase)
    expect(made.notices.wolfram.full).toEqual(WOLFRAM_FULL)
    expect(made.notices.wolfram.short).toBe(WOLFRAM_SHORT)
    // The dialog's shorter text keeps the claims that matter.
    for (const phrase of ["not affiliated with, endorsed by or sponsored by", "only as a user", "ships none of it", "trademarks and/or copyrights of Wolfram Research, Inc.", "all Wolfram software and logos belong to Wolfram Research"]) {
      expect(WOLFRAM_SHORT, phrase).toContain(phrase)
    }
  })

  it("names the other labels, WriteMind's own licence and the Chromium licences' place", () => {
    for (const line of OTHER_NAMES) expect(committed).toContain(line)
    expect(OTHER_NAMES.join(" ")).toMatch(/Python Software Foundation/)
    expect(OTHER_NAMES.join(" ")).toMatch(/Rust Foundation/)
    expect(OTHER_NAMES.join(" ")).toMatch(/C and C\+\+ icons are WriteMind's own drawings/)
    const own = readFileSync(path.join(root, "LICENSE"), "utf8").trim()
    expect(committed).toContain(own.split("\n").slice(0, 3).join("\n"))
    expect(made.notices.app.license).toBe("BSD-3-Clause")
    expect(made.notices.app.copyright).toBe("Copyright (c) 2026, Shahean Cheren")
    expect(committed).toContain("LICENSES.chromium.html")
  })

  it("gives each distinct text once, and the table names every component", () => {
    const fences = committed.match(/^`{3,}text$/gm) ?? []
    // WriteMind's own, then the groups.
    expect(fences).toHaveLength(1 + groupTexts(made.notices.libraries.filter((one: { name: string }) => one.name !== "Chromium")).length)
    for (const one of made.notices.libraries) expect(committed, one.name).toContain(`| ${one.name} | ${one.version} |`)
  })
})

describe("the generator's rules", () => {
  /** A repository in a temp folder: a lockfile, some packages, and whatever LICENSE files the test gives them. */
  function repo(packages: Record<string, { files?: Record<string, string>; license?: string; author?: string; dev?: boolean }>): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wm-notices-"))
    const lockPackages: Record<string, unknown> = { "": { name: "x" } }
    for (const [name, spec] of Object.entries(packages)) {
      const where = path.join(dir, "node_modules", name)
      mkdirSync(where, { recursive: true })
      writeFileSync(path.join(where, "package.json"), JSON.stringify({ name, version: "1.0.0", license: spec.license ?? "MIT", author: spec.author, repository: `https://github.com/o/${name}.git` }))
      for (const [file, text] of Object.entries(spec.files ?? {})) writeFileSync(path.join(where, file), text)
      lockPackages[`node_modules/${name}`] = { version: "1.0.0", license: spec.license ?? "MIT", ...(spec.dev ? { dev: true } : {}) }
    }
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ packages: lockPackages }))
    return dir
  }
  const MIT = "MIT License\n\nCopyright (c) 2020 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n"

  it("a shipped package with no licence text is a problem, not a silent gap", () => {
    const { libraries: found, problems } = libraries(repo({ good: { files: { LICENSE: MIT } }, bad: { files: {}, license: "BSD-3-Clause" } }))
    expect(found.map((one: { name: string }) => one.name)).toEqual(["good"])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/bad.*no licence text/)
  })

  it("a package that ships no file but declares MIT gets the standard text, said to be so", () => {
    const { libraries: found, problems } = libraries(repo({ plain: { files: {}, author: "Ann <a@b.c>" } }))
    expect(problems).toEqual([])
    expect(found[0].text).toContain("Copyright (c) Ann")
    expect(found[0].text).toContain("Permission is hereby granted")
    expect(found[0].note).toMatch(/ships no licence file/)
  })

  it("dev dependencies are left out, and identical texts are grouped", () => {
    const dir = repo({ a: { files: { LICENSE: MIT } }, b: { files: { LICENSE: MIT } }, c: { files: { LICENSE: MIT.replace("Someone", "Other") } }, tool: { files: { LICENSE: MIT }, dev: true } })
    const { libraries: found } = libraries(dir)
    expect(found.map((one: { name: string }) => one.name)).toEqual(["a", "b", "c"])
    const groups = groupTexts(found)
    expect(groups.map((g: { entries: { name: string }[] }) => g.entries.map((one) => one.name))).toEqual([["a", "b"], ["c"]])
  })

  it("reads a copyright from a line that states one, and not from a sentence that mentions one", () => {
    expect(copyrightOf("MIT\n\nCopyright (c) 2015 Loopline Systems\n\nthe above copyright notice")).toBe("Copyright (c) 2015 Loopline Systems")
    expect(copyrightOf("copyright in it.\nCOPYRIGHT HOLDERS BE LIABLE")).toBeNull()
    expect(copyrightOf("Copyright (c) 2011 A\nCopyright and related rights are waived")).toBe("Copyright (c) 2011 A")
  })

  it("makes a page of a repository field, whatever form it is in", () => {
    expect(pageOf({ repository: { url: "git+https://github.com/o/r.git" } }, "r")).toBe("https://github.com/o/r")
    expect(pageOf({ repository: "nodeca/argparse" }, "argparse")).toBe("https://github.com/nodeca/argparse")
    expect(pageOf({ repository: { url: "git@github.com:o/r.git" } }, "r")).toBe("https://github.com/o/r")
    expect(pageOf({ repository: { url: "git://github.com/o/r.git" } }, "r")).toBe("https://github.com/o/r")
    expect(pageOf({}, "x")).toBe("https://www.npmjs.com/package/x")
  })
})
