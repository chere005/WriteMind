/**
 * A drawing as the Mac app wrote it, in the shape this app reads.
 *
 * The two sidecars are the same drawing in two spellings. The Mac's
 * (`CanvasItem`'s hand-written Codable in `Drawing.swift`) nests each object
 * under its kind and writes a point as `[x, y]`:
 *
 *     {"items":[{"kind":"stroke","stroke":{"colorHex":"#2FBF71","width":2,"points":[[0.1,0.1],[0.2,0.2]]}},
 *               {"kind":"shape","shape":{"kind":"rectangle","center":[0.5,0.5], …}}]}
 *
 * This app's (`writeDrawing` in the core) is flat, with a point as `{x, y}`
 * and a shape's own kind called `shapeKind`. A notebook made on the Mac and
 * added to a project here is read through this, so its drawings show up; it
 * is READ ONLY: the Mac's file is never written, because the Mac cannot read
 * ours back and would go on to save over it.
 */

type Json = Record<string, unknown>

const KINDS = ["stroke", "image", "shape", "connector"] as const

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** `[x, y]` (a Swift CGPoint) as `{x, y}`; anything else as it was. */
const point = (value: unknown): unknown =>
  Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number"
    ? { x: value[0], y: value[1] } : value

const points = (value: unknown): unknown => (Array.isArray(value) ? value.map(point) : value)

function flatten(item: unknown): unknown {
  if (!isObject(item)) return item
  const kind = item.kind
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return item
  const inner = item[kind]
  // Already flat (this app's own spelling): nothing to undo.
  if (!isObject(inner)) return item
  switch (kind) {
    case "stroke":
      return { ...inner, kind, points: points(inner.points) }
    case "image":
      return { ...inner, kind, center: point(inner.center) }
    case "shape":
      // Both the item and the shape are "kind": the shape's own is kept as `shapeKind`.
      return { ...inner, kind, shapeKind: inner.kind, center: point(inner.center) }
    default:
      return {
        ...inner, kind, start: point(inner.start), end: point(inner.end), bends: points(inner.bends),
      }
  }
}

/**
 * The sidecar text the Mac wrote, as this app's sidecar text; null when the
 * text is not a drawing at all. The oldest Mac sidecars hold a bare `strokes` list.
 */
export function fromMacDrawing(text: string): string | null {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!isObject(parsed)) return null
  const items: unknown[] = Array.isArray(parsed.items)
    ? parsed.items.map(flatten)
    : Array.isArray(parsed.strokes)
      ? parsed.strokes.map((stroke) => (isObject(stroke) ? { ...stroke, kind: "stroke", points: points(stroke.points) } : stroke))
      : []
  return JSON.stringify({ items }, null, 1)
}

/** The image file names a sidecar mentions, so a note's pictures can follow it. */
export function pictureFiles(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { items?: unknown[] }
    const found: string[] = []
    for (const item of parsed.items ?? []) {
      if (!isObject(item) || item.kind !== "image") continue
      const inner = isObject(item.image) ? item.image : item
      if (typeof inner.file === "string" && inner.file !== "") found.push(inner.file)
    }
    return found
  } catch {
    return []
  }
}
