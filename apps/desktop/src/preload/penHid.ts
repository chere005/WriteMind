/**
 * preload/penHid.ts - the preload of the WebHID helper window (bundled to out/preload/pen-hid.cjs by scripts/build.mjs).
 * docs/spikes/DESIGN-pen-capture.md 4.4. Owner: IMPL-B.
 *
 * A bridge and nothing else: the WebHID code runs in the page's own world (webhid/hostPage.ts, as in the spike that was verified on the
 * real Wacom), and this file only gives it `window.penHid` to hand samples / raw reports / status to main and to receive commands.
 * Commands that arrive before the page has registered its listener are kept (the last few) and delivered when it does.
 */

import { contextBridge, ipcRenderer } from "electron"
import { HID_CHANNELS } from "../main/pen/webhid/protocol"
import type { HidCommand, HidHostStatus, HidRawRecord } from "../main/pen/webhid/protocol"
import type { PenSample } from "../shared/pen"

type CommandListener = (command: HidCommand) => void

let listener: CommandListener | null = null
const pending: HidCommand[] = []

ipcRenderer.on(HID_CHANNELS.command, (_event, command: HidCommand) => {
  if (listener) listener(command)
  else {
    pending.push(command)
    if (pending.length > 8) pending.shift()
  }
})

contextBridge.exposeInMainWorld("penHid", {
  samples: (batch: PenSample[]): void => { ipcRenderer.send(HID_CHANNELS.samples, batch) },
  raw: (records: HidRawRecord[]): void => { ipcRenderer.send(HID_CHANNELS.raw, records) },
  status: (status: HidHostStatus): void => { ipcRenderer.send(HID_CHANNELS.status, status) },
  onCommand: (cb: CommandListener): void => {
    listener = cb
    for (const command of pending.splice(0)) cb(command)
  },
})
