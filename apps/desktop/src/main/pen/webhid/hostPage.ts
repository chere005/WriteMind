/**
 * webhid/hostPage.ts - the script of the WebHID helper page (bundled by scripts/build.mjs to out/helpers/pen-hid.js as an iife for the
 * browser; the static page is src/helpers/pen-hid.html). docs/spikes/DESIGN-pen-capture.md 4.4. Owner: IMPL-B.
 *
 * It runs in the page's OWN world, exactly as the WebHID spike did (verified on the real Wacom); the preload (src/preload/penHid.ts) is
 * only a bridge: `window.penHid.samples / raw / status / onCommand`. WebHID inside an isolated-world preload is unverified, so nothing
 * relies on it. The page is not the notes window and never sees user data.
 *
 * `wireHost(bridge, env)` is the whole behaviour, with everything environmental injected (tests drive it with a fake hid and a fake
 * bridge); the last lines wire it to the real `window` when a bridge is there.
 *
 *   loaded   -> status {phase:"loaded"} as soon as the script runs (the handshake: the page, the preload and this script are alive)
 *   command  start   -> WebHidSource.start(); status {phase:"started", devices}
 *            stop    -> source.stop(); status {phase:"stopped"}
 *            request -> navigator.hid.requestDevice({filters:[{vendorId}]}) then adopt (main runs it with a user gesture through
 *                       `window.__penHidRequest()`: requestDevice needs one)
 */

import type { PenSample } from "../../../shared/pen"
import { WebHidSource, type HidLike } from "./hidSource"
import type { HidCommand, HidHostStatus, HidRawRecord } from "./protocol"
import { WACOM_VENDOR_ID } from "./protocol"

export interface PenHidBridge {
  samples(batch: PenSample[]): void
  raw(records: HidRawRecord[]): void
  status(status: HidHostStatus): void
  onCommand(listener: (command: HidCommand) => void): void
}

export interface HostEnv {
  hid?: HidLike
  /** `navigator.hid.requestDevice` with filters for these vendors; undefined when WebHID is missing. */
  requestDevice?(vendorIds: readonly number[]): Promise<unknown>
  now(): number
  timeOrigin: number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export const RAW_FLUSH_MS = 50

export interface HostHandle {
  /** Run a command as if main had sent it (the page's `__penHidRequest` uses this). */
  handle(command: HidCommand): Promise<void>
  source(): WebHidSource | null
}

export function wireHost(bridge: PenHidBridge, env: HostEnv): HostHandle {
  let source: WebHidSource | null = null
  let phase: HidHostStatus["phase"] = "loaded"
  let rawQueue: HidRawRecord[] = []
  let rawTimer: unknown = null
  let chain: Promise<void> = Promise.resolve()

  const flushRaw = (): void => {
    if (rawTimer !== null) { env.clearTimer(rawTimer); rawTimer = null }
    if (!rawQueue.length) return
    const out = rawQueue
    rawQueue = []
    bridge.raw(out)
  }

  const send = (note?: string): void => {
    const status: HidHostStatus = { phase, hidAvailable: !!env.hid, devices: source ? source.devices() : [] }
    if (note) status.note = note
    const collections = source?.takeCollections()
    if (collections !== undefined) status.collections = collections
    bridge.status(status)
  }

  const run = async (command: HidCommand): Promise<void> => {
    try {
      if (command.cmd === "start") {
        source?.stop()
        flushRaw()
        source = new WebHidSource({
          hid: env.hid,
          vendorIds: command.vendorIds,
          now: env.now,
          timeOrigin: env.timeOrigin,
          setTimer: env.setTimer,
          clearTimer: env.clearTimer,
          onSamples: (batch) => bridge.samples(batch),
          onStatus: () => send(),
          onRaw: (r) => {
            rawQueue.push(r)
            if (rawTimer === null) rawTimer = env.setTimer(() => { rawTimer = null; flushRaw() }, RAW_FLUSH_MS)
          },
        })
        phase = "loaded"
        if (!source.available) { phase = "started"; send("navigator.hid is not available in this Chromium"); return }
        await source.start()
        phase = "started"
        send()
      } else if (command.cmd === "stop") {
        source?.stop()
        flushRaw()
        phase = "stopped"
        send()
      } else if (command.cmd === "request") {
        if (!source || !env.requestDevice) { send("requestDevice is not available"); return }
        try {
          await env.requestDevice(command.vendorIds.length ? command.vendorIds : [WACOM_VENDOR_ID])
        } catch (error) {
          send(`requestDevice failed: ${(error as Error)?.message || String(error)}`)
          return
        }
        await source.refresh()
        send()
      }
    } catch (error) {
      send(`${command.cmd} failed: ${(error as Error)?.message || String(error)}`)
    }
  }

  // Commands run one after the other: a "start" that is still opening devices must finish before a "stop" closes them.
  const handle = (command: HidCommand): Promise<void> => {
    chain = chain.then(() => run(command), () => run(command))
    return chain
  }

  bridge.onCommand((command) => { void handle(command) })
  send()
  return { handle, source: () => source }
}

// ---------------------------------------------------------------------------------------------
// Real page wiring (skipped under vitest / node: there is no window with a bridge)
// ---------------------------------------------------------------------------------------------

declare global {
  interface Window {
    penHid?: PenHidBridge
    /** Main calls this through executeJavaScript(..., userGesture = true): requestDevice needs a user gesture. */
    __penHidRequest?: () => Promise<void>
    /** Test hook: a pretend navigator.hid, set by the test harness before the "start" command. Never set in production. */
    __penHidTestHid?: HidLike
  }
}

if (typeof window !== "undefined" && window.penHid) {
  const bridge = window.penHid
  const nav = navigator as Navigator & { hid?: HidLike & { requestDevice(options: { filters: { vendorId: number }[] }): Promise<unknown> } }
  const env: HostEnv = {
    get hid() { return window.__penHidTestHid ?? nav.hid },
    requestDevice: (vendorIds) => {
      const hid = nav.hid
      if (!hid) return Promise.reject(new Error("navigator.hid is not available"))
      return hid.requestDevice({ filters: vendorIds.map((vendorId) => ({ vendorId })) })
    },
    now: () => Date.now(),
    timeOrigin: performance.timeOrigin,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  const host = wireHost(bridge, env)
  window.__penHidRequest = () => host.handle({ cmd: "request", vendorIds: [WACOM_VENDOR_ID] })
}
