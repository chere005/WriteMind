/**
 * THE MAC'S HOT EXIT, in the window (useSession.ts `restore`): text that was typed and never written is put back into its
 * file BEFORE the tabs are restored, so the tab opens on it. NOTHING TYPED IS DROPPED: text that cannot be applied — the
 * file refuses the write (a newer WriteMind's note, read-only, a full disk, changed under us), the copy beside it cannot be
 * made, or the note it was typed in is no longer a note of the project (a `.md` left as it was because it could not be
 * converted, a file that was deleted) — is kept as a Recovered copy (`rescue`: a `.wm` in the app's own data folder) instead.
 *
 * Reading each file first (the shell remembers what it read) is what lets the write guard accept the write. A file somebody
 * else changed since is NOT overwritten: the text is kept as `name (unsaved copy).wm` beside it, or in Recovered.
 */

import { bufferDecisions, type Session } from "@writemind/core"

/** What this needs of the shell (`window.wm`): a fake in a test. */
export interface HotExitApi {
  readNote(file: string): Promise<string>
  writeNote(file: string, text: string): Promise<{ written: boolean }>
  existing(files: string[]): Promise<string[]>
  rescue(file: string, text: string, kind?: "note" | "drawing"): Promise<string>
}

const keepApart = async (api: HotExitApi, file: string, text: string): Promise<void> => {
  try { await api.rescue(file, text, "note") } catch (error) { console.error("WriteMind: could not keep unsaved text of", file, error) }
}

/** The buffers put back into their files; returns the text that went in, by path. */
export async function applyBuffers(buffers: Session["unsavedBuffers"], api: HotExitApi): Promise<Map<string, string>> {
  const applied = new Map<string, string>()
  const paths = Object.keys(buffers)
  if (paths.length === 0) return applied
  const disk = new Map<string, string | null>()
  for (const path of paths) disk.set(path, await api.readNote(path).catch(() => null))
  for (const decision of bufferDecisions(buffers, (path) => disk.get(path) ?? null)) {
    try {
      // (`skip` is "the file already has this text" — or "the file cannot be read" (gone, no longer a note): the text then has nowhere to go.)
      if (decision.action === "skip" && disk.get(decision.path) === null) await keepApart(api, decision.path, buffers[decision.path]!.text)
      if (decision.action === "apply") {
        const out = await api.writeNote(decision.path, decision.text)
        if (out.written) applied.set(decision.path, decision.text)
        else {
          console.error("WriteMind: could not put the unsaved text back into", decision.path)
          await keepApart(api, decision.path, decision.text)
        }
      } else if (decision.action === "keep-copy") {
        const stemmed = decision.path.replace(/\.(wm|md|markdown|txt)$/i, "")
        const extension = decision.path.slice(stemmed.length)
        let copy = `${stemmed} (unsaved copy)${extension}`
        for (let n = 2; (await api.existing([copy])).length > 0 && n < 50; n++) {
          copy = `${stemmed} (unsaved copy ${n})${extension}`
        }
        const out = await api.writeNote(copy, decision.text)
        if (!out.written) await keepApart(api, decision.path, decision.text)
      }
    } catch (error) {
      console.error("WriteMind: could not bring back unsaved text", error)
      if (decision.action !== "skip") await keepApart(api, decision.path, decision.text)
    }
  }
  return applied
}

/**
 * The buffers of notes that are no longer notes of the project (`exists` says no): `surviving` drops them from the session,
 * so their text is kept as Recovered copies first. Returns the paths whose text was kept apart.
 */
export async function keepDropped(buffers: Session["unsavedBuffers"], exists: (path: string) => boolean, api: HotExitApi): Promise<string[]> {
  const kept: string[] = []
  for (const [path, buffer] of Object.entries(buffers)) {
    if (exists(path)) continue
    await keepApart(api, path, buffer.text)
    kept.push(path)
  }
  return kept
}
