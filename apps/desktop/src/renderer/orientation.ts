/**
 * The tablet's orientation, remembered (the Mac keeps `cameraRotation` the same
 * way: a quarter-turn setting in the defaults). The arithmetic is
 * shared/orientation.ts; this is the stored choice and a hook to read it.
 */

import { useSyncExternalStore } from "react"
import { parseOrientation, turnsOf, type Orientation, type Turns } from "../shared/orientation"

export const ORIENTATION_KEY = "writemind.orientation"

function load(): Orientation {
  try { return parseOrientation(localStorage.getItem(ORIENTATION_KEY)) } catch { return "match" }
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

export const useOrientation = (): Orientation =>
  useSyncExternalStore(subscribeOrientation, orientation)
