/**
 * `.wm` files for the tests, made and read with the app's own codec (not a test double of it): a note of text and
 * whatever entries a test wants in it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { MIMETYPE_BYTES, drawingOfFile, entriesToWrite, newWmFile, openWm, textOfFile, utf8, withEntry, type WmFile } from "@writemind/core"
import { readZip, zipBytes } from "../src/main/zip"

export interface WmExtras {
  /** `drawing.json`'s text. */
  drawing?: string
  /** Entries by name (`media/a.png`, `snapshots/ink-….svg`, `legacy/x`, anything): text or bytes. */
  entries?: Record<string, string | Uint8Array>
  /** The manifest's keys, over the defaults. */
  manifest?: Record<string, unknown>
}

export const APP = { name: "WriteMind", version: "2.16.0" }

/** The container for these words. */
export function wmFileOf(text: string, extras: WmExtras = {}, when: Date = new Date("2026-10-08T09:14:03Z")): WmFile {
  let file = newWmFile(when, APP, text)
  if (extras.drawing !== undefined) file = withEntry(file, "drawing.json", utf8(extras.drawing))
  for (const [name, data] of Object.entries(extras.entries ?? {})) file = withEntry(file, name, typeof data === "string" ? utf8(data) : data)
  if (extras.manifest) {
    const manifest = { ...file.manifest, ...extras.manifest } as WmFile["manifest"]
    file = { ...file, manifest, manifestData: utf8(JSON.stringify(manifest)), version: typeof manifest.version === "number" ? manifest.version : 1 }
    file = { ...file, readOnly: file.version > 1 }
  }
  return file
}

/** The bytes of a `.wm` holding these words. */
export function wmBytes(text: string, extras: WmExtras = {}, when?: Date): Buffer {
  const file = wmFileOf(text, extras, when)
  // (a file of a newer version is written as the test says: the writer of the model refuses it, so it is assembled here)
  const entries = file.readOnly
    ? [{ name: "mimetype", data: MIMETYPE_BYTES }, { name: "manifest.json", data: file.manifestData }, ...file.entries]
    : entriesToWrite(file, null).entries
  return zipBytes(entries, when ?? new Date("2026-10-08T09:14:03Z"))
}

/** Write a `.wm` (the folder is made); returns its path. */
export function writeWm(file: string, text: string, extras: WmExtras = {}, when?: Date): string {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, wmBytes(text, extras, when))
  return file
}

/** A `.wm` read back: its text, its drawing text, every entry's bytes by name, its manifest. */
export function readWm(file: string): {
  text: string; drawing: string | null; entries: Record<string, Buffer>; names: string[]; manifest: Record<string, unknown>
} {
  const read = readZip(readFileSync(file))
  const model = openWm(read)
  const entries: Record<string, Buffer> = {}
  for (const entry of read) entries[entry.name] = Buffer.from(entry.data)
  return { text: textOfFile(model), drawing: drawingOfFile(model), entries, names: read.map((entry) => entry.name), manifest: model.manifest }
}
