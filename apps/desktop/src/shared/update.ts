/**
 * Updates, the pure half (main/updater.ts is the Electron half; test/updater.test.ts holds this one).
 *
 * WHERE THEY COME FROM: WriteMindCross's own GitHub Releases (a public repo; electron-builder.yml's `publish`
 * block, .github/workflows/release.yml makes them). WHICH COPIES LOOK: an INSTALLED Windows build only — the
 * per-user NSIS install, which has its uninstaller beside the exe and the update feed (`resources/app-update.yml`)
 * in its resources. Never a development run, an end-to-end run, the portable exe, an unpacked folder, or a copy run
 * from the repo's own Electron (C:\CLAUDIO\try-build): those are not what an installer would replace.
 *
 * HOW IT BEHAVES (Sean, 2026-10-05: "have a 'Updates available. Update now?' popup when there are updates and check
 * on startup by default and have a checkbox for 'Check on startup' and add a 'Check for updates' button to the
 * menu"): ONE look a few seconds after launch, when "Check on startup" is ticked (it is, unless he unticks it);
 * otherwise only Help ▸ Check for Updates… looks. A newer release brings up the page's own small dialog
 * (renderer/UpdateDialog.tsx) — "Updates available", "WriteMind 0.5.1 is available (you have 0.5.0). Update now?",
 * [Later] [Update now], and the "Check on startup" tick box. Nothing is downloaded until Update now; then a quiet
 * progress line in the dialog, the notes are written, the installer runs silently and the new version opens. Later
 * puts that version off until the next launch. A launch look that finds nothing, or fails (offline, GitHub's rate
 * limit), says nothing (update.log has it); Help ▸ Check for Updates… always answers.
 */

/** Where an update stands, as the page and the Help menu see it. */
export type UpdatePhase = "off" | "idle" | "checking" | "available" | "downloading" | "ready" | "latest" | "error"

export interface UpdateStatus {
  phase: UpdatePhase
  /** The running version. */
  current: string
  /** The newer version found, being downloaded, or ready to install. */
  version?: string
  /** Download progress, 0-100 (downloading only). */
  percent?: number
  /** The last error, one line (error only). */
  error?: string
  /** Why this copy does not update itself (off only). */
  why?: string
}

/** The launch look waits only for the window to settle: a dialog that comes late lands on somebody typing. */
export const STARTUP_CHECK_DELAY_MS = 3_000
/** The test feed (WRITEMIND_UPDATE_FEED) looks almost at once. */
export const TEST_FIRST_CHECK_DELAY_MS = 1_500

export const UPDATE_CHANNELS = {
  status: "update:status",
  view: "update:view",
  viewPush: "update:view-push",
  answer: "update:answer",
  setCheckOnStartup: "update:set-check-on-startup",
} as const

/** The Help menu's update commands, the main process's own (main.ts MAIN_OWNED, main/updater.ts `command`). */
export const UPDATE_COMMAND_IDS = ["checkForUpdates", "installUpdate", "checkUpdatesOnStartup"] as const

// MARK: - The setting

/** userData/update.json: the person's one update setting. Not localStorage: the main process needs it at launch. */
export const UPDATE_SETTINGS_FILE = "update.json"

export interface UpdateSettings {
  /** Look for a newer release a few seconds after launch (Help ▸ Check for Updates on Startup, the dialog's box). */
  checkOnStartup: boolean
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { checkOnStartup: true }

/** The settings file's text (null: there is none yet). Anything unreadable is the default: ticked. */
export function readUpdateSettings(text: string | null): UpdateSettings {
  if (!text) return { ...DEFAULT_UPDATE_SETTINGS }
  try {
    const parsed = JSON.parse(text) as Partial<UpdateSettings> | null
    return { checkOnStartup: typeof parsed?.checkOnStartup === "boolean" ? parsed.checkOnStartup : DEFAULT_UPDATE_SETTINGS.checkOnStartup }
  } catch {
    return { ...DEFAULT_UPDATE_SETTINGS }
  }
}

export function writeUpdateSettings(settings: UpdateSettings): string {
  return `${JSON.stringify({ checkOnStartup: settings.checkOnStartup }, null, 2)}\n`
}

// MARK: - What the page is told

/** The dialog the page shows (renderer/UpdateDialog.tsx), or none. */
export type UpdateDialog =
  /** "Updates available": a newer release, Update now / Later, and the Check on startup box. */
  | { kind: "available"; version: string; current: string; asked?: true }
  /** Help ▸ Check for Updates… found nothing newer. */
  | { kind: "latest"; current: string }
  /** Help ▸ Check for Updates… could not look. */
  | { kind: "error"; reason: string }
  /** Help ▸ Check for Updates… in a copy that does not update itself. */
  | { kind: "off"; why: string }

export interface UpdateView {
  status: UpdateStatus
  dialog: UpdateDialog | null
  checkOnStartup: boolean
}

/** The page's answer: Update now / Later in "Updates available", OK in the others. */
export type UpdateAnswer = "now" | "later" | "close"

/** window.wm.update (preload.ts). */
export interface UpdateApi {
  status(): Promise<UpdateStatus>
  view(): Promise<UpdateView>
  answer(choice: UpdateAnswer): Promise<void>
  setCheckOnStartup(on: boolean): Promise<void>
  onView(listener: (view: UpdateView) => void): () => void
}

// MARK: - Which copies look

export interface CopyFacts {
  platform: string
  /** `app.isPackaged`. */
  packaged: boolean
  env: Record<string, string | undefined>
  /** The names of the files beside the running exe. */
  besideExe: string[]
  /** `resources/app-update.yml` is there (electron-builder writes it when the build has a `publish` block). */
  hasFeedFile: boolean
}

export type Eligibility = { ok: true } | { ok: false; why: string }

/** Does this copy of WriteMind update itself? The reason is what Help ▸ Check for Updates… says when it does not. */
export function updateEligibility(facts: CopyFacts): Eligibility {
  const { env } = facts
  if (facts.platform !== "win32") return { ok: false, why: "Updates come with the Windows installer; on this system, install a new version by hand." }
  if (!facts.packaged || env.WRITEMIND_DEV === "1") return { ok: false, why: "This is a development run of WriteMind, which does not update itself." }
  if (env.WRITEMIND_E2E) return { ok: false, why: "This is a test run of WriteMind, which does not update itself." }
  if (env.PORTABLE_EXECUTABLE_DIR) return { ok: false, why: "This is the portable WriteMind, which does not update itself: download the new one, or use the installer." }
  if (!facts.hasFeedFile) return { ok: false, why: "This build of WriteMind was made without an update feed." }
  if (!facts.besideExe.some((name) => /^Uninstall .+\.exe$/i.test(name))) {
    return { ok: false, why: "This copy of WriteMind was not installed by its installer (it runs from an unpacked folder), so it does not update itself." }
  }
  return { ok: true }
}

/**
 * A feed to test against instead of GitHub (the end-to-end check serves a latest.yml and an installer from a
 * folder). Only a loopback address is taken: an environment variable must not be able to point an installed copy
 * at somebody else's server.
 */
export function testFeed(env: Record<string, string | undefined>): string | null {
  const raw = env.WRITEMIND_UPDATE_FEED?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null
    return url.href
  } catch {
    return null
  }
}

// MARK: - What the updater said

export type UpdateEvent =
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "none" }
  /** Update now: the download starts. */
  | { kind: "download" }
  | { kind: "progress"; percent: number }
  | { kind: "downloaded"; version: string }
  /** Cancel during the download: the version is still there to take. */
  | { kind: "cancelled" }
  | { kind: "error"; message: string }

/** The first line of an error, short: "net::ERR_INTERNET_DISCONNECTED", not a stack. */
export function oneLine(message: string): string {
  const line = message.split(/\r?\n/).find((one) => one.trim()) ?? "unknown error"
  return line.length > 160 ? `${line.slice(0, 157)}…` : line.trim()
}

export function nextStatus(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  const { current } = status
  if (status.phase === "off") return status
  // A downloaded update stays ready: a later check (or its error) does not lose it.
  if (status.phase === "ready" && event.kind !== "downloaded") return status
  switch (event.kind) {
    case "checking":
      if (status.phase === "downloading") return status
      // Update now again after a failed download checks first: the version is kept, so if that check fails too the
      // dialog still says why.
      return status.phase === "error" && status.version ? { phase: "checking", current, version: status.version } : { phase: "checking", current }
    case "available":
      return status.phase === "downloading" ? status : { phase: "available", current, version: event.version }
    case "none":
      return status.phase === "downloading" ? status : { phase: "latest", current }
    case "download":
      if (!status.version || (status.phase !== "available" && status.phase !== "error")) return status
      return { phase: "downloading", current, version: status.version, percent: 0 }
    case "progress":
      if (status.phase !== "downloading") return status
      return { ...status, percent: Math.max(0, Math.min(100, Math.floor(event.percent))) }
    case "downloaded":
      return { phase: "ready", current, version: event.version }
    case "cancelled":
      return status.phase === "downloading" && status.version ? { phase: "available", current, version: status.version } : status
    case "error":
      return { phase: "error", current, error: oneLine(event.message), ...(status.version ? { version: status.version } : {}) }
  }
}

/** Did the change matter to the menu (progress ticks do not)? */
export function sameForDisplay(a: UpdateStatus, b: UpdateStatus): boolean {
  return a.phase === b.phase && a.version === b.version
}

// MARK: - When to ask

/** After the launch look: ask only about a newer release not put off ("Later") since this launch. Else silence. */
export function dialogAfterLaunchCheck(status: UpdateStatus, putOff: ReadonlySet<string>): UpdateDialog | null {
  if (status.phase !== "available" || !status.version || putOff.has(status.version)) return null
  return { kind: "available", version: status.version, current: status.current }
}

/** After Help ▸ Check for Updates… (its look is over, or timed out): always an answer, even for a version put off. */
export function dialogAfterMenuCheck(status: UpdateStatus): UpdateDialog {
  switch (status.phase) {
    case "off":
      return { kind: "off", why: status.why ?? "This copy of WriteMind does not update itself." }
    case "available":
    case "downloading":
    case "ready":
      return status.version ? { kind: "available", version: status.version, current: status.current, asked: true } : { kind: "latest", current: status.current }
    case "error":
      return { kind: "error", reason: shortReason(status.error ?? "") }
    case "checking":
      return { kind: "error", reason: "no answer yet; try again in a moment" }
    case "latest":
    case "idle":
      return { kind: "latest", current: status.current }
  }
}

// MARK: - What is shown

/** An updater error in a few plain words ("no internet connection"), else its first line, short. */
export function shortReason(message: string): string {
  const m = message
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ENOTFOUND|EAI_AGAIN/i.test(m)) return "no internet connection"
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ECONNREFUSED|ECONNRESET/i.test(m)) return "the update server did not answer"
  if (/TIMED_OUT|ETIMEDOUT|timeout/i.test(m)) return "the update server took too long to answer"
  if (/rate limit|\b403\b/i.test(m)) return "GitHub is limiting requests; try again later"
  if (/latest\.yml|\b404\b|ensure a production release exists|No published versions/i.test(m)) return "no release was found"
  if (/sha512|checksum/i.test(m)) return "the download was damaged; try again"
  const line = oneLine(m || "unknown error")
  return line.length > 100 ? `${line.slice(0, 97)}…` : line
}

export interface UpdateDialogText {
  title: string
  message: string
  /** A second, softer line (the "off" dialog's reason). */
  detail?: string
}

export function updateDialogText(dialog: UpdateDialog): UpdateDialogText {
  switch (dialog.kind) {
    case "available":
      return { title: "Updates available", message: `WriteMind ${dialog.version} is available (you have ${dialog.current}). Update now?` }
    case "latest":
      return { title: "Check for Updates", message: `You're up to date (${dialog.current}).` }
    case "error":
      return { title: "Check for Updates", message: `Couldn't check for updates: ${dialog.reason}.` }
    case "off":
      return { title: "Check for Updates", message: "Updates come with the installed app.", detail: dialog.why }
  }
}

/** The quiet line under "Update now?" once it was pressed: progress, then the restart, or why the download stopped. */
export function progressLine(status: UpdateStatus): { text: string; problem: boolean } | null {
  switch (status.phase) {
    case "downloading":
      return { text: `Downloading… ${status.percent ?? 0}%`, problem: false }
    case "ready":
      return { text: "Saving your notes and restarting…", problem: false }
    case "error":
      if (!status.version) return null
      // A 404 here is the installer missing from the release (its latest.yml is there), not "no release".
      return {
        text: `Couldn't download the update: ${/\b404\b/.test(status.error ?? "") ? "the installer is not on the server" : shortReason(status.error ?? "")}.`,
        problem: true,
      }
    default:
      return null
  }
}

/** The one place outside the dialog: Help ▸ … */
export function updateMenuLabel(status: UpdateStatus | null | undefined): string {
  return status?.phase === "ready" && status.version ? `Restart to Update to ${status.version}` : "Check for Updates…"
}

/** What the Help menu needs (main/menu.ts). */
export interface UpdateMenu {
  label: string
  /** The item restarts into a downloaded update rather than looking. */
  ready: boolean
  checkOnStartup: boolean
  /** This copy updates itself: the startup box is live (else it is shown greyed). */
  canCheck: boolean
}

export function updateMenu(status: UpdateStatus | null | undefined, settings: UpdateSettings, canCheck: boolean): UpdateMenu {
  return {
    label: updateMenuLabel(status),
    ready: status?.phase === "ready" && !!status.version,
    checkOnStartup: settings.checkOnStartup,
    canCheck,
  }
}
