/**
 * hid/fromWebHid.ts - WebHID collection metadata (HIDCollectionInfo -> inputReports[] -> items[]) -> the neutral HidLayout.
 *
 * Written against the SHAPE of the real WebHID objects (checked on a real device in the webhid spike): an item's usages are
 * `usagePage << 16 | usage` (values <= 0xFFFF are taken to be on the collection's own page), padding items are
 * `isConstant`, and a report's `data` has NO leading id byte. Fields are packed little-endian by bit in descriptor order,
 * `reportSize` bits each, `reportCount` of them per item.
 *
 * Pure: no DOM, no Electron, no koffi. The helper page and node tests both use it.
 */

import { fixRange, penScore, roleOf, type HidField, type HidLayout, type HidReport } from "./layout"

export interface HidReportItemLike {
  isConstant?: boolean
  isArray?: boolean
  isRange?: boolean
  hasNull?: boolean
  logicalMinimum: number
  logicalMaximum: number
  physicalMinimum?: number
  physicalMaximum?: number
  reportSize: number
  reportCount: number
  usages?: readonly number[]
  usageMinimum?: number
  usageMaximum?: number
}
export interface HidReportInfoLike {
  reportId: number
  items?: readonly HidReportItemLike[]
}
export interface HidCollectionInfoLike {
  usagePage: number
  usage: number
  type?: number
  children?: readonly HidCollectionInfoLike[]
  inputReports?: readonly HidReportInfoLike[]
}

export function splitUsage(value: number, fallbackPage: number): { page: number; usage: number } {
  if (value > 0xffff) return { page: (value >>> 16) & 0xffff, usage: value & 0xffff }
  return { page: fallbackPage, usage: value }
}

function walk(c: HidCollectionInfoLike, visit: (c: HidCollectionInfoLike) => void): void {
  visit(c)
  for (const child of c.children ?? []) walk(child, visit)
}

/**
 * Compile collections (and their children, in descriptor order) into one neutral layout. The same report id described in
 * several collections continues its bit offsets where the previous one stopped (an approximation: WebHID does not say how
 * items of one report interleave across collections, but real pens put them all in the Stylus collection).
 */
export function layoutFromWebHid(collections: readonly HidCollectionInfoLike[]): HidLayout {
  const reports = new Map<number, HidReport>()
  const offsets = new Map<number, number>()
  const first = collections[0]
  for (const top of collections) {
    walk(top, (col) => {
      for (const report of col.inputReports ?? []) {
        let offset = offsets.get(report.reportId) ?? 0
        const fields: HidField[] = []
        for (const item of report.items ?? []) {
          const size = item.reportSize | 0
          const count = item.reportCount | 0
          if (item.isConstant || item.isArray) {
            offset += size * count // padding / index arrays: skipped, but they occupy bits
            continue
          }
          for (let i = 0; i < count; i++) {
            let raw: number | undefined
            if (item.isRange && item.usageMinimum !== undefined) raw = item.usageMinimum + i
            else if (item.usages && item.usages.length) raw = item.usages[Math.min(i, item.usages.length - 1)]
            const { page, usage } = raw === undefined ? { page: 0, usage: 0 } : splitUsage(raw, col.usagePage)
            const role = raw === undefined ? null : roleOf(page, usage)
            const [min, max] = fixRange(item.logicalMinimum, item.logicalMaximum, size)
            const noPhys = (item.physicalMinimum ?? 0) === 0 && (item.physicalMaximum ?? 0) === 0
            fields.push({
              page, usage, role, bitOffset: offset, bitSize: size, signed: item.logicalMinimum < 0,
              min, max, physMin: noPhys ? min : item.physicalMinimum ?? min, physMax: noPhys ? max : item.physicalMaximum ?? max,
              hasNull: !!item.hasNull,
            })
            offset += size
          }
        }
        offsets.set(report.reportId, offset)
        if (!fields.some((f) => f.role)) continue
        const prior = reports.get(report.reportId)
        if (prior) { prior.fields.push(...fields); prior.bitLength = Math.max(prior.bitLength, reach(fields)) }
        else reports.set(report.reportId, { reportId: report.reportId, bitLength: reach(fields), fields })
      }
    })
  }
  const list = [...reports.values()]
  return {
    source: "webhid",
    usagePage: first?.usagePage ?? 0,
    usage: first?.usage ?? 0,
    hasReportIds: list.some((r) => r.reportId !== 0),
    reports: list,
  }
}

/** Bits the role-bearing fields reach (a trailing pad is not demanded of a short report). */
function reach(fields: readonly HidField[]): number {
  let n = 0
  for (const f of fields) if (f.role) n = Math.max(n, f.bitOffset + f.bitSize)
  return n
}

/** How pen-like a collection tree is: 0 = not usable (the best of its top-level collections). */
export function penScoreOfCollections(collections: readonly HidCollectionInfoLike[]): number {
  let best = 0
  for (const c of collections) best = Math.max(best, penScore(layoutFromWebHid([c])))
  return best
}

/** Plain-JSON copy of WebHID collection metadata (its objects are not JSON.stringify-able). */
export function describeCollections(collections: readonly HidCollectionInfoLike[] | undefined): HidCollectionInfoLike[] {
  const item = (i: HidReportItemLike): HidReportItemLike => ({
    isConstant: i.isConstant, isArray: i.isArray, isRange: i.isRange, hasNull: i.hasNull,
    logicalMinimum: i.logicalMinimum, logicalMaximum: i.logicalMaximum,
    physicalMinimum: i.physicalMinimum, physicalMaximum: i.physicalMaximum,
    reportSize: i.reportSize, reportCount: i.reportCount,
    usages: i.usages ? Array.from(i.usages) : undefined,
    usageMinimum: i.usageMinimum, usageMaximum: i.usageMaximum,
  })
  const col = (c: HidCollectionInfoLike): HidCollectionInfoLike => ({
    usagePage: c.usagePage, usage: c.usage, type: c.type,
    children: Array.from(c.children ?? []).map(col),
    inputReports: Array.from(c.inputReports ?? []).map((r) => ({ reportId: r.reportId, items: Array.from(r.items ?? []).map(item) })),
  })
  return Array.from(collections ?? []).map(col)
}
