// macOS shows WriteMind, not Electron (Sean, 2026-10-05): the pure parts of main/macIdentity.ts,
// scripts/mac-dev-identity.mjs (the dev bundle's Info.plist) and scripts/icns.mjs (the bundle icon).
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  ICON_BODY, MAC_APP_NAME, applyMacIdentity, dockIcon, dockIconCandidates, padIntoCanvas,
  type MacIdentityDeps,
} from "../src/main/macIdentity"
import { DEV_IDENTITY, applyDevIdentity, patchInfoPlist } from "../scripts/mac-dev-identity.mjs"
import { APP_ICON_SET, ICNS_SLOTS, icnsFromPngs, pngSize, readIcns, writemindIcns } from "../scripts/icns.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(path.join(here, "fixtures", "Electron-Info.plist"), "utf8").replace(/\r\n/g, "\n")
const value = (xml: string, key: string): string | undefined =>
  xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]

describe("the dev bundle's Info.plist (scripts/mac-dev-identity.mjs)", () => {
  it("names the bundle WriteMind, with its own id and the camera wording", () => {
    const { xml, iconFile } = patchInfoPlist(fixture)
    expect(value(xml, "CFBundleName")).toBe("WriteMind")
    expect(value(xml, "CFBundleDisplayName")).toBe("WriteMind")
    expect(value(xml, "CFBundleIdentifier")).toBe("com.seancheren.writemind.dev")
    expect(value(xml, "NSCameraUsageDescription")).toBe(DEV_IDENTITY.camera)
    expect(iconFile).toBe("electron.icns")
  })

  it("drops CFBundleIconName (the .icns is what macOS draws) and leaves every other key alone", () => {
    const { xml } = patchInfoPlist(fixture)
    expect(xml).not.toContain("CFBundleIconName")
    expect(value(xml, "CFBundleExecutable")).toBe("Electron")
    expect(value(xml, "CFBundleIconFile")).toBe("electron.icns")
    expect(value(xml, "CFBundleShortVersionString")).toBe("44.4.3")
    expect(value(xml, "CFBundleURLName")).toBe("Electron Default Protocol")
    expect(xml).toContain("<key>MallocNanoZone</key>")
    expect(xml.trimEnd().endsWith("</dict>\n</plist>")).toBe(true)
    // The added display name goes at the end of the TOP dictionary, not into a nested one.
    const top = xml.lastIndexOf("</dict>")
    expect(xml.indexOf("<key>CFBundleDisplayName</key>")).toBeGreaterThan(xml.indexOf("<key>NSSupportsAutomaticGraphicsSwitching</key>"))
    expect(xml.indexOf("<key>CFBundleDisplayName</key>")).toBeLessThan(top)
  })

  it("is idempotent: a second pass changes nothing", () => {
    const once = patchInfoPlist(fixture).xml
    expect(patchInfoPlist(once).xml).toBe(once)
  })

  it("changes an existing display name in place and escapes what it writes", () => {
    const withDisplay = fixture.replace("<key>CFBundleName</key>", "<key>CFBundleDisplayName</key>\n\t<string>Electron</string>\n\t<key>CFBundleName</key>")
    const { xml } = patchInfoPlist(withDisplay, { ...DEV_IDENTITY, name: "Write & Mind" })
    expect(xml.match(/<key>CFBundleDisplayName<\/key>/g)).toHaveLength(1)
    expect(value(xml, "CFBundleDisplayName")).toBe("Write &amp; Mind")
  })

  it("names an icon file when the bundle has none, keeps CRLF files CRLF, refuses what is not a plist", () => {
    const noIcon = fixture.replace(/\t<key>CFBundleIconFile<\/key>\n\t<string>electron.icns<\/string>\n/, "")
    const { xml, iconFile } = patchInfoPlist(noIcon)
    expect(iconFile).toBe("electron.icns")
    expect(value(xml, "CFBundleIconFile")).toBe("electron.icns")
    const crlf = patchInfoPlist(fixture.replace(/\n/g, "\r\n")).xml
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n")
    expect(() => patchInfoPlist("bplist00garbage")).toThrow()
  })

  it("does nothing off macOS", () => {
    const lines: string[] = []
    expect(applyDevIdentity({ platform: "win32", app: "C:/nowhere/Electron.app", log: (l: string) => lines.push(l) })).toBe("not-mac")
    expect(applyDevIdentity({ platform: "linux", app: "/nowhere/Electron.app", log: (l: string) => lines.push(l) })).toBe("not-mac")
    expect(lines).toEqual([])
  })
})

describe("WriteMind's .icns (scripts/icns.mjs)", () => {
  it("holds the Mac app's icon set, every slot at its own size", () => {
    const icns = writemindIcns()
    const entries = readIcns(icns) as [string, Buffer][]
    expect(entries.map(([type]) => type)).toEqual(ICNS_SLOTS.map(([type]: [string, number]) => type))
    for (const [type, png] of entries) {
      const size = ICNS_SLOTS.find(([one]: [string, number]) => one === type)[1]
      expect(pngSize(png)).toEqual({ width: size, height: size })
    }
    // The 512@2x slot is the Mac app's own 1024 px art, byte for byte.
    expect(entries.find(([type]) => type === "ic10")?.[1].equals(readFileSync(path.join(APP_ICON_SET, "icon_1024.png")))).toBe(true)
  })

  it("writes the header and lengths macOS reads, and is the same bytes every time", () => {
    const icns = writemindIcns()
    expect(icns.toString("latin1", 0, 4)).toBe("icns")
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    expect(writemindIcns().equals(icns)).toBe(true)
  })

  it("falls back to the rounded 512 px cut without the icon set, and refuses a PNG of the wrong size", () => {
    const entries = readIcns(writemindIcns({ set: path.join(here, "no-such-set") })) as [string, Buffer][]
    expect(entries.map(([type]) => type)).toEqual(["ic14", "ic09"])
    const png512 = readFileSync(path.join(APP_ICON_SET, "icon_512.png"))
    expect(() => icnsFromPngs(new Map([[256, png512]]))).toThrow(/256 px image is 512x512/)
  })
})

describe("the running app's identity (main/macIdentity.ts)", () => {
  it("finds the dock icon in out/icons first, and in a dev tree in packaging/ too", () => {
    const out = path.join("/repo", "apps", "desktop", "out", "main")
    expect(dockIconCandidates(out, false)).toEqual([
      path.join("/repo", "apps", "desktop", "out", "icons", "icon.png"),
      path.join("/repo", "packaging", "icon.png"),
    ])
    const packaged = path.join("/Applications/WriteMind.app/Contents/Resources/app.asar/out/main")
    expect(dockIconCandidates(packaged, true)).toEqual([
      path.join("/Applications/WriteMind.app/Contents/Resources/app.asar/out/icons/icon.png"),
    ])
  })

  it("centres the logo on a transparent canvas (Apple's grid)", () => {
    const pixels = new Uint8Array(2 * 2 * 4).fill(255)
    const out = padIntoCanvas(pixels, 2, 4)
    const alpha = (x: number, y: number) => out[(y * 4 + x) * 4 + 3]
    expect([alpha(0, 0), alpha(1, 1), alpha(2, 2), alpha(3, 3), alpha(1, 2)]).toEqual([0, 255, 255, 0, 255])
    expect(Math.round(512 * ICON_BODY)).toBe(412)
    expect(() => padIntoCanvas(pixels, 3, 4)).toThrow()
  })

  function fakeDeps(platform: NodeJS.Platform, isPackaged: boolean) {
    const calls: string[] = []
    let ready: () => void = () => {}
    const readyPromise = new Promise<void>((resolve) => { ready = resolve })
    const image = (w: number) => ({
      isEmpty: () => false,
      getSize: () => ({ width: w, height: w }),
      resize: (o: { width: number }) => image(o.width),
      toBitmap: () => Buffer.alloc(w * w * 4, 255),
      tag: `image ${w}`,
    })
    const deps = {
      platform,
      here: path.join("/repo", "apps", "desktop", "out", "main"),
      app: {
        isPackaged,
        getPath: (name: string) => { calls.push(`getPath ${name}`); return "/Users/sean/Library/Application Support/@writemind/desktop" },
        setPath: (name: string, to: string) => { calls.push(`setPath ${name} ${to}`) },
        setName: (name: string) => { calls.push(`setName ${name}`) },
        getVersion: () => "0.5.0",
        whenReady: () => readyPromise,
        dock: { setIcon: (icon: { tag: string }) => { calls.push(`dock ${icon.tag}`) } },
      },
      nativeImage: {
        createFromBuffer: () => image(512),
        createFromBitmap: (buffer: Buffer, o: { width: number }) => ({ ...image(o.width), tag: `padded ${o.width} ${buffer.length}` }),
      },
      exists: (file: string) => file.endsWith(path.join("out", "icons", "icon.png")),
      read: () => Buffer.alloc(0),
    } as unknown as MacIdentityDeps
    return { deps, calls, ready: async () => { ready(); await readyPromise; await new Promise((r) => setTimeout(r, 0)) } }
  }

  it("does nothing on Windows or Linux", async () => {
    for (const platform of ["win32", "linux"] as const) {
      const { deps, calls, ready } = fakeDeps(platform, false)
      applyMacIdentity(deps)
      await ready()
      expect(calls).toEqual([])
    }
  })

  it("on a Mac: the profile pinned, then the name (and no native About panel: About is the page's dialog); a dev run's dock gets the padded logo", async () => {
    const { deps, calls, ready } = fakeDeps("darwin", false)
    applyMacIdentity(deps)
    const profile = "/Users/sean/Library/Application Support/@writemind/desktop"
    expect(calls).toEqual([
      "getPath userData",
      `setName ${MAC_APP_NAME}`,
      `setPath userData ${profile}`,
    ])
    await ready()
    expect(calls.at(-1)).toBe(`dock padded 512 ${512 * 512 * 4}`)
  })

  it("leaves a packaged WriteMind.app's dock icon to its bundle", async () => {
    const { deps, calls, ready } = fakeDeps("darwin", true)
    applyMacIdentity(deps)
    await ready()
    expect(calls.some((c) => c.startsWith("dock"))).toBe(false)
    expect(calls.some((c) => c.startsWith("setName"))).toBe(true)
  })

  it("has no dock icon when neither copy of the logo is there", () => {
    const { deps } = fakeDeps("darwin", false)
    expect(dockIcon({ ...deps, exists: () => false })).toBeNull()
  })
})
