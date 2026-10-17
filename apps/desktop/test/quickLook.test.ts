// WriteMind's Quick Look extension (apps/desktop/quicklook; Sean, 2026-10-17: "add a preview of rendered mode to macos
// spotlight"). What can be checked without a Mac:
//   - THE SCRIPT the extension runs: apps/desktop/scripts/build-quicklook.mjs's bundle, built here with the same options,
//     evaluated in a Node `vm` context that holds the language and nothing else - which is what a JavaScriptCore
//     JSContext gives it (no TextEncoder, no crypto, no console, no DOM, no require) - and asked for real pages;
//   - THE WIRING: the extension's Info.plist and entitlements, electron-builder.yml's mac.extraFiles and mac.sign, the
//     signing hook's arguments for a Developer ID and an ad-hoc build, the build scripts, verify-mac.sh's checks.
// What only a Mac can check (the built bundle, its signature, Quick Look actually drawing it) is tools/verify-mac.sh
// and docs/TESTING.md's "Quick Look" check.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { describe, expect, it } from "vitest"
import { load } from "js-yaml"
import plist from "plist"

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

  it("lets no script into the page, whatever the note says", async () => {
    const context = await bareContext()
    const out = JSON.parse(context.WriteMindPreview.render(JSON.stringify({
      text: "# <script>alert(1)</script>\n\n<img src=x onerror=alert(2)>", manifest: MANIFEST, names: NAMES,
    })))
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
    expect(hook.ENTITLEMENTS).toMatch(/apps\/desktop\/quicklook\/WriteMindPreview\.entitlements$/)
    expect(args.join(" ")).not.toContain("entitlements.mac.plist")
  })

  it("signs it ad hoc, with no runtime and no timestamp server, beside an ad-hoc app", () => {
    const opts = { app: "/x/WriteMind.app", identity: "-", optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }) }
    expect(hook.appexArguments(opts, "/a.appex")).toEqual(["--sign", "-", "--force", "--timestamp=none", "--entitlements", hook.ENTITLEMENTS, "/a.appex"])
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

  it("is said in the release workflow's Mac job", () => {
    expect(text(".github/workflows/release.yml")).toMatch(/Quick Look extension/)
  })
})
