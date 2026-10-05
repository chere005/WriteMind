/**
 * main/pen/subsystem.ts - the pen feed, assembled. main.ts calls `startPenSubsystem` once and `attachWindow()` after the notes window exists.
 *
 * The app creates NO window of its own for the pen: no helper window or page. The feed is the manager (manager.ts) over the Wintab
 * data backend (wintabBackend.ts); with no Wintab the window's own pen events drive the sheet as they always did. The only other thing is the
 * system mapping (mapping.ts): a second Wintab context, open only while the pen is in range over the sheet. Nothing is hooked, nothing is clipped.
 *
 * Built once inside a try/catch: if anything here throws, the pen simply works as the plain pointer it always was (`available: false`).
 *
 * Switch it off with WRITEMIND_PEN=off or an (empty) file named `pen-off` in the userData folder.
 */

import fs from "node:fs"
import path from "node:path"
import type { App, BrowserWindow, IpcMain, PowerMonitor, Screen } from "electron"
import type { BackendContext, Box, DeviceInfo, SheetReport } from "../../shared/pen"
import { InjectBackend } from "./fake"
import { installPenIpc, watchWindow, type IpcLike, type PenIpc, type WindowLike } from "./ipc"
import { createPenLog } from "./log"
import { createMappingController, type MapHandle, type MappingController } from "./mapping"
import { createFeedManager, type FeedManagerEx } from "./manager"
import { createStateStore, type StateStore } from "./state"
import type { PenPaths, SystemMapped } from "./types"
import { isWin32, loadWin32 } from "./win32"
import { closeAllWintab, installWintabExitCleanup, wintabBlockedReason } from "./wintabNative"
import { createWintabBackend } from "./wintabBackend"

export interface PenSubsystemDeps {
  app: Pick<App, "getPath">
  screen: Screen
  ipc: IpcMain
  powerMonitor: PowerMonitor
  /** The notes window. */
  window(): BrowserWindow | null
  e2e: boolean
  env: NodeJS.ProcessEnv
  platform: string
  log(line: string): void
}

export interface PenSubsystem {
  /** False when the subsystem could not exist (not Windows, switched off, a build failure): the renderer sees `available: false`. */
  available: boolean
  manager: FeedManagerEx | null
  /** Call after the notes window is (re)created: its focus / visibility go to the manager, and a closed or reloaded page lets go. */
  attachWindow(): void
  /** Quit: let go of everything. Idempotent. */
  dispose(): void
}

const none = (): PenSubsystem => ({ available: false, manager: null, attachWindow: () => {}, dispose: () => {} })


/** Why the pen subsystem must not exist right now, or null when it may. Pure apart from `exists`. */
export function penDisabledReason(input: { platform: string; env: Record<string, string | undefined>; userData: string; exists(path: string): boolean }): string | null {
  if (input.platform !== "win32") return "native pen capture is Windows only"
  if ((input.env.WRITEMIND_PEN ?? "").trim().toLowerCase() === "off") return "pen capture is switched off (WRITEMIND_PEN=off)"
  try { if (input.exists(path.join(input.userData, "pen-off"))) return "pen capture is switched off (pen-off file)" } catch { /* a file check that throws is no reason to refuse */ }
  return null
}

export function startPenSubsystem(deps: PenSubsystemDeps): PenSubsystem {
  try {
    return build(deps)
  } catch (error) {
    deps.log(`pen subsystem could not start: ${(error as Error)?.stack ?? String(error)}`)
    return none()
  }
}

function build(deps: PenSubsystemDeps): PenSubsystem {
  const userData = deps.app.getPath("userData")
  const disabled = penDisabledReason({ platform: deps.platform, env: deps.env, userData, exists: (p) => fs.existsSync(p) })
  if (disabled) { deps.log(`[pen] ${disabled}`); return none() }
  const paths: PenPaths = {
    userData,
    state: path.join(userData, "pen-state.json"),
    log: path.join(userData, "pen.log"),
    wintabJournal: path.join(userData, "wintab.journal.json"),
  }
  const log = (line: string): void => deps.log(`[pen] ${line}`)
  const now = (): number => performance.timeOrigin + performance.now()
  const { screen } = deps

  const store: StateStore = createStateStore(paths.state, { log })
  const trace = createPenLog(paths.log, log)

  // ---- the system mapping: a second Wintab context over the sheet, only while the pen is in range there (mapping.ts)
  const physical = (sheet: SheetReport): Box | null => {
    const win = deps.window()
    if (!win || win.isDestroyed()) return null
    const c = win.getContentBounds()
    // Client CSS pixels -> DIP on the virtual desktop -> PHYSICAL pixels of the display they are on (DPI-correct, Windows).
    const dip = { x: Math.round(c.x + sheet.rect.x), y: Math.round(c.y + sheet.rect.y), width: Math.round(sheet.rect.width), height: Math.round(sheet.rect.height) }
    try {
      const p = deps.screen.dipToScreenRect(win, dip)
      return { x: p.x, y: p.y, width: p.width, height: p.height }
    } catch { return null }
  }
  // Under E2E the window sits at -32000,-32000 and no pen moves: the mapping is not attempted unless Wintab is opened for real (WRITEMIND_PEN_NATIVE=1).
  const mappingPossible = (): boolean => (!deps.e2e || deps.env.WRITEMIND_PEN_NATIVE === "1") && wintabBlockedReason() === null && isWin32(loadWin32())
  const mapping: MappingController = createMappingController({
    available: mappingPossible,
    async open(rect: Box): Promise<MapHandle | null> {
      const backend = createWintabBackend("system", paths)
      const ctx: BackendContext = {
        sheetPhysical: rect, trace, now, settings: store.get().settings,
      }
      const result = await backend.start(ctx)
      if (!result.ok) { backend.stop(); trace.event("manager", "map-start-failed", { reason: result.reason }); return null }
      const mapped = backend as unknown as SystemMapped
      // Packets the system context decodes are only a liveness signal for the starvation watchdog; nothing else listens to this backend.
      const off = backend.onSample(() => mapping.systemPacket())
      return { setRect: (r) => mapped.setSheetPhysical(r), stop: () => { try { off() } catch { /* ignore */ } backend.stop() } }
    },
    cursor() {
      try { const w = loadWin32(); return isWin32(w) ? w.getCursorPos() : null } catch { return null }
    },
    physical,
    now,
    recall: (key) => store.get().mapping[key] ?? null,
    remember: (key, verdict) => store.update((st) => { if (verdict) st.mapping[key] = verdict; else delete st.mapping[key] }),
    trace: (name, data) => trace.event("manager", name, data),
  })

  // The E2E fake tablet is portrait-reporting like Sean's CTL-472 (Wintab x 0..9499, y 0..15199).
  const injectTablet = new InjectBackend("inject-tablet")
  const fakeDevice: DeviceInfo = {
    name: "Fake tablet", vendorId: null, productId: null, aspect: 1.6, rawX: [0, 9499], rawY: [0, 15199], pressureMax: 1000,
    claims: { pressure: true, tilt: false, lower: true, upper: true, eraser: false },
  }
  injectTablet.setDevice(fakeDevice)
  const manager = createFeedManager({
    available: true,
    wintab: createWintabBackend("data", paths),
    inject: new InjectBackend(),
    injectTablet,
    mapping,
    store,
    trace,
    now,
    e2e: deps.e2e,
    native: deps.env.WRITEMIND_PEN_NATIVE === "1",
    log,
  })

  const ipc: PenIpc = installPenIpc({
    ipc: deps.ipc as unknown as IpcLike,
    window: () => deps.window() as unknown as WindowLike | null,
    manager,
    trace,
    e2e: deps.e2e,
  })

  let unwatch: (() => void) | null = null
  const unlisten: (() => void)[] = []
  let disposed = false
  try { installWintabExitCleanup() } catch { /* the driver is not there */ }
  const onResume = (): void => manager.deviceChanged("resume")
  const onUnlock = (): void => manager.deviceChanged("unlock")
  deps.powerMonitor.on("resume", onResume)
  deps.powerMonitor.on("unlock-screen", onUnlock)

  function dispose(): void {
    if (disposed) return
    disposed = true
    try { unwatch?.() } catch { /* ignore */ }
    for (const off of unlisten.splice(0)) { try { off() } catch { /* ignore */ } }
    try { deps.powerMonitor.removeListener("resume", onResume); deps.powerMonitor.removeListener("unlock-screen", onUnlock) } catch { /* ignore */ }
    try { ipc.dispose() } catch { /* ignore */ }
    try { mapping.stop("quit") } catch { /* ignore */ }
    try { manager.dispose() } catch { /* ignore */ }
    try { closeAllWintab() } catch { /* ignore */ }
    try { store.dispose() } catch { /* ignore */ }
    try { trace.close() } catch { /* ignore */ }
  }

  return {
    available: true,
    manager,
    attachWindow() {
      try { unwatch?.() } catch { /* ignore */ }
      for (const off of unlisten.splice(0)) { try { off() } catch { /* ignore */ } }
      unwatch = null
      const win = deps.window()
      if (!win || win.isDestroyed()) return
      unwatch = watchWindow(win as unknown as WindowLike, manager)
      // The window moved or was resized: the sheet is somewhere else on the screen.
      const moved = (): void => { try { mapping.refresh() } catch { /* ignore */ } }
      const w = win as unknown as WindowLike
      for (const name of ["move", "resize"]) w.on(name, moved)
      unlisten.push(() => { if (!win.isDestroyed()) for (const name of ["move", "resize"]) w.removeListener(name, moved) })
      // A closed window, a dead page or a reload lets go at once; the page asks again when its sheet shows.
      const letGo = (why: string) => (): void => { try { manager.close(why) } catch { /* ignore */ } }
      const onClosed = letGo("window closed"), onLoading = letGo("page reloading"), onGone = letGo("page gone")
      win.on("closed", onClosed)
      win.webContents.on("did-start-loading", onLoading)
      win.webContents.on("render-process-gone", onGone)
      unlisten.push(
        () => win.removeListener("closed", onClosed),
        () => { if (!win.isDestroyed()) { win.webContents.removeListener("did-start-loading", onLoading); win.webContents.removeListener("render-process-gone", onGone) } },
      )
    },
    dispose,
  }
}
