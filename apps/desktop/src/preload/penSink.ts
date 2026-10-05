/**
 * The preload of the pen-sink window (docs/spikes/DESIGN-pen-capture.md 7.6). Bundled to out/preload/pen-sink.cjs by scripts/build.mjs.
 * The sink window is a different window from the notes window and gets this preload INSTEAD of the app's: it exposes
 * `window.wm.penSink` (the three private channels of PEN_SINK_CHANNELS, which main checks the sender of) and nothing else, so the
 * sink page cannot read a note or touch a file.
 */

import { contextBridge, ipcRenderer } from "electron"
import { PEN_SINK_CHANNELS, type PenSinkApi } from "../shared/pen"
import { SINK_STATE_CHANNEL } from "../shared/penSink"

const penSink: PenSinkApi & { onState(listener: (on: boolean) => void): () => void } = {
  pen: (reports) => ipcRenderer.send(PEN_SINK_CHANNELS.pen, reports),
  mouse: () => ipcRenderer.send(PEN_SINK_CHANNELS.mouse),
  beat: () => ipcRenderer.send(PEN_SINK_CHANNELS.beat),
  onState: (listener) => {
    const wrapped = (_event: unknown, state: { on?: unknown }): void => listener(state?.on === true)
    ipcRenderer.on(SINK_STATE_CHANNEL, wrapped)
    return () => { ipcRenderer.removeListener(SINK_STATE_CHANNEL, wrapped) }
  },
}

contextBridge.exposeInMainWorld("wm", { penSink })
