/**
 * main/pen/log.ts - pen.log in userData: the one diagnostic. State transitions and errors (one JSON line each), and the first
 * RAW_LIMIT raw packets of a session so a decoder that disagrees with a real tablet can be fixed from the file. Nothing else:
 * no samples, no UI. Capped (LINE_LIMIT lines a session) so it can never grow; the previous session's file is kept as pen.log.1.
 */

import fs from "node:fs"
import type { BackendName, TraceSink } from "../../shared/pen"

export const RAW_LIMIT = 50
export const LINE_LIMIT = 2000
/** The last lines of the cap are kept for errors, failures and refusals: ordinary lines stop LINE_RESERVE short of it. */
export const LINE_RESERVE = 200
const IMPORTANT = /error|fail|refus|unavailable|starv/i

export interface PenLog extends TraceSink {
  /** The path of the file. */
  readonly path: string
  /** Everything written this session (tests). */
  lines(): string[]
  close(): void
}

export function createPenLog(file: string, write: (line: string) => void = () => {}): PenLog {
  let rawn = 0
  let n = 0
  const memory: string[] = []
  let fd: number | null = null
  const open = (): void => {
    if (fd !== null || !file) return
    try {
      try { fs.renameSync(file, `${file}.1`) } catch { /* no previous log */ }
      fd = fs.openSync(file, "w")
    } catch { fd = null }
  }
  const put = (record: Record<string, unknown>, important = false): void => {
    if (n >= (important ? LINE_LIMIT : LINE_LIMIT - LINE_RESERVE)) return
    n++
    const line = JSON.stringify(record)
    if (memory.length < 400) memory.push(line)
    open()
    if (fd !== null) { try { fs.writeSync(fd, line + "\n") } catch { /* a log never breaks the pen */ } }
  }
  return {
    path: file,
    event(source: BackendName | "manager", name: string, data?: Record<string, unknown>): void {
      const important = IMPORTANT.test(name)
      put({ t: Math.round(Date.now()), s: source, e: name, ...(data ? { d: data } : {}) }, important)
      if (important) write(`${source} ${name} ${data ? JSON.stringify(data) : ""}`)
    },
    raw(backend: BackendName, t: number, hex: string, note?: string): void {
      if (rawn >= RAW_LIMIT) return
      rawn++
      put({ t: Math.round(t), s: backend, e: "raw", n: rawn, hex, ...(note ? { note } : {}) })
    },
    lines: () => [...memory],
    close() { if (fd !== null) { try { fs.closeSync(fd) } catch { /* closed */ } fd = null } },
  }
}
