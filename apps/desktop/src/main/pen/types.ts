/**
 * types.ts - the MAIN-PROCESS-ONLY half of the pen contract. May import Node; nothing here may be imported by the renderer.
 */

import type { Box, PenBackend } from "../../shared/pen"

/** All under app.getPath("userData"); built once by the subsystem and handed to everyone. */
export interface PenPaths {
  userData: string
  /** pen-state.json: the capture switch and the mapping verdict. Small. */
  state: string
  /** pen.log: state transitions, errors and the first raw packets of a session. */
  log: string
  /** wintab.journal.json: the handles this process opened, for recovery after a hard kill. */
  wintabJournal: string
}

/** Implemented by the system-mapped Wintab backend: where the sheet is (physical pixels, or null to give the pointer back). */
export interface SystemMapped {
  setSheetPhysical(rect: Box | null): void
}
export const isSystemMapped = (b: PenBackend): b is PenBackend & SystemMapped =>
  typeof (b as Partial<SystemMapped>).setSheetPhysical === "function"

export type CreateWintabBackend = (mode: "data" | "system", paths: PenPaths) => PenBackend
