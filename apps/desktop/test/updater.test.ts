// Updates from GitHub Releases: the pure rules (src/shared/update.ts) behind main/updater.ts and the page's
// "Updates available" dialog (renderer/UpdateDialog.tsx). No Swift original: the Mac app has no updater of its own.
import { describe, expect, it } from "vitest"
import type { MenuItemConstructorOptions } from "electron"
import {
  DEFAULT_UPDATE_SETTINGS, UPDATE_COMMAND_IDS, dialogAfterLaunchCheck, dialogAfterMenuCheck, nextStatus, oneLine,
  progressLine, readUpdateSettings, sameForDisplay, shortReason, testFeed, updateDialogText, updateEligibility,
  updateMenu, updateMenuLabel, writeUpdateSettings, type CopyFacts, type UpdateEvent, type UpdateStatus,
} from "../src/shared/update"
import { buildMenu } from "../src/main/menu"
import { initialMenuState } from "../src/shared/commands"

const installed: CopyFacts = {
  platform: "win32",
  packaged: true,
  env: {},
  besideExe: ["WriteMind.exe", "Uninstall WriteMind.exe", "resources", "ffmpeg.dll"],
  hasFeedFile: true,
}

describe("which copies look for updates", () => {
  it("an installed Windows build does", () => {
    expect(updateEligibility(installed)).toEqual({ ok: true })
  })

  it("nothing else does, and each says why", () => {
    const why = (facts: Partial<CopyFacts>) => {
      const result = updateEligibility({ ...installed, ...facts })
      return result.ok ? "ok" : result.why
    }
    expect(why({ platform: "darwin" })).toMatch(/Windows installer/)
    expect(why({ platform: "linux" })).toMatch(/Windows installer/)
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
    expect(updateEligibility({ ...installed, besideExe: ["Uninstall WriteMind UpdTest.exe"] })).toEqual({ ok: true })
    expect(updateEligibility({ ...installed, besideExe: ["uninstall writemind.exe"] })).toEqual({ ok: true })
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
    expect(dialogAfterLaunchCheck(available, none)).toEqual({ kind: "available", version: "0.5.1", current: "0.5.0" })
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
    expect(dialogAfterMenuCheck(available)).toEqual({ kind: "available", version: "0.5.1", current: "0.5.0", asked: true })
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
    expect(updateDialogText({ kind: "available", version: "0.5.1", current: "0.5.0" }))
      .toEqual({ title: "Updates available", message: "WriteMind 0.5.1 is available (you have 0.5.0). Update now?" })
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
    expect(shortReason("Unable to find latest version on GitHub (https://github.com/chere005/WriteMindCross/releases/latest), please ensure a production release exists: HttpError: 404"))
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
})
