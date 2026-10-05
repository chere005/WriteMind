/**
 * The tablet's orientation, remembered (the Mac keeps `cameraRotation` the same
 * way: a quarter-turn setting in the defaults). The arithmetic is
 * shared/orientation.ts; this is the stored choice and a hook to read it.
 */

import { useSyncExternalStore } from "react"
import { parseOrientation, turnsOf, type Orientation, type Turns } from "../shared/orientation"

export const ORIENTATION_KEY = "writemind.orientation"

function load(): Orientation {
  try { return parseOrientation(localStorage.getItem(ORIENTATION_KEY)) } catch { return 0 }
}

let current: Orientation = load()
const listeners = new Set<() => void>()

export const orientation = (): Orientation => current
export const currentTurns = (): Turns => turnsOf(current)

export function setOrientation(next: Orientation): void {
  if (next === current) return
  current = next
  try { localStorage.setItem(ORIENTATION_KEY, String(next)) } catch { /* the choice lasts the session */ }
  listeners.forEach((listener) => listener())
}

export const subscribeOrientation = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The tablet's own shape (long side over short side, from Wintab), or null when no tablet is known. The sheet is the whole tablet, so it takes
 * THIS shape (turned by the orientation) rather than the screen's: a circle on the tablet is a circle on the sheet.
 */
let tabletShape: number | null = null
export const tabletAspect = (): number | null => tabletShape
export function setTabletAspect(aspect: number | null): void {
  const next = aspect !== null && aspect >= 1 && aspect < 5 ? aspect : null
  if (next === tabletShape) return
  tabletShape = next
  listeners.forEach((listener) => listener())
}

export const useOrientation = (): Orientation =>
  useSyncExternalStore(subscribeOrientation, orientation)
