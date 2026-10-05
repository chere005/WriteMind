/**
 * guardCore.ts - everything the guard process decides, as plain logic over injected ports, so that every release rule is a
 * unit test with a fake clock and a fake OS (guard.ts is the thin process shell that wires the real ones).
 *
 * WHAT THE GUARD IS FOR. Two kinds of OS state outlive the process that created them: a cursor-clip rectangle and a Wintab
 * context (measured, docs/spikes/wacom-containment.md and wacom-wintab.md). If the app is killed, crashes or hangs while
 * holding one, the person is left with a mouse that cannot leave a rectangle, or a driver context that is never closed.
 * So the app never owns them alone: a small DETACHED process holds them with the app, and lets go on its own when
 *
 *   - stdin closes (the app died: ~14 ms after kill -9, measured),
 *   - the app stops sending `beat` (a hang: 800 ms for a clip or a system context, 5 s for a harmless data context),
 *   - the app's pid is gone (a belt for an inherited pipe that never closes),
 *   - `free` / `quit` arrive (the normal path),
 *   - the person presses the panic chord Ctrl+Alt+G (the guard reads the key state by itself, so this works even when the
 *     app is frozen, and does not need a window, a hook or the focus).
 *
 * RULES THAT CANNOT BE RELAXED:
 *   - A clip is released ONLY if the OS still reports the rectangle this guard set (never somebody else's clip).
 *   - A Wintab handle is closed ONLY if WTGetW reports the name "WriteMind pen <appPid>" (never a handle that cannot be
 *     identified: the Wintab spike once closed one of the driver's own contexts by guessing, and this rule exists because
 *     of it).
 *   - Nothing here moves the cursor, injects input or hooks anything.
 */

import {
  DATA_LEASE_MS, DEFAULT_LEASE_MS, parseGuardCommand, rectsEqual, staleClipDecision, validateClipRect, wintabMarker,
  type GuardCommand, type LeaseJournal, type Rect, type Win32Clip, type WintabMode,
} from "./clip"

export interface WintabPort {
  /** The context's name (lcName) if `handle` is a live context, else null. */
  name(handle: string): string | null
  /** Close the context. true = the driver reported success. */
  close(handle: string): boolean
}

export interface GuardPorts {
  clip: Win32Clip
  wintab: WintabPort
  now(): number
  /** One stdout line. Must never throw. */
  out(line: string): void
  /** Persist what is held (null = nothing is held: delete the file). Failures are swallowed by the port. */
  journal(j: LeaseJournal | null): void
  /** True while the panic chord is physically down. */
  panicChordDown(): boolean
  pidAlive(pid: number): boolean
  /** End the process (after a release). */
  exit(code: number): void
  log?(line: string): void
}

export const MAX_HELD_HANDLES = 64

interface Held { mode: WintabMode; appPid: number; since: number }

export class GuardCore {
  private rect: Rect | null = null
  private clipLeaseMs = DEFAULT_LEASE_MS
  private lastBeat = 0
  private held = new Map<string, Held>()
  private chordLatched = false
  private done = false

  constructor(private readonly p: GuardPorts, readonly guardPid: number, readonly appPid: number) {
    this.lastBeat = p.now()
  }

  holding(): boolean { return this.rect !== null || this.held.size > 0 }
  clipRect(): Rect | null { return this.rect }
  heldHandles(): string[] { return [...this.held.keys()] }
  finished(): boolean { return this.done }

  private log(s: string): void { try { this.p.log?.(s) } catch { /* optional */ } }
  private say(s: string): void { this.log(`out ${s}`); try { this.p.out(s) } catch { /* the parent is gone */ } }

  private writeJournal(): void {
    try {
      if (!this.holding()) { this.p.journal(null); return }
      this.p.journal({
        guardPid: this.guardPid, appPid: this.appPid, clip: this.rect,
        wintab: [...this.held.entries()].map(([handle, h]) => ({ handle, mode: h.mode })), at: this.p.now(),
      })
    } catch { /* a journal is a convenience */ }
  }

  // ---- clip

  private arm(r: Rect, lease: number): void {
    const screen = this.p.clip.screen()
    // Re-check what the app already checked: this process is the last line.
    const v = validateClipRect(r, screen)
    if (!v.ok || !rectsEqual(v.rect, r)) { this.say("err bad-rect"); return }
    const cur = this.p.clip.getClip()
    if (this.rect && !rectsEqual(cur, this.rect)) { this.say("foreign arm"); this.rect = null; this.writeJournal(); return }
    if (!this.rect && !rectsEqual(cur, screen)) { this.say("foreign arm"); return } // somebody else's clip: do not fight it
    const before = this.rect
    this.rect = r // journal first: a crash between the journal and the clip must still be swept
    this.writeJournal()
    let ok = false
    try { ok = this.p.clip.setClip(r) } catch { ok = false }
    if (!ok) { this.rect = before; this.writeJournal(); this.say("err clip-failed"); return }
    this.clipLeaseMs = lease
    this.lastBeat = this.p.now()
    this.say(`armed ${r.left} ${r.top} ${r.right} ${r.bottom}`)
  }

  private releaseClip(why: string): boolean {
    const r = this.rect
    if (!r) return false
    let mine = false
    try {
      mine = rectsEqual(this.p.clip.getClip(), r)
      if (mine) this.p.clip.setClip(null)
    } catch (e) { this.log(`release threw: ${(e as Error).message}`) }
    this.rect = null
    this.writeJournal()
    this.say(mine ? `freed ${why}` : `foreign ${why}`) // foreign = somebody else changed the clip meanwhile; left alone
    return true
  }

  // ---- wintab

  private closeWintab(handle: string, why: string): void {
    const h = this.held.get(handle)
    this.held.delete(handle)
    if (!h) return
    let result = "gone"
    try {
      const name = this.p.wintab.name(handle)
      if (name === null) result = "gone"
      else if (name !== wintabMarker(h.appPid)) result = "not-ours" // positively identified or left alone
      else result = this.p.wintab.close(handle) ? why : "close-failed"
    } catch (e) { result = "error"; this.log(`wintab close threw: ${(e as Error).message}`) }
    this.writeJournal()
    this.say(`closed-wintab ${handle} ${result}`)
  }

  // ---- the public surface

  /** Let go of everything now, whatever its state. Never throws. */
  releaseAll(why: string): void {
    this.releaseClip(why)
    for (const handle of [...this.held.keys()]) this.closeWintab(handle, why)
    this.writeJournal()
  }

  handleLine(line: string): void {
    if (this.done) return
    const c: GuardCommand | null = parseGuardCommand(line)
    if (!c) { if (line.trim()) this.say("err bad-command"); return }
    switch (c.cmd) {
      case "arm": this.arm(c.rect, c.leaseMs); break
      case "beat": this.lastBeat = this.p.now(); break
      case "free": if (!this.releaseClip("free")) this.say("freed none"); break
      case "hold-wintab":
        if (this.held.size >= MAX_HELD_HANDLES && !this.held.has(c.handle)) { this.say("err too-many-handles"); break }
        this.held.set(c.handle, { mode: c.mode, appPid: c.appPid, since: this.p.now() })
        this.lastBeat = this.p.now() // registering counts as a sign of life
        this.writeJournal()
        this.say(`held-wintab ${c.handle} ${c.mode}`)
        break
      case "drop-wintab": // the app closed it itself
        if (this.held.delete(c.handle)) this.writeJournal()
        break
      case "status":
        this.say(`status clip ${this.rect ? `${this.rect.left} ${this.rect.top} ${this.rect.right} ${this.rect.bottom} lease-left ${Math.max(0, this.clipLeaseMs - (this.p.now() - this.lastBeat))}` : "none"} wintab ${this.held.size}`)
        break
      case "quit": this.bye("quit"); break
    }
  }

  /** Called every ~50 ms by the shell. */
  tick(): void {
    if (this.done) return
    const now = this.p.now()
    // The independent panic chord: only meaningful while something is held, and latched so one press is one release.
    let down = false
    try { down = this.p.panicChordDown() } catch { down = false }
    if (down && !this.chordLatched) {
      this.chordLatched = true
      if (this.holding()) { this.say("panic-key"); this.releaseAll("panic-key") }
    } else if (!down) this.chordLatched = false

    if (this.rect && now - this.lastBeat > this.clipLeaseMs) { this.releaseClip("lease"); this.say("expired") }
    for (const [handle, h] of [...this.held.entries()]) {
      const lease = h.mode === "system" ? DEFAULT_LEASE_MS : DATA_LEASE_MS
      if (now - this.lastBeat > lease) { this.closeWintab(handle, "lease"); this.say("expired") }
    }
    if (this.appPid > 0 && !this.p.pidAlive(this.appPid)) this.bye("app-dead")
  }

  /** stdin closed: the app is gone. */
  eof(): void { this.bye("eof") }

  /** Release everything and end the process. Idempotent. */
  bye(why: string): void {
    if (this.done) return
    try { this.releaseAll(why) } catch { /* nothing more to do */ }
    this.done = true
    try { this.p.exit(0) } catch { /* nothing */ }
  }

  /** The process is exiting for a reason we did not see coming: release synchronously, say nothing. */
  lastGasp(): void {
    try {
      if (this.rect && rectsEqual(this.p.clip.getClip(), this.rect)) this.p.clip.setClip(null)
      for (const [handle, h] of this.held) {
        if (this.p.wintab.name(handle) === wintabMarker(h.appPid)) this.p.wintab.close(handle)
      }
    } catch { /* last gasp */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The sweep: run at launch, before anything arms. Undoes what a previous run left behind, and only that.
// ---------------------------------------------------------------------------------------------------------------

export interface SweepReport {
  /** "none" = no journal; "alive" = the previous owner still runs, nothing touched; "swept" = the journal was stale. */
  journal: "none" | "alive" | "swept"
  clip: "none" | "released" | "left"
  wintabClosed: string[]
  wintabSkipped: { handle: string; why: string }[]
}

export function sweepJournal(
  j: LeaseJournal | null,
  ports: { clip: Win32Clip; wintab: WintabPort; pidAlive(pid: number): boolean },
  selfPid: number,
): SweepReport {
  const report: SweepReport = { journal: "none", clip: "none", wintabClosed: [], wintabSkipped: [] }
  if (!j) return report
  // If either the app or its guard still runs, the journal is LIVE: it is not ours to undo.
  if ((j.appPid !== selfPid && ports.pidAlive(j.appPid)) || (j.guardPid !== selfPid && ports.pidAlive(j.guardPid))) {
    report.journal = "alive"
    return report
  }
  report.journal = "swept"
  if (j.clip) {
    const d = staleClipDecision({ rect: j.clip }, ports.clip.getClip(), ports.clip.screen())
    if (d === "release") { ports.clip.setClip(null); report.clip = "released" } else report.clip = d === "leave" ? "left" : "none"
  }
  for (const w of j.wintab) {
    const name = ports.wintab.name(w.handle)
    if (name === null) { report.wintabSkipped.push({ handle: w.handle, why: "gone" }); continue }
    if (name !== wintabMarker(j.appPid)) { report.wintabSkipped.push({ handle: w.handle, why: "not-ours" }); continue }
    if (ports.wintab.close(w.handle)) report.wintabClosed.push(w.handle)
    else report.wintabSkipped.push({ handle: w.handle, why: "close-failed" })
  }
  return report
}
