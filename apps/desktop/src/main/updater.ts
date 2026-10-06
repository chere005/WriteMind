/**
 * Updates from WriteMindCross's own GitHub Releases, the Electron half (shared/update.ts is the pure half and
 * says the rules). electron-updater does the work: it reads the feed electron-builder wrote into the installed
 * copy (`resources/app-update.yml`: provider github, chere005/WriteMindCross), downloads the new installer when
 * the person says Update now, checks its sha512 against latest.yml, and runs it silently over the per-user install.
 *
 * Asked, never pushed: one look a few seconds after launch when "Check on startup" is ticked (userData/update.json,
 * ticked unless unticked), else only Help ▸ Check for Updates…. A newer release brings up the page's own dialog
 * (renderer/UpdateDialog.tsx): Update now downloads (progress in the dialog), has the page write the notes (the
 * close handshake), and restarts into the installer; Later puts that version off until the next launch. The launch
 * look's failures go to `userData/update.log` and nowhere else; the menu's look always answers.
 *
 * electron-updater is loaded only when this copy updates itself (an installed Windows build), and through
 * `createRequire` like koffi: it is CommonJS that requires "electron", which a bundled ESM main cannot do.
 *
 * A MAC IS IN DOWNLOAD MODE (updateEligibility's how: "download"; the app is ad-hoc signed, which Squirrel.Mac
 * cannot replace): electron-updater is never loaded. Its look is one `net.fetch` of GitHub's releases/latest
 * (RELEASES_LATEST_API, a User-Agent, given up after 10 s), read by `latestFromGitHub`, fed into the same states
 * (checking → available / latest / error) and the same dialog, launch rule and menu answer. Download (the dialog's
 * "now") opens the release's page in the browser — `releasePage`, built from the version — and closes the dialog:
 * nothing is downloaded, installed or restarted, so a Mac never reaches "downloading" or "ready".
 */

import { app, net, shell, type BrowserWindow, type IpcMain } from "electron"
import { createRequire } from "node:module"
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AppUpdater, CancellationToken } from "electron-updater"
import {
  RELEASES_LATEST_API, RELEASE_CHECK_TIMEOUT_MS, STARTUP_CHECK_DELAY_MS, TEST_FIRST_CHECK_DELAY_MS, UPDATE_CHANNELS,
  UPDATE_SETTINGS_FILE, dialogAfterLaunchCheck, dialogAfterMenuCheck, latestFromGitHub, nextStatus, oneLine,
  readUpdateSettings, releasePage, sameForDisplay, testFeed, updateEligibility, updateMenu, writeUpdateSettings,
  type UpdateAnswer, type UpdateDialog, type UpdateEvent, type UpdateHow, type UpdateMenu, type UpdateSettings,
  type UpdateStatus, type UpdateView,
} from "../shared/update"

export interface UpdaterHost {
  ipc: IpcMain
  window(): BrowserWindow | null
  /** Have the page write what it holds (main.ts's close handshake), before the installer is started. */
  beforeInstall(): Promise<void>
  /** The Help menu's update items changed (wording, or the startup box). */
  menuChanged(): void
}

export interface Updater {
  status(): UpdateStatus
  /** What Help's update items show (main/menu.ts). */
  menu(): UpdateMenu
  /** Help ▸ Check for Updates… / Restart to Update… / Check for Updates on Startup (shared/update.ts UPDATE_COMMAND_IDS). */
  command(id: string): Promise<void>
  dispose(): void
}

/** How long Help ▸ Check for Updates… waits for its answer before saying there is none yet. */
const MENU_CHECK_WAIT_MS = 20_000
/** The log is kept small: past this it is moved to update.old.log and started again. */
const LOG_LIMIT = 256 * 1024

function makeLog(file: string): (level: string, text: string) => void {
  return (level, text) => {
    const line = `${new Date().toISOString()} ${level} ${text}\n`
    try {
      if (existsSync(file) && statSync(file).size > LOG_LIMIT) renameSync(file, file.replace(/\.log$/, ".old.log"))
      appendFileSync(file, line, "utf8")
    } catch {
      // A log that cannot be written is not worth a word to anybody.
    }
    if (level === "error") console.error(`[update] ${text}`)
  }
}

function besideExe(): string[] {
  try { return readdirSync(path.dirname(process.execPath)) } catch { return [] }
}

function readText(file: string): string | null {
  try { return readFileSync(file, "utf8") } catch { return null }
}

export function startUpdater(host: UpdaterHost): Updater {
  const current = app.getVersion()
  const eligible = updateEligibility({
    platform: process.platform,
    packaged: app.isPackaged,
    env: process.env,
    besideExe: besideExe(),
    hasFeedFile: app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml")),
  })
  const settingsFile = path.join(app.getPath("userData"), UPDATE_SETTINGS_FILE)
  let settings: UpdateSettings = readUpdateSettings(readText(settingsFile))
  let status: UpdateStatus = eligible.ok ? { phase: "idle", current } : { phase: "off", current, why: eligible.why }
  /** How a newer release is taken: installed (Windows), or its page opened (a Mac, download mode). */
  const how: UpdateHow = eligible.ok ? eligible.how : "install"
  /** A Mac: looks at GitHub itself, never loads electron-updater. */
  const downloadMode = eligible.ok && eligible.how === "download"
  let dialog: UpdateDialog | null = null
  /** Versions answered "Later" since this launch: the launch look does not ask about them again. */
  const putOff = new Set<string>()
  let updater: AppUpdater | null = null
  let Token: (new () => CancellationToken) | null = null
  let download: CancellationToken | null = null
  /** Update now was pressed: install as soon as the download is in. */
  let wantInstall = false
  let installing = false
  let inFlight: Promise<void> | null = null
  const timers: ReturnType<typeof setTimeout>[] = []

  const view = (): UpdateView => ({ status, dialog, checkOnStartup: settings.checkOnStartup })
  const push = () => {
    const win = host.window()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(UPDATE_CHANNELS.viewPush, view())
  }
  const show = (next: UpdateDialog | null) => { dialog = next; push() }
  const log = makeLog(path.join(app.getPath("userData"), "update.log"))
  const apply = (event: UpdateEvent) => {
    const before = status
    status = nextStatus(status, event)
    if (sameForDisplay(before, status)) {
      // A progress tick: the dialog's line, not the menu.
      if (before.percent !== status.percent) push()
      return
    }
    log("info", `${before.phase} -> ${status.phase}${status.version ? ` ${status.version}` : ""}`)
    push()
    host.menuChanged()
    if (status.phase === "ready" && wantInstall) void install()
  }

  host.ipc.handle(UPDATE_CHANNELS.status, () => status)
  host.ipc.handle(UPDATE_CHANNELS.view, () => view())
  host.ipc.handle(UPDATE_CHANNELS.answer, (_event, choice: UpdateAnswer) => answer(choice))
  host.ipc.handle(UPDATE_CHANNELS.setCheckOnStartup, (_event, on: boolean) => { setCheckOnStartup(on === true) })

  const feed = testFeed(process.env)
  if (eligible.ok && !downloadMode) {
    try {
      const loaded = createRequire(import.meta.url)("electron-updater") as typeof import("electron-updater")
      updater = loaded.autoUpdater
      Token = loaded.CancellationToken
      updater.logger = {
        info: (message?: unknown) => log("info", String(message)),
        warn: (message?: unknown) => log("warn", String(message)),
        error: (message?: unknown) => log("error", String(message)),
        debug: () => {},
      }
      // Nothing is downloaded until the person says Update now.
      updater.autoDownload = false
      // A download that is in when the app quits (Update now, then the restart failed) installs on the way out.
      updater.autoInstallOnAppQuit = true
      updater.allowDowngrade = false
      updater.disableWebInstaller = true
      if (feed) {
        log("info", `test feed ${feed}`)
        updater.setFeedURL({ provider: "generic", url: feed })
      }
      updater.on("checking-for-update", () => apply({ kind: "checking" }))
      updater.on("update-available", (info) => apply({ kind: "available", version: info.version }))
      updater.on("update-not-available", () => apply({ kind: "none" }))
      updater.on("download-progress", (progress) => apply({ kind: "progress", percent: progress.percent }))
      updater.on("update-downloaded", (info) => apply({ kind: "downloaded", version: info.version }))
      updater.on("update-cancelled", () => apply({ kind: "cancelled" }))
      updater.on("error", (error) => apply({ kind: "error", message: oneLine(String(error?.message ?? error)) }))
    } catch (error) {
      log("error", `the updater did not load: ${String(error)}`)
      status = { phase: "off", current, why: "The updater could not be loaded (see update.log)." }
      updater = null
    }
  }

  /** This copy looks: electron-updater is loaded (Windows), or it is a Mac in download mode. */
  const looks = () => updater !== null || downloadMode

  /**
   * A Mac's look: GitHub's latest release, as an event for the state machine. Every failure is an "error" event
   * (offline, GitHub's rate limit, no release, 10 s without an answer, an answer that is not JSON), never a throw.
   */
  async function lookOnGitHub(): Promise<UpdateEvent> {
    const stop = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // The race, not only the signal: a look that never settles would hold every later look (inFlight) for good.
    const tooLong = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        stop.abort()
        reject(new Error(`net::ERR_TIMED_OUT (GitHub did not answer in ${RELEASE_CHECK_TIMEOUT_MS / 1000} s)`))
      }, RELEASE_CHECK_TIMEOUT_MS)
    })
    try {
      const response = await Promise.race([
        net.fetch(RELEASES_LATEST_API, {
          headers: {
            "User-Agent": `WriteMind/${current} (${process.platform}; ${process.arch})`,
            Accept: "application/vnd.github+json",
          },
          signal: stop.signal,
        }),
        tooLong,
      ])
      if (!response.ok) {
        // 404: no published release yet; 403 / 429: GitHub's rate limit (shared/update.ts shortReason says which).
        throw new Error(`HttpError: ${response.status}${response.status === 429 ? " rate limit" : ""} ${response.statusText}`.trim())
      }
      const text = await Promise.race([response.text(), tooLong])
      let answer: unknown
      try { answer = JSON.parse(text) } catch { throw new Error("GitHub's answer could not be read") }
      const found = latestFromGitHub(answer, current, process.arch)
      log("info", found ? `GitHub: ${found.version} has this Mac's dmg (${process.arch})` : `GitHub: nothing newer for this Mac (${process.arch})`)
      return found ? { kind: "available", version: found.version } : { kind: "none" }
    } catch (error) {
      // Logged here: a failed launch look says nothing on screen, so update.log is the only place it shows.
      const message = oneLine(String((error as Error | undefined)?.message ?? error))
      log("warn", `GitHub look failed: ${message}`)
      return { kind: "error", message }
    } finally {
      clearTimeout(timer)
    }
  }

  /** One look at a time: a second asker waits for the one under way. */
  function check(reason: string): Promise<void> {
    if (downloadMode) {
      if (inFlight) return inFlight
      log("info", `checking GitHub (${reason}), running ${current} (${process.arch})`)
      inFlight = (async () => {
        apply({ kind: "checking" })
        apply(await lookOnGitHub())
      })().finally(() => { inFlight = null })
      return inFlight
    }
    if (!updater) return Promise.resolve()
    if (inFlight) return inFlight
    const looking = updater
    log("info", `checking (${reason}), running ${current}`)
    inFlight = (async () => {
      try {
        await looking.checkForUpdates()
      } catch {
        // Reported through "error" (offline, rate limit, no release yet): logged; the menu's look says it.
      }
    })().finally(() => { inFlight = null })
    return inFlight
  }

  if (looks()) {
    if (settings.checkOnStartup) {
      timers.push(setTimeout(() => {
        void check("launch").then(() => {
          const ask = dialogAfterLaunchCheck(status, putOff, how)
          if (ask && !dialog) show(ask)
        })
      }, feed ? TEST_FIRST_CHECK_DELAY_MS : STARTUP_CHECK_DELAY_MS))
    } else {
      log("info", `not checking at launch (Check on startup is off), running ${current}`)
    }
  }

  function startDownload(): void {
    if (!updater || !Token || nextStatus(status, { kind: "download" }).phase !== "downloading" || status.phase === "downloading") return
    apply({ kind: "download" })
    log("info", `downloading ${status.version}`)
    download = new Token()
    // A failure is reported through "error", a cancel through "update-cancelled".
    updater.downloadUpdate(download).catch(() => {})
  }

  async function install(): Promise<void> {
    if (!updater || status.phase !== "ready" || installing) return
    installing = true
    log("info", `restarting into ${status.version}`)
    try {
      await host.beforeInstall()
      // Silent: the per-user installer runs with no window over the existing install. It starts the new version
      // when it is done — except under the test feed, whose run starts its own copy with its own profile.
      updater.quitAndInstall(true, !feed)
    } catch (error) {
      installing = false
      log("error", `could not restart into the update: ${String(error)}`)
    }
  }

  async function answer(choice: UpdateAnswer): Promise<void> {
    const asked = dialog
    if (choice === "close") { show(null); return }
    if (asked?.kind !== "available") { show(null); return }
    if (choice === "later") {
      putOff.add(asked.version)
      wantInstall = false
      if (status.phase === "downloading") download?.cancel()
      log("info", `later: ${asked.version} is not asked about again until the next launch`)
      show(null)
      return
    }
    // A Mac's Download: the release's page in the browser, and the dialog is done. Nothing else happens here.
    if (downloadMode) { openReleasePage(asked.version); show(null); return }
    // Update now.
    wantInstall = true
    if (status.phase === "ready") { await install(); return }
    if (status.phase === "downloading") return
    if (status.phase !== "available" || status.version !== asked.version) {
      // A failed download (or an older look): look again, then take what it finds.
      await check("update now")
      if (status.phase !== "available") { push(); return }
    }
    startDownload()
  }

  /** The page Download opens: built from the version (shared/update.ts releasePage), never taken from GitHub's answer. */
  function openReleasePage(version: string): void {
    const page = releasePage(version)
    if (!page) { log("error", `download: "${version}" is not a release version; nothing opened`); return }
    log("info", `download: opening ${page}`)
    shell.openExternal(page).catch((error: unknown) => log("error", `could not open ${page}: ${String(error)}`))
  }

  async function checkFromMenu(): Promise<void> {
    if (!looks()) { show(dialogAfterMenuCheck(status, how)); return }
    if (status.phase === "ready") { wantInstall = true; await install(); return }
    if (status.phase !== "downloading") {
      await Promise.race([check("menu"), new Promise((resolve) => { setTimeout(resolve, MENU_CHECK_WAIT_MS) })])
    }
    show(dialogAfterMenuCheck(status, how))
  }

  function setCheckOnStartup(on: boolean): void {
    if (settings.checkOnStartup === on) return
    settings = { ...settings, checkOnStartup: on }
    try {
      writeFileSync(settingsFile, writeUpdateSettings(settings), "utf8")
    } catch (error) {
      log("error", `could not write ${UPDATE_SETTINGS_FILE}: ${String(error)}`)
    }
    log("info", `check on startup: ${on ? "on" : "off"}`)
    push()
    host.menuChanged()
  }

  return {
    status: () => status,
    menu: () => updateMenu(status, settings, looks()),
    command: async (id) => {
      if (id === "checkForUpdates") await checkFromMenu()
      else if (id === "installUpdate") { wantInstall = true; await install() }
      else if (id === "checkUpdatesOnStartup") setCheckOnStartup(!settings.checkOnStartup)
    },
    dispose: () => { for (const timer of timers) clearTimeout(timer) },
  }
}
