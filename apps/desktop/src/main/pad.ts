/**
 * Pad mode, the window's half: full screen on the display the window is on,
 * and back again EXACTLY as it was. No Electron in here, so the decisions can
 * be tested; main.ts does what these say.
 *
 * What is remembered on the way in: the window's bounds, whether it was
 * maximised, whether it was already full screen (View ▸ Toggle Full Screen),
 * and the menu bar's two settings. What is done on the way out follows from
 * that, so a window that was already full screen stays full screen, a
 * maximised one is maximised again, and a normal one gets its bounds back.
 */

export interface Bounds { x: number; y: number; width: number; height: number }

export interface WindowMemory {
  bounds: Bounds
  maximized: boolean
  fullScreen: boolean
  autoHideMenuBar: boolean
  menuBarVisible: boolean
}

export type EnterStep = "fullScreen" | "hideMenuBar"
export type ExitStep =
  | { step: "leaveFullScreen" }
  | { step: "maximize" }
  | { step: "bounds"; bounds: Bounds }
  | { step: "menuBar"; autoHide: boolean; visible: boolean }

/** What to do to go into the pad. */
export function planEnter(was: WindowMemory): EnterStep[] {
  return was.fullScreen ? ["hideMenuBar"] : ["fullScreen", "hideMenuBar"]
}

/**
 * What to do to leave it. `stillFullScreen` is whether the window is full
 * screen now: when the person (or Windows) already took it out of full screen,
 * leaving it is not asked for twice.
 */
export function planExit(was: WindowMemory, stillFullScreen: boolean): ExitStep[] {
  const steps: ExitStep[] = []
  if (!was.fullScreen && stillFullScreen) steps.push({ step: "leaveFullScreen" })
  if (!was.fullScreen) {
    steps.push(was.maximized ? { step: "maximize" } : { step: "bounds", bounds: was.bounds })
  }
  steps.push({ step: "menuBar", autoHide: was.autoHideMenuBar, visible: was.menuBarVisible })
  return steps
}
