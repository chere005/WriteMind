/**
 * What `decodeDrawing` does not understand, kept (docs/SPEC-WM.md 3.6): a drawing written by a newer WriteMind, or by
 * anything else, has fields, items and a top-level key this build never heard of, and the model it decodes into has
 * nowhere to put them. Dropping them on the next save would quietly take work away from a note that still opens, so
 * the save goes through `keepUnknown`: the JSON the model WRITES, merged with the JSON the file HAD.
 *
 * - every unknown field of an item (a cell included) and every unknown top-level key comes back, same key, same value;
 * - an item of a kind this build does not know, a stroke with no points, a `null` and anything else that is not an
 *   item stays in the list, in its place (after the item that was before it), as opaque JSON;
 * - a shape of an unknown `shapeKind` (a hexagon) is drawn as a rectangle, and its own word is written back.
 *
 * The merge is by item `id`: an item the model dropped (deleted) takes its unknown fields with it; one that is new has
 * none. A neighbour's edit or reordering moves nothing that is opaque away from the item it followed.
 *
 * Pure: strings in, string out.
 */

import { isShapeKind } from "./shapes"

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
/** Whether `object` has `key` of its OWN: `in` also finds `constructor`, `toString`, `valueOf` and the rest of Object.prototype. */
const has = (object: object, key: string): boolean => Object.hasOwn(object, key)
/** `object[key] = value` that is safe for ANY key: `__proto__` set by assignment sets the prototype and drops the key. */
const put = (object: Json, key: string, value: unknown): void => {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
}

/** The fields this build reads and writes on each kind of item (everything else is unknown). */
const KNOWN: Record<string, ReadonlySet<string>> = {
  stroke: new Set(["id", "kind", "colorHex", "width", "points", "pressures", "transform", "group"]),
  image: new Set(["id", "kind", "file", "center", "width", "aspect", "transform", "hidden", "group"]),
  shape: new Set(["id", "kind", "shapeKind", "kindName", "center", "width", "aspect", "colorHex", "lineWidth", "fillHex",
    "label", "transform", "group"]),
  connector: new Set(["id", "kind", "start", "end", "startNode", "endNode", "startHead", "endHead", "line", "colorHex",
    "lineWidth", "transform", "bends", "overrides"]),
  cell: new Set(["id", "kind", "aspect", "items"]),
}

/** The kind a raw item reads as when this build can use it, else null (opaque). `nested`: inside a cell, where a cell is no item. */
function usableKind(raw: unknown, fromStrokes: boolean, nested: boolean): string | null {
  if (!isRecord(raw)) return null
  if (fromStrokes) return list(raw.points).length > 0 ? "stroke" : null
  const kind = typeof raw.kind === "string" ? raw.kind : ""
  if (kind === "stroke") return list(raw.points).length > 0 ? "stroke" : null
  if (kind === "image" || kind === "shape" || kind === "connector") return kind
  if (kind === "cell" && !nested) return "cell"
  return null
}

interface Slot { raw: unknown; opaque: boolean; id: string | null }

/** `next` (an array of items the model wrote) with what `before` (the list the file had) held that the model could not. */
function mergeItems(before: unknown[], strokes: number, next: unknown[], nested: boolean): unknown[] {
  // The previous items, by id, for the ones this build reads.
  const known = new Map<string, Json>()
  const prior: { raw: unknown; kind: string | null; id: string | null }[] = before.map((raw, at) => {
    const kind = usableKind(raw, at < strokes, nested)
    const id = kind !== null && isRecord(raw) && typeof raw.id === "string" ? raw.id : null
    if (id !== null && kind !== null && !known.has(id)) known.set(id, raw as Json)
    return { raw, kind, id }
  })

  const out: Slot[] = next.map((item) => {
    const id = isRecord(item) && typeof item.id === "string" ? item.id : null
    return { raw: id !== null && known.has(id) ? carry(known.get(id)!, item as Json, nested) : item, opaque: false, id }
  })

  // The items that were not usable go back after the item that was before them.
  const present = new Set(out.map((slot) => slot.id))
  let anchor: string | null = null
  for (const one of prior) {
    if (one.kind !== null) { if (one.id !== null && present.has(one.id)) anchor = one.id; continue }
    const slot: Slot = { raw: one.raw, opaque: true, id: null }
    let at = anchor === null ? 0 : out.findIndex((other) => !other.opaque && other.id === anchor) + 1
    while (at < out.length && out[at]!.opaque) at++
    out.splice(at, 0, slot)
  }
  return out.map((slot) => slot.raw)
}

/** One item the model wrote, with the unknown fields (and the unknown shape word) of the same item from the file. */
function carry(old: Json, item: Json, nested: boolean): Json {
  const kind = typeof item.kind === "string" ? item.kind : ""
  const known = has(KNOWN, kind) ? KNOWN[kind] : undefined
  if (!known) return item
  const out: Json = { ...item }
  for (const [key, value] of Object.entries(old)) {
    if (!known.has(key) && !has(out, key)) put(out, key, value)
  }
  if (kind === "shape") {
    const word = old.shapeKind ?? old.kindName
    if (typeof word === "string" && !isShapeKind(word) && item.shapeKind === "rectangle") out.shapeKind = word
  }
  if (kind === "cell" && !nested) {
    out.items = mergeItems(list(old.items), 0, list(item.items), true)
  }
  return out
}

/**
 * `next` (a drawing's JSON as `writeDrawing` made it) with everything `previous` (the JSON the file held) had that the
 * model does not carry. When `previous` is missing or is not a drawing, `next` as it is.
 */
export function keepUnknown(previous: string | null, next: string): string {
  if (previous === null) return next
  let before: unknown
  let after: unknown
  try {
    before = JSON.parse(previous.charCodeAt(0) === 0xfeff ? previous.slice(1) : previous)
    after = JSON.parse(next)
  } catch { return next }
  if (!isRecord(before) || !isRecord(after)) return next
  const strokes = list(before.strokes)
  const merged = mergeItems([...strokes, ...list(before.items)], strokes.length, list(after.items), false)
  const out: Json = { ...after, items: merged }
  for (const [key, value] of Object.entries(before)) {
    if (key === "items" || key === "strokes" || has(out, key)) continue
    put(out, key, value)
  }
  return JSON.stringify(out, null, 1)
}
