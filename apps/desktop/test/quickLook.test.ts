// WriteMind's Quick Look extension (apps/desktop/quicklook; Sean, 2026-10-17: "add a preview of rendered mode to macos
// spotlight"). What can be checked without a Mac:
//   - THE SCRIPT the extension runs: apps/desktop/scripts/build-quicklook.mjs's bundle, built here with the same options,
//     evaluated in a Node `vm` context that holds the language and nothing else - which is what a JavaScriptCore
//     JSContext gives it (no TextEncoder, no crypto, no console, no DOM, no require) - and asked for real pages;
//   - THE WIRING: the extension's Info.plist and entitlements, electron-builder.yml's mac.extraFiles and mac.sign, the
//     signing hook's arguments for a Developer ID and an ad-hoc build, the build scripts, verify-mac.sh's checks.
//   - ON A MAC, THE ENGINE: the same bundle in the system's own JavaScriptCore with its JIT off, as the sandboxed
//     extension runs it, drawing notes crafted to be slow - each must come back in a glance's time (review of the
//     preview, 2026-10-17: a line of brackets held it for minutes, 3 999 strokes for three seconds).
// What only a Mac can check (the built bundle, its signature, Quick Look actually drawing it) is tools/verify-mac.sh
// and docs/TESTING.md's "Quick Look" check.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { describe, expect, it } from "vitest"
import { load } from "js-yaml"
import plist from "plist"
import { writeDrawing } from "@writemind/core"
import { renderQuickLook } from "../../../packages/core/src/export/quickLook"
import { HOSTILE_TEXT, hostileDrawing, INJECTED, PLAIN_TEXT, SLOW_TEXT } from "../scripts/quicklook-sample-notes"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../../..")
const text = (rel: string): string => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const MANIFEST = JSON.stringify({ format: "writemind-note", version: 1 })
const NAMES = ["mimetype", "manifest.json", "note.mdwm"]

/** The bundle, run in a context with nothing in it but the language. */
async function bareContext(): Promise<Any> {
  // @ts-expect-error - a plain .mjs build script, no types
  const { bundleQuickLook } = await import("../scripts/build-quicklook.mjs")
  const source: string = await bundleQuickLook()
  const context = vm.createContext({})
  vm.runInContext(source, context, { filename: "preview.js" })
  return context
}

describe("the extension's script, in a context with nothing but the language (as JavaScriptCore runs it)", () => {
  it("starts with no globals to lean on, and defines WriteMindPreview", async () => {
    const empty = vm.createContext({})
    expect(vm.runInContext("typeof TextEncoder + typeof crypto + typeof document + typeof require + typeof process", empty))
      .toBe("undefinedundefinedundefinedundefinedundefined")
    const context = await bareContext()
    expect(typeof context.WriteMindPreview.render).toBe("function")
    expect(typeof context.WriteMindPreview.refusal).toBe("function")
    expect(typeof context.WriteMindPreview.message).toBe("function")
  })

  it("renders a note: a heading, maths as MathML, a list, a picture as cid:", async () => {
    const context = await bareContext()
    const input = {
      text: "# Title\n\n```wl\nx^2 + Sqrt[y]\n```\n\n- one\n- [x] two\n\n![a cat](media/cat.png)",
      drawing: JSON.stringify({ items: [{ kind: "stroke", colorHex: "#000000", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }] }] }),
      manifest: MANIFEST, names: [...NAMES, "drawing.json", "media/cat.png"], textBytes: 70,
    }
    const out = JSON.parse(context.WriteMindPreview.render(JSON.stringify(input)))
    expect(out.message).toBe(false)
    expect(out.html).toContain(">Title</div>")
    expect(out.html).toContain("<math display=\"block\">")
    expect(out.html).toContain('<div class="list">')
    expect(out.html).toContain('<img src="cid:wm0" alt="a cat"')
    expect(out.attachments).toEqual([{ cid: "wm0", entry: "media/cat.png" }])
    // The free ink: a stroke with no id was given one (crypto.randomUUID, which the bundle brings for itself).
    expect(out.html).toContain('<div class="free-ink">')
  })

  it("answers the names before anything is unpacked, and a message is a page", async () => {
    const context = await bareContext()
    expect(context.WriteMindPreview.refusal(JSON.stringify([...NAMES, "../evil"]))).toBe("This note cannot be shown: “../evil” has a “..” part.")
    expect(context.WriteMindPreview.refusal(JSON.stringify(NAMES))).toBeNull()
    expect(context.WriteMindPreview.refusal("not json")).toBe("This note cannot be shown.")
    expect(context.WriteMindPreview.message("<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;")
    const out = JSON.parse(context.WriteMindPreview.render("{broken"))
    expect(out.message).toBe(true)
  })

  it("lets no script into the page, whatever the note or its drawing says", async () => {
    const context = await bareContext()
    // (A colour that ends its attribute: what ran script in Quick Look before drawing.ts wrote only real colours.)
    const fill = `"><svg><image href="x" onerror="fetch('http://127.0.0.1:1/ran')"/></svg><x y="`
    const out = JSON.parse(context.WriteMindPreview.render(JSON.stringify({
      text: "# <script>alert(1)</script>\n\n<img src=x onerror=alert(2)>", manifest: MANIFEST, names: [...NAMES, "drawing.json"],
      drawing: JSON.stringify({ items: [{ kind: "shape", shapeKind: "text", center: { x: 0.5, y: 0.5 }, width: 0.3, aspect: 0.3,
        colorHex: fill, fillHex: fill, label: "words" }] }),
    })))
    expect(out.html).toContain('<div class="free-ink">')
    expect(out.html).not.toMatch(/<script/i)
    expect(out.html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
    expect(out.html).not.toContain("<image")
    expect(out.html).not.toContain("127.0.0.1")
  })
})

/** The system's JavaScriptCore shell: the engine the extension runs the bundle in. */
const JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"

/**
 * Notes made to be slow, each as `render` is handed it. Every one took seconds (the last three tens of seconds or
 * minutes) in the extension before the renderer read links, bold and tags in one pass and capped the ink by its points.
 */
const SLOW_NOTES = `
const md = (body) => "<!-- markdown -->\\n" + body
const strokes = []
for (let i = 0; i < 3999; i++) {
  const points = []
  for (let j = 0; j < 200; j++) points.push({ x: ((i * 7 + j) % 100) / 100, y: (j % 50) / 60 })
  strokes.push({ kind: "stroke", id: "s" + i, colorHex: "#000000", width: 3, points })
}
const notes = {
  "a run of 199 000 <": { text: md("<".repeat(199000)) },
  "3 999 strokes of 200 points": { text: "Words.", drawing: JSON.stringify({ items: strokes }) },
  "a heading of 40 000 [": { text: "# " + "[".repeat(40000) },
  "20 000 [x]( that never close": { text: md("[x](".repeat(20000)) },
  "20 000 **a that never close": { text: md("**a ".repeat(20000)) },
  "20 000 __a that never close": { text: md("__a ".repeat(20000)) },
  "40 000 ![": { text: md("![".repeat(40000)) },
  "fifty lines of 4 000 [, one paragraph": { text: md(("[".repeat(4000) + "\\n").repeat(50)) },
  "slow.wm, the check's own sample": { text: ${JSON.stringify(SLOW_TEXT)} },
}
`

describe("the extension's script in JavaScriptCore with no JIT, as the extension runs it (a Mac)", () => {
  it.skipIf(!existsSync(JSC))("draws every note crafted to be slow in a glance's time", async () => {
    // @ts-expect-error - a plain .mjs build script, no types
    const { bundleQuickLook } = await import("../scripts/build-quicklook.mjs")
    const folder = mkdtempSync(path.join(os.tmpdir(), "wm-quicklook-jsc-"))
    try {
      writeFileSync(path.join(folder, "preview.js"), await bundleQuickLook())
      writeFileSync(path.join(folder, "slow.js"), `${SLOW_NOTES}
load(arguments[0])
const MANIFEST = JSON.stringify({ format: "writemind-note", version: 1 })
const times = {}
for (const [name, note] of Object.entries(notes)) {
  const names = ["mimetype", "manifest.json", "note.mdwm"].concat(note.drawing ? ["drawing.json"] : [])
  const started = preciseTime()
  const page = JSON.parse(WriteMindPreview.render(JSON.stringify({ manifest: MANIFEST, names, drawing: null, ...note })))
  times[name] = { ms: Math.round((preciseTime() - started) * 1000), message: page.message, html: page.html.length }
}
print(JSON.stringify(times))
`)
      const out = execFileSync(JSC, ["--useJIT=false", "--useRegExpJIT=false", path.join(folder, "slow.js"), "--", path.join(folder, "preview.js")],
        { encoding: "utf8", timeout: 180_000 })
      const times = JSON.parse(out.trim().split("\n").pop()!) as Record<string, { ms: number; message: boolean; html: number }>
      expect(Object.keys(times)).toHaveLength(9)
      for (const [name, time] of Object.entries(times)) {
        expect(time.message, name).toBe(false)
        // Each is well under half a second here; the bound is for a slow, busy machine, and still far below what the
        // same notes took before (four seconds to minutes).
        expect(time.ms, `${name}: ${time.ms} ms`).toBeLessThan(2_500)
        // (The heavy drawing is left off the page rather than written: 39 MB before.)
        expect(time.html, name).toBeLessThan(4_000_000)
      }
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }, 240_000)
})

describe("the sample notes tools/check-quicklook.sh photographs (quicklook-sample-notes.ts)", () => {
  const MANIFEST_ID = JSON.stringify({ format: "writemind-note", version: 1, id: "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10" })

  it("plain.wm's text cell is a text cell: its stars are words and its line break is kept", () => {
    // (Unescaped, the older-notes rule read the stars as markdown: the photograph showed italics the sample said it
    // would not have.)
    const out = renderQuickLook({ text: PLAIN_TEXT, manifest: MANIFEST_ID, names: NAMES })
    expect(out.html).toContain('<div class="para">A text cell, as typed: *not italic* and line breaks\nkept as they are.</div>')
    expect(out.html).toContain('<div class="para">A markdown cell with <b>bold</b>, <i>italic</i>')
  })

  it("hostile.wm's drawing reaches the page with none of its payloads: no handler, no probe, no mark", () => {
    const probe = "http://127.0.0.1:47123"
    const out = renderQuickLook({ text: HOSTILE_TEXT, drawing: writeDrawing(hostileDrawing(probe)), manifest: MANIFEST_ID, names: [...NAMES, "drawing.json"] })
    expect(out.html).toContain('<div class="free-ink">')
    expect(out.html).toContain('class="wm-ink-cell"')
    expect(out.html).not.toContain(probe)
    expect(out.html).not.toContain(INJECTED)
    expect(out.html).not.toMatch(/<script/i)
    expect(out.html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
  })
})

describe("the extension bundle's Info.plist and entitlements", () => {
  const info = plist.parse(text("apps/desktop/quicklook/Info.plist")) as Any
  const entitlements = plist.parse(text("apps/desktop/quicklook/WriteMindPreview.entitlements")) as Any

  it("is a data-based Quick Look preview of a WriteMind note, under the app's bundle id", () => {
    expect(info.CFBundleIdentifier).toBe("com.seancheren.writemind.quicklook")
    // An extension's id is its app's, and then something (macOS refuses one that is not).
    const builder = load(text("apps/desktop/electron-builder.yml")) as Any
    expect(info.CFBundleIdentifier.startsWith(`${builder.appId}.`)).toBe(true)
    expect(info.CFBundlePackageType).toBe("XPC!")
    expect(info.CFBundleExecutable).toBe("WriteMindPreview")
    expect(info.CFBundleShortVersionString).toBe("@VERSION@")
    expect(info.LSMinimumSystemVersion).toBe("13.0")
    expect(info.NSExtension.NSExtensionPointIdentifier).toBe("com.apple.quicklook.preview")
    expect(info.NSExtension.NSExtensionPrincipalClass).toBe("WMPreviewProvider")
    expect(info.NSExtension.NSExtensionAttributes.QLIsDataBasedPreview).toBe(true)
    expect(text("apps/desktop/quicklook/PreviewProvider.swift")).toContain("@objc(WMPreviewProvider)")
  })

  it("previews the note's own type AND Windows Media's, which is what macOS calls every .wm file", () => {
    const types = info.NSExtension.NSExtensionAttributes.QLSupportedContentTypes
    expect(types).toEqual(["com.seancheren.writemind.note", "com.microsoft.windows-media-wm"])
    // The note's type is the one the app exports.
    const builder = load(text("apps/desktop/electron-builder.yml")) as Any
    expect(builder.mac.extendInfo.UTExportedTypeDeclarations[0].UTTypeIdentifier).toBe(types[0])
    // A real Windows Media file is told apart by its first bytes and handed back.
    expect(text("apps/desktop/quicklook/PreviewProvider.swift")).toContain("if PreviewRenderer.isWindowsMedia(request.fileURL) { throw")
    expect(text("apps/desktop/quicklook/PreviewRenderer.swift")).toContain("0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11")
  })

  it("is sandboxed with read-only file access and none of the app's entitlements", () => {
    expect(entitlements).toEqual({
      "com.apple.security.app-sandbox": true,
      "com.apple.security.files.user-selected.read-only": true,
    })
  })
})

describe("packaging", () => {
  const builder = load(text("apps/desktop/electron-builder.yml")) as Any
  const require = createRequire(import.meta.url)
  const hook = require("../scripts/sign-mac.cjs")

  it("puts the built extension in WriteMind.app/Contents/PlugIns and signs with the hook", () => {
    expect(builder.mac.extraFiles).toEqual([{ from: "build/quicklook/WriteMindPreview.appex", to: "PlugIns/WriteMindPreview.appex" }])
    expect(builder.mac.sign).toBe("./scripts/sign-mac.cjs")
    expect(hook.APPEX).toBe("Contents/PlugIns/WriteMindPreview.appex")
    expect(typeof hook).toBe("function")
    // Nothing of it reaches Windows or Linux, or the archive.
    expect(JSON.stringify(builder.win ?? {}) + JSON.stringify(builder.linux ?? {}) + JSON.stringify(builder.files)).not.toContain("quicklook")
  })

  it("signs the extension with the app's Developer ID, keychain, runtime and timestamp, and its own entitlements", () => {
    const opts = {
      app: "/x/WriteMind.app", identity: "ABCDEF0123", keychain: "/tmp/k.keychain",
      optionsForFile: (file: string) => file === "/x/WriteMind.app"
        ? { entitlements: "/repo/packaging/entitlements.mac.plist", hardenedRuntime: true, timestamp: undefined } : {},
    }
    const args: string[] = hook.appexArguments(opts, "/x/WriteMind.app/Contents/PlugIns/WriteMindPreview.appex")
    expect(args).toEqual([
      "--sign", "ABCDEF0123", "--force", "--keychain", "/tmp/k.keychain", "--timestamp", "--options", "runtime",
      "--entitlements", hook.ENTITLEMENTS, "/x/WriteMind.app/Contents/PlugIns/WriteMindPreview.appex",
    ])
    // (A path of this machine's: backslashes on the Windows runner, where the hook is never run but the test is.)
    expect(hook.ENTITLEMENTS.replaceAll("\\", "/")).toMatch(/apps\/desktop\/quicklook\/WriteMindPreview\.entitlements$/)
    expect(args.join(" ")).not.toContain("entitlements.mac.plist")
  })

  it("signs it ad hoc, with no runtime and no timestamp server, beside an ad-hoc app", () => {
    const opts = { app: "/x/WriteMind.app", identity: "-", optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }) }
    expect(hook.appexArguments(opts, "/a.appex")).toEqual(["--sign", "-", "--force", "--timestamp=none", "--entitlements", hook.ENTITLEMENTS, "/a.appex"])
  })

  it("tries both signings again after a failure, as electron-builder's own signing does (5, 10, 15 s), then gives up", async () => {
    const waits: number[] = []
    const quiet = { wait: async (ms: number) => { waits.push(ms) }, log: () => {} }
    let calls = 0
    // A timestamp server that fails twice and then answers.
    await expect(hook.retrying(async () => { calls++; if (calls < 3) throw new Error("timestamp server unavailable"); return "signed" }, quiet))
      .resolves.toBe("signed")
    expect(calls).toBe(3)
    expect(waits).toEqual([5000, 10000])
    // One that never answers: four tries, then its error.
    waits.length = 0
    calls = 0
    await expect(hook.retrying(async () => { calls++; throw new Error("no") }, quiet)).rejects.toThrow("no")
    expect(calls).toBe(4)
    expect(waits).toEqual([5000, 10000, 15000])
    // Both the extension's codesign and osx-sign's go through it.
    const source = text("apps/desktop/scripts/sign-mac.cjs")
    expect(source).toContain("await retrying(() => codesign(appexArguments(opts, appex)))")
    expect(source).toContain("await retrying(() => signAsync(opts))")
    // (electron-builder's own, which the hook replaces: the same three retries.)
    expect(readFileSync(require.resolve("app-builder-lib/out/codeSign/macCodeSign.js"), "utf8"))
      .toMatch(/retry\)\(\(\) => signAsync\(opts\), \{\s*retries: 3,\s*interval: 5000,\s*backoff: 5000,/)
  })

  it("is built by npm run build on a Mac: one arm64 slice, macOS 13, an app extension with NSExtensionMain", () => {
    expect(text("tools/build-helpers.sh")).toContain("sh tools/build-quicklook.sh")
    const build = text("tools/build-quicklook.sh")
    expect(build).toContain('out="apps/desktop/build/quicklook"')
    expect(build).toContain('-target "arm64-apple-macos$min"')
    expect(build).toContain('min="13.0"')
    expect(build).toContain("-application-extension -Xlinker -application_extension -Xlinker -e -Xlinker _NSExtensionMain")
    expect(build).toContain("node apps/desktop/scripts/build-quicklook.mjs")
    expect(build).toContain('sed "s/@VERSION@/$version/g"')
    // No process is spawned by the extension, and it reaches for nothing but the file it is handed.
    for (const file of ["PreviewProvider.swift", "PreviewRenderer.swift", "WmArchive.swift"]) {
      expect(text(`apps/desktop/quicklook/${file}`)).not.toMatch(/\bProcess\(|posix_spawn|NSTask|URLSession/)
    }
  })

  it("is checked by tools/verify-mac.sh: present, arm64, signed, sandboxed, its own entitlements, its Info.plist", () => {
    const verify = text("tools/verify-mac.sh")
    expect(verify).toContain("check_quicklook \"$app\"")
    for (const needle of [
      "Contents/PlugIns/WriteMindPreview.appex", "NSExtension.NSExtensionPointIdentifier|com.apple.quicklook.preview",
      "NSExtension.NSExtensionAttributes.QLIsDataBasedPreview|true", "com.microsoft.windows-media-wm",
      "com.apple.security.app-sandbox", "allow-jit", "Resources/preview.js", "minos \"$exe\" arm64",
    ]) expect(verify).toContain(needle)
  })

  it("names only test files that are there (a comment that sends a reader to a file that is not is a wrong comment)", () => {
    const sources = ["apps/desktop/scripts/build-quicklook.mjs", "apps/desktop/scripts/sign-mac.cjs", "apps/desktop/scripts/quicklook-samples.ts",
      "apps/desktop/scripts/quicklook-sample-notes.ts", "apps/desktop/src/quicklook/preview.ts", "apps/desktop/src/quicklook/environment.ts",
      "apps/desktop/quicklook/PreviewProvider.swift", "apps/desktop/quicklook/PreviewRenderer.swift", "apps/desktop/quicklook/WmArchive.swift",
      "packages/core/src/export/quickLook.ts", "tools/build-quicklook.sh", "tools/check-quicklook.sh", "tools/verify-mac.sh", "docs/TESTING.md"]
    const named = new Set<string>()
    for (const file of sources) {
      for (const match of text(file).matchAll(/(?:apps\/desktop|packages\/core)\/test\/[\w.-]+\.test\.ts|test\/[\w.-]+\.test\.ts/g)) named.add(match[0])
    }
    expect(named.size).toBeGreaterThan(0)
    for (const one of named) {
      const candidates = one.startsWith("test/") ? [`packages/core/${one}`, `apps/desktop/${one}`] : [one]
      expect(candidates.some((candidate) => existsSync(path.join(root, candidate))), one).toBe(true)
    }
  })

  it("is said in the release workflow's Mac job", () => {
    expect(text(".github/workflows/release.yml")).toMatch(/Quick Look extension/)
  })
})
