/**
 * The open project, in the window: what the main process says it is (its
 * name, its file, its folders and the ones kept out of the sidebar), and what
 * to do when it changes.
 *
 * Another project (Open, New) is a SWITCH: the session of the one being left
 * is written under its own file while its tabs are still up, the tabs are
 * let go, and the other project's session comes back over its own tree. The
 * same project with other folders (Add, Remove, Hide, Show) changes only
 * the tree, and the notes the tree no longer holds are closed by the window
 * (the Mac's `reload` drops them from `openNoteIDs`). `switching` is true for
 * the length of a switch, so nothing closes tabs behind its back.
 */

import { useEffect, useRef, useState, type MutableRefObject } from "react"
import type { ProjectInfo, Section } from "./wm"

export interface SessionApi {
  flush(): void
  switchTo(tree: Section, file: string | null): Promise<void>
  renamed(file: string | null): void
}

interface Options {
  /** The session hook's handle, filled in once it exists (it needs the project's file, which this reads). */
  session: MutableRefObject<SessionApi | null>
  reload(): Promise<void>
  /** The sidebar tree's fingerprint, forgotten so the new tree is shown even if it looks the same. */
  lastTree: MutableRefObject<string>
}

export function useProject({ session, reload, lastTree }: Options) {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const switching = useRef(false)

  useEffect(() => {
    let live = true
    void window.wm.project().then((info) => { if (live) setProject(info) })
    const off = window.wm.onProject((kind, info) => {
      if (kind !== "switch") {
        if (kind === "saved") session.current?.renamed(info.file)
        setProject(info)
        return
      }
      switching.current = true
      // Synchronously, before anything else: the old project's tabs are still up.
      session.current?.flush()
      void (async () => {
        try {
          const tree = await window.wm.tree()
          await session.current?.switchTo(tree, info.file)
          lastTree.current = ""
          await reload()
        } finally {
          switching.current = false
          setProject(info)
        }
      })()
    })
    return () => { live = false; off() }
  }, [reload, lastTree, session])

  return { project, switching }
}
