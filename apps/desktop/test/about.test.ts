/**
 * Help ▸ About WriteMind: what the dialog is told (shared/about.ts), how the main process reads and answers it
 * (main/about.ts), the menu items that open it (main/menu.ts) and the build's notices.json it reads. Port-only.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { IpcMain, MenuItemConstructorOptions } from "electron"
import { describe, expect, it } from "vitest"
import { generate } from "../../../tools/gen-notices.mjs"
import { noticesFile, readAbout, registerAbout } from "../src/main/about"
import { buildMenu } from "../src/main/menu"
import { ABOUT_CHANNELS, ABOUT_FALLBACK, aboutFromNotices, aboutMissing, NOTICES_MISSING } from "../src/shared/about"
import { initialMenuState } from "../src/shared/commands"

const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.resolve(here, "..")
const notices = generate().notices

describe("what the dialog is told", () => {
  it("is the build's notices with the RUNNING app's version", () => {
    const info = aboutFromNotices(JSON.parse(JSON.stringify(notices)), "9.9.0")!
    expect(info.name).toBe("WriteMind")
    expect(info.version).toBe("9.9.0")
    expect(info.license).toBe("BSD-3-Clause")
    expect(info.copyright).toBe("Copyright (c) 2026, Shahean Cheren")
    expect(info.licenseText).toContain("BSD 3-Clause License")
    expect(info.url).toBe("https://github.com/chere005/WriteMind")
    expect(info.wolfram.short).toMatch(/not affiliated with, endorsed by or sponsored by/)
    expect(info.libraries.length).toBeGreaterThan(25)
    const react = info.libraries.find((one) => one.name === "react")!
    expect(react).toMatchObject({ license: "MIT", copyright: expect.stringContaining("Meta Platforms") })
    expect(react.text).toContain("Permission is hereby granted")
    expect(info.libraries.map((one) => one.name)).toEqual(expect.arrayContaining(["Electron", "Chromium", "@codemirror/view", "koffi", "electron-updater"]))
    expect(info.missing).toBeUndefined()
  })

  it("drops what is not the right shape instead of showing it, and refuses what is not a notices file", () => {
    const damaged = { ...JSON.parse(JSON.stringify(notices)), libraries: [{ name: "ok", version: "1", license: "MIT", copyright: "c", url: "https://x", text: "t" }, { name: 7 }, null, "x"] }
    expect(aboutFromNotices(damaged, "1.0.0")!.libraries.map((one) => one.name)).toEqual(["ok"])
    for (const bad of [null, 7, "x", [], {}, { app: {}, wolfram: {}, libraries: [] }, { ...notices, wolfram: { short: 1, full: [] } }, { ...notices, libraries: "no" }]) {
      expect(aboutFromNotices(bad, "1.0.0")).toBeNull()
    }
  })

  it("a build with no list says so, keeps the licence line, and invents nothing about anyone else", () => {
    const none = aboutMissing("2.0.0")
    expect(none).toMatchObject({ name: "WriteMind", version: "2.0.0", missing: true, libraries: [], ...ABOUT_FALLBACK })
    expect(none.wolfram.short).toBe("")
    expect(NOTICES_MISSING).toContain("THIRD-PARTY-NOTICES.md")
  })
})

describe("the main process's half", () => {
  const temp = () => mkdtempSync(path.join(os.tmpdir(), "wm-about-"))

  it("looks for out/notices.json beside the main bundle's folder", () => {
    expect(noticesFile(path.join("/app", "out", "main"))).toBe(path.join("/app", "out", "notices.json"))
  })

  it("reads a real file; a missing or damaged one is the bare answer, never an error", () => {
    const dir = temp()
    const good = path.join(dir, "notices.json")
    writeFileSync(good, JSON.stringify(notices))
    expect(readAbout(good, "3.0.0").libraries.length).toBe(notices.libraries.length)
    expect(readAbout(good, "3.0.0").version).toBe("3.0.0")
    expect(readAbout(path.join(dir, "nope.json"), "3.0.0").missing).toBe(true)
    const broken = path.join(dir, "broken.json")
    writeFileSync(broken, "{ not json")
    expect(readAbout(broken, "3.0.0").missing).toBe(true)
    writeFileSync(broken, JSON.stringify({ app: 1 }))
    expect(readAbout(broken, "3.0.0").missing).toBe(true)
  })

  it("answers the two channels, and opens only the project page", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { handlers.set(channel, fn) } } as unknown as Pick<IpcMain, "handle">
    const opened: string[] = []
    let url = "https://github.com/chere005/WriteMind"
    registerAbout(ipc, {
      info: () => ({ ...aboutMissing("1.2.3"), url }),
      open: (to) => { opened.push(to) },
    })
    expect([...handlers.keys()].sort()).toEqual([ABOUT_CHANNELS.info, ABOUT_CHANNELS.openProject].sort())
    expect((await handlers.get(ABOUT_CHANNELS.info)!() as { version: string }).version).toBe("1.2.3")
    await handlers.get(ABOUT_CHANNELS.openProject)!(undefined, "https://evil.example")
    expect(opened).toEqual(["https://github.com/chere005/WriteMind"])
    // A file that names something that is not a web page does not get opened.
    url = "file:///etc/passwd"
    await handlers.get(ABOUT_CHANNELS.openProject)!()
    expect(opened.at(-1)).toBe(ABOUT_FALLBACK.url)
  })

  it("the preload bridges both channels and main registers them (no second About anywhere)", () => {
    const preload = readFileSync(path.join(desktop, "src/preload/preload.ts"), "utf8")
    expect(preload).toContain("ABOUT_CHANNELS.info")
    expect(preload).toContain("ABOUT_CHANNELS.openProject")
    const main = readFileSync(path.join(desktop, "src/main/main.ts"), "utf8")
    expect(main).toContain("registerAbout(ipcMain")
    // The plain message box is gone and About is the page's command.
    expect(main).not.toMatch(/title: "About WriteMind"/)
    expect(main).not.toMatch(/id === "about"/)
    expect(main).not.toMatch(/MAIN_OWNED = new RegExp\(`\^\(about/)
    expect(readFileSync(path.join(desktop, "src/main/macIdentity.ts"), "utf8")).not.toMatch(/setAboutPanelOptions\(/)
  })
})

describe("the menu items that open it", () => {
  const project = { name: "Untitled Project", edited: false, folders: [{ path: "/a", name: "a" }] }
  const items = (platform: string, run: (id: string) => void) =>
    buildMenu({ platform, state: initialMenuState, project, run })
  const submenu = (top: MenuItemConstructorOptions): MenuItemConstructorOptions[] => (top.submenu ?? []) as MenuItemConstructorOptions[]

  it("Help ▸ About WriteMind runs the page's command on every platform", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
      const asked: string[] = []
      const help = submenu(items(platform, (id) => asked.push(id)).find((one) => one.role === "help")!)
      const about = help.find((one) => one.id === "about")!
      expect(about.label).toBe("About WriteMind")
      ;(about.click as () => void)()
      expect(asked).toEqual(["about"])
    }
  })

  it("the Mac's app menu has its own About item (not Apple's panel), then the role items it always had", () => {
    const asked: string[] = []
    const mac = items("darwin", (id) => asked.push(id))
    const app = mac[0]!
    expect(app.role).toBeUndefined()
    const inside = submenu(app)
    expect(inside[0]).toMatchObject({ label: "About WriteMind" })
    expect(inside[0]!.role).toBeUndefined()
    ;(inside[0]!.click as () => void)()
    expect(asked).toEqual(["about"])
    expect(inside.filter((one) => one.role).map((one) => one.role)).toEqual(["services", "hide", "hideOthers", "unhide", "quit"])
    // Nothing else on a PC puts a menu before File.
    expect(items("win32", () => {})[0]!.label).toBe("File")
  })
})
