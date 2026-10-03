/**
 * What a pressure-sensitive pen adds to a stroke: a width per point.
 *
 * A mouse reports no pressure, so a stroke without `pressures` is the same
 * even line it always was. A pen reports 0…1 and the stroke keeps one value
 * per point, in step with `points`. Half pressure draws at the pen's own
 * width, so choosing a width still means what it says.
 */

/** How much of the pen's width a pressure draws at. */
export function pressureScale(pressure: number): number {
  const p = Math.min(Math.max(Number.isFinite(pressure) ? pressure : 0.5, 0), 1)
  return 0.2 + 1.6 * p
}

/** The width at each point, or `null` for a stroke that has no pressure. */
export function widthsAlong(width: number, pressures: number[] | undefined, count: number): number[] | null {
  if (!pressures || pressures.length !== count || count === 0) return null
  return pressures.map((p) => width * pressureScale(p))
}

/** Pressures read back from a sidecar: numbers 0…1, or nothing. */
export function readPressures(value: unknown, count: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== count) return undefined
  if (!value.every((p) => typeof p === "number" && Number.isFinite(p))) return undefined
  return value.map((p: number) => Math.min(Math.max(p, 0), 1))
}
