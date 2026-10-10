// The Mac release (2026-10-05, Apple silicon only since 2026-10-10): one ad-hoc signed dmg on the same GitHub Release
// as the Windows installer. Nothing built for Intel ships on a Mac.
// What can be checked without a Mac is the configuration: electron-builder.yml's mac / dmg sections, the
// package:mac:adhoc script, release.yml's four jobs and ci.yml's mac-package job, read as YAML (js-yaml, the copy
// electron-builder itself brings). What only a Mac can check (the signature, every Mach-O's slice,
// Info.plist, the dmg) is tools/verify-mac.sh, which both workflows run on macos-15.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { load } from "js-yaml"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../../..")
const text = (rel: string): string => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const yaml = (rel: string): Any => load(text(rel))

const builder = yaml("apps/desktop/electron-builder.yml")
const release = yaml(".github/workflows/release.yml")
const ci = yaml(".github/workflows/ci.yml")
const desktopPkg = JSON.parse(text("apps/desktop/package.json"))
const rootPkg = JSON.parse(text("package.json"))
const lock = JSON.parse(text("package-lock.json"))

/** Every `run:` of a job, joined. */
const runs = (job: Any): string => (job.steps as Any[]).map((s) => s.run ?? "").join("\n")
const asList = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String)

const AD_HOC = ["-c.mac.identity=-", "-c.forceCodeSigning=true", "-c.mac.timestamp=none", "-c.mac.notarize=false"]

describe("electron-builder.yml, the Mac", () => {
  const mac = builder.mac

  it("makes a dmg (to download) and a zip (for the updater) for Apple silicon alone, the chip in the name", () => {
    // Sean, 2026-10-10: no x86 code on a Mac. A behaviour change from 3.0.0, which made an x64 dmg and zip too.
    expect(mac.target).toEqual([{ target: "dmg", arch: ["arm64"] }, { target: "zip", arch: ["arm64"] }])
    expect(mac.artifactName).toBe("${productName}-${version}-mac-${arch}.${ext}")
    expect(mac.artifactName).toContain("${arch}")
  })

  it("packs no koffi on a Mac (the Windows pen's FFI, which carries every platform's prebuilt binary)", () => {
    expect(mac.files).toEqual(expect.arrayContaining(["!node_modules/koffi/**", "!node_modules/@koromix/**"]))
    // Windows keeps it: the Wintab code needs it there.
    expect(builder.files.join("\n")).not.toContain("koffi")
    expect(asList(builder.asarUnpack)).toContain("node_modules/koffi/**")
    expect(desktopPkg.dependencies.koffi).toBeDefined()
  })

  it("writes no update info for a dmg (the zip's latest-mac.yml is the feed)", () => {
    expect(builder.dmg.writeUpdateInfo).toBe(false)
  })

  it("macOS 13 or newer, as the string 13.0", () => {
    expect(mac.minimumSystemVersion).toBe("13.0")
  })

  it("is signed with the Developer ID, hardened and notarized, with the camera entitlement (CI's ad-hoc line overrides it)", () => {
    expect(mac.hardenedRuntime).toBe(true)
    expect(mac.notarize).toBe(true)
    expect(String(mac.identity)).toMatch(/2LGYTL3FSJ/)
    expect(String(mac.entitlements)).toMatch(/entitlements\.mac\.plist$/)
  })

  it("asks for the camera and Documents in its own words", () => {
    expect(mac.extendInfo.NSCameraUsageDescription).toMatch(/camera/)
    expect(mac.extendInfo.NSDocumentsFolderUsageDescription).toMatch(/Documents/)
  })

  it("leaves the Windows installer as it was", () => {
    expect(builder.win.target).toEqual([{ target: "nsis", arch: ["x64"] }, { target: "portable", arch: ["x64"] }])
    expect(builder.nsis.artifactName).toBe("${productName}-Setup-${version}.${ext}")
    expect(builder.nsis.license).toBe("../LICENSE")
    expect(builder.publish).toEqual({ provider: "github", owner: "chere005", repo: "WriteMind", releaseType: "draft" })
  })
})

describe("package:mac:adhoc", () => {
  const script: string = desktopPkg.scripts["package:mac:adhoc"]

  it("is the arm64 dmg alone, signed ad hoc, never published", () => {
    expect(script).toContain("electron-builder --mac dmg --arm64 --publish never --config electron-builder.yml")
    expect(script).not.toMatch(/--x64|--universal/)
    for (const flag of AD_HOC) expect(script).toContain(flag)
    expect(script).not.toMatch(/--publish (always|onTag|onTagOrDraft)/)
  })
})

describe("release.yml", () => {
  const jobs = release.jobs

  it("has four jobs: prepare, then windows and mac, then publish", () => {
    expect(Object.keys(jobs).sort()).toEqual(["mac", "prepare", "publish", "windows"])
    expect(asList(jobs.windows.needs)).toEqual(["prepare"])
    expect(asList(jobs.mac.needs)).toEqual(["prepare"])
    expect(asList(jobs.publish.needs)).toEqual(expect.arrayContaining(["windows", "mac"]))
  })

  it("prepare checks the tag and makes (or reuses) the draft, refusing a published release", () => {
    const run = runs(jobs.prepare)
    expect(run).toContain("-cnotmatch '^v\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$'")
    expect(run).toContain("gh release create $env:TAG --draft --verify-tag")
    expect(run).toContain("--notes-file")
    expect(run).toMatch(/drafts -contains "false"[\s\S]*exit 1/)
    expect(jobs.prepare.outputs.version).toContain("steps.version.outputs.version")
  })

  it("windows uploads the installer, its blockmap and latest.yml into the draft, and publishes nothing itself", () => {
    const run = runs(jobs.windows)
    expect(jobs.windows["runs-on"]).toBe("windows-latest")
    expect(run).toContain("--win nsis --x64 --publish always")
    expect(run).toContain("npm test")
    expect(run).not.toContain("gh release edit")
    expect(run).not.toContain("-cnotmatch")
  })

  it("mac builds the arm64 dmg (signed: and the zip) with --publish never, checks it, then uploads it with gh", () => {
    const mac = jobs.mac
    const run = runs(mac)
    expect(mac["runs-on"]).toBe("macos-15")
    expect(mac.defaults.run.shell).toBe("bash")
    expect(run).toContain("npm ci")
    expect(run).toContain("npm run build")
    // Signed and notarized when the secrets are set (the Developer ID line), otherwise package:mac:adhoc's.
    expect(run).toContain("--mac dmg zip --arm64 --publish never")
    expect(run).not.toMatch(/--x64|--universal/)
    expect(run).toContain("npm run package:mac:adhoc")
    expect(run).toContain("bash tools/verify-mac.sh")
    expect(run).toContain('gh release upload "$TAG" dist-electron/*-mac-*.dmg --clobber')
    // The updater's files go up only from a signed build (an ad-hoc copy cannot install them).
    expect(run).toMatch(/WRITEMIND_MAC_SIGNED:-\}" = 1 \]; then[\s\S]*latest-mac\.yml --clobber/)
    // verify before upload
    expect(run.indexOf("verify-mac.sh")).toBeLessThan(run.indexOf("gh release upload"))
    expect(run).not.toMatch(/--publish always/)
  })

  it("publish waits for every file, the one dmg included, before taking the draft off", () => {
    const run = runs(jobs.publish)
    expect(run).toContain('"latest.yml"')
    expect(run).toContain(".exe.blockmap")
    expect(run).toContain("WriteMind-$env:VERSION-mac-arm64.dmg")
    expect(run).not.toContain("mac-x64")
    expect(run.indexOf("mac-arm64.dmg")).toBeLessThan(run.indexOf("--draft=false"))
    expect(run).toContain("--draft=false --latest")
    expect(run).toContain("--draft=false --prerelease")
  })

  it("gives the signing secrets to the mac job alone", () => {
    const raw = text(".github/workflows/release.yml")
    const secrets = new Set(raw.match(/secrets\.[A-Za-z0-9_]+/g))
    expect([...secrets].sort()).toEqual(["secrets.APPLE_API_ISSUER", "secrets.APPLE_API_KEY_ID", "secrets.APPLE_API_KEY_P8",
      "secrets.CSC_KEY_PASSWORD", "secrets.CSC_LINK", "secrets.GITHUB_TOKEN"])
    // Only the mac job sees the signing secrets.
    const signing = (j: Any) => Object.keys(j.env ?? {}).some((k) => /^(APPLE_|CSC_)/.test(k) && k !== "CSC_IDENTITY_AUTO_DISCOVERY")
    expect(Object.keys(jobs).filter((name) => signing(jobs[name]))).toEqual(["mac"])
  })
})

describe("ci.yml", () => {
  const job = ci.jobs["mac-package"]

  it("packages and checks the Mac arm64 dmg on main, never publishing", () => {
    expect(job["runs-on"]).toBe("macos-15")
    expect(job.if).toContain("refs/heads/main")
    expect(job.if).toContain("workflow_dispatch")
    const run = runs(job)
    expect(run).toContain("npm ci")
    expect(run).toContain("npm run typecheck")
    expect(run).toContain("npm run build")
    expect(run).toContain("npm -w @writemind/desktop run package:mac:adhoc")
    expect(run).toContain("bash tools/verify-mac.sh")
    expect(run).not.toMatch(/gh release|--publish always/)
    expect(JSON.stringify(job)).not.toMatch(/secrets\.|APPLE_ID|CSC_LINK/)
    // The unit tests block on macOS as on Windows (the seven Windows-path tests were fixed, 2026-10-05).
    const tests = (job.steps as Any[]).find((s) => s.run === "npm test")
    expect(tests).toBeDefined()
    expect(tests["continue-on-error"]).toBeUndefined()
    const upload = (job.steps as Any[]).find((s) => String(s.uses).startsWith("actions/upload-artifact"))
    expect(upload.with.path).toBe("dist-electron/*-mac-*.dmg")
    expect(upload.with["retention-days"]).toBe(14)
  })

  it("keeps the Windows jobs", () => {
    expect(ci.jobs.verify["runs-on"]).toBe("windows-latest")
    expect(ci.jobs.e2e.needs).toBe("verify")
  })
})

describe("the Mac scripts", () => {
  it("build-helpers.sh compiles wm-vision and wm-pen for arm64 and macOS 13 alone: no x86_64 slice, no lipo", () => {
    const sh = text("tools/build-helpers.sh")
    expect(sh).toContain('min="13.0"')
    expect(sh).toContain('-target "arm64-apple-macos$min"')
    expect(sh).toContain("tools/pen/wm-pen.swift")
    expect(sh).toContain("tools/vision/wm-vision.swift")
    // Comments may say what is gone; the commands must not do it.
    const commands = sh.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n")
    expect(commands).not.toMatch(/x86_64|lipo -create|x64/)
    expect(commands.match(/swiftc -O -target "arm64-apple-macos\$min"/g)?.length).toBe(2)
  })

  it("the build runs build-helpers, and the script that was build-vision is gone", () => {
    expect(desktopPkg.scripts.build).toContain("node scripts/build-helpers.mjs")
    expect(text("apps/desktop/scripts/build-helpers.mjs")).toContain("tools/build-helpers.sh")
    expect(existsSync(path.join(root, "tools/build-vision.sh"))).toBe(false)
    expect(existsSync(path.join(root, "apps/desktop/scripts/build-vision.mjs"))).toBe(false)
  })

  it("verify-mac.sh checks the signature, both helpers' slices, every Mach-O, Info.plist and the one dmg", () => {
    const sh = text("tools/verify-mac.sh")
    expect(sh.startsWith("#!/usr/bin/env bash\n")).toBe(true)
    for (const piece of [
      "codesign --verify --deep --strict",
      "Signature=adhoc",
      "app.asar.unpacked/out/helpers/wm-pen",
      "app.asar.unpacked/out/helpers/wm-vision",
      "scan_macho",
      "scan_asar",
      '"$got" != "arm64"',
      "is a universal binary",
      "NSCameraUsageDescription",
      "LSMinimumSystemVersion",
      'WriteMind-$version-mac-arm64.dmg',
      "mac-arm64) check_app",
      "exit 1",
    ]) expect(sh).toContain(piece)
    // Nothing of Intel's is expected anywhere: the old checks for an x64 app and an x64 dmg are gone.
    expect(sh).not.toContain("mac-x64.dmg")
    expect(sh).not.toContain("x86_64 and arm64")
  })
})

describe("the version", () => {
  // Not pinned to a literal: release.yml's windows job runs npm test, so a
  // pinned version would fail the next release until this file changed too.
  it("is one semver in the root, apps/desktop and the lockfile", () => {
    const versions = [
      rootPkg.version,
      desktopPkg.version,
      lock.version,
      lock.packages[""].version,
      lock.packages["apps/desktop"].version,
    ]
    expect(new Set(versions).size).toBe(1)
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  })
})
