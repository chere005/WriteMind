/**
 * The page's half of the application menu: it hears the keys the table in
 * `shared/commands.ts` gives to "page" and "main", hears the menu's clicks,
 * and tells the shell what the menu needs to know.
 *
 * ONE PRESS, ONE ACTION. The menu's accelerators are shown and not
 * registered, so a key reaches exactly one listener: CodeMirror's keymap
 * (the formatting keys — it calls preventDefault, and this listener then
 * stands down), `useUndo` (Ctrl+Z), or this. A key already handled is
 * `defaultPrevented` by the time it bubbles to the window.
 */

import { useEffect, useRef } from "react"
import { commandForKey, type MenuState } from "../shared/commands"
import { returnFocusSoon, watchChromeFocus } from "./focusReturn"

interface Options {
  platform: string
  /** Runs a command by id (a menu click, or a key the page owns). */
  run(id: string): void
  state: MenuState
}

export function useChrome({ platform, run, state }: Options): void {
  const latest = useRef(run)
  latest.current = run

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const command = commandForKey(event, platform)
      if (!command) return
      // A field being typed in has its own keys — except that the pen's keys
      // (an ExpressKey presses them) are heard with focus on a list or a tick
      // box, where the last click left it.
      const field = event.target instanceof Element ? event.target.closest("input, textarea, select") : null
      if (field && !(command.id.startsWith("pen") && !field.matches("textarea, input:not([type=checkbox], [type=color], [type=range], [type=button])"))) return
      event.preventDefault()
      // A held ExpressKey repeats; one press is one action.
      if (event.repeat && command.id.startsWith("pen")) return
      if (command.owner === "main") void window.wm.runMain(command.id)
      else latest.current(command.id)
      if (!command.id.startsWith("pen")) returnFocusSoon()
    }
    window.addEventListener("keydown", key)
    // A menu click: done, and then the caret is back in the notes (chrome never keeps the keyboard).
    const unlisten = window.wm.onMenuCommand((id) => {
      latest.current(id)
      if (!id.startsWith("pen")) returnFocusSoon()
    })
    const unwatch = watchChromeFocus()
    return () => {
      window.removeEventListener("keydown", key)
      unlisten()
      unwatch()
    }
  }, [platform])

  // The shell rebuilds the menu when this changes, and only then.
  const sent = useRef("")
  const json = JSON.stringify(state)
  useEffect(() => {
    if (json === sent.current) return
    sent.current = json
    void window.wm.setMenuState(state)
  }, [json, state])
}
