// Updates from GitHub Releases: the pure rules (src/shared/update.ts) behind main/updater.ts and the page's
// "Updates available" dialog (renderer/UpdateDialog.tsx). No Swift original: the Mac app has no updater of its own.
import { mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MenuItemConstructorOptions } from "electron"

// main/updater.ts against a stand-in Electron: GitHub's answer is a spy's, the browser is a spy, and every module the
// updater asks createRequire for is written down (a Mac must never load electron-updater).
const fx = vi.hoisted(() => ({
  fetch: vi.fn(),
  openExternal: vi.fn(async (_url: string) => {}),
  packaged: true,
  userData: "",
  required: [] as string[],
}))
vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0", get isPackaged() { return fx.packaged }, getPath: () => fx.userData },
  net: { fetch: fx.fetch },
  shell: { openExternal: fx.openExternal },
}))
vi.mock("node:module", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:module")>()
  const createRequire = (url: string | URL) => {
    const load = real.createRequire(url)
    return Object.assign((id: string) => { fx.required.push(id); return load(id) }, load)
  }
  return { ...real, default: { ...real, createRequire }, createRequire }
})

import {
  DEFAULT_UPDATE_SETTINGS, MAC_DOWNLOAD_LINE, RELEASES_LATEST_API, RELEASE_TAG_PAGE, UPDATE_CHANNELS,
  UPDATE_COMMAND_IDS, dialogAfterLaunchCheck, dialogAfterMenuCheck, latestFromGitHub, macDmgSuffix, nextStatus,
  oneLine, progressLine, readUpdateSettings, releasePage, sameForDisplay, shortReason, testFeed, updateDialogText,
  updateEligibility, updateMenu, updateMenuLabel, writeUpdateSettings, type CopyFacts, type UpdateAnswer,
  type UpdateEvent, type UpdateStatus, type UpdateView,
} from "../src/shared/update"
import { buildMenu } from "../src/main/menu"
import { startUpdater } from "../src/main/updater"
import { initialMenuState } from "../src/shared/commands"

const installed: CopyFacts = {
  platform: "win32",
  packaged: true,
  env: {},
  besideExe: ["WriteMind.exe", "Uninstall WriteMind.exe", "resources", "ffmpeg.dll"],
  hasFeedFile: true,
}

describe("which copies look for updates", () => {
  it("an installed Windows build does, and installs", () => {
    expect(updateEligibility(installed)).toEqual({ ok: true, how: "install" })
  })

  it("a packaged Mac build does, and only offers the download; a Mac development or test run does not", () => {
    const mac: CopyFacts = { platform: "darwin", packaged: true, env: {}, besideExe: ["WriteMind"], hasFeedFile: false }
    expect(updateEligibility(mac)).toEqual({ ok: true, how: "download" })
    // Wherever it was dragged to, with or without electron-builder's app-update.yml: it never installs.
    expect(updateEligibility({ ...mac, hasFeedFile: true })).toEqual({ ok: true, how: "download" })
    expect(updateEligibility({ ...mac, packaged: false })).toEqual({ ok: false, why: expect.stringMatching(/development run/) })
    expect(updateEligibility({ ...mac, env: { WRITEMIND_DEV: "1" } })).toEqual({ ok: false, why: expect.stringMatching(/development run/) })
    expect(updateEligibility({ ...mac, env: { WRITEMIND_E2E: "1" } })).toEqual({ ok: false, why: expect.stringMatching(/test run/) })
  })

  it("nothing else does, and each says why", () => {
    const why = (facts: Partial<CopyFacts>) => {
      const result = updateEligibility({ ...installed, ...facts })
      return result.ok ? "ok" : result.why
    }
    expect(why({ platform: "linux" })).toMatch(/Windows installer/)
    expect(why({ platform: "linux", besideExe: [], hasFeedFile: false })).toMatch(/Windows installer/)
    // A development run, and the repo's own Electron running a build folder (C:\CLAUDIO\try-build): not packaged.
    expect(why({ packaged: false })).toMatch(/development run/)
    expect(why({ env: { WRITEMIND_DEV: "1" } })).toMatch(/development run/)
    expect(why({ env: { WRITEMIND_E2E: "1" } })).toMatch(/test run/)
    expect(why({ env: { PORTABLE_EXECUTABLE_DIR: "C:\\Users\\S\\Downloads" } })).toMatch(/portable/)
    expect(why({ hasFeedFile: false })).toMatch(/without an update feed/)
    // dist-electron\win-unpacked: packaged, has the feed, but no installer put it there.
    expect(why({ besideExe: ["WriteMind.exe", "resources"] })).toMatch(/not installed by its installer/)
  })

  it("the uninstaller is found whatever the product is called", () => {
    expect(updateEligibility({ ...installed, besideExe: ["Uninstall WriteMind UpdTest.exe"] })).toEqual({ ok: true, how: "install" })
    expect(updateEligibility({ ...installed, besideExe: ["uninstall writemind.exe"] })).toEqual({ ok: true, how: "install" })
    expect(updateEligibility({ ...installed, besideExe: ["Uninstall.txt", "Uninstall .exe"] }).ok).toBe(false)
  })
})

describe("the test feed", () => {
  it("is taken only from a loopback address", () => {
    expect(testFeed({})).toBeNull()
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "  " })).toBeNull()
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "http://127.0.0.1:9585/" })).toBe("http://127.0.0.1:9585/")
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "http://localhost:9585/feed" })).toBe("http://localhost:9585/feed")
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "http://[::1]:9585/" })).toBe("http://[::1]:9585/")
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "https://example.com/" })).toBeNull()
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "http://127.0.0.1.example.com/" })).toBeNull()
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "file:///C:/feed" })).toBeNull()
    expect(testFeed({ WRITEMIND_UPDATE_FEED: "not a url" })).toBeNull()
  })
})

describe("the Check on startup setting (userData/update.json)", () => {
  it("is ticked unless it was unticked, and anything unreadable is ticked", () => {
    expect(DEFAULT_UPDATE_SETTINGS.checkOnStartup).toBe(true)
    expect(readUpdateSettings(null)).toEqual({ checkOnStartup: true })
    expect(readUpdateSettings("")).toEqual({ checkOnStartup: true })
    expect(readUpdateSettings("{ not json")).toEqual({ checkOnStartup: true })
    expect(readUpdateSettings("null")).toEqual({ checkOnStartup: true })
    expect(readUpdateSettings('{"checkOnStartup":"no"}')).toEqual({ checkOnStartup: true })
    expect(readUpdateSettings('{"checkOnStartup":false}')).toEqual({ checkOnStartup: false })
  })
  it("round-trips", () => {
    for (const checkOnStartup of [true, false]) {
      expect(readUpdateSettings(writeUpdateSettings({ checkOnStartup }))).toEqual({ checkOnStartup })
    }
  })
})

describe("what the updater said", () => {
  const start: UpdateStatus = { phase: "idle", current: "0.5.0" }
  const run = (events: UpdateEvent[], from = start) => events.reduce(nextStatus, from)
  const found = run([{ kind: "checking" }, { kind: "available", version: "0.5.1" }])

  it("check, find: nothing is downloaded until Update now", () => {
    expect(run([{ kind: "checking" }])).toEqual({ phase: "checking", current: "0.5.0" })
    expect(run([{ kind: "checking" }, { kind: "none" }])).toEqual({ phase: "latest", current: "0.5.0" })
    expect(found).toEqual({ phase: "available", current: "0.5.0", version: "0.5.1" })
    // Progress without a download under way is noise.
    expect(run([{ kind: "progress", percent: 50 }], found)).toEqual(found)
  })

  it("Update now: download, progress, ready", () => {
    const downloading = run([{ kind: "download" }, { kind: "progress", percent: 42.7 }], found)
    expect(downloading).toEqual({ phase: "downloading", current: "0.5.0", version: "0.5.1", percent: 42 })
    expect(run([{ kind: "progress", percent: 140 }], downloading).percent).toBe(100)
    expect(run([{ kind: "downloaded", version: "0.5.1" }], downloading)).toEqual({ phase: "ready", current: "0.5.0", version: "0.5.1" })
    // No version found yet: nothing to download.
    expect(run([{ kind: "download" }])).toEqual(start)
  })

  it("a look during a download does not lose it; Cancel goes back to the version found", () => {
    const downloading = run([{ kind: "download" }], found)
    expect(run([{ kind: "checking" }, { kind: "none" }, { kind: "available", version: "0.5.1" }], downloading)).toEqual(downloading)
    expect(run([{ kind: "cancelled" }], downloading)).toEqual(found)
    expect(run([{ kind: "cancelled" }], found)).toEqual(found)
  })

  it("a failed download keeps the version (Update now tries again); a ready update stays ready", () => {
    const failed = run([{ kind: "download" }, { kind: "error", message: "net::ERR_CONNECTION_RESET" }], found)
    expect(failed).toEqual({ phase: "error", current: "0.5.0", version: "0.5.1", error: "net::ERR_CONNECTION_RESET" })
    expect(run([{ kind: "download" }], failed).phase).toBe("downloading")
    const ready = run([{ kind: "download" }, { kind: "downloaded", version: "0.5.1" }], found)
    expect(run([{ kind: "checking" }, { kind: "error", message: "offline" }, { kind: "none" }], ready)).toEqual(ready)
  })

  it("Update now again after a failed download, its check failing too, still says why", () => {
    const failed = run([{ kind: "download" }, { kind: "error", message: "net::ERR_CONNECTION_RESET" }], found)
    const again = run([{ kind: "checking" }, { kind: "error", message: "net::ERR_INTERNET_DISCONNECTED" }], failed)
    expect(again.version).toBe("0.5.1")
    expect(progressLine(again)?.problem).toBe(true)
  })

  it("an error is one short line, and a copy that does not update hears nothing", () => {
    const failed = run([{ kind: "checking" }, { kind: "error", message: "HttpError: 403 rate limit exceeded\n    at foo (bar.js:1:1)" }])
    expect(failed).toEqual({ phase: "error", current: "0.5.0", error: "HttpError: 403 rate limit exceeded" })
    expect(oneLine("x".repeat(400)).length).toBeLessThanOrEqual(160)
    const off: UpdateStatus = { phase: "off", current: "0.5.0", why: "development run" }
    expect(run([{ kind: "checking" }, { kind: "available", version: "9.9.9" }, { kind: "download" }], off)).toBe(off)
  })

  it("progress ticks are not news to the menu", () => {
    const a: UpdateStatus = { phase: "downloading", current: "0.5.0", version: "0.5.1", percent: 1 }
    expect(sameForDisplay(a, { ...a, percent: 77 })).toBe(true)
    expect(sameForDisplay(a, { phase: "ready", current: "0.5.0", version: "0.5.1" })).toBe(false)
  })
})

describe("when it asks", () => {
  const available: UpdateStatus = { phase: "available", current: "0.5.0", version: "0.5.1" }
  const none = new Set<string>()

  it("the launch look asks about a newer release, and says nothing otherwise", () => {
    expect(dialogAfterLaunchCheck(available, none)).toEqual({ kind: "available", version: "0.5.1", current: "0.5.0", how: "install" })
    expect(dialogAfterLaunchCheck(available, none, "download")).toEqual({ kind: "available", version: "0.5.1", current: "0.5.0", how: "download" })
    for (const status of [
      { phase: "latest", current: "0.5.0" },
      { phase: "error", current: "0.5.0", error: "net::ERR_INTERNET_DISCONNECTED" },
      { phase: "checking", current: "0.5.0" },
      { phase: "off", current: "0.5.0", why: "x" },
    ] as UpdateStatus[]) expect(dialogAfterLaunchCheck(status, none), status.phase).toBeNull()
  })

  it("Later: the same version is not asked about again this launch; a newer one is", () => {
    const putOff = new Set(["0.5.1"])
    expect(dialogAfterLaunchCheck(available, putOff)).toBeNull()
    expect(dialogAfterLaunchCheck({ ...available, version: "0.5.2" }, putOff)).toMatchObject({ version: "0.5.2" })
  })

  it("Help ▸ Check for Updates… always answers, a version put off included", () => {
    expect(dialogAfterMenuCheck(available)).toEqual({ kind: "available", version: "0.5.1", current: "0.5.0", how: "install", asked: true })
    expect(dialogAfterMenuCheck(available, "download")).toEqual({ kind: "available", version: "0.5.1", current: "0.5.0", how: "download", asked: true })
    expect(dialogAfterMenuCheck({ ...available, phase: "downloading", percent: 3 })).toMatchObject({ kind: "available" })
    expect(dialogAfterMenuCheck({ phase: "latest", current: "0.5.1" })).toEqual({ kind: "latest", current: "0.5.1" })
    expect(dialogAfterMenuCheck({ phase: "error", current: "0.5.0", error: "net::ERR_INTERNET_DISCONNECTED" }))
      .toEqual({ kind: "error", reason: "no internet connection" })
    expect(dialogAfterMenuCheck({ phase: "checking", current: "0.5.0" }).kind).toBe("error")
    expect(dialogAfterMenuCheck({ phase: "off", current: "0.5.0", why: "This is a development run of WriteMind, which does not update itself." }))
      .toEqual({ kind: "off", why: "This is a development run of WriteMind, which does not update itself." })
  })
})

describe("what is shown", () => {
  it("Sean's words: Updates available / Update now?, You're up to date, Couldn't check for updates", () => {
    expect(updateDialogText({ kind: "available", version: "0.5.1", current: "0.5.0", how: "install" }))
      .toEqual({ title: "Updates available", message: "WriteMind 0.5.1 is available (you have 0.5.0). Update now?" })
    // A Mac: the same dialog, [Download] in the page, and one line saying what to do with it.
    expect(updateDialogText({ kind: "available", version: "1.0.1", current: "1.0.0", how: "download" })).toEqual({
      title: "Updates available", message: "WriteMind 1.0.1 is available (you have 1.0.0).",
      detail: "Drag the new WriteMind into Applications to replace this one.",
    })
    expect(MAC_DOWNLOAD_LINE).toBe("Drag the new WriteMind into Applications to replace this one.")
    expect(updateDialogText({ kind: "latest", current: "0.5.1" }).message).toBe("You're up to date (0.5.1).")
    expect(updateDialogText({ kind: "error", reason: "no internet connection" }).message)
      .toBe("Couldn't check for updates: no internet connection.")
    const off = updateDialogText({ kind: "off", why: "This is a test run of WriteMind, which does not update itself." })
    expect(off.message).toBe("Updates come with the installed app.")
    expect(off.detail).toMatch(/test run/)
  })

  it("the reason is short and plain", () => {
    expect(shortReason("net::ERR_INTERNET_DISCONNECTED")).toBe("no internet connection")
    expect(shortReason("getaddrinfo ENOTFOUND api.github.com")).toBe("no internet connection")
    expect(shortReason("net::ERR_CONNECTION_REFUSED")).toBe("the update server did not answer")
    expect(shortReason("HttpError: 403 Forbidden \"rate limit exceeded\"")).toBe("GitHub is limiting requests; try again later")
    expect(shortReason("Unable to find latest version on GitHub (https://github.com/chere005/WriteMind/releases/latest), please ensure a production release exists: HttpError: 404"))
      .toBe("no release was found")
    expect(shortReason("Cannot find latest.yml in the latest release artifacts")).toBe("no release was found")
    expect(shortReason("sha512 checksum mismatch, expected abc")).toBe("the download was damaged; try again")
    expect(shortReason("Something odd\n  at x")).toBe("Something odd")
    expect(shortReason("y".repeat(300)).length).toBeLessThanOrEqual(100)
    expect(shortReason("")).toBe("unknown error")
  })

  it("the quiet line under Update now?: progress, the restart, or why the download stopped", () => {
    expect(progressLine({ phase: "available", current: "0.5.0", version: "0.5.1" })).toBeNull()
    expect(progressLine({ phase: "downloading", current: "0.5.0", version: "0.5.1", percent: 42 }))
      .toEqual({ text: "Downloading… 42%", problem: false })
    expect(progressLine({ phase: "ready", current: "0.5.0", version: "0.5.1" })?.text).toMatch(/restarting/)
    expect(progressLine({ phase: "error", current: "0.5.0", version: "0.5.1", error: "net::ERR_CONNECTION_RESET" }))
      .toEqual({ text: "Couldn't download the update: the update server did not answer.", problem: true })
    // Seen in the e2e: latest.yml named a file the feed did not have.
    expect(progressLine({ phase: "error", current: "0.5.0", version: "0.5.1", error: "HttpError: 404 \"method: GET url: http://127.0.0.1:9621/WriteMind-Setup-0.5.1.exe\"" })?.text)
      .toBe("Couldn't download the update: the installer is not on the server.")
    expect(progressLine({ phase: "error", current: "0.5.0", error: "offline" })).toBeNull()
  })

  it("Help: Check for Updates…, Restart to Update once one is in, and the startup box", () => {
    const ready: UpdateStatus = { phase: "ready", current: "0.5.0", version: "0.5.1" }
    expect(updateMenuLabel(null)).toBe("Check for Updates…")
    expect(updateMenuLabel({ phase: "downloading", current: "0.5.0", version: "0.5.1" })).toBe("Check for Updates…")
    expect(updateMenuLabel(ready)).toBe("Restart to Update to 0.5.1")
    const ran: string[] = []
    const help = (update?: ReturnType<typeof updateMenu>) => {
      const bar = buildMenu({
        platform: "win32", state: initialMenuState, run: (id) => { ran.push(id) }, ...(update ? { update } : {}),
        project: { name: "P", edited: false, folders: [] },
      })
      return (bar.find((one) => one.role === "help")!.submenu as MenuItemConstructorOptions[])
        .filter((one) => (UPDATE_COMMAND_IDS as readonly string[]).includes(one.id ?? ""))
    }
    const on = { checkOnStartup: true }
    const shown = (items: MenuItemConstructorOptions[]) => items.map((one) =>
      `${one.id}: ${one.label}${one.type === "checkbox" ? ` [${one.checked ? "x" : " "}]${one.enabled === false ? " greyed" : ""}` : ""}`)
    expect(shown(help(updateMenu({ phase: "idle", current: "0.5.0" }, on, true)))).toEqual([
      "checkForUpdates: Check for Updates…", "checkUpdatesOnStartup: Check for Updates on Startup [x]",
    ])
    expect(shown(help(updateMenu({ phase: "idle", current: "0.5.0" }, { checkOnStartup: false }, true)))).toEqual([
      "checkForUpdates: Check for Updates…", "checkUpdatesOnStartup: Check for Updates on Startup [ ]",
    ])
    expect(shown(help(updateMenu(ready, on, true)))[0]).toBe("installUpdate: Restart to Update to 0.5.1")
    // A copy that does not update itself: the box is greyed; Check for Updates… still answers (with why not).
    expect(shown(help(updateMenu({ phase: "off", current: "0.5.0", why: "x" }, on, false)))).toEqual([
      "checkForUpdates: Check for Updates…", "checkUpdatesOnStartup: Check for Updates on Startup [ ] greyed",
    ])
    // The items run the main process's own commands.
    for (const item of help(updateMenu({ phase: "idle", current: "0.5.0" }, on, true))) (item.click as () => void)()
    expect(ran).toEqual(["checkForUpdates", "checkUpdatesOnStartup"])
  })

  it("Help on a Mac: Check for Updates… and the startup box, never an install item", () => {
    const help = (update: ReturnType<typeof updateMenu>) => (buildMenu({
      platform: "darwin", state: initialMenuState, run: () => {}, update, project: { name: "P", edited: false, folders: [] },
    }).find((one) => one.role === "help")!.submenu as MenuItemConstructorOptions[])
    const shown = (items: MenuItemConstructorOptions[]) => items
      .filter((one) => (UPDATE_COMMAND_IDS as readonly string[]).includes(one.id ?? ""))
      .map((one) => `${one.id}: ${one.label}${one.type === "checkbox" ? ` [${one.checked ? "x" : " "}]${one.enabled === false ? " greyed" : ""}` : ""}`)
    expect(shown(help(updateMenu({ phase: "idle", current: "1.0.0" }, { checkOnStartup: true }, true)))).toEqual([
      "checkForUpdates: Check for Updates…", "checkUpdatesOnStartup: Check for Updates on Startup [x]",
    ])
    // Even told an update is "ready" (a Mac never gets there), the item only looks.
    const ready = help(updateMenu({ phase: "ready", current: "1.0.0", version: "1.0.1" }, { checkOnStartup: true }, true))
    expect(shown(ready)[0]).toBe("checkForUpdates: Check for Updates…")
    expect(ready.some((one) => one.id === "installUpdate" || /Restart/.test(one.label ?? ""))).toBe(false)
    // A Mac development run: Check for Updates… answers why not; the box is greyed.
    expect(shown(help(updateMenu({ phase: "off", current: "1.0.0", why: "x" }, { checkOnStartup: true }, false)))).toEqual([
      "checkForUpdates: Check for Updates…", "checkUpdatesOnStartup: Check for Updates on Startup [ ] greyed",
    ])
  })
})

// GitHub's releases/latest answer, as much of it as matters (the real one has more, all ignored).
const release = (over: Record<string, unknown> = {}) => ({
  tag_name: "v1.0.1", name: "WriteMind 1.0.1", draft: false, prerelease: false,
  html_url: "https://github.com/chere005/WriteMind/releases/tag/v1.0.1",
  assets: [
    { name: "WriteMind-Setup-1.0.1.exe", state: "uploaded" },
    { name: "WriteMind-Setup-1.0.1.exe.blockmap", state: "uploaded" },
    { name: "latest.yml", state: "uploaded" },
    { name: "WriteMind-1.0.1-mac-arm64.dmg", state: "uploaded" },
    { name: "WriteMind-1.0.1-mac-x64.dmg", state: "uploaded" },
  ],
  ...over,
})

describe("a Mac's look at GitHub's latest release", () => {
  const page = "https://github.com/chere005/WriteMind/releases/tag/v1.0.1"

  it("offers a newer published release that carries this Mac's dmg, with its page", () => {
    expect(latestFromGitHub(release(), "1.0.0", "arm64")).toEqual({ version: "1.0.1", page })
    expect(latestFromGitHub(release(), "1.0.0", "x64")).toEqual({ version: "1.0.1", page })
    // The text as it came, too.
    expect(latestFromGitHub(JSON.stringify(release({ tag_name: "v2.0.0" })), "1.0.0", "arm64"))
      .toEqual({ version: "2.0.0", page: "https://github.com/chere005/WriteMind/releases/tag/v2.0.0" })
    expect(latestFromGitHub(release({ tag_name: "v1.10.0" }), "1.9.9", "arm64")?.version).toBe("1.10.0")
    // A pre-release build is older than its final release.
    expect(latestFromGitHub(release({ tag_name: "v1.1.0" }), "1.1.0-beta.1", "arm64")?.version).toBe("1.1.0")
    expect(macDmgSuffix("arm64")).toBe("-mac-arm64.dmg")
    expect(macDmgSuffix("x64")).toBe("-mac-x64.dmg")
  })

  it("ignores drafts, pre-releases, the same or an older version", () => {
    expect(latestFromGitHub(release({ draft: true }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ prerelease: true }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ draft: undefined }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ tag_name: "v1.0.0" }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ tag_name: "v0.9.9" }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ tag_name: "v1.0.1" }), "1.0.2", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ tag_name: "v1.0.1" }), "1.0.1+build.7", "arm64")).toBeNull()
  })

  it("ignores a release without this arch's dmg, and an arch that has none", () => {
    const only = (name: string) => release({ assets: [{ name, state: "uploaded" }] })
    expect(latestFromGitHub(only("WriteMind-1.0.1-mac-x64.dmg"), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(only("WriteMind-1.0.1-mac-arm64.dmg"), "1.0.0", "x64")).toBeNull()
    expect(latestFromGitHub(only("WriteMind-1.0.1-mac-arm64.dmg"), "1.0.0", "arm64")?.version).toBe("1.0.1")
    // A Windows-only release, a zip, a dmg still uploading, no assets at all.
    expect(latestFromGitHub(only("WriteMind-Setup-1.0.1.exe"), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(only("WriteMind-1.0.1-mac-arm64.zip"), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ assets: [{ name: "WriteMind-1.0.1-mac-arm64.dmg", state: "starter" }] }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ assets: [] }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ assets: undefined }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release({ assets: [null, 7, { name: 3 }] }), "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(release(), "1.0.0", "ia32")).toBeNull()
    expect(latestFromGitHub(release(), "1.0.0", "arm")).toBeNull()
  })

  it("ignores an answer that is not JSON, not a release, or has a bad tag", () => {
    for (const bad of ["", "{", "<html>rate limited</html>", "null", "[]", "42", '"v1.0.1"']) {
      expect(latestFromGitHub(bad, "1.0.0", "arm64"), bad).toBeNull()
    }
    expect(latestFromGitHub(null, "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub(undefined, "1.0.0", "arm64")).toBeNull()
    expect(latestFromGitHub({ message: "Not Found" }, "1.0.0", "arm64")).toBeNull()
    for (const tag of ["1.0.1", "v1.0", "v1.0.1-beta.1", "v1.0.1+7", "v01.0.1", "v1.0.1/../../evil", "v1.0.1 ", "V1.0.1",
      "v1.0.1?x=1", "v9999999999.0.0", "release-1.0.1", 101, null]) {
      expect(latestFromGitHub(release({ tag_name: tag }), "1.0.0", "arm64"), String(tag)).toBeNull()
    }
    // A running version that cannot be read is never offered anything.
    expect(latestFromGitHub(release(), "dev", "arm64")).toBeNull()
  })

  it("the page is built from the version, never taken from the answer, and always under the repo's releases/tag/", () => {
    const sneaky = release({ html_url: "https://evil.example/WriteMind.dmg", url: "https://evil.example/", upload_url: "https://evil.example/" })
    expect(latestFromGitHub(sneaky, "1.0.0", "arm64")?.page).toBe(page)
    expect(RELEASE_TAG_PAGE).toBe("https://github.com/chere005/WriteMind/releases/tag/")
    expect(RELEASES_LATEST_API).toBe("https://api.github.com/repos/chere005/WriteMind/releases/latest")
    expect(releasePage("1.0.1")).toBe(page)
    expect(releasePage("12.30.0")).toBe("https://github.com/chere005/WriteMind/releases/tag/v12.30.0")
    for (const bad of ["", "v1.0.1", "1.0", "1.0.1-beta", "1.0.1/../x", "1.0.1#x", "https://evil.example/", "01.0.0"]) {
      expect(releasePage(bad), bad).toBeNull()
    }
    for (const version of ["0.0.1", "1.0.1", "3.14.159"]) {
      const url = new URL(releasePage(version)!)
      expect(url.origin + url.pathname).toBe(`${RELEASE_TAG_PAGE}v${version}`)
      expect(url.search + url.hash).toBe("")
    }
  })
})

// main/updater.ts in a packaged copy, against the stand-in Electron above.
describe("the updater in download mode (a packaged Mac)", () => {
  const saved = { platform: process.platform, arch: process.arch, resourcesPath: (process as { resourcesPath?: string }).resourcesPath }
  const savedEnv = { e2e: process.env.WRITEMIND_E2E, dev: process.env.WRITEMIND_DEV, feed: process.env.WRITEMIND_UPDATE_FEED }
  const as = (platform: string, arch: string) => {
    Object.defineProperty(process, "platform", { value: platform, configurable: true })
    Object.defineProperty(process, "arch", { value: arch, configurable: true })
  }
  const answering = (body: unknown, status = 200) => fx.fetch.mockImplementation(async () => ({
    ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Error",
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }))
  let stops: (() => void)[] = []

  beforeEach(() => {
    fx.fetch.mockReset()
    fx.openExternal.mockClear()
    fx.packaged = true
    fx.required.length = 0
    fx.userData = mkdtempSync(path.join(os.tmpdir(), "wm-upd-"))
    ;(process as { resourcesPath?: string }).resourcesPath = fx.userData
    delete process.env.WRITEMIND_E2E
    delete process.env.WRITEMIND_DEV
    delete process.env.WRITEMIND_UPDATE_FEED
    as("darwin", "arm64")
  })
  afterEach(() => {
    for (const stop of stops) stop()
    stops = []
    vi.useRealTimers()
    as(saved.platform, saved.arch)
    ;(process as { resourcesPath?: string }).resourcesPath = saved.resourcesPath
    for (const [key, value] of [["WRITEMIND_E2E", savedEnv.e2e], ["WRITEMIND_DEV", savedEnv.dev], ["WRITEMIND_UPDATE_FEED", savedEnv.feed]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  /** A started updater with a stand-in window (every view the page is sent) and IPC (the page's answers). */
  function start() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const views: UpdateView[] = []
    const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_channel: string, next: UpdateView) => { views.push(next) } } }
    const updater = startUpdater({
      ipc: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) } } as never,
      window: () => win as never, beforeInstall: async () => {}, menuChanged: () => {},
    })
    stops.push(() => updater.dispose())
    const answer = (choice: UpdateAnswer) => handlers.get(UPDATE_CHANNELS.answer)!({}, choice) as Promise<void>
    const phases = () => views.map((one) => one.status.phase)
    const dialog = () => views.at(-1)?.dialog ?? null
    return { updater, views, answer, phases, dialog }
  }

  it("Help ▸ Check for Updates… asks GitHub, offers [Download], and Download opens the release's page — nothing else", async () => {
    answering(release({ html_url: "https://evil.example/" }))
    const { updater, answer, phases, dialog } = start()
    expect(updater.menu()).toMatchObject({ label: "Check for Updates…", ready: false, canCheck: true })
    await updater.command("checkForUpdates")
    expect(fx.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fx.fetch.mock.calls[0] as [string, { headers: Record<string, string>; signal?: AbortSignal }]
    expect(url).toBe("https://api.github.com/repos/chere005/WriteMind/releases/latest")
    expect(init.headers["User-Agent"]).toMatch(/^WriteMind\/1\.0\.0 /)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(dialog()).toEqual({ kind: "available", version: "1.0.1", current: "1.0.0", how: "download", asked: true })
    await answer("now")
    expect(fx.openExternal).toHaveBeenCalledTimes(1)
    expect(fx.openExternal).toHaveBeenCalledWith("https://github.com/chere005/WriteMind/releases/tag/v1.0.1")
    expect(dialog()).toBeNull()
    // Neither Download, nor the install command, nor another Download gets near a download or a restart.
    await updater.command("installUpdate")
    await answer("now")
    expect(phases()).not.toContain("downloading")
    expect(phases()).not.toContain("ready")
    expect(updater.status()).toMatchObject({ phase: "available", version: "1.0.1" })
    expect(fx.required).not.toContain("electron-updater")
  })

  it("the launch look (Check on startup) asks by itself; Later puts it off; unticked, it does not look", async () => {
    vi.useFakeTimers()
    answering(release({ tag_name: "v1.2.0", assets: [{ name: "WriteMind-1.2.0-mac-x64.dmg", state: "uploaded" }] }))
    as("darwin", "x64")
    const first = start()
    expect(fx.fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fx.fetch).toHaveBeenCalledTimes(1)
    expect(first.dialog()).toEqual({ kind: "available", version: "1.2.0", current: "1.0.0", how: "download" })
    await first.answer("later")
    expect(first.dialog()).toBeNull()
    expect(fx.openExternal).not.toHaveBeenCalled()
    first.updater.dispose()

    fx.fetch.mockClear()
    writeFileSync(path.join(fx.userData, "update.json"), writeUpdateSettings({ checkOnStartup: false }), "utf8")
    start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fx.fetch).not.toHaveBeenCalled()
  })

  it("nothing newer for this Mac: You're up to date; the launch look says nothing", async () => {
    answering(release({ assets: [{ name: "WriteMind-1.0.1-mac-x64.dmg", state: "uploaded" }] }))
    vi.useFakeTimers()
    const { updater, dialog } = start()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fx.fetch).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    await updater.command("checkForUpdates")
    expect(dialog()).toEqual({ kind: "latest", current: "1.0.0" })
  })

  it("offline, rate-limited, no release, an unreadable answer, 10 s without one: the menu's look says why", async () => {
    const said = async (setup: () => void, fake = false) => {
      fx.fetch.mockReset()
      setup()
      if (fake) vi.useFakeTimers()
      writeFileSync(path.join(fx.userData, "update.json"), writeUpdateSettings({ checkOnStartup: false }), "utf8")
      const { updater, dialog } = start()
      const asked = updater.command("checkForUpdates")
      if (fake) await vi.advanceTimersByTimeAsync(10_000)
      await asked
      vi.useRealTimers()
      return dialog()
    }
    expect(await said(() => fx.fetch.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"))))
      .toEqual({ kind: "error", reason: "no internet connection" })
    expect(await said(() => answering({ message: "API rate limit exceeded" }, 403)))
      .toEqual({ kind: "error", reason: "GitHub is limiting requests; try again later" })
    expect(await said(() => answering({ message: "Not Found" }, 404))).toEqual({ kind: "error", reason: "no release was found" })
    expect(await said(() => answering("<html>"))).toMatchObject({ kind: "error" })
    expect(await said(() => fx.fetch.mockImplementation(() => new Promise(() => {})), true))
      .toEqual({ kind: "error", reason: "the update server took too long to answer" })
    expect(fx.openExternal).not.toHaveBeenCalled()
  })

  it("(the control) an installed Windows copy still goes to electron-updater, never to GitHub's API itself", async () => {
    const exeDir = mkdtempSync(path.join(os.tmpdir(), "wm-upd-exe-"))
    writeFileSync(path.join(exeDir, "Uninstall WriteMind.exe"), "")
    writeFileSync(path.join(fx.userData, "app-update.yml"), "provider: github\n")
    const execPath = process.execPath
    as("win32", "x64")
    process.execPath = path.join(exeDir, "WriteMind.exe")
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const { updater } = start()
      expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/the updater did not load/))
      // Asked for, so the spy above sees what the updater requires (here it cannot run without the real Electron).
      expect(fx.required).toContain("electron-updater")
      expect(updater.status().phase).toBe("off")
      await updater.command("checkForUpdates")
      expect(fx.fetch).not.toHaveBeenCalled()
    } finally {
      process.execPath = execPath
      quiet.mockRestore()
    }
  })

  it("a Mac development or test run, and Linux, never look", async () => {
    const offWhy = async () => {
      const { updater, dialog } = start()
      expect(updater.menu().canCheck).toBe(false)
      await updater.command("checkForUpdates")
      return dialog()
    }
    answering(release())
    vi.useFakeTimers()
    fx.packaged = false
    expect(await offWhy()).toEqual({ kind: "off", why: expect.stringMatching(/development run/) })
    fx.packaged = true
    process.env.WRITEMIND_E2E = "1"
    expect(await offWhy()).toEqual({ kind: "off", why: expect.stringMatching(/test run/) })
    delete process.env.WRITEMIND_E2E
    as("linux", "x64")
    expect(await offWhy()).toEqual({ kind: "off", why: expect.stringMatching(/Windows installer/) })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fx.fetch).not.toHaveBeenCalled()
    expect(fx.required).not.toContain("electron-updater")
  })
})
