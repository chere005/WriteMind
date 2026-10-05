/**
 * hid/fromHidP.ts - Windows' own HID parser (hid.dll, probed by hidNative.probeLayout) -> the neutral HidLayout.
 *
 * The probe says, per report id, where every value field and every one-bit button sits in the report INCLUDING the
 * leading report-id byte (it diffs real HidP_SetUsageValue / HidP_SetUsages output). The neutral layout counts from the
 * start of the data AFTER the id byte, so the id byte's 8 bits come off when the device uses report ids.
 *
 * The probe's shape is plain JSON (a fixture of a real device is in test/fixtures/pen/ms-synth-pen.json).
 * Pure: no koffi here.
 */

import { fixRange, roleOf, type HidField, type HidLayout, type HidReport } from "./layout"

export interface ProbeValueField {
  page: number
  usage: number
  link?: number
  bitOffset: number
  bitSize: number
  signed: boolean
  logicalMin: number
  logicalMax: number
  physicalMin: number
  physicalMax: number
  units?: number
  unitsExp?: number
  hasNull: boolean
}

export interface ProbeButtonField {
  page: number
  usage: number
  link?: number
  bitOffset: number
}

export interface ProbeReport {
  reportId: number
  /** Bytes of one report including the id byte. */
  byteLength: number
  values: ProbeValueField[]
  buttons: ProbeButtonField[]
}

export interface ProbeLayout {
  usagePage: number
  usage: number
  hasReportIds: boolean
  reports: ProbeReport[]
}

export function layoutFromProbe(probe: ProbeLayout): HidLayout {
  const skip = probe.hasReportIds ? 8 : 0
  const reports: HidReport[] = probe.reports.map((r) => {
    const fields: HidField[] = []
    let reach = 0
    for (const v of r.values) {
      const [min, max] = fixRange(v.logicalMin, v.logicalMax, v.bitSize)
      const offset = v.bitOffset - skip
      if (offset < 0) continue
      const noPhys = v.physicalMin === 0 && v.physicalMax === 0
      fields.push({
        page: v.page, usage: v.usage, role: roleOf(v.page, v.usage),
        bitOffset: offset, bitSize: v.bitSize, signed: v.logicalMin < 0,
        min, max, physMin: noPhys ? min : v.physicalMin, physMax: noPhys ? max : v.physicalMax,
        hasNull: v.hasNull,
      })
      reach = Math.max(reach, offset + v.bitSize)
    }
    for (const b of r.buttons) {
      const offset = b.bitOffset - skip
      if (offset < 0) continue
      fields.push({
        page: b.page, usage: b.usage, role: roleOf(b.page, b.usage),
        bitOffset: offset, bitSize: 1, signed: false, min: 0, max: 1, physMin: 0, physMax: 1, hasNull: false,
      })
      reach = Math.max(reach, offset + 1)
    }
    fields.sort((a, b) => a.bitOffset - b.bitOffset)
    return { reportId: r.reportId, bitLength: reach, fields }
  })
  return { source: "hidp", usagePage: probe.usagePage, usage: probe.usage, hasReportIds: probe.hasReportIds, reports }
}
