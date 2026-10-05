/**
 * webhid/electronHost.ts - the real host of the WebHID helper: a hidden BrowserWindow on its own session. docs/spikes/DESIGN-pen-capture.md
 * 4.4. Owner: IMPL-B. The only file of the WebHID lane that touches Electron's window API; webhidBackend.ts drives it through `WebHidHost`.
 *
 *   new BrowserWindow({ show:false, width:1, height:1, webPreferences:{ session, preload: pen-hid.cjs, contextIsolation:true, sandbox:false,
 *                       nodeIntegration:false, backgroundThrottling:false } })
 *
 * `backgroundThrottling:false` is mandatory (measured: timers fall to 1 Hz otherwise). The window is never shown, never focusable, not in
 * the taskbar. Messages arrive on the helper's OWN `webContents.ipc`, so no other window can speak the pen:hid-* channels. The window never
 * navigates anywhere else and opens no new windows.
 *
 * A hidden window still counts as a window: with the notes window closed the app would not quit. So a watchdog closes the helper (and says
 * so) when no other window is left, besides the backend's own stop() on the usual paths.
 *
 * Electron is imported lazily so vitest can load this module (it is never run there).
 */

import type { BrowserWindow } from "electron"
import type { WebHidDeps } from "../types"
import { HID_CHANNELS, type HidCommand } from "./protocol"

export interface HostMessageSink {
  samples(data: unknown): void
  raw(data: unknown): void
  status(data: unknown): void
}

/** What the backend needs of the helper window; tests fake it. */
export interface WebHidHost {
  /** Create the window and load the page. Rejects if the page cannot load. */
  load(): Promise<void>
  send(command: HidCommand): void
  /** Run `navigator.hid.requestDevice` inside the page with a user gesture (the permission handlers pick the Wacom). */
  requestDevice(): Promise<void>
  /** Test harnesses only: run a script in the page before "start" (to plant a pretend navigator.hid). */
  evaluate(script: string): Promise<void>
  onMessage(sink: HostMessageSink): () => void
  /** The window or its renderer went away without being asked (crash, killed, no other window left). */
  onGone(listener: (why: string) => void): () => void
  /** Synchronous, idempotent. */
  close(): void
}

export type WebHidHostFactory = (deps: WebHidDeps) => WebHidHost

export const ORPHAN_CHECK_MS = 2000

export const createElectronHost: WebHidHostFactory = (deps) => {
  let win: BrowserWindow | null = null
  let closing = false
  let watchdog: ReturnType<typeof setInterval> | null = null
  const sinks = new Set<HostMessageSink>()
  const goneListeners = new Set<(why: string) => void>()

  const gone = (why: string): void => {
    if (closing) return
    for (const l of [...goneListeners]) { try { l(why) } catch { /* ignore */ } }
  }

  return {
    async load() {
      const { BrowserWindow: Window } = await import("electron")
      const w = new Window({
        show: false,
        width: 1,
        height: 1,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        title: "WriteMind pen (WebHID helper)",
        webPreferences: {
          session: deps.session,
          preload: deps.preload,
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false,
          spellcheck: false,
        },
      })
      win = w
      const wc = w.webContents
      wc.setWindowOpenHandler(() => ({ action: "deny" }))
      wc.on("will-navigate", (event) => event.preventDefault())
      wc.ipc.on(HID_CHANNELS.samples, (_e, data: unknown) => { for (const s of [...sinks]) s.samples(data) })
      wc.ipc.on(HID_CHANNELS.raw, (_e, data: unknown) => { for (const s of [...sinks]) s.raw(data) })
      wc.ipc.on(HID_CHANNELS.status, (_e, data: unknown) => { for (const s of [...sinks]) s.status(data) })
      wc.on("render-process-gone", (_e, details) => gone(`the WebHID helper page stopped (${details.reason})`))
      wc.on("unresponsive", () => deps.log("pen-hid: helper page is not responding"))
      wc.on("console-message", (event) => {
        if (event.level === "error" || event.level === "warning") deps.log(`pen-hid page ${event.level}: ${event.message}`)
      })
      w.on("closed", () => { win = null; gone("the WebHID helper window was closed") })
      watchdog = setInterval(() => {
        const others = Window.getAllWindows().filter((o) => o !== w && !o.isDestroyed())
        if (!others.length) gone("no other window is open")
      }, ORPHAN_CHECK_MS)
      watchdog.unref?.()
      await w.loadFile(deps.page)
    },

    send(command) {
      if (!win || win.isDestroyed()) return
      win.webContents.send(HID_CHANNELS.command, command)
    },

    async requestDevice() {
      if (!win || win.isDestroyed()) return
      await win.webContents.executeJavaScript("window.__penHidRequest ? window.__penHidRequest() : Promise.resolve()", true)
    },

    async evaluate(script) {
      if (!win || win.isDestroyed()) return
      await win.webContents.executeJavaScript(script, false)
    },

    onMessage(sink) {
      sinks.add(sink)
      return () => { sinks.delete(sink) }
    },

    onGone(listener) {
      goneListeners.add(listener)
      return () => { goneListeners.delete(listener) }
    },

    close() {
      if (closing) return
      closing = true
      if (watchdog) { clearInterval(watchdog); watchdog = null }
      sinks.clear()
      goneListeners.clear()
      const w = win
      win = null
      if (w && !w.isDestroyed()) {
        try { w.destroy() } catch { /* already gone */ }
      }
    },
  }
}
