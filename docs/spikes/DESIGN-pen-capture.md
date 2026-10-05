> **SUPERSEDED (2026-10-04, wr-demolish):** the overlay, sink, guard, clip, containment, Raw Input, WebHID, check wizard and trace UI described here were deleted; only the Wintab data backend and the window pen remain (docs/PARITY.md "Pen demolition"). Kept as history and as evidence of what the hardware does.

# DESIGN: native pen capture for the Tablet sheet (final)

Architect: `wdesign`, Wacom lane. Status: **FINAL, revision 3 (2026-10-04, midday CDT), ready for four implementers working in parallel.**
History. Revision 1 (2026-10-03 ~17:00, tablet dead) is what the implementers started from (17:47-17:57) before the usage limit stopped them.
Revision 2 (22:00-22:09) folded in the live tablet, the updated spikes, a probe of Windows' pointer stack and the state of the tree, but its file ended with
an unfilled placeholder and was never handed over. **Revision 3 (this file) is the audit of revision 2** against the tree as it is now, the four spike reports
(re-run by their lanes 2026-10-04 11:50-11:57), Sean's `grab.log` and saved window state, and the machine (re-read 12:13): it fixes what the audit found, changes one
policy (containment, section 7) and adds two safety nets (5.8, 4.2). **Nothing was renumbered**: the section numbers quoted in the code comments of the tree
(`design 4.7`, `8.4`, `9.3` ...) still point where they did. **Read the box "Revisions 2 and 3" below first: it says what changed and who must act.**
Inputs read: the four spike reports (`wacom-wintab.md`, `wacom-rawinput.md`, `wacom-webhid.md`, `wacom-containment.md`) and all of their scratch code under
`C:\CLAUDIO\spikes\`; Sean's `grab.log` and `window.json`; the current code (`main/grab.ts`, `main/penHook.ts`, `TabletSurface`, `CameraPane`, `penSettings`,
`penButtons`, `penActions`, `penCursor`, `penLive`, `tabletPage`, `tabletCapture`, `GrabOverlay`, `useGrabHost`, `shared/grab.ts`, `shared/orientation.ts`,
`PenMenu`, `main.ts`, `preload.ts`) and everything already written under `main/pen/`; `PARITY.md`, `TODO.md`, `TESTING.md`.

**Honesty line.** Nothing here has run against a MOVING pen: not one real stroke packet or report has been decoded by anything in this
design, and the tablet's behaviour while it is being written on is the one thing still unknown. What has been verified is the plumbing, on the real
device: the tablet was dead from the 15:28 CDT reboot on 2026-10-03 (`CM_PROB_FAILED_START`, problem 10) until it re-enumerated at 18:44:41;
since then `USB\VID_056A&PID_037A` and its four HID nodes are `OK` with problem code 0 and "Wacom Professional Service" is running (re-read read-only
on 2026-10-04 at 12:13; Wacom driver 6.4.14-1, router `WacHidRouterPro` 4.0.0.4). Every claim below is tagged **[verified]** (with what), **[inferred]**
or **[unverified]**. Because nobody can try hardware, the design's main job is to make every unknown *observable in one 20-second check* (section 9) and
*survivable if the answer is bad* (section 16 has an "if this is false, then" table). A baseline backend (`dom`, section 4.7) does not depend on any of the
unknowns coming out well, and the pen sink (7.6) is the only mechanism that can hold the pen to the sheet without help from the driver.

How this answers the brief: (1) the ladder and the liveness selector are sections 4 and 5; (2) the module layout and the four
implementers' disjoint files are section 12; (3) the interface types, IPC, and the E2E hook (`pen:inject`) are section 3; (4) the containment policy is
section 7; (5) the safety checklist and the no-pen test plan are sections 14 and 15.

### Revisions 2 and 3: what changed, and who must act

**State of the tree, measured 2026-10-04 12:05-12:20 CDT** (nothing under `main/pen/`, `shared/pen*.ts` or the pen tests has changed since 17:58 on 2026-10-03; other lanes' files have):

* `npm run typecheck`: exactly two errors, both in `lease.ts` (round 1 left it mid-edit: `sweepPending` is not imported, and `start()` can return `null` where a `Promise<boolean>` is declared).
* `npx vitest run`: 36 failures. 35 are ours: `lease.test.ts` 31 (all from those two lines), `penManager.test.ts` 3, `env.test.ts` 1 (causes and fixes in 12.7). One is the editor lane's (`notes.test.ts`, a duplicated note's drawing).
* About 6,600 lines under `main/pen/` plus `shared/pen.ts`, `shared/penEvents.ts`, `test/pen/*`, `test/penManager.test.ts`, `test/penEvents.test.ts`.
  **Real:** `backendCore`, `batcher`, `check`, `clip`, `env`, `fake`, `frame` (header still says STUB, the body is the A.1 sketch plus helpers), `guard` + `guardCore`, `lease` (broken), `manager` (1,300 lines), `state`, `sweep`, `trace`, `win32`, `winmsg`, `wintab` (the pure half), `hid/*` (layout, decoder, both producers, raw parsing, both natives).
  **Still the M0 stubs** ("STUB owned by IMPL-X: replace wholesale"): `wintabBackend`, `wintabNative`, `rawinputBackend`, `webhid/webhidBackend`, `pointerRange`, `containment`, `overlay`, `panic`.
  **Not started:** `domBackend`, `registry`, `ipc`, `diagnostics`, `replay`, the tools, everything in the renderer, the preload, the `main.ts` wiring, the e2e suites.
  **No tests yet** for the real pure modules `wintab`, `hid/*`, `batcher`, `frame`, `state`, `backendCore` (the spikes' tests have not been ported).
* The old Grab (`main/grab.ts` + `penHook.ts` + `GrabOverlay`) is still the live path in the built app (`out/main/main.mjs` was rebuilt at 12:03 with the `pen-guard.mjs` entry in it).
  `shared/pen.ts` and `main/pen/types.ts` are revision 1's section 3 plus one optional `TraceSink.record?`: **the contract delta below has not been applied.**

**What changed.** R1-R8 are revision 2 (the tree does not have them yet); R9-R20 are revision 3.

| # | Change | Why | Who acts |
|---|---|---|---|
| R1 | **New baseline backend `dom` ("Window pen", 4.7).** The pen events the notes window itself receives are taken by the gate, reported to main on `pen:dom`, converted to the screen frame, and fed to the sheet like any backend. Ranks between `webhid` and `overlay`. No native call, no extra window, no OS state. | It is the one source that needs no unknown to come out well: Windows Ink already delivers real pen pointer events to the page (the pointer stack lists the Wacom as two real pen devices, 1.1). If every native backend turns out silent, the whole tablet still drives the sheet over the part of the screen the window covers. | D (contract, `domBackend.ts`, gate, manager), B (check row) |
| R2 | **The gate is closed whenever capture is on** (8.4), not only while a feed is healthy. `LIVENESS.GATE_HOLD_MS` and `GATE_HOLD_CONTACT_MS` are deleted. Under `WRITEMIND_E2E` capture starts OFF; a test turns it on with `e2e.config({capture:true})`. | With R1 there is always a consumer for the events the gate swallows, so the "open when quiet" safety is not needed, the first event of a stroke is never doubled, and the gate loses its timers. The escape hatch is the capture switch / Ctrl+Alt+G, plus a self-opening if the synthesiser itself keeps throwing. | D |
| R3 | **HID rules from the real descriptors** (4.3, 4.4): one position stream per VID:PID (the "primary" report); `Col03` and `Col04` are one pen exposed twice; the vendor report 220 is traced and never decoded by default; the orientation guess uses PHYSICAL extents; `looksDriverMapped` is decided by device path (`Microsoft HID RID`), not by the logical maximum; WebHID shows ONE `HIDDevice` with three collections and no Pen collection. | The real Wacom (Raw Input and WebHID spikes): report ids 209 / 213 / 220, X/Y 0..32767 over 15200 x 9500, pressure 0..2047, tilt -9000..9000. Revision 1's range heuristic would have flagged the real Wacom as "driver-mapped" and the vendor heartbeat would have decoded as a pen at x = 0.013. | A (decoder, rawinput), B (WebHID) |
| R4 | **Pointer-stack facts in `env`** (7.6, 9.1): new optional `EnvSummary.pointerDevices`; the pointer-range witness ignores `Microsoft HID RID` devices. | Measured: the Wacom is two real pointer devices ("CTL-472", INTEGRATED_PEN and EXTERNAL_PEN, device rect 15201 x 9501 himetric mapped to the whole 1920 x 1200 display), next to a permanent synthetic `Microsoft HID RID\000D_0002\1` whose rect is screen-sized. | B (+ D for the contract field) |
| R5 | **Rules that `dom` makes necessary** (5.3, 5.4, 5.6): `stageStarts` guards the WebHID stage with `liveNative`, not `liveAny`; `persistWinner` skips `dom`, `overlay` and `inject`; a native backend that proves itself while `dom` has the tip down waits for pen-up. | Found by reading `manager.ts` against the new backend. | D, B |
| R6 | **Reach hint** (7.7), now P1 (see R16). | | C |
| R7 | **Evidence and numbers refreshed** (1.1, 4.1, 16, 17). | | none |
| R8 | **Module tables match the tree** (12). | | none |
| R9 | **Containment policy (7.2-7.7).** The **pen sink** is tried automatically ("auto-trial") and judges itself from what it observes; the **driver mapping** and **ClipCursor**, which leave OS state behind, stay earned (ready guard + proof). `GrabModes` is deleted: the sink's hit-testing follows authoritative pen signals, and a real mouse event always wins. | Sean's saved window is 1280 x 800 on a 1920 x 1200 display and not maximised (`window.json`, 1.1): with no mechanism armed about 60% of the tablet maps to the desktop or another program, so strays are the normal case, and the old Grab was on by default. A mechanism that dies with the process and is undone by any mouse event can be tried; only OS state that outlives the process needs a proof. | C (engine, sink), D (settings text, chip) |
| R10 | **Crash and hang breadcrumb (5.8, 11, 14.1)**: `inFlight` in `pen-state.json` is written before a native backend starts and cleared after 30 s of life; a leftover at launch switches that backend off with a note; kill switch `pen-off` / `WRITEMIND_PEN=off`. | No real packet or report has ever met this code in-process via koffi. A wrong size or a wedged driver call can crash or freeze the main process, and an app that dies every time the Tablet source opens is worse than an imprecise pen. | D (manager, state, registry), B (check row) |
| R11 | **FFI safety (4.2, 4.3, 14.1 #15-#16)**: buffers twice the computed size with a canary, struct sizes asserted against the driver's own numbers, `start()` yields between native steps and times each. | Same reason: `WTPacketsGet` and `GetRawInputData` write into memory sized by arithmetic nobody has compared with a real packet. | A |
| R12 | **Frame-settle rule (5.4, `LIVENESS.FRAME_SETTLE_MS`)**: a device-frame backend whose frame is still a guess does not take over from a live screen-frame backend until the frame is fitted, or 6 s have passed. | Revision 2 let a guessed-frame backend take over after 1.5 s, so the first stroke of a real run could have gone the wrong way round. | D |
| R13 | **Ownership rebalanced (12)**: `PenCheck.tsx` and `diagnostics.ts` go to B (it owns the check engine); `SheetStrip.tsx` and `SheetReach.tsx` go to C (it ports the strip out of the overlay it replaces); A owns the missing tests of the pure modules; every lane has a round-2 work order (12.7). | D's list was the critical path and as long as the other three together. | all |
| R14 | **The E2E channel is `pen:inject`**, as the brief says (was `pen:e2e-inject`). The sink's private bridge `PenSinkApi` / `PEN_SINK_CHANNELS` joins the contract. | One name for the lead's scripts and the contract. | D |
| R15 | **Esc is never taken from a text field** (8.8). | With the sink armed whenever a pen is near, an unconditional "Esc releases" would eat Esc while typing. | D |
| R9a | **Overruled 2026-10-04: the sink is OPT-IN** (`WRITEMIND_PEN_SINK=1`); `contain: auto` and `sink` in the Pen menu do not start it otherwise, and the menu says so. 7.2, 7.7 and 14.1 #17 describe the earlier auto-trial. | It never worked on Sean's hardware and looked like a dead full-screen mode (PARITY). | C, D |
| R16 | **The reach hint is P1** (7.7). | On Sean's window `dom` reaches about 0.67 x 0.62 of the tablet. | C |
| R17 | The sink's pen events are also reported as `dom` witnesses (7.6). | Otherwise native backends could be neither calibrated nor judged stale once the sink absorbs the pen. | C |
| R18 | **A green gate** (12.7, 15): `npm run typecheck` and `npx vitest run` are green at the end of the round, except other lanes' own failures. | Round 1 ended red. | all |
| R19 | `endCheck` and `persistWinner` store only tablet-native winners; the check's candidate list keeps `dom`; the `dom` row is judged like the others. | Found by reading `manager.ts` (`endCheck` stores `report.winner` unconditionally). | D, B |
| R20 | Evidence, probabilities, unknowns and the runbook refreshed (1.1, 4.1, 16). | | none |

**Contract delta (apply in this order; the tree's `shared/pen.ts` is the file to edit, section 3 below already shows the result).**
`shared/pen.ts`: (1) `BACKEND_ORDER = ["inject", "wintab-system", "wintab-data", "rawinput", "webhid", "dom", "overlay"]`; (2) `DEFAULT_SETTINGS.backends.dom = true`
(the type follows from `NativeBackendName`; `state.ts` already starts from `DEFAULT_SETTINGS`, so a `pen-state.json` without the key gets `true`: pin it with a test); (3) new `DomPenReport`,
`PEN_CHANNELS.dom = "pen:dom"`, `PenApi.dom(reports)`; (4) new `PointerDeviceSummary` and optional `EnvSummary.pointerDevices`; (5) `LIVENESS`: delete `GATE_HOLD_MS` and
`GATE_HOLD_CONTACT_MS` (nothing in the tree uses them), add `FRAME_SETTLE_MS` (6 s) and `NATIVE_SAFE_MS` (30 s); (6) the E2E config payload gains `capture?: boolean` (`FeedManagerEx.e2eConfig` too);
(7) `PenSample.backend` comment lists `"dom"`; (8) `PEN_CHANNELS.e2eInject = "pen:inject"` (value only; the key name is unchanged); (9) new `PenSinkApi` and `PEN_SINK_CHANNELS`; (10) `TraceSink.record?` stays.
`main/pen/types.ts`: new `DomIngest`, `isDomIngest`, `DomDeps`, `CreateDomBackend`, and the optional `EnvDeps.pointerDevices`.
**What the compiler then flags, measured on a scratch copy of the tree with the delta applied:** exactly four new errors: `BACKEND_LABEL` in `check.ts` and in `manager.ts` (add `dom: "Window pen"`), the `containment.ts` stub (add `sinkWanted: () => false`), and `LIVENESS.STAGE_OVERLAY_MS` in `manager.ts` (the overlay stage is gone, 5.3.4).
Behaviour changes the compiler cannot flag are the rules in R5 and R19 (`stageStarts`, `persistWinner`, `endCheck`, the check's candidate list), `familyOf("dom") = "screen"`, `headlineFor` (8.7), the frame-settle rule and the breadcrumb.
**Contract compile check (revision 3, 2026-10-04 12:35):** the two blocks of section 3 were extracted from this file, copied over `shared/pen.ts` and `main/pen/types.ts` in a scratch copy of the tree (`apps/desktop/src`, 120 files, the repo's `node_modules` by junction) and compiled with `tsc -p apps/desktop` (TypeScript 5.9.3, the app's own `strict` options): six errors, the two old ones in `lease.ts` and the four above, nothing else. With the four one-line fixes and the `lease.ts` fix of 12.7 applied to the scratch copy, `tsc` is clean and the 32 tests of `lease.test.ts` pass.

**Restart order for round 2.** (1) D applies the contract delta first (30 minutes) and keeps going on the manager fixes; A, B and C meanwhile continue in files that do not depend on it (A: tests of the pure modules, then `wintabNative`;
B: `env` fix, `pointerRange`, `check`; C: `lease.ts`, then `containment`) and re-typecheck when D says the delta is in. (2) C fixes `lease.ts` first of all (the tree is red until then), then `containment`, `overlay` (sink + backend), `panic`, the strip.
(3) A: `wintabNative` -> `wintabBackend` -> `rawinputBackend`. (4) B: `pointerRange` (with the device listing) -> `check` changes -> `diagnostics` / `PenCheck` -> `replay` and tools -> `webhidBackend` (cut line: ship disabled).
(5) D: `domBackend`, `registry`, `ipc`, preload, `penGate` / `penFeed` / `usePenFeed`, chip, mounting the other lanes' components, then the deletions of section 13. Priorities if time runs short are in 17.1, and each lane's own order is in 12.7.

**Reading guide (nobody needs all of it first).** Everyone: this box, 0, 2, 3, 14.1, and 12 for the own lane (the work order is 12.7).
A: 4.2, 4.3, 5.5 (what the manager does to your batches), 6 (frames), 10 (what to trace), 15.3 (fixtures); the spikes `wacom-wintab.md` and `wacom-rawinput.md`.
B: 4.4, 7.6 (pointer-range), 9, 10, 15.2 #20 and #27, 15.3, Appendix A.3; `wacom-webhid.md`.
C: 7 (all), 8.6, 14.2, 15.2 #31, 15.4 (`pensink`); `main/grab.ts`, `GrabOverlay.tsx` and `PARITY.md` "Tablet orientation and Grab" (the measured overlay facts) are your source; `wacom-containment.md`.
D: 3, 4.7, 5 (all), 6.3, 8, 11, 12.4, 13, 15; Appendix A.1 and A.2.

## Contents

0. [The answer on one page](#0-the-answer-on-one-page)
1. [What is known, what is not](#1-what-is-known-what-is-not)
2. [Architecture and invariants](#2-architecture-and-invariants)
3. [The contract (compiled TypeScript, IPC, E2E hook)](#3-the-contract)
4. [Backends and the priority ladder](#4-backends-and-the-priority-ladder)
5. [Auto-selection by liveness](#5-auto-selection-by-liveness)
6. [Frames, orientation, mapping](#6-frames-orientation-mapping)
7. [Containment policy](#7-containment-policy)
8. [Renderer consumption](#8-renderer-consumption)
9. [The Tablet setup check](#9-the-tablet-setup-check)
10. [pen-trace.jsonl](#10-pen-tracejsonl)
11. [Settings and persistence](#11-settings-and-persistence)
12. [Modules and who writes what](#12-modules-and-who-writes-what)
13. [Removal and demotion](#13-removal-and-demotion)
14. [Safety checklist](#14-safety-checklist)
15. [Test plan (no pen needed)](#15-test-plan-no-pen-needed)
16. [Unverified on Sean's hardware, and Sean's runbook](#16-unverified-on-seans-hardware-and-seans-runbook)
17. [Risks, decisions to overrule, later work](#17-risks-decisions-you-may-want-to-overrule-later-work)
A. [Tested reference sketches](#appendix-a-tested-reference-sketches) (frame inference, the sample-to-event state machine, the environment probe)

---

## 0. The answer on one page

**What we build.** A Windows-only *pen feed*. The main process reads the tablet itself and streams normalised `PenSample`s to the
notes window. Backends are tried by evidence, not by belief: **Wintab** (system-context remap only once proven, otherwise data
context), then **Raw Input HID**, then **WebHID**, then the notes window's **own pen events** (`dom`, the baseline that needs no unknown
to come out well, 4.7), then the **overlay** (the pen sink as a source, 4.5). A backend counts as working only when it
actually delivers moving samples while a pen is in range; the manager runs them concurrently in stages, records which one produced data,
persists the winner, and re-evaluates on failure (section 5).

**How the sheet uses it.** The renderer turns each sample back into an ordinary synthetic *pen* `PointerEvent` on the sheet
(the e2e suites drive the sheet and the notes page with exactly such events, so every existing pen feature keeps working untouched: the pressure
curve, the lower/upper/eraser button logic, tap actions, ExpressKeys, the in-app pen ring, palm rejection). A *gate*, the very first
capture listener on `window`, throws away the OS's own pen events for as long as capture is on, so nothing is drawn twice
and the notes page does not receive the pen. The gate reports what it swallows to the `dom` backend, so a pen that no native backend can read
still drives the sheet from its position on the display (over the part of the screen the window covers); a wrong guess about the native
backends costs precision, never the pen. The person's escape is the capture switch / Ctrl+Alt+G (section 8).

**What we do not claim.** That the OS pen can be stopped from clicking other windows *everywhere*. It cannot, without a signed UIAccess helper
(measured, `wacom-containment.md`): the taskbar band and the window's own title-bar buttons stay reachable. Containment is layered by what a
mechanism leaves behind if the app dies. The **pen sink** (a transparent topmost window of ours, hit-testable only while a pen is near, gone with the process,
undone by any real mouse event) is **tried automatically and judges itself** from what it observes (7.6). The **driver mapping** (a Wintab system context) and
**`ClipCursor`** change OS state that outlives the process, so they need a ready guard process and a proof on this machine; the chip says which mechanism is armed
and whether the pen is contained at all (section 7).

**What dies.** `penHook.ts` (the `WH_MOUSE_LL` signature hook) is deleted: it cannot see a pen that Chromium handles as `WM_POINTER`, which is
what Sean's `grab.log` is consistent with (1.1). `GrabModes` goes with it. The Grab overlay stops being a drawing surface; it becomes the *pen sink* and the
last-resort backend (section 13).

**Self-diagnosis.** Always-on `pen-trace.jsonl`; a chip that says *why* ("Windows reports the tablet as not working, problem 10");
a 20-second guided check with a per-backend verdict and **Copy diagnostics**; a breadcrumb that switches a backend off, with the reason, if the app stopped
while it was starting (5.8). When Sean is back: run the check once; either it is working, or the diagnostics/trace tells me the next step with no further round trip.

**Four implementers (disjoint files; section 12).**

| | Lane | Writes |
|---|---|---|
| IMPL-A | backends and decoders | `win32`, `winmsg`, Wintab (pure + native + backend), the one shared HID decoder, Raw Input (native + backend), frame calibration, batcher, and the tests of all of those |
| IMPL-B | WebHID, witnesses, diagnostics | WebHID backend + permissions + helper window (cut line), pointer-range witness, environment probe, trace writer/replay, check engine, **check UI (`PenCheck.tsx`) and the Copy-diagnostics text**, analyser tool |
| IMPL-C | containment and safety | lease + guard process, clip policy, sweep, containment engine, the pen sink (demoted Grab) and overlay backend, panic, **the sheet strip and the reach hint (renderer)**, build/packaging edits |
| IMPL-D | manager, IPC, renderer | contract files, manager, state, registry, IPC, preload, the `dom` backend, renderer feed/gate/synth, chip, settings, mounting the other lanes' components, E2E hooks and suites, deletions, docs |

**The handshake (done in round 1, and still how the lanes stay independent).** IMPL-D wrote `shared/pen.ts`, `main/pen/types.ts` and a *compilable stub* of every
factory in section 12 (each marked `// STUB owned by IMPL-X: replace wholesale`). A, B, C `Read` their stubs and replace them whole, keeping the exported names and
signatures. Round 2 starts from that tree; the restart order is in the revision box and each lane's work order is 12.7.

---

## 1. What is known, what is not

### 1.1 The machine and the evidence

| Fact | Source | Status |
|---|---|---|
| Tablet `VID_056A PID_037A` (One by Wacom S / CTL-472, ~152 x 95 mm, landscape 16:10 = the 1920x1200 display's shape), pen with two side buttons and no eraser end, Windows Ink on, Pen mode | task brief; extents now read live: Wintab 9500 x 15200 (portrait in), HID 15200 x 9500, Windows' pointer device rect 15201 x 9501 himetric | brief verified by Sean; physical size **verified** live (the "Windows Ink on, Pen mode" setting itself is only inferred: the pointer devices below exist) |
| The tablet was **dead from the 15:28 CDT reboot** (`CM_PROB_FAILED_START`, problem 10, `STATUS_IO_TIMEOUT`, every HID child a ghost) until it **re-enumerated at 18:44:41** (`DEVPKEY_Device_LastArrivalDate`; cause unknown: a re-plug or an automatic retry). Now: `USB\VID_056A&PID_037A\2DA00L1059230` Status OK, problem 0; nodes `COL01` "Wacom Pointer" (Mouse class, `mouhid`), `COL02` vendor-defined, `COL03` "HID-compliant pen", `COL04` "HID-compliant digitizer", all present and OK; function driver `WacHidRouterPro` 4.0.0.4 (dated 2026-06-08; device first installed 11:14, last install 13:05), Wacom driver 6.4.14-1, "Wacom Professional Service" running (the user-mode Wacom processes started 15:28:59). **It may die again at the next boot**: the failure first appeared at the first boot after the driver install, and nothing in this design can fix it, only report it | my own read-only `Get-PnpDevice` / `Get-PnpDeviceProperty` / `Get-Service` at 21:5x CDT; the spikes' updates | **verified** |
| `grab.log` (its clock is UTC): four grabs, "global pen hook installed" each time, **no** mode transition logged, lengths 113 s, 3.2 s, 3.1 s, 3.3 s, all 15:23-15:26 CDT, 2-5 minutes before the reboot that killed the tablet | `%APPDATA%\@writemind\desktop\grab.log` read with `grab.ts`, `shared/grab.ts`, `useGrabHost.ts` | **verified**. What it can and cannot say: the log records only *changes* of mode, and with the default (not "pen only") a grab starts in click-through mouse mode, so any of three signals would have logged a transition: a pen-signed event at the hook, a DOM pen event over the notes window (`grab:mainpen`), a DOM pen event on the overlay. None did in four grabs. That fits "the pen never produced a recognised pen event" and equally "pen-only was switched on" or "the pen was hardly used" (three of the grabs lasted 3 s: probably toggled on and off), so it is **weak** evidence. What it supports is only that the signature hook is no basis for anything, which the containment spike explains: a pointer-aware window gets no mouse event from the pen, so the hook has nothing to see. It does not tell us whether the overlay *received* pen events, so the overlay is treated as unproven too |
| `open()` succeeds on shared HID collections; timers throttle to 1 Hz in hidden/occluded pages unless `backgroundThrottling:false`. A gamepad, a mouse and a keyboard show up as one `HIDDevice` per top-level collection, but **the Wacom is ONE `HIDDevice` with all its collections** (next row) | webhid spike, real Electron 44.4.3 + real HID devices | **verified** |
| **ON THE WACOM (webhid spike, tablet back 2026-10-03 evening):** WebHID lists the CTL-472 as ONE `HIDDevice` with three collections (Pointer `0x1:0x1` no reports; vendor `0xff00:0xa` report 220; Digitizer `0xd:0x1` report 213), NOT per-collection; `open()` succeeds with the driver running; real reports (a 5 s vendor heartbeat, report 220, `c0 00 .. 01`) reach the listener also with a hidden/throttled window. Report 213 = standard pen report (X/Y 0..32767 Null-state, pressure 0..2047, tilt +-9000 = hundredths of a degree, physical 15200 x 9500). **The decoder must pick ONE position report (213) and ignore the vendor report 220 (it also has X/Y/pressure on a different scale and no In Range, so the heartbeat would decode as a pen in range at x = 0.013).** Tilt unit comes from `unitSystem`/`unitExponent`. Strokes on 213 not seen (no pen). See `wacom-webhid.md`, `webhid-spike/src/hidPen.ts` (`compileLayout().primary`, `defaultReportIds`). | **verified** (metadata, open, heartbeat); strokes unverified |
| `WM_INPUT` with `RIDEV_INPUTSINK` arrives unfocused via a koffi message-only window or `hookWindowMessage`; HidP-derived layouts match `HidP_GetUsageValue` on 13 devices; Windows' synthesized pen (`Microsoft HID RID\000D_0002\n`) reports **screen pixels** | rawinput spike, real OS | **verified** |
| `RIDEV_NOLEGACY` is rejected for the pen usage (error 87) and does not stop the cursor for the mouse usage | rawinput spike | **verified** |
| `wintab32.dll` loads through koffi in Electron main; DATA and SYSTEM contexts open/close cleanly; the driver stores `lcSysOrg/Ext` as given; a hard-killed process leaks its context until the driver restarts; `setInterval(4)` ticks every ~15 ms unless `timeBeginPeriod(1)` | wintab spike, cached description, no tablet | **verified** for the plumbing; **no real packet has ever been decoded** |
| `ClipCursor` clamps mouse-class input but **not** a Windows-Ink pen; a swallowing `WH_MOUSE_LL` cannot stop `WM_POINTER`; `RegisterPointerInputTarget` needs UIAccess (error 5); `RegisterPointerDeviceNotifications` works unelevated and gives focus-independent pen in/out of range; a clip outlives its process; a non-detached child dies with its parent | containment spike, **synthetic** pen | **verified for the synthetic pen**, real pen **unverified** |
| Chromium on Windows delivers the pen as `WM_POINTER`; a window that handles it gets no mouse events from the pen | containment spike | **verified** (synthetic) |
| **Pointer stack, read-only probe at 21:5x CDT** (`GetPointerDevices` + `GetPointerDeviceRects` + `GetRawInputDeviceList`; script and output kept in `C:\CLAUDIO\spikes\wdesign\`; nothing injected, registered or opened): three pointer devices. `[0]` `\??\Microsoft HID RID\000D_0002\1` INTEGRATED_PEN, cursor id 4, device rect (0,0)-(50800,31750) himetric = exactly the screen's size, i.e. a **synthetic** pen from some other program, listed permanently. `[1]` "CTL-472" INTEGRATED_PEN, cursor id 56, and `[2]` "CTL-472" EXTERNAL_PEN, cursor id 58, both with device rect **(0,0)-(15201,9501)** himetric = the tablet's physical size, mapped to display rect **(0,0)-(1920,1200)** = the whole display. Raw Input lists `Col01` (a mouse device, VID_056A), `Col04` (usage 0D/01), `Col03` (0D/02), `Col02` (FF00/0A) and the one `Microsoft HID RID\000D_0002\1` (vid/pid 0) | this machine | **verified**. Reading **[inferred]**: Windows Ink reads the Wacom's standard HID pen nodes directly (it is not fed by synthetic injection, the Wacom has its own pointer devices), so the notes window receives ordinary pen pointer events whenever the OS pen is over it; and the default mapping is the whole tablet onto the whole display. That is why the `dom` baseline (4.7) is worth having. DOM pen events from the real pen have not been seen yet |
| **Raw Input, the real caps** (rawinput spike 21:25, fixture `wacom-ctl472.json`): `Col03` pen: one input report, id **209** (38 bytes); `Col04`: the same fields under id **213**; `Col02` vendor: id **220** (11 bytes: X 0..15200 and Y 0..9500 raw counts, pressure, a vendor array; an idle heartbeat `dc c0 00 .. 01` twice in 10 s). Pen X/Y logical **0..32767 over physical 15200 x 9500** (tablet-normalised, not screen pixels), pressure **0..2047** (11 bit), tilt -9000..9000 (hundredths of a degree), 1-bit fields for tip, barrel, invert, eraser, secondary barrel, in range. `RegisterRawInputDevices(RIDEV_INPUTSINK)` succeeds; the vendor collection delivered real `WM_INPUT` with the app unfocused | rawinput spike | **verified** (caps, registration, delivery of the heartbeat); pen streaming **unverified** |
| **Wintab, live** (wintab spike 21:23): `NDEVICES 1`; extents **X 0..9499, Y 0..15199** (portrait in; the default context's out extents are landscape 15200 x 9500, so the driver turns it); pressure 0..32767; no tilt axes (this model has no tilt); 100 packets/s; cursors 1 ("Pressure Stylus", 3 buttons: tip, barrel, barrel 2) and 4 are the pen, 2 and 5 the eraser (Sean's pen has none); DATA and SYSTEM contexts open and close cleanly, the driver stores `lcSys*` as given, the mouse is undisturbed; a 15 s capture got **0 packets** because nobody moved the pen | wintab spike | **verified** (plumbing); packets **unverified** |
| **Re-read 2026-10-04 12:13 CDT** (read-only: `Get-PnpDevice`, `Get-Service`, `Get-Process` names, `GetClipCursor`; no input, no registration, no injection): `Wacom Tablet` (USB), `HID-compliant pen` (`COL03`), `HID-compliant digitizer` (`COL04`), `Wacom Pointer` (`COL01`, class Mouse), `HID-compliant vendor-defined device` (`COL02`): all `OK`, problem 0. `WTabletServicePro` Running; `Wacom_Tablet`, `WacomHost`, `Wacom_TabletUser`, `Wacom_TouchUser`, `Wacom_NotifyUtil` alive. `GetClipCursor` = (0,0,1920,1200). The four spike lanes re-ran their checks between 11:50 and 11:57 ("try again"): same results, still **no pen was moved**, so none of the unknowns changed | this machine | **verified** |
| **Sean's window** (`%APPDATA%\@writemind\desktop\window.json`, last written 2026-10-04 11:06): bounds 320,185, 1280 x 800, `maximized: false`, on the 1920 x 1200 display. Its content area is about 0.67 of the display's width and 0.62 of its height | the file | **verified**. Consequence: by default the `dom` baseline reaches about two thirds of the tablet in each direction, and a pen over the rest of the tablet is over the desktop or another program. Containment (7) and the reach hint are therefore the first-run experience, not an edge case |
| **Transparent overlay behaviour on this Windows** (measured 2026-10-03 with a synthetic pen and mouse, `PARITY.md` "Tablet orientation and Grab"): a transparent window is hit-testable only if its page paints alpha >= 1/255 (the Grab page uses `rgba(0,0,0,0.01)`); once hit-testable it receives the pen as `pointerType: pen` with correct position and pressure and the mouse as `mouse`; it cannot be hit-testable for the pen alone; `setIgnoreMouseEvents(true)` makes it click-through for both | `e2e\grab\spike`, `agents\e2e\wacom\grab-*.mjs` | **verified** with the synthetic pen (the same pointer stack a Wacom in Pen mode + Ink uses); the real pen unverified |

### 1.2 The seven facts that shaped the design

1. **Observation is cheap and safe; control is not.** Wintab, Raw Input and WebHID only *read*. Short of a signed UIAccess helper (parked), nothing but a driver mapping, a topmost sink
   window, or (for mouse-class input only) a clip can keep the pen from acting on other windows, and each of those has a failure that can hurt.
2. **We cannot know which transport works on this driver stack.** Windows Ink reads the Wacom's standard HID pen nodes directly (1.1), so reports do
   exist on `Col03` / `Col04`; whether the 6.4.x router also lets a second reader see them (a Raw Input registration, a WebHID handle) is exactly what is
   unproven, and Wintab, the driver's own API and the most likely to deliver, has never handed us a single packet. So the answer must come from a
   liveness test, not from a decision made here.
3. **A wrong guess must be harmless.** Hence the `dom` baseline (the page's own pen events carry the sheet when no native backend does), the "stop on blur"
   rule, and "capabilities are earned".
4. **Anything that survives a crash needs an owner other than the app.** Wintab contexts and `ClipCursor` outlive the process. Hence the guard
   process, the journal, the startup sweep, and the rule *no guard, no system context*.
5. **Tests must never touch the real tablet.** `wm-stop.ps1` kills test instances hard, which leaks Wintab contexts (limit 32), so under
   `WRITEMIND_E2E` the native backends are off unless `WRITEMIND_PEN_NATIVE=1`.
6. **The page is a source too.** The notes window receives the pen as ordinary pointer events wherever the OS pen is over it, with pressure, a
   button and a position on the display. That is less than the tablet's own data (one barrel button, the display's frame rate, only where the window
   covers the display) but it needs nothing from the driver, so it is the floor under every native backend (4.7).
7. **Strays are the normal case, not an edge case.** Sean's saved window is two thirds of the display in each direction, so most of the tablet maps to something that is not the sheet. A design that treats containment as an optional extra leaves the pen acting on the desktop; one that arms an unproven OS-wide mechanism risks the mouse. Hence the split of 7.2 by what a mechanism leaves behind.

---

## 2. Architecture and invariants

```
 tablet --USB--> Wacom driver 6.4.14 (WacHidRouterPro, Wacom Professional Service)
                  |-- Windows Ink pointer stack (reads Col03/Col04 itself) --> OS cursor / WM_POINTER --> window under the pen   (cannot be changed by us)
                  |-- Wintab (wintab32.dll) ---------------------+
                  '-- HID collections (pen / digitizer / vendor) -+------------------+
                                                                  |                  |
 MAIN PROCESS    WintabBackend      RawInputBackend      WebHidBackend      DomBackend          OverlayBackend       InjectBackend (E2E)
 (src/main/pen)  data | system       WM_INPUT, HidP      helper window,     pen:dom reports     sink window DOM      pen:inject
                       \                  |              WebHID, own sess.  from the gate       pen events               /
                        '-------- FeedManager: liveness, winner, frame, swap, trace, check engine ---------'
                                          |  Containment (sink: auto-trial; driver, clip: earned)  <--> Lease/Guard process (detached)
                                          |  pen:samples (screen frame, batches <= 8 ms) ; pen:status-push ; pen:event
 RENDERER        penGate/penFeed: GATE (first window capture listener: swallows DOM pen events while capture is on, reports them on pen:dom)
                             + SYNTH (sample -> sheet px -> real PointerEvent{pointerType:"pen"} on the element under it)
                                          |
        unchanged: penButtons / penActions / penLive / penCursor / penSettings / TabletSurface / Canvas
```

**Invariants (every reviewer checks these):**

1. **One authority.** `FeedManager` in main owns liveness, the winner, frames, persistence, trace, the check and containment. The renderer only consumes.
2. **One of each.** One `PenSample`; one HID decoder shared by Raw Input and WebHID; one `FrameTransform` applied once, in the manager; one place that maps a sample to the sheet (`tabletToSheet`, existing).
3. **The DOM is ground truth that a pen exists** (the notes window's events and, while the sink is on, the sink's). A native feed is trusted only while it is delivering. If DOM pen events arrive and no native backend is live, the `dom` backend carries them: the pen is never lost, only less precise. The gate does not open by itself; the person's switch does (8.4).
4. **Everything OS-level has an owner and a release** (section 14), and anything that persists past a crash is owned by the guard and swept at next start.
5. **Fail closed.** No guard, no system context, no clip. A containment test that misbehaves marks the mechanism `unsafe` and it is never retried automatically.
6. **The feed lives only while the sheet shows and the window is in front.** Blur for `BLUR_GRACE_MS` stops the backends and closes the contexts; focus restarts them. Esc releases capture only when the keyboard focus is not in a text field (8.8: the editor keeps its Esc); Ctrl+Alt+G always releases.
7. **No full screen, ever.** The sink keeps `overlayBounds` (display minus 2 DIP), `type: "toolbar"`, `focusable:false`, never the monitor's exact rectangle; `sheetGeometry.test.ts` stays as the guard.
8. **Windows only, and the rest shows nothing.** `FeedStatus.available=false` elsewhere; the UI renders no chip, no check, no toggle (AGENTS.md: the side that cannot do a thing shows nothing).
9. **Native layer off under E2E** unless `WRITEMIND_PEN_NATIVE=1` (the `inject` backend is on). **Capture itself starts OFF under E2E** (every existing pen and tablet script dispatches synthetic pen events on the sheet and expects them to draw there); a test turns it on with `e2e.config({capture:true})`.
10. **No window titles and no user content in the trace**; only `self/other` for the foreground window.
11. **A native backend that took the app down is switched off, not retried** (5.8), and the pen subsystem has a kill switch (`pen-off`, `WRITEMIND_PEN=off`).
12. **The sink is bounded by its own rules** (7.6): hit-testing only under a fresh pen signal, never with a tip down, never without a consumer, off at the first real mouse event.

---

## 3. The contract

Two files. IMPL-D created them in round 1 by copying revision 1's blocks; **the blocks below are revision 3**: they already contain the contract delta
of the revision box, so apply that delta to the existing files rather than re-copying (the tree's `shared/pen.ts` also carries IMPL-D's comments, which stay).
Later changes go through IMPL-D and are announced in the final reports. Both blocks compile together with `tsc --strict` against the tree (revision 3: the compile check at the end of the revision box).

### 3.1 `apps/desktop/src/shared/pen.ts` (pure; imported by main, preload, renderer, tests)

```ts
/**
 * shared/pen.ts - THE CONTRACT of native pen capture (docs/spikes/DESIGN-pen-capture.md section 3).
 *
 * Pure: types, constants and four tiny helpers. No Electron, no DOM, no Node, no koffi. main/pen/*, the
 * preload, the renderer and the tests all import this one file, so it is the only place a name is spelled.
 * IMPL-D creates it first (copy this block verbatim); nobody else edits it without telling IMPL-D.
 */

// ---------------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------------

/**
 * One pen reading, as every backend produces it (the shape the spikes agreed on).
 *
 * FRAME. A backend delivers x / y in the DEVICE frame (its best static guess at "natural landscape, origin
 * top-left, y down") unless `PenBackend.frameKind` is "screen". The FeedManager applies the calibrated
 * FrameTransform, so everything that leaves the manager (`PenBatch`) is in the SCREEN frame: where the
 * driver would put the cursor if the whole tablet were mapped to the whole display. The renderer then
 * applies the person's Orientation (shared/orientation.ts `tabletToSheet`) and lands the point on the sheet.
 */
export interface PenSample {
  /** Epoch ms, fractional: performance.timeOrigin + performance.now(). Comparable across processes. ARRIVAL ORDER orders samples, never t. */
  t: number
  /** 0..1 over the tablet's active area, clamped, never NaN. */
  x: number
  y: number
  /** Pressure 0..1; 0 while hovering. */
  p: number
  /** Contact. */
  tip: boolean
  /** Side button nearer the tip (the setting `swapButtons` flips lower / upper). */
  lower: boolean
  upper: boolean
  /** The eraser end (Sean's pen has none; stays false). */
  eraser: boolean
  /** False on the single "pen left" sample that ends a visit, and while the backend says out of range. */
  inRange: boolean
  /** Degrees -90..90 like PointerEvent.tiltX / tiltY; ABSENT when the device has no tilt. */
  tiltX?: number
  tiltY?: number
  /** Free-form label of the decoder that made it: "wintab", "rawinput-hid", "rawinput-synth", "webhid", "dom", "overlay", "inject". */
  backend: string
}

/** What the manager hands the renderer: one backend's samples, in the screen frame, in order. */
export interface PenBatch {
  source: BackendName
  /** 1, 2, 3 ... per open feed; a gap means a batch was lost. */
  seq: number
  samples: PenSample[]
}

// ---------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------

export type Turn = 0 | 1 | 2 | 3

/** Mirror y first (`flipY`), then turn `turn` quarter turns clockwise inside the unit square. 8 possible transforms. */
export interface FrameTransform { turn: Turn; flipY: boolean }

export const IDENTITY_FRAME: FrameTransform = { turn: 0, flipY: false }

export function applyFrame(x: number, y: number, f: FrameTransform): [number, number] {
  const v = f.flipY ? 1 - y : y
  switch (f.turn) {
    case 0: return [x, v]
    case 1: return [1 - v, x]
    case 2: return [1 - x, 1 - v]
    default: return [v, 1 - x]
  }
}

export interface FrameRecord {
  frame: FrameTransform
  /** default = a guess from the extents; cursor / dom = fitted against pairs; strokes = two guided strokes; manual = the person chose; screen = the backend already delivers the screen frame. */
  source: "default" | "cursor" | "dom" | "strokes" | "manual" | "screen"
  /** Root-mean-square error of the fit (unit square) and how clearly it beat the runner-up (x). Null for default / manual / screen. */
  rms: number | null
  margin: number | null
  /** ISO time. */
  at: string
}

// ---------------------------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------------------------

/**
 * Priority order when several are live: first wins. `inject` exists for the end-to-end tests only. `dom` is the notes window's own pen
 * events (design 4.7): the baseline that needs no driver, so it ranks below every tablet-native backend and above the overlay.
 */
export const BACKEND_ORDER = ["inject", "wintab-system", "wintab-data", "rawinput", "webhid", "dom", "overlay"] as const
export type BackendName = (typeof BACKEND_ORDER)[number]
export type NativeBackendName = Exclude<BackendName, "inject">

export type BackendState =
  | "idle"         // not started
  | "starting"     // start() in flight
  | "armed"        // started, no pen data yet (nothing to say the pen is here)
  | "live"         // delivering samples that move
  | "stale"        // was live, silent while a witness says the pen is here
  | "failed"       // start failed or stayed stale: restarted with backoff, or given up (see reason)
  | "unavailable"  // can never work here (not Windows, no dll, switched off): never started

export interface DeviceInfo {
  name: string
  vendorId: number | null
  productId: number | null
  /** Active-area width / height in natural landscape when known (physical units), else null. */
  aspect: number | null
  /** Raw axis extents as the backend sees them, for the trace and the check. */
  rawX: [number, number] | null
  rawY: [number, number] | null
  pressureMax: number | null
  /** What the driver / descriptor CLAIMS. `BackendStatus.seen` is what was OBSERVED; the check compares the two. */
  claims: { pressure: boolean; tilt: boolean; lower: boolean; upper: boolean; eraser: boolean }
}

export interface Counters {
  /** PenSamples emitted. */
  samples: number
  /** ... of which inRange. */
  inRange: number
  /** Raw packets / reports received (before decoding). */
  raw: number
  tipDowns: number
  /** out -> in transitions. */
  visits: number
  errors: number
  /** Raw records the decoder threw away (implausible, too short, unknown report id). */
  dropped: number
}

export interface BackendStatus {
  name: BackendName
  state: BackendState
  /** Plain words, specific: "WTInfo reports 0 devices (the tablet is not working or the Wacom service is down)". Null when all is well. */
  reason: string | null
  counters: Counters
  /** Epoch ms of the last sample / last in-range sample. */
  lastSampleAt: number | null
  lastInRangeAt: number | null
  /** Samples per second over the last 2 s of flow, null when idle. */
  rateHz: number | null
  /** 95th-percentile gap between consecutive samples while in range (ms). */
  gapP95Ms: number | null
  device: DeviceInfo | null
  /** What has actually been observed since start. */
  seen: { pressure: boolean; lower: boolean; upper: boolean; eraser: boolean; tilt: boolean; moved: boolean }
  /** Extents reached by x / y (0..1, in the frame the backend delivered): the check's coverage test. Null before any sample. */
  reach: { x: [number, number]; y: [number, number] } | null
  pressureMaxSeen: number
  /** Backend-specific facts for the diagnostics: strings, numbers, booleans only. */
  facts: Record<string, string | number | boolean | null>
}

export type BackendEvent =
  | { kind: "proximity"; inRange: boolean }
  | { kind: "device"; info: DeviceInfo | null }
  | { kind: "error"; message: string; fatal: boolean }
  | { kind: "note"; text: string }

export type BackendStart =
  | { ok: true; device: DeviceInfo | null }
  | { ok: false; reason: string; retry: "never" | "later" | "after-replug" }

/** What backends see of the guard process (IMPL-C implements it; carried in BackendContext). */
export interface LeaseApi {
  /** True when the guard process is up and answering. */
  ready(): boolean
  /** Register a Wintab context handle (decimal string) the guard must close if the app dies or stops beating. false = the guard is down or refused: a SYSTEM context must then be closed again at once (fail closed). */
  holdWintab(handle: string, mode: "data" | "system"): boolean
  dropWintab(handle: string): void
}

/** What the manager gives a backend when it starts it. */
export interface BackendContext {
  /** The sheet in physical screen pixels; only the wintab-system backend (and the sink) look at it. */
  sheetPhysical: Box | null
  trace: TraceSink
  lease: LeaseApi
  /** Same clock as PenSample.t. */
  now(): number
  settings: PenFeedSettings
}

export interface PenBackend {
  readonly name: BackendName
  /** "screen": x / y already in the screen frame (inject, overlay). "device": the manager applies the calibrated FrameTransform. */
  readonly frameKind: "screen" | "device"
  /** Cheap, side-effect free: can this ever work here (platform, dll present, not switched off)? */
  available(): { ok: true } | { ok: false; reason: string }
  /** Open the OS resources. Never throws, never hangs past 4 s without resolving; idempotent. */
  start(ctx: BackendContext): Promise<BackendStart>
  /** Release EVERYTHING. Synchronous, idempotent, safe after a failed start and from an exit handler. */
  stop(): void
  /** Batches are at most 8 ms apart and never empty; the listener must be cheap. */
  onSample(listener: (batch: PenSample[]) => void): () => void
  onEvent(listener: (event: BackendEvent) => void): () => void
  status(): BackendStatus
}

/** Where backends write the raw packets / reports and the transitions that go into pen-trace.jsonl. The sink applies every cap. */
export interface TraceSink {
  event(source: BackendName | "manager" | "renderer" | "containment" | "check", name: string, data?: Record<string, unknown>): void
  /** One raw packet / report as hex (the sink keeps the first N per backend per session, then a sparse sample). */
  raw(backend: BackendName, t: number, hex: string, note?: string): void
  /**
   * OPTIONAL (added by IMPL-D in round 1, adopted in revision 2): the sampled record kinds of the trace (`smp`, `dom`, `cur`, `st`, section 10),
   * which the manager decimates and caps itself. A sink without it receives the same data as `event(...)` calls named like the kind.
   */
  record?(kind: "smp" | "dom" | "cur" | "st", data: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------------------------
// Settings (main keeps them in userData/pen-state.json; the renderer reads and writes them over IPC)
// ---------------------------------------------------------------------------------------------

/**
 * auto = the pen sink on auto-trial (design 7.2, 7.6) and, only if the check proved it here, the driver mapping; clip only if the tablet was measured to be in
 * Mouse mode. sink / driver / clip force that one mechanism. none = no mechanism and no overlay backend.
 */
export type ContainSetting = "auto" | "driver" | "sink" | "clip" | "none"

export interface PenFeedSettings {
  /** "Pen capture": read the tablet pen natively while the Tablet sheet shows and the window is in front. */
  enabled: boolean
  /** Per-backend switches: a backend that misbehaves can be turned off for good. */
  backends: Record<NativeBackendName, boolean>
  /** Force one backend (null = automatic, by liveness). Useful to compare; the check ignores it. */
  prefer: BackendName | null
  /** See ContainSetting. */
  contain: ContainSetting
  /** The physical lower / upper side buttons are the other way round. */
  swapButtons: boolean
  /** Write pen-trace.jsonl. */
  trace: boolean
}

export const DEFAULT_SETTINGS: PenFeedSettings = {
  enabled: true,
  backends: { "wintab-system": true, "wintab-data": true, rawinput: true, webhid: true, dom: true, overlay: true },
  prefer: null,
  contain: "auto",
  swapButtons: false,
  trace: true,
}

// ---------------------------------------------------------------------------------------------
// Geometry and the window
// ---------------------------------------------------------------------------------------------

export interface Box { x: number; y: number; width: number; height: number }

/** The sheet as the renderer sees it. Main turns it into physical screen pixels (screen.dipToScreenRect). */
export interface SheetGeometry {
  /** getBoundingClientRect of [data-tablet="surface"], CSS pixels of the notes window's page. */
  rect: Box
  /** The person's Orientation in quarter turns (the sheet is portrait for 1 and 3). */
  turns: Turn
  /** Width / height as shown. */
  aspect: number
}

export interface WindowState { focused: boolean; visible: boolean; minimized: boolean }

/** Evidence that a pen is (or is not) near the tablet, from somewhere other than the backend being judged. */
export interface Witness {
  /** "dom" = a pen event Windows delivered to one of our own pages: the notes window (the gate, design 8.4) or the pen sink (design 7.6). */
  source: "dom" | "pointer-range" | "wizard" | "cursor"
  inRange: boolean
  /** Epoch ms. */
  at: number
  /** DOM only: the renderer sets this from PointerEvent.screenX / screenY (DIP, virtual desktop). */
  screenDip?: { x: number; y: number }
  /** Main fills this from `screenDip` (or from the OS cursor): where the pen is, as fractions of the display that contains the point (0..1, y down). Pairs with a device sample for frame calibration. */
  screen?: { x: number; y: number }
  /** DOM only: the event's buttons mask and pointer type, for the echo rule. */
  buttons?: number
  pointerType?: string
}

/**
 * What the renderer's gate reports for ONE pen pointer event, coalesced events included (each is its own report), on `pen:dom`, at most one
 * message per animation frame. Main turns it into a `PenSample` in the screen frame (main/pen/domBackend.ts, design 4.7); the renderer does
 * no display arithmetic of its own, so multi-display and scale handling live in one place that has Electron's `screen`.
 */
export interface DomPenReport {
  /** Epoch ms (performance.timeOrigin + event.timeStamp). */
  t: number
  /** PointerEvent.screenX / screenY: DIP on the virtual desktop. (The app has no page zoom today; if a zoom feature is ever added, check that Chromium does not scale them by the zoom factor and divide it out before sending.) */
  sx: number
  sy: number
  /** PointerEvent.pressure, 0..1 (0 while hovering). */
  p: number
  /** PointerEvent.buttons: tip 1, barrel 2, 4 only when the driver maps a second button, eraser 32. */
  buttons: number
  /** False on the one report that ends a visit (the pen leaves the document, or pointercancel). */
  inRange: boolean
  tiltX?: number
  tiltY?: number
}

// ---------------------------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------------------------

export type ContainMechanism = "driver" | "sink" | "clip"

/** untested = never tried here; honored / effective = observed to work on this machine; ignored / ineffective = observed NOT to; unsafe = it misbehaved (never retried automatically). */
export type CapabilityState = "untested" | "honored" | "ignored" | "effective" | "ineffective" | "unsafe"

export interface CapabilityRecord { state: CapabilityState; at: string | null; note: string | null }

export interface ContainmentStatus {
  mode: "none" | ContainMechanism
  armed: boolean
  /** The rectangle in physical screen pixels while armed. */
  rect: Box | null
  lastRelease: { reason: string; at: number } | null
  capabilities: { driver: CapabilityRecord; sink: CapabilityRecord; clip: CapabilityRecord }
  /** "pen" = the driver moves the cursor to where the pen is (Pen mode); "mouse" = relative (Mouse mode); null = not measured. */
  pointerMode: "pen" | "mouse" | null
  guard: { state: "none" | "starting" | "ready" | "lost"; pid: number | null }
}

export interface ContainmentTestResult {
  mechanism: "driver" | "sink"
  state: CapabilityState
  /** Plain words for the person: what was measured. */
  detail: string
}

// ---------------------------------------------------------------------------------------------
// Status the HUD, the check and the diagnostics read
// ---------------------------------------------------------------------------------------------

/** One entry of Windows' pointer-device list (GetPointerDevices + GetPointerDeviceRects). Read-only facts for the check and the diagnostics (design 7.6). */
export interface PointerDeviceSummary {
  /** productString: "CTL-472" for the Wacom, "\??\Microsoft HID RID\000D_0002\1" for a synthetic pen. */
  product: string
  /** INTEGRATED_PEN, EXTERNAL_PEN, TOUCH, TOUCH_PAD, or the number. */
  kind: string
  cursorId: number
  /** himetric (0.01 mm): the tablet's physical size for a real pen (15201 x 9501 for the CTL-472); null when Windows would not say. */
  deviceRect: Box | null
  /** Pixels: the part of the desktop the device is mapped to (the whole display by default). */
  displayRect: Box | null
  /** True for `Microsoft HID RID` devices: a pen injected by some program, never the tablet. */
  synthetic: boolean
}

export interface EnvSummary {
  platform: string
  os: string
  electron: string
  appVersion: string
  koffi: boolean
  wintabDll: boolean
  /** Windows' own view of the tablet (Get-PnpDevice, VID_056A). Null when there is no such device or the query failed (see note). */
  tablet: { present: boolean; status: string | null; problem: string | null; name: string | null; instanceId: string | null; note: string | null } | null
  wacomDriver: string | null
  wacomService: string | null
  displays: { bounds: Box; scale: number; primary: boolean }[]
  /** Raw Input devices on the digitizer page or from Wacom (name, vid, pid, usage page / usage, kind). */
  rawDevices: { name: string; vid: number; pid: number; usagePage: number; usage: number; kind: string }[]
  /** Windows' pointer devices (the pen stack's own view); null when the query failed, absent in older records. Added in revision 2. */
  pointerDevices?: PointerDeviceSummary[] | null
  /** Wintab interface facts (spec / implementation versions, device count, extents) or null when it is not there. */
  wintab: Record<string, string | number | boolean | null> | null
}

export type FeedSeverity = "ok" | "wait" | "warn" | "error" | "off"

export interface FeedStatus {
  /** False on platforms with no native feed at all: the UI shows nothing. */
  available: boolean
  open: boolean
  /** Capture released because the window is not in front / minimised / hidden. */
  released: string | null
  /** The backend feeding the sheet right now, or null (the pen then works as a plain pointer). */
  active: BackendName | null
  backends: BackendStatus[]
  /** The frame in force for the active backend (screen frame once applied). */
  frame: FrameRecord | null
  containment: ContainmentStatus
  /** Epoch ms of the last witness (DOM pen event, pointer-device in-range). */
  witnessAt: number | null
  env: EnvSummary | null
  settings: PenFeedSettings
  /** The one line for the chip, e.g. "Pen: Wintab - 133 Hz", and how to colour it. */
  headline: string
  severity: FeedSeverity
  /** The persisted winner from earlier runs, if any. */
  winner: { backend: BackendName; at: string } | null
}

export type FeedEvent =
  | { kind: "live"; backend: BackendName }
  | { kind: "lost"; backend: BackendName; reason: string }
  | { kind: "failover"; from: BackendName | null; to: BackendName }
  | { kind: "released"; reason: string }
  | { kind: "needs-you"; message: string }

// ---------------------------------------------------------------------------------------------
// The setup check (a 20-second guided check; engine in main/pen/check.ts, pure)
// ---------------------------------------------------------------------------------------------

export type CheckStepId = "env" | "hover" | "tap" | "lower" | "upper" | "sweep" | "away"

export interface CheckStepSpec { id: CheckStepId; seconds: number; title: string; prompt: string; optional: boolean }

export const CHECK_STEPS: readonly CheckStepSpec[] = [
  { id: "env", seconds: 0, title: "Looking at the machine", prompt: "Reading what Windows says about the tablet.", optional: false },
  { id: "hover", seconds: 4, title: "Hover", prompt: "Hold the pen a finger's width above the tablet and slowly wave it around. Do not touch.", optional: false },
  { id: "tap", seconds: 3, title: "Tap and press", prompt: "Tap the tip on the MIDDLE of the tablet a few times, then press harder and softer.", optional: false },
  { id: "lower", seconds: 3, title: "Lower side button", prompt: "Hover over the MIDDLE of the tablet and press the side button NEAREST THE TIP, again and again.", optional: false },
  { id: "upper", seconds: 3, title: "Upper side button", prompt: "Hover over the MIDDLE of the tablet and press the side button FARTHEST FROM THE TIP, again and again.", optional: false },
  { id: "sweep", seconds: 5, title: "Round the edge", prompt: "Keep the pen just ABOVE the tablet, not touching, and move it round the very edge, then across the middle in a cross.", optional: false },
  { id: "away", seconds: 4, title: "Another window in front", prompt: "Click another program with the MOUSE so it is in front, then wave the pen over the tablet. Click WriteMind to come back.", optional: true },
]

export type Verdict = "works" | "partial" | "silent" | "failed" | "unavailable" | "skipped"

export interface CheckRow {
  backend: BackendName
  verdict: Verdict
  /** One line: "133 Hz, 2048 levels, both side buttons, whole tablet reached." */
  headline: string
  /** Why not (or what to watch), plain words, most important first. */
  reasons: string[]
  samples: number
  rateHz: number | null
  pressureMaxSeen: number
  pressureLevels: number
  lower: boolean
  upper: boolean
  /** Coverage of the tablet reached in the sweep: 0..1 for x and y. */
  coverage: { x: number; y: number } | null
  frame: FrameRecord | null
  /** Samples that arrived while WriteMind was not the foreground window (the "away" step), or null if not run. */
  samplesAway: number | null
}

export interface CheckReport {
  at: string
  overall: "ok" | "partial" | "none"
  winner: BackendName | null
  summary: string
  rows: CheckRow[]
  /** What the check learned about the machine, ready to persist. */
  learned: { frames: Record<string, FrameRecord>; pointerMode: "pen" | "mouse" | null; swapButtons: boolean | null }
  /** Next steps in plain words, for the person. */
  advice: string[]
}

export interface CheckSnapshot {
  running: boolean
  step: CheckStepId | null
  secondsLeft: number
  done: CheckStepId[]
  /** Live per-backend counters while the check runs (the table on screen). */
  rows: CheckRow[]
  env: EnvSummary | null
  report: CheckReport | null
}

// ---------------------------------------------------------------------------------------------
// IPC (names are spelled ONCE, here; preload, main/pen/ipc.ts and the tests use PEN_CHANNELS)
// ---------------------------------------------------------------------------------------------

export const PEN_CHANNELS = {
  // renderer -> main, invoke (reply in brackets)
  open: "pen:open", // (SheetGeometry) -> FeedStatus
  close: "pen:close", // (reason: string) -> void
  status: "pen:status", // () -> FeedStatus
  settings: "pen:settings", // () -> PenFeedSettings
  setSettings: "pen:settings-set", // (Partial<PenFeedSettings>) -> PenFeedSettings
  checkStart: "pen:check-start", // () -> CheckSnapshot
  checkStep: "pen:check-step", // (CheckStepId) -> CheckSnapshot
  checkCancel: "pen:check-cancel", // () -> CheckSnapshot
  checkCopy: "pen:check-copy", // () -> string  (the diagnostics text)
  containTest: "pen:contain-test", // ("driver" | "sink") -> ContainmentTestResult
  frameSet: "pen:frame-set", // (FrameTransform | null)  null = back to automatic -> FeedStatus
  revealTrace: "pen:reveal-trace", // () -> void
  // renderer -> main, fire and forget
  sheet: "pen:sheet", // (SheetGeometry | null)
  witness: "pen:witness", // (Witness), at most 30 a second
  dom: "pen:dom", // (DomPenReport[]), at most one message per animation frame: what the gate swallowed, for the `dom` backend
  panic: "pen:panic", // (reason: string)
  // main -> renderer
  samples: "pen:samples", // PenBatch (the active backend only, screen frame)
  statusPush: "pen:status-push", // FeedStatus (changes at once, counters at most 4 a second)
  event: "pen:event", // FeedEvent
  check: "pen:check", // CheckSnapshot
  // WRITEMIND_E2E only
  e2eInject: "pen:inject", // ({ samples: PenSample[]; backend?: BackendName }) -> void
  e2eState: "pen:e2e-state", // () -> FeedStatus
  e2eConfig: "pen:e2e-config", // ({ native?: boolean; backends?: BackendName[]; focused?: boolean; capture?: boolean }) -> FeedStatus  (focused overrides the E2E "always in front"; capture turns pen capture on, it starts OFF under E2E)
} as const
export type PenChannel = (typeof PEN_CHANNELS)[keyof typeof PEN_CHANNELS]

/** window.wm.pen, as the preload exposes it (preload.ts builds it from PEN_CHANNELS; wm.d.ts types it with this). */
export interface PenApi {
  open(sheet: SheetGeometry): Promise<FeedStatus>
  close(reason: string): Promise<void>
  status(): Promise<FeedStatus>
  settings(): Promise<PenFeedSettings>
  setSettings(patch: Partial<PenFeedSettings>): Promise<PenFeedSettings>
  sheet(geometry: SheetGeometry | null): void
  witness(w: Witness): void
  /** The gate's reports for the `dom` backend. */
  dom(reports: DomPenReport[]): void
  panic(reason: string): void
  check: {
    start(): Promise<CheckSnapshot>
    step(id: CheckStepId): Promise<CheckSnapshot>
    cancel(): Promise<CheckSnapshot>
    copy(): Promise<string>
    test(mechanism: "driver" | "sink"): Promise<ContainmentTestResult>
  }
  setFrame(frame: FrameTransform | null): Promise<FeedStatus>
  revealTrace(): Promise<void>
  onSamples(listener: (batch: PenBatch) => void): () => void
  onStatus(listener: (status: FeedStatus) => void): () => void
  onEvent(listener: (event: FeedEvent) => void): () => void
  onCheck(listener: (snapshot: CheckSnapshot) => void): () => void
  /** Present only under WRITEMIND_E2E. */
  e2e?: {
    inject(samples: PenSample[], backend?: BackendName): Promise<void>
    state(): Promise<FeedStatus>
    config(c: { native?: boolean; backends?: BackendName[]; focused?: boolean; capture?: boolean }): Promise<FeedStatus>
  }
}

// ---------------------------------------------------------------------------------------------
// The pen sink's private bridge (renderer/PenSink.tsx <-> main/pen/overlay.ts; design 7.6)
// ---------------------------------------------------------------------------------------------

export const PEN_SINK_CHANNELS = {
  pen: "pen:sink-pen", // renderer -> main, send: (DomPenReport[]), at most one message per animation frame
  mouse: "pen:sink-mouse", // renderer -> main, send: () a real mouse event (not the pen's echo) reached the sink while it was on
  beat: "pen:sink-beat", // renderer -> main, send: () every second; main destroys the sink after 6 s of silence
} as const

/** window.wm.penSink: exposed by the one preload; main verifies that the sender of each message is the sink window. */
export interface PenSinkApi {
  pen(reports: DomPenReport[]): void
  mouse(): void
  beat(): void
}

// ---------------------------------------------------------------------------------------------
// The FeedManager (main/pen/manager.ts, IMPL-D)
// ---------------------------------------------------------------------------------------------

export interface FeedManager {
  /** The Tablet sheet is showing: start reading. Idempotent. Resolves with the first status (backends may still be starting). */
  open(sheet: SheetGeometry | null): Promise<FeedStatus>
  close(reason: string): void
  setSheet(sheet: SheetGeometry | null): void
  setWindowState(state: WindowState): void
  witness(w: Witness): void
  /** The ACTIVE backend's samples only, screen frame. */
  onSamples(listener: (batch: PenBatch) => void): () => void
  onStatus(listener: (status: FeedStatus) => void): () => void
  onEvent(listener: (event: FeedEvent) => void): () => void
  status(): FeedStatus
  settings(): PenFeedSettings
  update(patch: Partial<PenFeedSettings>): PenFeedSettings
  /** Let go of everything now (Esc, Ctrl+Alt+G, the pen-free key, quit). The feed stays closed until the window is focused again or the person turns capture on. */
  panic(reason: string): void
  /** E2E and tests: samples from a pretend backend. */
  inject(samples: PenSample[], backend?: BackendName): void
  dispose(): void
}

// ---------------------------------------------------------------------------------------------
// Liveness: every number the selector uses, in one place (tests import them; nobody inlines them)
// ---------------------------------------------------------------------------------------------

export const LIVENESS = {
  /** A backend is LIVE after this many in-range samples within LIVE_WINDOW_MS, at least one of which differs from the one before in x, y or p. */
  LIVE_MIN_SAMPLES: 4,
  LIVE_WINDOW_MS: 1000,
  /** LIVE -> STALE: no sample for this long while a witness says the pen is here. */
  STALE_AFTER_MS: 800,
  /** STALE -> FAILED: still silent this long after going stale, witness continuing. */
  FAIL_AFTER_MS: 6000,
  /** start() must resolve within this, else failed("start timed out"). */
  START_TIMEOUT_MS: 4000,
  /** A witness counts as "the pen is here" for this long after it was seen. */
  WITNESS_HOLD_MS: 500,
  // There is no gate hold time: the renderer's gate is closed whenever capture is on (design 8.4).
  /** A higher-priority backend must stay live this long (pen up) before it takes over from the active one. */
  UPGRADE_AFTER_LIVE_MS: 1500,
  /** A visit with no packets ends after this long hovering, or this long in contact (a still pen sends nothing); the driver's own proximity signal wins over both. */
  LEAVE_HOVER_MS: 600,
  LEAVE_CONTACT_MS: 2000,
  /** Batches leave a backend at most this long after their first sample. */
  BATCH_MS: 8,
  /** Staged starts, measured from open() (or from the first witness on a first run). The overlay is not staged: it starts with the sink (design 4.5, 5.3). */
  STAGE_WEBHID_MS: 2500,
  /** A device-frame backend whose frame is still a guess waits this long (live, pen up) behind a live screen-frame backend before it may take over (design 5.4). */
  FRAME_SETTLE_MS: 6000,
  /** A native backend that has run this long since start() resolved is considered safe: the crash breadcrumb is cleared (design 5.8). */
  NATIVE_SAFE_MS: 30_000,
  /** Restart backoff after a failure: 5 s, 15 s, 45 s, then give up for the session (a re-plug or a settings change resets it). */
  BACKOFF_MS: [5000, 15000, 45000],
  /** A backend that failed 3 times in a row while a witness was active is left alone for 24 h. */
  DEMOTE_MS: 24 * 3600 * 1000,
  /** Released window grace: backends are stopped this long after the window stops being in front. */
  BLUR_GRACE_MS: 1500,
} as const

/** The tablet-normalised bits the trace stores per sample: tip=1, lower=2, upper=4, eraser=8, inRange=16. */
export const sampleFlags = (s: PenSample): number =>
  (s.tip ? 1 : 0) | (s.lower ? 2 : 0) | (s.upper ? 4 : 0) | (s.eraser ? 8 : 0) | (s.inRange ? 16 : 0)

export const clamp01 = (v: number): number => (v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v)

/** True for the backends that read the tablet itself (everything but the overlay and the test injector). */
export const isTabletNative = (name: BackendName): boolean =>
  name === "wintab-system" || name === "wintab-data" || name === "rawinput" || name === "webhid"
```

### 3.2 `apps/desktop/src/main/pen/types.ts` (main only; the factory signatures every stub compiles against)

```ts
/**
 * main/pen/types.ts - the MAIN-PROCESS-ONLY half of the contract (docs/spikes/DESIGN-pen-capture.md section 3.2).
 * Everything here may import Electron and Node; nothing here may be imported by the renderer.
 * IMPL-D creates it first; the factory signatures at the bottom are what the stubs and `registry.ts` compile against.
 */

import type { BrowserWindow, Session } from "electron"
import type {
  BackendName, Box, CheckReport, DomPenReport, LeaseApi, CheckSnapshot, CheckStepId, ContainmentStatus, ContainmentTestResult, EnvSummary, FeedStatus,
  FrameRecord, FrameTransform, PenBackend, PenFeedSettings, PenSample, PointerDeviceSummary, SheetGeometry, TraceSink, Turn, WindowState, Witness,
} from "../../shared/pen"

// ---------------------------------------------------------------------------------------------
// Paths (all under app.getPath("userData"); built once in main.ts and handed to everyone)
// ---------------------------------------------------------------------------------------------

export interface PenPaths {
  userData: string
  /** pen-state.json: settings, winner, frames, capabilities. Small. */
  state: string
  /** pen-trace.jsonl (+ .1, .2 rotations). */
  trace: string
  /** wintab.journal.json: the handles this process opened, for recovery after a hard kill. */
  wintabJournal: string
  /** pen-leases.json: what the guard holds right now (clip rectangle, Wintab handles), for the next launch's sweep. */
  leases: string
}

// ---------------------------------------------------------------------------------------------
// Optional capabilities a backend may add to PenBackend
// ---------------------------------------------------------------------------------------------

/** Implemented by the wintab-system backend: the manager tells it where the sheet is (physical pixels, or null to give the pointer back). */
export interface SystemMapped {
  setSheetPhysical(rect: Box | null): void
}
export const isSystemMapped = (b: PenBackend): b is PenBackend & SystemMapped =>
  typeof (b as Partial<SystemMapped>).setSheetPhysical === "function"

/** Implemented by the `dom` backend (design 4.7): ipc.ts hands it what the renderer's gate reported on `pen:dom`. */
export interface DomIngest {
  ingest(reports: DomPenReport[]): void
}
export const isDomIngest = (b: PenBackend): b is PenBackend & DomIngest =>
  typeof (b as Partial<DomIngest>).ingest === "function"

// ---------------------------------------------------------------------------------------------
// The guard / lease (IMPL-C). A detached helper process that undoes OS state if the app dies or hangs.
// ---------------------------------------------------------------------------------------------

export interface Lease extends LeaseApi {
  /** Start the guard (detached). Resolves when it said "ready", or false after 3 s. */
  start(): Promise<boolean>
  /** ClipCursor leases: arm / beat / free as in the containment spike (clip.ts). */
  armClip(rect: Box, leaseMs: number): boolean
  beat(): void
  freeClip(): void
  currentClip(): Box
  onLost(listener: (why: "lease" | "guard-lost") => void): () => void
  state(): "none" | "starting" | "ready" | "lost"
  pid(): number | null
  dispose(): void
}

export interface LeaseOptions { paths: PenPaths; execPath: string; guardScript: string; log: (line: string) => void }

// ---------------------------------------------------------------------------------------------
// Containment (IMPL-C): decides when the pen is held to the sheet, by which mechanism, and lets go.
// ---------------------------------------------------------------------------------------------

export interface ContainmentInput {
  sheet: SheetGeometry | null
  /** The sheet in physical screen pixels (main computed it with screen.dipToScreenRect), or null. */
  sheetPhysical: Box | null
  window: WindowState
  /** A pen is near the tablet right now (backend inRange, or a witness). */
  penInRange: boolean
  /** Epoch ms of the last pen activity of any kind (idle release). */
  lastPenAt: number | null
  settings: PenFeedSettings
  active: BackendName | null
}

export interface DriverProbe {
  /** A fresh wintab-system backend for the probe (not the manager's). */
  makeSystemBackend(): PenBackend & SystemMapped
  cursor(): { x: number; y: number }
  /** Samples of ANY live backend, so the probe can tell the pen moved. */
  onSamples(listener: (batch: PenSample[]) => void): () => void
}

export interface ContainmentDeps {
  lease: Lease
  paths: PenPaths
  trace: TraceSink
  now(): number
  window(): BrowserWindow | null
  /** Electron's screen module, narrowed (tests fake it). */
  display: { metricsChanged(listener: () => void): () => void }
  probe: DriverProbe
  /** Persistence of capability records goes through the manager's state module. */
  loadCapabilities(): ContainmentStatus["capabilities"]
  saveCapability(name: "driver" | "sink" | "clip", record: { state: string; note: string | null }): void
  pointerMode(): "pen" | "mouse" | null
  /** The overlay sink, created by overlay.ts. */
  sink: Sink
  log: (line: string) => void
}

export interface Containment {
  update(input: ContainmentInput): void
  status(): ContainmentStatus
  /** The manager asks this before it picks wintab-system over wintab-data. */
  driverMappingWanted(): boolean
  /** The pen sink may arm (design 7.6 (d)(e)): the setting allows it and no `ineffective` / `unsafe` record stops it. The manager starts the overlay backend when this is true. */
  sinkWanted(): boolean
  /** The check's optional containment tests. */
  test(mechanism: "driver" | "sink"): Promise<ContainmentTestResult>
  /** Let go of every mechanism now, whatever state it is in. Synchronous. */
  panic(reason: string): void
  dispose(): void
}

export interface SinkDeps {
  window(): BrowserWindow | null
  load(overlay: BrowserWindow): Promise<void>
  preload: string
  /** WRITEMIND_E2E: do not hide the sink when the notes window is not in front. */
  e2e: boolean
  log: (line: string) => void
}

/** The transparent pen-sink window (the demoted Grab overlay). It never takes the keyboard and is hit-testable ONLY while `on`. */
export interface Sink {
  /** Show / hide the window over the display the notes window is on. */
  setShown(shown: boolean): void
  /** Hit-testable (swallows the pen) or click-through (the mouse works). */
  setOn(on: boolean): void
  state(): { shown: boolean; on: boolean; bounds: Box | null }
  /** DOM pen events the sink page has seen (validation, 7.6, and the sink test count them). */
  penEvents(): number
  mouseEvents(): number
  onPenSamples(listener: (batch: PenSample[]) => void): () => void
  dispose(): void
}

// ---------------------------------------------------------------------------------------------
// Environment, trace, check (IMPL-B)
// ---------------------------------------------------------------------------------------------

export interface EnvDeps {
  appVersion: string
  /** Wintab / Raw Input facts come from IMPL-A's modules, passed in so env.ts stays free of koffi. */
  wintabFacts(): Record<string, string | number | boolean | null> | null
  rawDevices(): EnvSummary["rawDevices"]
  /** Windows' pointer devices (IMPL-B's pointerRange.ts `listPointerDevices`); optional so older callers and tests still compile. Added in revision 2. */
  pointerDevices?(): PointerDeviceSummary[] | null
  koffiLoaded(): boolean
  displays(): EnvSummary["displays"]
  /** Runs powershell.exe with a timeout and returns stdout, or null on failure (tests fake it). */
  powershell(script: string, timeoutMs: number): Promise<string | null>
}

export interface TraceFile extends TraceSink {
  readonly path: string
  /** The last n trace lines (for Copy diagnostics). */
  tail(n: number): string[]
  /** The first n raw hex records per backend of this session. */
  firstRaw(n: number): Record<string, string[]>
  flush(): Promise<void>
  close(): void
}

export interface CheckDeps {
  now(): number
  windowFocused(): boolean
  env(): EnvSummary | null
  statuses(): import("../../shared/pen").BackendStatus[]
  /** Frames the check may propose (it never persists; the manager does, from `report.learned`). */
  currentFrame(backend: BackendName): FrameRecord | null
}

export interface CheckEngine {
  begin(): CheckSnapshot
  /** EVERY backend's samples while the check runs, tagged with its name (the manager forwards them, active or not). */
  feed(backend: BackendName, samples: PenSample[]): void
  witness(w: Witness): void
  /** Pairs for frame calibration come from the manager; the engine only reads the result via CheckDeps.currentFrame. */
  start(step: CheckStepId): CheckSnapshot
  tick(): CheckSnapshot
  cancel(): CheckSnapshot
  /** Ends the check and builds the report. */
  finish(): CheckReport
  snapshot(): CheckSnapshot
}

// ---------------------------------------------------------------------------------------------
// WebHID host and overlay deps (IMPL-B / IMPL-C)
// ---------------------------------------------------------------------------------------------

export interface WebHidDeps {
  /** A dedicated session (partition "pen-hid"): its permission handlers allow VID 0x056A and nothing else. */
  session: Session
  preload: string
  page: string
  log: (line: string) => void
}

export interface OverlayDeps extends SinkDeps {
  sink: Sink
  /** `containment.sinkWanted()`: when false the overlay backend is unavailable (no sink, so no overlay). */
  allowed(): boolean
}

/** The `dom` backend (IMPL-D, design 4.7): no OS resource, so its deps are only geometry. */
export interface DomDeps {
  /** DIP bounds of the display that contains a point on the virtual desktop, or null when it is on no display. Under E2E: the notes window's content bounds (an offscreen test window sits at -32000,-32000), so screen fractions equal client fractions. */
  displayAt(dip: { x: number; y: number }): Box | null
  /** The notes window's content bounds in DIP, or null; for the `coverage` fact. */
  windowBounds(): Box | null
  /** DIP work area (the display without the taskbar) of the display that contains a point; for the `work.*` facts of the reach hint. Optional so that tests compile without it. */
  workAreaAt?(dip: { x: number; y: number }): Box | null
}

// ---------------------------------------------------------------------------------------------
// The factories every implementer exports with EXACTLY these names (registry.ts imports them from minute 0)
// ---------------------------------------------------------------------------------------------

export type CreateWintabBackend = (mode: "data" | "system", paths: PenPaths) => PenBackend
export type CreateRawInputBackend = () => PenBackend
export type CreateWebHidBackend = (deps: WebHidDeps) => PenBackend
export type CreateOverlayBackend = (deps: OverlayDeps) => PenBackend
export type CreateDomBackend = (deps: DomDeps) => PenBackend & DomIngest
export type CreateSink = (deps: SinkDeps) => Sink
export type CreateLease = (options: LeaseOptions) => Lease
export type CreateContainment = (deps: ContainmentDeps) => Containment
export type CreateTrace = (paths: PenPaths, enabled: () => boolean) => TraceFile
export type CreateCheckEngine = (deps: CheckDeps) => CheckEngine
export type CollectEnv = (deps: EnvDeps) => Promise<EnvSummary>
export type CreatePointerRangeWitness = (onWitness: (w: Witness) => void) => { start(): boolean; stop(): void }

// FeedStatus / FrameTransform / Turn are re-exported for convenience of the main-process modules.
export type { FeedStatus, FrameTransform, Turn }
```

### 3.3 IPC in words (the code above is the truth; `PEN_CHANNELS` spells every name once)

| Direction | Channel | Payload -> reply | Notes |
|---|---|---|---|
| renderer -> main (invoke) | `pen:open` | `SheetGeometry` -> `FeedStatus` | the Tablet sheet is showing; idempotent; main keeps "wanted" and re-opens on focus |
| | `pen:close` | reason -> void | the sheet is gone / capture toggled off |
| | `pen:status`, `pen:settings`, `pen:settings-set` | -> `FeedStatus` / `PenFeedSettings` | |
| | `pen:check-start/step/cancel/copy`, `pen:contain-test`, `pen:frame-set`, `pen:reveal-trace` | see `PenApi` | check and diagnostics |
| renderer -> main (send) | `pen:sheet` | `SheetGeometry \| null`, on change and every 250 ms while open | main converts to physical px with `screen.dipToScreenRect(win, ...)` |
| | `pen:witness` | `Witness`, at most 30/s | DOM pen events: pen exists / where (calibration pairs); also the echo rule and mouse activity |
| | `pen:dom` | `DomPenReport[]`, at most one message per animation frame | everything the gate swallowed, coalesced events included, for the `dom` backend (4.7); main converts it to the screen frame |
| | `pen:panic` | reason | Esc with the focus outside a text field, Ctrl+Alt+G relay, chip button |
| main -> renderer | `pen:samples` | `PenBatch` | only the ACTIVE backend, screen frame, at most 8 ms apart |
| | `pen:status-push` | `FeedStatus` | state changes at once; counters at most 4/s (1/s when no UI is looking) |
| | `pen:event` | `FeedEvent` | toasts: "Pen: Wintab is live", "lost", "failover", "released" |
| | `pen:check` | `CheckSnapshot` | 4/s while a check runs |
| helper windows (private) | `pen:hid-*` (IMPL-B's files); `pen:sink-pen`, `pen:sink-mouse`, `pen:sink-beat` (`PEN_SINK_CHANNELS`, `window.wm.penSink`) | the hid ones are documented at the top of `webhidBackend.ts`; the sink ones in 7.6 | never exposed to the notes window; main checks the sender of each |
| E2E only | `pen:inject`, `pen:e2e-state`, `pen:e2e-config` | see `PenApi.e2e` | registered only when `WRITEMIND_E2E` |

Every handler verifies its sender (`event.sender === win.webContents` for the notes window; the sink and helper channels verify their own windows), as `grab.ts` does today with `fromNotes` / `fromOverlay`. The preload exposes `window.wm.pen: PenApi` (object, not flat functions). The old `grab*` API and `wm.onGrab` are removed in section 13 once nothing uses them.

### 3.4 The E2E injection hook

`window.wm.pen.e2e.inject(samples, backend?)` -> `ipcMain.handle("pen:inject")` -> `manager.inject(samples, "inject")`: the samples enter
exactly where a backend's samples enter (frame application, swap, liveness, trace), so the whole path from main to the
sheet is exercised by a test. `e2e.config({ native: false, backends: ["inject"] })` pins the backends (default under `WRITEMIND_E2E`);
`e2e.config({ capture: true })` turns capture on (it starts OFF under E2E: invariant 9), after which the gate swallows DOM pen events and the
`dom` backend carries them, so a test can also drive the whole `dom` path with ordinary dispatched pen events.
`e2e/lib/penfeed.mjs` (IMPL-D) adds helpers: `penFeedStroke(points, {pressure, buttons, turns})` builds timed samples, `penFeedHover`, `waitLive()`.

---

## 4. Backends and the priority ladder

### 4.1 The ladder

Priority only matters when several backends are live at once (the highest feeds the sheet); the others keep counting for the status and the check.

| Rank | `BackendName` | Reads | Why it is here | Side effects (all released, section 14) | Owner |
|---|---|---|---|---|---|
| 0 | `inject` | `pen:inject` | tests drive the whole path with no pen | none | D |
| 1 | `wintab-system` | Wintab **system** context, `lcSysOrg/Ext` = the sheet | capture **and** driver-level containment in one move; ranked first but **never tried blind**: a candidate only after the check proved `capabilities.driver = honored` and containment wants it | remaps the pen while on top; a leaked one keeps doing it, so the guard is mandatory | A (+C probe) |
| 2 | `wintab-data` | Wintab **data** context | the driver's own API: the most likely to deliver on a 6.4.x router driver; position and buttons independent of the pointer stack | an open context (leaks if killed: guard when ready, journal always) | A |
| 3 | `rawinput` | `WM_INPUT` for HID pen / digitizer collections, decoded with the shared HID decoder | no driver API needed; OS parser; background delivery proven with the vendor `Col02` heartbeat. Windows' own pen stack reads these same nodes (`Col03` / `Col04`), so reports exist; whether Raw Input is also handed them while Ink is on is the open question | a registration that dies with the process | A |
| 4 | `webhid` | `navigator.hid` in a hidden helper window | the same reports through a different door (a second handle on the collection, each with its own queue; `open()` is verified on the real Wacom with the driver running), a hedge if Raw Input is starved; **first thing to cut** | a helper window and a dedicated session | B |
| 5 | `dom` | the notes window's own pen events, reported by the gate on `pen:dom` (4.7) | **the floor**: needs nothing from the driver, no native call, no window, no OS state. Reaches the part of the tablet that maps onto the window (maximised: 97.5% of it); one barrel button; the display's frame rate | none | D |
| 6 | `overlay` | DOM pen events on the pen-sink window (4.5) | `dom` with the whole display as its reach. It exists because the sink exists (7.6), so it costs nothing extra; it carries the pen when the window does not cover the display and no native backend is live | a topmost transparent window (bounded by 7.6) | C |

Below the ladder there is only **capture off**: the person's switch (chip, Ctrl+Alt+G) gives the pen back to plain pointer behaviour over the whole window. It also
happens by itself when the window is not in front, the Tablet sheet is not showing, capture is disabled in the settings, or the synthesiser keeps throwing (8.4).

Probabilities (my estimate after the live probes of 2026-10-03 21:23-21:55 and the re-checks of 2026-10-04, to be replaced by the check's result): Wintab data delivers ~85%; Raw Input `WM_INPUT` for `Col03` /
`Col04` while Ink is on ~60%; WebHID report 213 ~55% (correlated with Raw Input; the open is verified); at least one of the three ~95%; `dom` ~90% (it needs only that
Windows Ink hands Chromium `pointerType: "pen"` events, which the pointer-device list suggests and nobody has watched); the pen sink effective ~75% (the same pointer stack on which the synthetic pen
proved it, 1.1); a Wintab system context honoured under Windows Ink ~25% (Ink reads the HID nodes itself, so the Wacom service may not be in the cursor path at all). This is why the first run starts Wintab
and Raw Input together, WebHID a few seconds later, and why nothing is decided here.

### 4.2 Wintab (IMPL-A: `wintab.ts`, `wintabNative.ts`, `wintabBackend.ts`) -- `wintab-data` and `wintab-system` are one class, `mode` differs

Port the spike drafts (`C:\CLAUDIO\spikes\wintab-spike\wintab.ts`, `wintabNative.ts`, `wintabPen.ts`) with the changes below; the spike's 54 tests move with them.

**Start (all of it inside `start()`, never throws, 4 s budget):**

1. `loadWin32()` / `loadWintab()` (koffi, x64 only). Not Windows or not x64 -> `available()` says so; DLL missing -> "wintab32.dll not found: the Wacom driver is not installed".
2. `recoverStaleContexts(paths.wintabJournal)` once per process (closes only a journalled handle whose `lcName` is `WriteMind pen <deadPid>`; **never** a guessed handle).
3. `WTI_INTERFACE`: `IFC_NDEVICES == 0` -> `{ok:false, retry:"after-replug", reason:"Wintab reports 0 tablets: Windows or the Wacom service says the tablet is not working"}`.
4. Read device 0 (X/Y/pressure/orientation axes, cursor list with the eraser set), the default data context (`WTI_DDCTXS`); everything goes into `status().facts` and the trace.
5. Owner window: `winmsg.createMessageWindow` (koffi WNDPROC). Its WNDPROC forwards `0x7ff0 + n` (`WT_PACKET`, `WT_PROXIMITY`, `WT_INFOCHANGE`, `WT_CTXOVERLAP`).
6. Context (`LOGCONTEXTW`, 212 bytes, layout checked in the spike): `lcName = "WriteMind pen <pid>"`, `lcOptions = CXO_MESSAGES` (+ `CXO_SYSTEM` for system mode), `lcPktData = mask`, `lcPktMode = 0`, `lcMoveMask = mask`, button masks all ones, `lcIn* =` the default context's, **`lcOut* = lcIn*`** (raw tablet units; orientation is the frame transform's business, section 6). System mode adds `lcSysMode = 0`, `lcSysOrg/Ext = sheetPhysical`. `WTOpenW(hwnd, ctx, TRUE)`, read back with `WTGetW` (trace what the driver stored), `WTQueueSizeSet(256)`, `highResTimer(true)`.
7. **Register with the guard immediately:** `ctx.lease.holdWintab(handle, mode)`. If it returns false: system mode -> `WTClose` at once and fail ("guard not ready: refusing a system context"); data mode -> continue (the journal covers it). Journal write follows.
8. **Mask ladder** (the packet layout has never met a real packet): `FULL = STATUS|TIME|CHANGED|SERIAL_NUMBER|CURSOR|BUTTONS|X|Y|NORMAL_PRESSURE|ORIENTATION`, `MIN = STATUS|TIME|BUTTONS|X|Y|NORMAL_PRESSURE`, `TINY = X|Y|NORMAL_PRESSURE`. After the first 20 packets, count *implausible* ones (x/y outside the context's in-rectangle by more than 1%, pressure above the axis max, time going backwards by more than 1 s, status bits above `0x1f`). Above 30% -> close, reopen with the next mask, trace `mask-fallback`. All of `FULL` is 4-byte fields, so the decoder has no padding questions.
9. **Poll loop:** `setInterval` 4 ms while a pen is in range and for 2 s after; 33 ms when idle; `WT_PACKET` triggers an immediate drain; each drain loops `WTPacketsGet(256)` at most 8 times. `timeBeginPeriod(1)` is reference-counted in `win32.ts` (Electron's default tick is ~15 ms, measured).

**FFI safety (revision 3, R11; applies to `wintabNative.ts`, `hid/hidNative.ts`, `hid/rawNative.ts`, `winmsg.ts`, `pointerRange.ts`).** Nothing in the tree has met a real packet in-process, and a native call that writes into a buffer we sized by arithmetic can corrupt the heap of the whole Electron main process.
1. **Size nothing by arithmetic alone.** Every buffer a native call writes into is allocated at twice the size the code computed (and at least 256 bytes), zero-filled, with an 8-byte canary (`A5 A5 A5 A5 A5 A5 A5 A5`) after the computed end. After each call the canary is checked; a broken canary is a fatal `BackendEvent error` ("buffer overrun in WTPacketsGet: expected 48 bytes a packet, the driver wrote more"), the backend is stopped and, because it is inside the breadcrumb window (5.8), is not restarted by itself. `WTPacketsGet(ctx, max, buf)` never asks for more packets than `floor(bufferBytes / (2 * packetSize))`.
2. **Assert the sizes the driver reports.** `LOGCONTEXTW` must be what `WTInfoW(WTI_DEFCONTEXT, 0, NULL)` returns (212 on this driver [verified]); the packet size computed from the mask is compared with a one-packet probe into a canary buffer before the poll loop starts (a mismatch moves down the mask ladder, step 8, or fails with both sizes in the reason).
3. **No native call inside a koffi callback** except `DefWindowProcW` (the WNDPROC only forwards `0x7ff0 + n` numbers to a queue the poll loop drains).
4. **`start()` is a chain of small awaited steps** (`await new Promise(setImmediate)` between native calls) so a slow step cannot starve the event loop for the whole 4 s budget, and each step is timed: a step over 750 ms is traced `slow-native-call` with its name. A call that never returns cannot be preempted (17.1 #5); the breadcrumb (5.8) is what keeps it from freezing the app on every launch.
5. Every `koffi.register` has its `unregister`; every struct and proto name is declared once per process (`WMP_` prefix); a `try`/`catch` around each native call turns a thrown koffi error into a `BackendEvent error` (fatal for 1 and 2, counted for the rest).

**Decode and normalise (pure, `wintab.ts`):** `x = (rawX - inOrg.x) / inExt.x`, same for y, clamped (negative extents are fine); **y is not flipped here** (the frame transform absorbs Wintab's y-up; its default guess has `flipY: true`); `p = pressure / axisMax`; `tip = (buttons & 1) || p > 0`; `lower = buttons & 2`, `upper = buttons & 4` (low word of `PK_BUTTONS` only; the logical numbers are `tip`, `barrel`, `barrel 2` per the driver's `CSR_BTNNAMES`; `swapButtons` is applied later by the manager, never here); `eraser = TPS_INVERT || cursor in the eraser set` (cursors 2 and 5 on this driver; Sean's pen has none, so expect cursors 1 and/or 4); tilt only when the orientation axes are non-zero; `t` from `PK_TIME` through the spike's `ClockAligner` onto the epoch clock (a batch that arrives together lets its newest packet set the offset so 10 ms spacings survive).

**In range (changed from the spike):** authoritative signals first -- `WT_PROXIMITY` (`LOWORD(lParam) == 0` = left) and `TPS_PROXIMITY` with **adaptive polarity** (assume "set = out" as the spec says; if more than 30% of contact packets in the first 20 carry the bit, flip it and trace `prox-polarity-flipped`). With no signal, a visit ends after `LEAVE_HOVER_MS` (600) of silence while hovering and `LEAVE_CONTACT_MS` (2000) in contact. **The spike's fixed 120 ms is too aggressive:** a perfectly still pen may send nothing and would be "lifted" mid-stroke. Exactly one leave sample (`inRange:false, p:0, tip:false`, buttons false, last position) per visit. This logic lives in `batcher.ts` (`VisitTracker`), shared with the HID backends.

**System mode extras:** implements `SystemMapped.setSheetPhysical(rect | null)`. `null` closes the context (the pointer is the driver's again). A new rectangle (debounced 150 ms, ignored under 2 px) **opens the new context first, then closes the old one**; the two coexist for under 50 ms. It is never started by the staged ladder (5.3). It works for every Orientation: the context only *contains* the pointer; the ink is placed by our own mapping (section 6), not by where the driver puts the cursor.

**Stop:** `stop()` is synchronous and idempotent: clear timers, `WTClose`, `lease.dropWintab`, `highResTimer(false)`, destroy the window, remove the journal entry. `closeAllWintab()` is also called from `before-quit`, `will-quit`, `window-all-closed`, and a `process.on("exit" | "uncaughtException" | "SIGINT" | "SIGTERM")` handler.

**Reason strings** (status `reason`, shown verbatim in the chip tooltip, the check and the diagnostics): the five above plus "WTOpen failed (GetLastError n)", "context opened but the driver stored a different packet mask (0x..)", "opened, 0 packets in 8 s while Windows saw the pen N times", "the driver closed our context (WT_CTXCLOSE)".

**Unverified:** that a single real packet decodes; `lcMoveMask` behaviour for a still pen; `PK_TIME`'s unit; proximity polarity (adaptive now); which logical button is physically lower (the check asks, 9.1); whether `WT_*` messages reach a koffi message-only window (polling is primary, so harmless); whether the router driver feeds Wintab at all under Windows Ink.

### 4.3 Raw Input + the shared HID decoder (IMPL-A: `hid/*`, `rawinputBackend.ts`)

**One decoder for both HID transports.** The spikes wrote two (`webhid-spike/src/hidPen.ts`, `rawinput-spike/src/hidLayout.ts + penSample.ts`). Merge them into `main/pen/hid/`:

* `layout.ts` -- a neutral flat layout: per report id, `fields[]` of `{page, usage, role, bitOffset, bitSize, signed, min, max, physMin, physMax, hasNull}` (buttons are 1-bit fields), plus the bit reader (`readBits`, little-endian, any size/offset, the WebHID `fixRange` for the Windows `-1` maximum quirk). Plain JSON: it goes into the trace next to the reports and replays offline.
* `decoder.ts` -- `PenDecoder(layout, opts)`: merges state across reports (position in one, tilt in another), Null-state aware, `tip` from Tip Switch else pressure > 0, `inRange` from the In Range field else `VisitTracker`, `lower` = Barrel Switch (0D:44) or Button 1, `upper` = Secondary Barrel (0D:5A) or Button 2, `eraser` = Eraser (0D:45) or Invert (0D:3C), tilt scaled through the physical range. **No rotation, no flip, no auto-"landscape" inside the decoder:** that is `frame.ts`'s job (6.2).
* **One position stream per device: the primary-report rule (revision 2, from the real descriptors).** The Wacom exposes the same pen several times. Raw Input lists `Col03` (pen, report 209) and `Col04` (digitizer, report 213) with identical fields, and the vendor `Col02` (report 220: X 0..15200, Y 0..9500, pressure 0..2047, no In Range, and an idle heartbeat `dc c0 00 .. 01` about every 5 s). WebHID shows ONE `HIDDevice` whose Digitizer collection carries 213 and whose vendor collection carries 220, and it has no Pen (0D:02) collection at all. Decoding every report would merge two coordinate scales and let the heartbeat decode as a pen in range at x = 0.013. So `layout.ts` / `decoder.ts` pick ONE primary report per device, the one with the best `penScore` (Tip Switch, In Range, pressure, barrel, tilt present; ties go to descriptor order), and ignore the other reports' position fields (they are still traced as raw). In Raw Input, where two collections stream the same pen, a `PrimaryPicker` keeps the first collection to speak and keeps it until it has been silent for 250 ms, so samples never duplicate or interleave. The vendor page (0xFF00) is traced and **not decoded**, except as a last resort: the backend switches to decoding `Col02` (x / 15200, y / 9500, pressure / 2047, tip = pressure > 0, no buttons) only after `Col02` delivered more than 3 reports in 2 s while `Col03` / `Col04` delivered none (a heartbeat is one per 5 s). Override for tests and the analyser: `reportIds: "all" | number[]`. Reference code: `webhid-spike/src/hidPen.ts` (`compileLayout().primary`, `defaultReportIds`), `rawinput-spike/src/penRawInput.ts` (`PrimaryPicker`).
* **Orientation from PHYSICAL extents.** Both logical ranges are 32767, so `DeviceInfo.aspect` and the orientation guess (`defaultFrame("hid", ...)`, 6.2) use the physical size (`physMax`: 15200 x 9500 = landscape); `DeviceInfo.rawX / rawY` stay the logical extents. (WebHID's `portraitNative` already does this.)
* `fromWebHid.ts` (`compileLayout` ported from the WebHID spike) and `fromHidP.ts` (the Raw Input spike's probed layout -> the same shape). Raw Input reports start with the report-id byte when the device uses ids; WebHID's `data` does not; `decode(layout, bytes, {includesReportId})` handles both. **Real fixtures to copy into `test/fixtures/pen/`:** `rawinput-spike/test/fixtures/wacom-ctl472.json` (Raw Input caps + probed layout, all four nodes) and `webhid-spike/test/fixtures/wacom-ctl472-real.json` (the WebHID collections), next to `ms-synth-pen.json` and `gamepad-real.json`. Revision 1 asked for model Wacom layouts; the real ones now exist, so the decoder tests use them (corners, pressure, both barrels, invert, tilt, hover, Null state, the heartbeat ignored).
* Tests merge the two spikes' (26 + 34): the real gamepad fixture, the Microsoft synthesized-pen caps fixture, model Wacom-style layouts (aligned and awkward: 12-bit pressure, signed tilt with Null state, two report ids, no tip switch), `dwCount > 1`.

**Backend (`rawinputBackend.ts`)**, ported from `penRawInput.ts`: enumerate (`GetRawInputDeviceList`), keep HID devices on the digitizer page (0x0D) or VID 056A, **excluding `Microsoft HID RID` (Windows' synthesized pen, screen pixels) unless `allowSynthetic`** (tests and the desktop suite set it), probe the layout from Windows' own parser (HidP), register usages 0D/02 and 0D/01 with `RIDEV_INPUTSINK | RIDEV_DEVNOTIFY` on a koffi message-only window, decode every report in every `WM_INPUT` (`dwCount > 1`), batch at `BATCH_MS`. Never `RIDEV_NOLEGACY`. The mouse usage (01/02) is registered **only inside the check** (`mouseProbe`), to learn whether the Wacom pointer node reports absolute (Pen mode) or relative (Mouse mode) -- it receives every mouse move on the system, so it lives for seconds, not minutes.

If there is no usable device the backend is `armed` with a reason ("no digitizer-page device with a pen layout is listed; Windows lists N HID devices: ...") rather than `failed`: nothing to retry, and a `GIDC_ARRIVAL` re-resolves it. `facts` carry `synthetic` (the candidate's device path starts with `\\?\Microsoft HID RID`: Windows' own synthesised pen, screen pixels), the descriptor summary (report ids, logical and physical ranges), which collection is primary, and every candidate device name. **`looksDriverMapped` is not decided from the logical range.** Revision 1 said "X/Y logical max in {32000, 32767, 65535}"; the real Wacom pen collection is 0..32767 over a physical 15200 x 9500, so that rule would have flagged it. A collection of VID 056A is treated as tablet-native; only the observed reach and the frame fit say anything about a mapping (a Wacom Mapping set to a portion of the screen shows up as partial coverage, advice row in 9.4). A `synthetic` device is still usable (it is the screen frame, identity) but only with `allowSynthetic`.

The Wacom's `Col01` ("Wacom Pointer") is a Raw Input **mouse** device whose name contains `VID_056A`. The check's `mouseProbe` recognises it by name and reports whether its events are absolute (Pen mode) or relative (Mouse mode); in Pen mode with Ink it is expected to stay silent. [unverified]

**Unverified (the open question):** that `Col03` / `Col04` stream `WM_INPUT` to a second reader while Windows Ink is reading them; which barrel switch is physically lower (`swapBarrels`); real pressure depth (the descriptor says 11 bit).

**FFI safety (4.2) applies here too:** the preparsed-data buffer is sized from the call's own return value and given the canary; a `RAWINPUT` read is bounded by the `dwSize` Windows reports; `HidP_*` output buffers are over-allocated and checked.

### 4.4 WebHID (IMPL-B: `webhid/*`, `src/preload/penHid.ts`, `src/helpers/pen-hid.html`) -- viable, last of the native three, first to cut

Viability, verified **on the real Wacom with the driver running** (webhid spike, 21:25-21:29): the permission plumbing, the device list (ONE `HIDDevice` "CTL-472" with three collections: Pointer `0x1:0x1` with no input reports, vendor `0xff00:0xa` with report 220, Digitizer `0xd:0x1` with the standard pen report 213), `open()`, and live delivery of the vendor heartbeat to the listener in four window configurations (visible, `show:false`, offscreen, offscreen with default throttling). The decoder is verified on the real descriptor with synthetic reports. What is missing is a stroke on report 213. It adds a hidden renderer process, so it starts last (5.3) and ships behind its own switch.

* **Host:** `new BrowserWindow({show:false, width:1, height:1, webPreferences:{session, preload: out/preload/pen-hid.cjs, contextIsolation:true, sandbox:false, nodeIntegration:false, backgroundThrottling:false}})` loading `out/helpers/pen-hid.html` (static; `src/helpers/` is copied by the existing `build.mjs` step and already unpacked from the asar), which loads `out/helpers/pen-hid.js` (an esbuild `iife` for the browser, from `webhid/hostPage.ts`). **The WebHID code runs in the page's own world, exactly as in the spike (verified); the preload is only a `contextBridge` bridge** (`window.penHid.samples / raw / status / onCommand`). WebHID inside an isolated-world preload is unverified, so nothing relies on it. `backgroundThrottling:false` is mandatory (measured: timers drop to 1 Hz otherwise). The page is not the notes window and never sees user data.
* **Session:** `session.fromPartition("pen-hid")`, **not** the default session, so the grant never reaches the notes window: `setDevicePermissionHandler(d => d.deviceType === "hid" && d.device.vendorId === 0x056A)`, `setPermissionCheckHandler((_, p) => p === "hid")`, `setPermissionRequestHandler((_, p, cb) => cb(p === "hid"))`, and `on("select-hid-device", (e, details, cb) => { e.preventDefault(); cb(pick ?? "") })`. Fallback if `getDevices()` lists nothing: `webContents.executeJavaScript("navigator.hid.requestDevice({filters:[{vendorId:0x056a}]})", true)` (user gesture).
* **Source:** the page runs the WebHID spike's `WebHidPenSource` on IMPL-A's shared decoder; pen-like collections only (`penScore > 0`: on the Wacom that is report 213 of the Digitizer collection; the Pointer collection has no reports and the vendor 220 loses to the primary-report rule, 4.3), `open()`, listen, hot-plug; it hands batches (`pen:hid-samples`), raw reports for the trace (`pen:hid-raw`) and per-collection status (`pen:hid-status`) to the preload bridge, which `ipcRenderer.send`s them. Main re-batches at `BATCH_MS`. Every refusal is a reason ("open() refused: NotAllowedError: Failed to open the device").
* **Cut rule:** if B runs short, ship the code and tests with `settings.backends.webhid = false` by default and say so in the final report. Nothing else depends on it.

### 4.5 The overlay as a backend (IMPL-C: `overlay.ts`)

Not a separate window: **a view on the pen sink** (7.6). The sink's page reports every pen event it receives (`pen:sink-pen`, the shape of `DomPenReport`) and the overlay backend turns them into `PenSample`s with `frameKind: "screen"`
(`x = (screenX - display.x) / (display.width - 1)` in DIP: the existing `displayFraction` rule, first and last pixel = the tablet's edges). It does no drawing and holds no sheet replica (the strip and the sheet live in the notes window, 8.6).
It is **started whenever the sink may arm** (`containment.sinkWanted()`, 5.3.4), whatever the native backends are doing, because a sink that absorbs the pen with nobody counting its events would be a pen that vanishes (7.6 (f)). It has the lowest rank, so it is *active* only when nothing above it is live:
no native backend, and `dom` silent. While the sink is on the notes window receives no pen events, so `dom` and `overlay` are never both receiving; they are the same question (where is the pen on the display?) answered by two windows, and the overlay's answer covers the whole display instead of the window.
When a native backend is live the sink still runs, for containment, and its events are only counted: validation (7.6), witnesses, calibration pairs. `settings.backends.overlay = false`, or `settings.contain` not in `auto | sink`, means no sink and no overlay backend.

### 4.6 What "available()" means (cheap, side-effect free, no I/O beyond a `fs.existsSync`)

| Backend | `available()` is `unavailable` when |
|---|---|
| all but `inject`, `webhid`, `dom` | not `win32`, or `process.arch !== "x64"`, or koffi failed to load |
| `wintab-*` | `%WINDIR%\System32\wintab32.dll` missing |
| `rawinput` | `hid.dll` missing (practically never) |
| `webhid` | `settings.backends.webhid` false, or the helper files are missing |
| `dom` | not `win32` (the whole feed is Windows-only, invariant 8), or `settings.backends.dom` false. It needs no koffi and no DLL |
| `overlay` | `settings.backends.overlay` false |
| all but `inject` and `dom` | `WRITEMIND_E2E` set without `WRITEMIND_PEN_NATIVE=1` (reason "native pen backends are off under E2E") |

### 4.7 The window pen, `dom` (IMPL-D: `main/pen/domBackend.ts`; reports from the renderer's `penGate.ts`) -- new in revision 2

**What it is.** The pen events that Chromium delivers to the notes window (`pointerType === "pen"`), taken by the gate (8.4) in the capture phase before anything else sees them,
reported to main on `pen:dom`, converted there to `PenSample`s in the screen frame, and fed to the sheet like any other backend's samples. Nothing native: no koffi, no helper window, no
OS state to release. `frameKind: "screen"` (no calibration), `PenSample.backend = "dom"`, display name "Window pen".

**Why it exists.** Every native backend depends on something nobody has seen yet: a packet, a report. This one depends only on Windows Ink handing Chromium real pen events, and the
pointer-stack probe (1.1) says Windows treats the Wacom as two real pen devices, which is how every pen-aware program on this machine gets its input. If Wintab, Raw Input and WebHID all
turn out silent, the sheet is still driven by the whole tablet instead of by the right-hand patch of it that happens to lie over the sheet. It also gives the check a ground truth
("Windows delivered N pen events to this page", with the pressure and buttons Windows exposes) and gives failover somewhere to land.

**Reports.** The gate sends one `DomPenReport` per event and per coalesced event (`getCoalescedEvents()`; `pointerrawupdate` as well if this Chromium delivers it, for the device's own rate
rather than the frame rate), batched into one `pen:dom` message per animation frame, always at full rate (about 60 small messages a second), so `dom` is a hot standby. A report with
`inRange:false` is sent when the pen leaves the document (`pointerout` / `pointerleave` with `relatedTarget === null`, or `pointercancel`); the backend's `VisitTracker` also ends a visit after
`LEAVE_HOVER_MS` / `LEAVE_CONTACT_MS` of silence.

**Conversion (`domBackend.ingest`).** With `b = deps.displayAt({x: sx, y: sy})` (DIP bounds of the display that contains the point): `x = clamp01((sx - b.x) / (b.width - 1))`,
`y = clamp01((sy - b.y) / (b.height - 1))` (the first and last pixel are the tablet's edges, as in the existing `displayFraction`); `tip = buttons & 1`; `p = pressure`; `lower = buttons & 2`
(Windows exposes ONE barrel button; `swapButtons` still applies); `upper = buttons & 4` (only when the driver maps a second button to the middle slot); `eraser = buttons & 32`; tilt as given.
The renderer does no display arithmetic: multi-display and scale live in the one place that has Electron's `screen`. `ingest` drops any report with a non-finite number and takes at most 512 reports per message; the `pen:dom` handler, like every handler, checks that the sender is the notes window.

**Reach.** It only sees the pen while the OS pen is over the window. Its `facts` (primitives only) carry `coverage.x` and `coverage.y`, the share of the display's width and height that the window's content
covers (a maximised window gives about 1.0 and 0.975 on Sean's display with its 30 px taskbar, a half-width window 0.5 and 1), and `cover.x0`, `cover.y0`, `cover.x1`, `cover.y1`, the rectangle itself as
fractions of the display, and `work.x0`, `work.y0`, `work.x1`, `work.y1`, the display's work area (without the taskbar) the same way, from the optional `DomDeps.workAreaAt`. They go into the chip tooltip ("reaches 97% of the tablet"), the check and the reach hint (7.7).
`coverage` for the chip is `min(coverage.x, coverage.y)`. **On Sean's saved window (1280 x 800 on 1920 x 1200) the reach is about 0.67 x 0.62**, so a first run that falls back to `dom` is a partial reach by default.
The advice is always the same: maximise the window (not full screen). `dom` shares one assumption with the old overlay: **the driver maps the whole tablet to the whole display** (the default,
and what the pointer-stack probe shows today). With a Wacom Mapping set to a portion of the screen, or the Area helper, `dom` shows partial reach and the check says so (9.4); switch capture
off for the Area helper (the pen then draws directly where it points).

**State machine.** The ordinary liveness rule (4 in-range samples, one moved; the manager's `unsent` buffer already hands the first samples of a visit to the sheet when a backend becomes active,
so none are lost). It goes back to `armed` when a visit ends. It is never `stale` or `failed`: its only witness would be itself. It starts with `open()` (not in a stage) and runs as long as
capture is on. Being live from the first stroke, it normally draws the first stroke after a start, and a native backend takes over at the next pen-up once it has been live for
`UPGRADE_AFTER_LIVE_MS` (5.4).

**Under E2E.** `displayAt` returns the notes window's content bounds (the offscreen test window sits at -32000,-32000), so `screenX` fractions equal client fractions. `dom` is available there (it is
not native), but capture starts off (invariant 9). **Tests must feed the gate trusted pen events** (CDP `Input.dispatchMouseEvent` with `pointerType: "pen"`, which is what the harness helpers do with `{ pen: true }`): a script-constructed `PointerEvent`, like the harness's `pe()`, has `screenX = screenY = 0` unless the test passes them, and the `dom` backend would then put every sample in the top-left corner.

**Unverified.** That the real pen reaches Chromium as `pointerType: "pen"` with pressure, tip and the barrel in `buttons` (inferred from the pointer-device list; no DOM pen event from the real pen
has been seen); that `PointerEvent.screenX/screenY` are right at display scales other than 100% (the e2e checks a device-pixel-ratio of 1.5 with CDP's `Emulation.setDeviceMetricsOverride`) and, should a page-zoom feature ever be added (there is none today: no `setZoomFactor`, no zoom menu role), not scaled by the zoom; the achieved event rate.

---

## 5. Auto-selection by liveness

Owner: IMPL-D (`manager.ts`, `state.ts`); the numbers are `LIVENESS` in `shared/pen.ts`.

### 5.1 Definitions (numbers live in `LIVENESS`; tests import them)

* A **witness** is evidence that a pen is near the tablet from a source other than the backend being judged: a DOM pen pointer event over the notes window (gate) or on the pen sink (7.6), a pointer-device in-range notification (`pointerRange.ts`, any window), or a check step that tells the person to move the pen. A witness holds for `WITNESS_HOLD_MS`.
* A backend is **live** when it delivered at least `LIVE_MIN_SAMPLES` in-range samples inside `LIVE_WINDOW_MS`, and at least one differed from its predecessor (`|dx|,|dy| >= 1e-4` or `|dp| >= 0.002`). "Moves" rules out a frozen or constant source.
* **Stale** needs a witness: silence with no witness just means the pen is not here. The one exception is `dom`, whose only witness would be itself: it is never stale or failed (4.7).

### 5.2 Per-backend state machine

| From | Event | To | Action |
|---|---|---|---|
| idle | manager starts it | starting | `start(ctx)` with `START_TIMEOUT_MS` |
| starting | `{ok:true}` | armed | |
| starting | `{ok:false}` or timeout | failed (`never` -> unavailable) | backoff by `retry` kind; trace `start-failed` with the reason |
| armed | live condition met | live | trace `live`; `FeedEvent live` |
| live | silent `STALE_AFTER_MS` **and** witness | stale | trace `stale`; if it was active, fail over (5.4) |
| live | the agreement monitor fails (6.3) | stale | reason "disagrees with Windows' own pen position"; fail over |
| stale | samples resume | live | |
| stale | still silent `FAIL_AFTER_MS`, witness continuing | failed | `stop()`; backoff |
| failed | backoff `BACKOFF_MS[i]` elapsed, window in front | starting | |
| failed | 3rd failure with a witness each time | demoted `DEMOTE_MS` | skipped by the ladder; the check and `prefer` still start it |
| any | blur grace, close, setting off, panic | idle | `stop()` |
| any | device arrival / re-plug / `powerMonitor` resume or unlock | starting | reset backoff and demotion |
| `dom` only | the gate reports a visit / the visit ends | armed <-> live | nothing else: it has no `starting`, `stale` or `failed`; it is started by `open()` and only follows the pen's visits |

### 5.3 Start policy (staged, measured from `open()`)

0. **`dom` is not staged.** It starts with `open()` whenever `settings.backends.dom` is on and stays for as long as capture is on (no cost: no native call, no window).
1. **Candidates** = `BACKEND_ORDER` minus `inject` (unless E2E), minus `settings.backends[x] === false`, minus `available()` failures, minus demoted, plus `wintab-system` only if `containment.driverMappingWanted()`, plus `overlay` only if `containment.sinkWanted()`. `settings.prefer` narrows the *native* candidates to that one backend; `dom` stays on beside it as the standby (a preferred backend that is silent leaves the pen on `dom`), unless `dom` itself is the one preferred.
2. **Stage 0 (immediately):** the persisted winner if it is still a candidate; with no winner, `wintab-data` and `rawinput` together. If the winner has not gone live within 3 s of the first witness, start the remaining cheap ones.
3. **Stage 1 (`STAGE_WEBHID_MS`):** `webhid`, only if no *native* backend is live and a witness has been seen since `open()` (or it is a first run). (`dom` going live does not stop this: it is the standby, not an answer.)
4. **The overlay is not staged any more (revision 3).** It is a candidate whenever `containment.sinkWanted()` is true (7.6 (d)(e): the setting allows the sink and no `ineffective` / `unsafe` record stops it) and it starts with the other cheap ones in stage 0, because the sink exists to contain the pen and the overlay backend is only a view on it (4.5). It has the lowest rank, so it is *active* only when nothing above it is live. `LIVENESS.STAGE_OVERLAY_MS` is deleted.
5. No witness for 20 s: start nothing more, wait; the stage timers restart at the first witness.
6. **The check starts every native candidate at once** (`wintab-data`, `rawinput`, `webhid`; not the system context and not the overlay, which are separate opt-in tests, 9.6) and ignores demotion.

### 5.4 Selection, switching, failover

* **Active** = the highest-priority backend in `live`. Sticky: the active stays while it stays live; a higher one takes over only after `UPGRADE_AFTER_LIVE_MS` of continuous liveness **and** with no tip down (never mid-stroke). `wintab-system` replaces `wintab-data` (the manager stops `wintab-data` once system is live and proven; never both open for more than the handover). With `dom` in the picture this is the normal course of a first run: `dom` is live after the first four events of the first stroke and draws it; a native backend that proves itself takes over at a later pen-up. The **first activation** takes everything of the visit (the `unsent` buffer), so the samples that proved liveness are not missing from the stroke.
* **Frame-settle rule (revision 3).** A backend with `frameKind: "device"` whose frame is still labelled `default` (a guess) does not take over from a live `screen`-frame backend (`dom`, `overlay`, `inject`) until its frame has been fitted (`source` is `cursor`, `dom`, `strokes` or `manual`, or it was saved by an earlier run) or it has been live for `FRAME_SETTLE_MS` (6 s), always at a pen-up. While it waits, the screen-frame backend keeps drawing and its witnesses feed the calibration (6.3), which normally lands within one or two waves of the pen. When nothing else is live a default-frame device backend is active at once (a guessed direction is better than no ink) and the chip says "direction guessed". In `reselect()` this is one more clause in the upgrade condition.
* **Failover:** if the active goes stale/failed, the best other live backend (at worst `dom`) becomes active at once; the manager sends a synthetic leave sample so the renderer ends any stroke, then `FeedEvent failover`. With none live (for a pen that is merely out of range this is normal), `active = null` and a leave batch goes out so the renderer ends any stroke; the gate stays closed (8.4), the chip reads "ready", and the next pen event makes `dom` live again within four samples.
* **Only the active backend's samples reach the renderer.** Others still update counters and feed the check engine.

### 5.5 What the manager does to every batch (in this order)

1. count (`Counters`, `rateHz`, `gapP95Ms`, `seen`, `reach`, `pressureMaxSeen`); 2. trace sampling (every 10th sample, capped); 3. **frame**: if `frameKind === "device"`, `applyFrame` with the backend's current `FrameRecord`; 4. **swap**: if `settings.swapButtons`, exchange `lower`/`upper`; 5. clamp (`clamp01`), drop NaN; 6. calibration pairs (6.3); 7. witness/liveness bookkeeping; 8. if the backend is active: `emit pen:samples`; 9. if a check runs: `check.feed(backend, samples)` for *every* backend, active or not.

### 5.6 Persistence of the winner

A backend becomes the persisted **winner** when it has been active for 3 s with at least 30 samples; stored with the device key and ISO time in `pen-state.json`. Invalidated when the device key changes (name or extents) or the backend is demoted. A winner that never reaches 30 samples is never stored. **Only a tablet-native backend (`isTabletNative`) is ever stored**: `dom`, `overlay` and `inject` are not answers to "which door works", and a stored `dom` would make the next run start with no native backend at all. (`manager.ts`: `persistWinner` and `endCheck` skip them, so a check that ends with only `dom` working leaves the stored winner alone; `stageStarts` uses `liveNative`, not `liveAny`, to decide the WebHID stage.)

### 5.7 What the manager must never do

Block the main thread for more than 10 ms in a tick (native calls are microseconds; a measured overrun is traced and halves the poll rate); start a native backend under E2E without the env switch; persist a winner it did not observe; enable containment on its own; call a backend method that can throw without a try/catch that converts it into `failed`; keep a backend running while the window is not in front (beyond the grace); write to disk more often than every 400 ms (the breadcrumb of 5.8 is the one synchronous exception); start a native backend without writing the breadcrumb first.

### 5.8 Crash and hang breadcrumb, and the kill switch (revision 3; IMPL-D `manager.ts`, `state.ts`, `registry.ts`)

**Why.** No real packet or report has ever been decoded in-process through koffi. A wrong struct size or a wedged driver call can crash or freeze the Electron main process, and an app that dies every time the Tablet source opens is worse than a pen that is merely imprecise. The staged liveness of this section copes with a backend that is *silent*; this copes with one that takes the app down.

**The breadcrumb.** `PenState.inFlight: Record<string, string>` (backend name -> ISO time).
* **Set** by `startBackend(name)` for every backend that makes native calls or opens a helper process (`wintab-system`, `wintab-data`, `rawinput`, `webhid`), then `store.flushSync()` (one small synchronous write, exempt from the 400 ms debounce of 11), **before** `backend.start()` is called. Never for `dom`, `inject` and `overlay` (no FFI; the overlay is the old Grab's window recipe, which has run on this machine).
* **Cleared** (and flushed) when: `start()` resolved not-ok, threw or timed out (the app survived); the manager stopped the backend normally (`stop()`, including `dispose()` at quit); or the backend has been running `LIVENESS.NATIVE_SAFE_MS` (30 s) since `start()` resolved. The first 30 s are the dangerous ones: it is when the first real packets and reports meet the decoders.
* **Read** at launch (`createStateStore` load, applied by `registry.ts` before any backend is created): an entry that is still there means the previous run ended inside that window (a crash; a hang followed by a kill; a power cut; or the person ending WriteMind within 30 s of opening the Tablet source). For each such backend: `settings.backends[name] = false`, `faults[name] = { at, note: "the app stopped within 30 s of starting this backend last time" }`, trace `crash-suspect`, `inFlight` cleared.
  `unavailableReason(name)` then returns "switched off after the app stopped while it was starting (turn it on again in the Pen menu to retry)"; the chip appends " - Wintab is off after a crash" (severity warn) while no native backend is live; the check shows the row as `skipped` with that reason. Turning the switch back on clears the fault.
* **False positives** are accepted: a person who ends the app inside the window loses one backend until he turns it on again. The alternative is a crash loop with nobody home.
* **Several backends in flight** (the first run starts two) are all switched off: the manager cannot tell which one did it, and `dom` (never switched off) still carries the pen. Re-enabling is one at a time from the Pen menu, so the second crash, if there is one, names its culprit.

**The kill switch.** `WRITEMIND_PEN=off` in the environment, or an (empty) file named `pen-off` in the userData folder, makes the manager `available: false` with the reason "pen capture is switched off (pen-off / WRITEMIND_PEN)": no chip, no gate, no backend, no guard, the sheet behaves as it did before this feature (a plain pointer on the sheet). It is for a launch where the pen subsystem itself is the problem; it is checked once at startup, before anything native is loaded, and it is in the runbook (16.2).

---

## 6. Frames, orientation, mapping

### 6.1 Two frames and one transform

* **Device frame** -- what a backend can know on its own: x along the tablet's long side, origin top-left, y down, *as the backend guesses*. Wintab's raw frame is y-up and (on this driver) portrait; HID is y-down.
* **Screen frame** -- where the driver would put the cursor if the whole tablet were mapped to the whole display. This is the frame the old overlay used (`displayFraction`), so `tabletToSheet(p, turns)` and every existing orientation test stay valid unchanged.
* **`FrameTransform {turn, flipY}`** (8 possibilities) takes the device frame to the screen frame. It is applied **once, in the manager** (5.5 step 3). `frameKind: "screen"` backends (inject, dom, overlay) skip it.

### 6.2 Defaults (IMPL-A, `frame.ts: defaultFrame(family, device)`)

| Family | Guess | Source label |
|---|---|---|
| wintab | raw extents portrait (X max < Y max; **measured live on this machine: X 0..9499, Y 0..15199**, while the default context's out extents are landscape, so the driver turns it): `{turn:1, flipY:true}`; landscape: `{turn:0, flipY:true}`. The direction of the turn (1 or 3) and the y origin are only a guess: the pairs settle them | `default` |
| hid (rawinput, webhid) | from the PHYSICAL extents (both logical ranges are 32767; the Wacom's are 15200 x 9500 = landscape): X >= Y: `{turn:0, flipY:false}`; else `{turn:1, flipY:false}` | `default` |
| dom, overlay, inject | identity | `screen` |

A default is a guess. The chip says "pen direction: guessed" and the check fixes it.

### 6.3 Calibration (IMPL-A: `frame.ts` pure; IMPL-D feeds it)

* **Pairs** `{raw: {x,y} device-frame sample, screen: {x,y} fraction of the display the window is on}` are collected from (a) `Witness.screenDip` of DOM pen events (from the notes window, and from the sink while it absorbs the pen, 7.6), converted by main to display fractions with `screen.getDisplayNearestPoint` (**the primary source**: it works in Windows Ink mode even when the OS cursor does not follow the pen, because the pointer stack still reports the position), and (b) polling `screen.getCursorScreenPoint()` in main for the last in-range sample of each batch (Pen mode puts the cursor where the pen is). Only pairs where the pen sample moved (`>= 1e-3`) and the pointer moved in the same batch interval (+-40 ms); **pairs within 200 ms of a DOM *mouse* event are dropped** (the person is using the mouse, so the cursor is not the pen's); at most 400 kept.
* **Algorithm (replaces the spike's RMS-to-the-display fit, which assumed the tablet maps to the whole display):** for each of the 8 transforms, Pearson-correlate the transformed raw x with the screen x and the transformed raw y with the screen y; score = the smaller of the two. Correlation ignores scale and offset, so a driver *Portion of screen* mapping, a sheet-sized system-context mapping, or partial coverage do not matter. Accept the best when `score >= 0.9`, the runner-up is `<= 0.6`, each axis' standard deviation of raw is at least 0.08, and `|corr(raw.x, raw.y)| < 0.8` (a diagonal-only scribble cannot tell a transpose from the identity). If a candidate's plain score is below 0.9 it is recomputed after dropping the worst 20% of pairs by residual (a per-axis least-squares line): that tolerates the ~18% of pairs a moving mouse or a late cursor read can spoil, and still refuses pure noise. Needs at least 24 pairs; re-run every 40 new pairs; replace a `default`/`cursor`/`dom` result only by a better score. **Reference sketch, tested (33 synthetic cases): Appendix A.1.**
* **Strokes** (manual, from the check): the spike's `inferFrame(leftToRight, topToBottom)`: "move the pen along the long edge from left to right, then from top to bottom" (hover is enough and is what the check asks for, 9.1). Source `strokes`.
* **Manual:** `pen:frame-set` with a `FrameTransform` (the check's "turn it / mirror it" buttons on a live preview) -> source `manual`; `null` returns to automatic.
* **Agreement monitor (self-diagnosis against "green but wrong").** Once a frame from `cursor` / `dom` / `strokes` is in force, every 40 new pairs the manager recomputes the score of the *current* frame. Below 0.6 twice in a row (with >= 60 pairs) the backend is declared `stale` with the reason "disagrees with Windows' own pen position (score 0.31)": failover is tried (the next live backend, at worst `dom`, which is Windows' own position by construction), the chip warns, and the trace records `disagree`. A `manual` frame is exempt (the person chose it). `facts.agreement` shows the latest score.
* Persist per `family:deviceName:rawXxrawY` in `pen-state.json`. `FrameRecord` carries source, rms, margin, time.

### 6.4 Orientation and the sheet (unchanged, reused)

The renderer maps a screen-frame sample with `tabletToSheet({x,y}, turns)` (`shared/orientation.ts`). `turns` is the person's Orientation setting ("how the tablet is turned relative to the screen"); the sheet's aspect is already `sheetAspectFor(screenAspect(), turns)`. For Sean the tablet is 16:10 and so is the display, so the whole tablet lands on the whole sheet without distortion. *Later (P2):* when a backend reports `DeviceInfo.aspect` and it differs from the sheet's by more than 3%, the sheet can adopt the tablet's physical aspect so circles stay circles (`currentSheetAspect()` reads a `penAspect()`); not needed for this tablet.

---

## 7. Containment policy

Owner: IMPL-C (`lease`, `guard`, `clip`, `sweep`, `containment`, `overlay`, `panic`, and the renderer's `SheetStrip` / `SheetReach`); the manager (IMPL-D) feeds `containment.update()` on every sheet, window, witness and active-backend change.

### 7.1 The honest picture: what a stray pen tap can reach

With the feed live and nothing containing the pen, the OS still sends the pen's pointer input to whatever is under it. [verified for a synthetic pen; the real one unverified]

| Where the pen's OS position is | What a tap or stroke does | Stopped by |
|---|---|---|
| the notes page (editor, sidebar, toolbars) | nothing: the gate swallows DOM pen events | the gate (8.4) |
| WriteMind's own frame: title bar, caption buttons (**close**), resize edges | acts (non-client area, not DOM) | the sink, the driver mapping |
| the rest of the desktop, another application | acts, and takes the foreground (then capture releases on blur) | the sink, the driver mapping |
| the taskbar | acts | only the driver mapping, or a hidden / absent taskbar (the sink cannot cover Explorer's band) |

Damage is bounded (notes autosave; a stray click is a stray click) but real, and **on Sean's window it is the common case**: the window is 1280 x 800 on a 1920 x 1200 display (1.1), so about 60% of the tablet maps to something that is not the notes page.
That is why revision 3 tries the pen sink automatically (7.2) instead of waiting for an optional test, and why the reach hint is P1 (7.7). With the window **maximised** (not full screen) the OS pen is over the page everywhere except the taskbar band (2.5% of the
tablet's height on Sean's display) and the native title-bar caption buttons, so only the last rows of the table stay open: that costs nothing, needs no proof, and is why `dom` reports its coverage (4.7).

### 7.2 Principles

1. **Earned in proportion to what a mechanism leaves behind.** A mechanism that dies with the process and is undone by an ordinary mouse event (the **sink**: a window of ours) is *tried automatically*, inside the bounds of 7.6, and judges itself from what it
   observes (`untested` -> `effective` / `ineffective` / `unsafe`, kept per display configuration). A mechanism that changes OS state which outlives the process (a Wintab **system** context = `driver`, and `ClipCursor` = `clip`) needs a ready guard **and** a proof on this machine
   (a test from the check, or the person's explicit choice) before it arms. (Revision 2 asked for a proof for the sink as well; with Sean's window not maximised that would have left most of the tablet uncontained until he ran an optional test.)
2. **One mechanism at a time:** driver > sink > clip. A proven driver mapping replaces the sink for containment; the overlay backend can still count what the sink sees.
3. **Fail closed.** No guard -> no system context, no clip. Any doubt about the sink (no fresh pen signal, no consumer for what it swallows, a mouse event, a page that stopped answering, a tip down) turns its hit-testing OFF, never on. A mechanism that misbehaves is marked `unsafe` and never retried on its own.
4. **A closed list of release triggers** (7.4), all tested with fakes.
5. **Never full-screen-looking.** The sink keeps `overlayBounds`, tool-window style, `focusable:false`, hidden unless the notes window is in front.
6. **Visible.** The chip tooltip and the popover say which mechanism is armed ("contained: overlay"), whether it is still on trial, or "not contained".

### 7.3 The mechanisms

| | `driver` (Wintab system context) | `sink` (transparent overlay window) | `clip` (ClipCursor) |
|---|---|---|---|
| What it does | The driver maps the whole tablet onto the sheet's pixel rectangle; the OS pen cannot leave it | A topmost, non-activating, transparent window over the display, hit-testable **only while a fresh pen signal exists** (7.6); it swallows the pen, and the OS arrow is hidden while it is on | Confines the *mouse-class* cursor to the sheet rectangle |
| Valid when | Wintab system context proven `honored` | `contain` is `auto` or `sink`, `backends.overlay` is on, the capability is not `ineffective` / `unsafe` for this display configuration, and a consumer for what it swallows exists (7.6 (f)) | `pointerMode == "mouse"` measured, or explicit; **does not contain a Windows-Ink pen** [verified, synthetic] |
| Proof | 5 s probe in the check (9.6) | none needed to arm: it validates itself during use (7.6). The check's optional "Test overlay" forces the same measurement and can clear an `ineffective` record | none (a driver-mode fact) |
| Rectangle | `sheetPhysical`, exact | the display minus `OVERLAY_MARGIN` at the bottom | `sheetPhysical`, right/bottom exclusive (Win32 RECT), `validateClipRect` (>= 240 x 160, inside the virtual screen, not the whole screen) |
| State outside the app | Wintab context (guard closes it by name) | none (the window dies with the process; heartbeat 6 s) | the OS clip (guard releases it) |
| Known holes | DPI scaling other than 100% may mis-map (the proof is per scale); another Wintab program on top | the taskbar band; the real mouse is blocked while a pen signal is fresh, until a real mouse event reaches the sink (it then turns itself off) | useless for a Pen-mode tablet |

### 7.4 Arm conditions, rectangle, release triggers

**Arm** only when *all* hold: `settings.enabled`; the window is focused, visible, not minimised; the sheet geometry exists and is >= 240 x 160 CSS px; the capability for the mechanism is not `ineffective` / `unsafe` (a record made at another display configuration counts as `untested`);
not panic-suspended; **no check is running** (9.2: the check measures the window's own pen events, so the sink must not absorb them; the explicit sink test is the exception); plus per mechanism: driver -> the feed is `active` and live, the guard is ready, `wintab-system` is live and `capabilities.driver` is `honored` (or `contain: driver`);
sink -> the sink window is shown (click-through at all times except while 7.6's conditions for `on` hold); clip -> guard ready, a pen is in range, nothing foreign is clipping, `pointerMode == "mouse"` (or `contain: clip`).

**Rectangle.** Main computes `sheetPhysical = screen.dipToScreenRect(win, {content.x + sheet.rect.x, content.y + sheet.rect.y, w, h})`, rounded, on every `pen:sheet` and on the window's `move`/`resize` (debounced 100 ms). Correct at 150% and on a second monitor because Electron does the DIP-to-physical conversion per display.

**Release triggers (the closed list; each is a `DisarmReason` in the trace):**

| Reason | Trigger | Applies to |
|---|---|---|
| `blur`, `hidden`, `minimized` | the window is not in front (containment lets go at once; backends after `BLUR_GRACE_MS`) | all |
| `sheet-gone` | tablet source left, sheet under the minimum size, `pen:close` | all |
| `esc` | Escape pressed in the window while the keyboard focus is **not in a text field** (8.8) | all |
| `panic` | Ctrl+Alt+G (global while anything is armed), the chip's Release, `pen:panic`; `free-pen` from outside | all |
| `pen-out` | no fresh pen signal for `SINK_PEN_OUT_MS` (400 ms): the sink goes click-through; the clip is freed; the driver mapping stays until `idle` | sink, clip |
| `mouse` | a real mouse event (not the pen's echo) reached the sink while it was `on`: it turns itself off at once (at the pen-up if a tip is down) and stays off until no pen signal has been seen for 1.5 s (7.6) | sink |
| `idle` | no pen activity of any kind for 20 s | all |
| `display-changed` | `display-metrics-changed` / added / removed, scale change | all |
| `lock`, `suspend` | `powerMonitor` lock-screen / suspend; re-evaluated on unlock / resume | all |
| `lease` | the guard says the app stopped beating (a hang) | driver, clip |
| `guard-lost` | the guard process died; the app undoes the state itself at once | driver, clip |
| `foreign-clip` | another program's clip is active | clip |
| `no-consumer` | nothing is counting what the sink swallows (7.6 (f)): the native backend went stale and the overlay backend is off | sink |
| `ineffective` | the sink's passive validation failed (7.6): disarm, record, no automatic retry on this display configuration | sink |
| `unsafe` | the mechanism misbehaved: a system context while `GetCursorPos` is outside the rectangle for 3 consecutive beats; a sink `on` for 60 s with no pen signal, or hit-testing still on 3 s after an off order, or its page stopped beating while `on`; a clip that is not the armed rectangle after 2 beats | that mechanism (marks the capability `unsafe`) |
| `quit` | before-quit, window closed, renderer gone | all |

### 7.5 The lease and the guard (a clip and a Wintab context both outlive their process)

Ported from the containment spike (`C:\CLAUDIO\spikes\contain-spike\clip.ts`, `guard.mjs`, `guard-proof.mjs`: 38 unit tests and real-process proofs), extended to hold Wintab handles. **The sink is not part of this: it is process-bound.**

* **Process.** `process.execPath` with `ELECTRON_RUN_AS_NODE=1` runs `out/main/pen-guard.mjs` (esbuild entry from `src/main/pen/guard.ts`), spawned lazily at the first `pen:open` (not at every app start), **`detached: true`**, `windowsHide: true`, `stdio: ["pipe","pipe","ignore"]`, `unref()`. `detached` is mandatory: libuv puts non-detached children in a job object that kills them with the parent [verified]. The guard loads its own tiny koffi bindings (`ClipCursor`, `GetClipCursor`, `WTGetW`, `WTClose`); it imports nothing from the app.
* **Protocol** (one text line per message). stdin: `arm L T R B leaseMs`, `beat`, `free`, `hold-wintab <handle> <appPid> <mode>`, `drop-wintab <handle>`, `status`, `quit`. stdout: `ready`, `armed ...`, `freed <why>`, `foreign <why>`, `expired`, `closed-wintab <handle> <why>`, `err <msg>`.
* **Release rules.** On stdin EOF (~14 ms after the app dies [verified]), lease expiry (800 ms without `beat` [verified: 807-851 ms]), `free` or `quit`: the clip is released **iff `GetClipCursor` still equals what the guard set**; each held handle is closed **iff `WTGetW(handle).lcName == "WriteMind pen <appPid>"`** (it never closes anything it cannot identify -- the Wintab spike closed one of the driver's own contexts by guessing a handle, and this rule exists because of it). Beats every 250 ms while anything is held.
* **Journal.** `pen-leases.json`, rewritten by the guard on every change: `{guardPid, appPid, clip, wintab:[{handle, mode}], at}`.
* **Startup sweep** (`sweep.ts`, before anything arms; `lease.start()` waits for it): journal says a previous run held something and both its pids are dead -> clip: `staleClipDecision` (release only our recorded rectangle, leave a foreign clip alone); Wintab: `recoverStaleContexts` by name + dead pid; delete the journal.
* **The one residual trap:** app and guard both killed (Task Manager "End task" on the tree) -> the next launch's sweep, or `tools/free-pen.cmd` (C writes it: releases any clip, closes `WriteMind pen *` contexts whose pid is dead via P/Invoke, prints the driver's context count; Sean double-clicks it).
* **Packaged build:** `pen-guard.mjs` and `node_modules/koffi/**` are `asarUnpack`ed. If `detached` spawn fails (a launcher job without breakaway) or the `RunAsNode` Electron fuse is disabled in the packaged app (it must stay enabled), the lease reports `lost`; driver and clip are then refused (never fall back to an in-process clip), data contexts continue without the guard, and **the sink is unaffected**. [unverified in a packaged build]

### 7.6 The pen sink (the demoted Grab overlay)

**Window.** The existing `grab.ts` recipe (type `toolbar`, transparent, frameless, `alwaysOnTop` `floating`, `skipTaskbar`, `focusable:false`, `fullscreenable:false`, bounds `overlayBounds(display)` set twice, shown with `showInactive`, hidden unless the notes window is focused + visible + not
minimised; follows the window to another display). The page paints `rgba(0,0,0,0.01)`: fully transparent pixels fall through (1.1, measured). **E2E:** never hidden for focus (as today).

**Page.** `renderer/PenSink.tsx` on `?pen-sink=1` (replaces `?grab=1`). Renders nothing; `cursor: none` (the arrow is hidden while the sink is on; the ring on the sheet shows where the pen is). Swallows pen pointer events (`preventDefault`, `contextmenu` too).
Talks to main on private channels (`PEN_SINK_CHANNELS`, 3.1; never exposed to the notes window; main checks the sender is the sink window): `pen:sink-pen` (one message per animation frame, every coalesced pen event as the shape of `DomPenReport`), `pen:sink-mouse` (the first real mouse event while the sink is on, echo excluded), `pen:sink-beat` (1 s).

**States.** `hidden` (the notes window is not in front, or capture is off, or the sink is not allowed) -> `shown` (visible, click-through: `setIgnoreMouseEvents(true)`) -> `on` (hit-testable: `setIgnoreMouseEvents(false)`). `shown` is invisible and costs the person nothing. Only `on` can touch the mouse.

**`on` requires ALL of:**
* (a) a **fresh pen signal**, seen within `SINK_SIGNAL_MS` (1500 ms): a started backend's visit is open (it reports the pen in range; the active one or not); or a `dom` witness with a pen came from the notes window; or the pointer-range witness says in range; or the sink itself saw a pen event;
* (b) **no tip is down** anywhere (a backend's `tipDown`, a witness with `buttons & 1`, the sink's own events): hit-testing never flips mid-stroke, in either direction;
* (c) it is not **mouse-locked** (a real mouse event reached the sink earlier in this pen visit, below);
* (d) the capability is not `ineffective` or `unsafe` for this display configuration;
* (e) `settings.enabled`, `settings.contain` is `auto` or `sink`, and `settings.backends.overlay` is on;
* (f) a **consumer** exists for what the sink swallows: a live native backend, or the overlay backend is started (it counts the sink's events as samples). The pen is never absorbed into nothing.

**`off`** when (a) fails for `SINK_PEN_OUT_MS` (400 ms), when (c) turns true, when (d)-(f) fail, on panic / blur / idle / display change (7.4), or when the page stops beating (6 s -> destroy). Re-evaluated on every manager state change and every 100 ms.

**Mouse always wins.** A real mouse event (`pointerType: "mouse"`, and not the pen's echo: no pen tip sample in the last `ECHO_MS` = 300 ms, from any source) reaching the sink while it is `on` turns it `off` at once and locks it off until no pen signal has been seen for 1.5 s. Traced `sink-mouse-wins`. **Not in the middle of a stroke:** with a tip down the mouse event is remembered and takes effect at the pen-up (the mouse waits for the length of one stroke), because turning the sink off under a stroke would drop the rest of it onto whatever lies beneath.
A click cannot be lost this way in practice: while a pen drives the cursor, a mouse move always arrives before a mouse click, and the move is what turns the sink off. The price of the rule is that a person who alternates pen and mouse without lifting the pen out of range writes with the sink off for the rest of that visit.

**Pen as mouse.** If a mouse event reaches the sink within 300 ms of it turning on, on three pen visits in a row, while a native backend reports the pen in range, the pen is arriving here as mouse input (Mouse mode, or Ink off). The sink then records `ineffective` with the note "the pen reaches this window as mouse input" and the advice for `pointerMode == "mouse"` (9.4) applies. This keeps a Mouse-mode tablet from flipping the sink on and off at every visit.

**Passive validation** (so that no test is needed). When the sink turns `on` it records the counters; every 100 ms for up to `SINK_VALIDATE_MAX_MS` (5 s):
* with a native backend live: once at least `SINK_MIN_NATIVE` (30) in-range native samples have been counted, `ratio = sink pen events / native in-range samples`. `ratio >= SINK_EFFECTIVE_RATIO` (0.10) -> `effective`. After `SINK_VALIDATE_MS` (1500 ms) with `ratio` still below it -> `ineffective`.
* with no native backend live: a pen signal from before the sink turned on (pointer-range, or DOM events from the notes window) is the reference. At least 10 sink pen events within 1500 ms of turning on while that signal holds -> `effective`; none, while the signal still holds, -> `ineffective`. Anything ambiguous is `ineffective`: **when in doubt, turn off.**
* Either decision is saved with the display bounds and scale (`capabilities.sink`). `ineffective` disarms at once and is not retried automatically at this display configuration (the check's "Test overlay" or `contain: sink` retries). `effective` stops the measuring but not the counting (diagnostics).
* `unsafe` (never retried automatically): `on` for `SINK_MAX_ON_MS` (60 s) with no pen signal at all; hit-testing still on 3 s after an off order; the sink page stopped beating while `on`.

**Witness (R17).** Each sink pen event is also reported to the manager as a `dom` witness (<= 30/s, with `screenDip` and `buttons`; the sink page is a page of ours) so that stale detection and calibration pairs keep working while the sink absorbs the pen from the notes window.

**Pointer-range witness (IMPL-B `pointerRange.ts`):** `RegisterPointerDeviceNotifications(hwnd, TRUE)` on a koffi message-only window; messages 0x238 change / 0x239 in range / 0x23A out of range; the device type is read with `GetPointerDevice`; `(NULL, FALSE)` on stop. [verified with a synthetic pen; the real Wacom unverified.]
**It ignores synthetic devices (R4):** Windows lists a permanent `\??\Microsoft HID RID\000D_0002\1` INTEGRATED_PEN (a pen injected by some other program, with a screen-sized rect) next to the real pens (1.1); a notification whose device's product string starts with `\\?\Microsoft HID RID` or `\??\Microsoft HID RID` is not a witness, or it would "see" pens that are not on this tablet.
Without a pointer-range witness (it may not fire for the real pen) the sink still arms from the other signals: the first DOM pen events over the notes window arm it, and its own events keep it armed. What stays uncovered is a pen that comes into range *outside* the window and goes down without ever crossing it.

**The same module lists the pointer devices** (`listPointerDevices(): PointerDeviceSummary[] | null`, read-only: `GetPointerDevices` then `GetPointerDeviceRects` per device) for `env.ts` (`EnvSummary.pointerDevices`, 9.1) and the check ("Windows lists two pen devices for this tablet: CTL-472 INTEGRATED_PEN and EXTERNAL_PEN, 15201 x 9501, mapped to the whole display").
x64 layout of `POINTER_DEVICE_INFO`, 1080 bytes: `displayOrientation` u32 @0, `device` HANDLE @8, `pointerDeviceType` i32 @16, `monitor` HANDLE @24, `startingCursorId` u32 @32, `maxActiveContacts` u16 @36, `productString` WCHAR[520] @38 (the working C# declaration is in `C:\CLAUDIO\spikes\wdesign\enum-readonly.ps1`, which also prints the Raw Input device list;
real output on this machine: `C:\CLAUDIO\spikes\wdesign\enum-readonly-2026-10-03.txt`). A real-OS test (`WM_PEN_REAL=1`) may call it: it only reads.

**Constants** (C exports them as `CONTAIN` from `containment.ts`; tests import them, nobody inlines them): `SINK_SIGNAL_MS` 1500, `SINK_PEN_OUT_MS` 400, `MOUSE_LOCK_CLEAR_MS` 1500,
`ECHO_MS` 300, `SINK_VALIDATE_MS` 1500, `SINK_VALIDATE_MAX_MS` 5000, `SINK_MIN_NATIVE` 30, `SINK_EFFECTIVE_RATIO` 0.10, `SINK_MAX_ON_MS` 60000, `IDLE_RELEASE_MS` 20000, `HEARTBEAT_MS` 1000, `HEARTBEAT_TIMEOUT_MS` 6000.

### 7.7 Defaults, in one place

`contain: "auto"` = the **sink on auto-trial** (7.6) and nothing else; the driver mapping only after the check proved it here and now (or `contain: driver`); `clip` only if `pointerMode == "mouse"` was measured or the person chose it; `contain: none` turns every mechanism, and the overlay backend, off.
A sink that validates `ineffective` leaves the pen not contained and the chip says "not contained" (and why in the tooltip). Nothing OS-wide that outlives the process is ever armed unattended on an unproven mechanism.

**What costs nothing and helps today: keep WriteMind maximised** (a normal maximised window, never full screen). The chip tooltip and the check say so whenever `dom`'s coverage is below 0.9.

**Reach hint (priority P1, IMPL-C writes `renderer/SheetReach.tsx`, IMPL-D mounts it).** The sheet shows hatched strips over the part of the tablet whose OS position lies outside the WriteMind window: the complement of the window's content rectangle in the screen frame, mapped through `tabletToSheet` like everything else.
For a maximised window that is only a strip along the bottom edge for the taskbar band (the pen's samples there are still drawn, but a tap there clicks the taskbar, and the hatch says so); on Sean's saved window it is most of the sheet's border. The rectangle comes from the `dom` backend's facts (`cover.x0`, `cover.y0`, `cover.x1`, `cover.y1`: the window's content
rectangle as fractions of its display; `work.x0`, `work.y0`, `work.x1`, `work.y1`: the display's work area, i.e. without the taskbar, the same way, from the optional `DomDeps.workAreaAt`), so the contract needs no new field; with no `dom` backend or no window bounds there is no hint.
With the sink armed and `effective` the hint shows only what lies outside `work` (the taskbar band: the sink cannot cover Explorer); otherwise it shows what lies outside `cover`. It is advice drawn on the sheet, not a mechanism: nothing is blocked.
Props: `{ cover: Rect01 | null; work: Rect01 | null; turns: Turn; containedBySink: boolean }` with `Rect01 = { x0: number; y0: number; x1: number; y1: number }` (fractions of the display, y down).

---

## 8. Renderer consumption

Owner: IMPL-D.

### 8.1 Data path

`pen:samples` (a `PenBatch`, screen frame) -> `penFeed.ts` -> for each sample: `u = tabletToSheet({x,y}, turns)` -> client point `sheetRect.left + u.x * width` (`sheetRect` = the `[data-tablet="surface"]` rectangle, read on each batch from a cached value refreshed by the same 250 ms/resize loop that sends `pen:sheet`) -> the **synthesiser** -> real `PointerEvent`s dispatched on `document.elementFromPoint(x, y)`, bubbling and composed, with `emitting = true` around the dispatch so the gate lets them through. No sheet rectangle (pane hidden) -> drop the batch. Orientation changes apply to the next sample (no history is rewritten). For the `dom` backend the loop closes through main (gate -> `pen:dom` -> `domBackend` -> manager -> `pen:samples` -> synthesiser, about 1-3 ms for the two hops), so that liveness, the trace, the check and failover see it like any other backend.

### 8.2 Why synthetic events instead of a new draw path

The e2e harness has driven the sheet and the notes page with exactly `el.dispatchEvent(new PointerEvent(type, {pointerType:"pen", ...}))` since the pen suites were written, so the handlers (`TabletSurface.down/move/up`, `penButtons.resolvePress/tapStep`, `penLive`, `penCursor`, `penActions`) are proven to accept them. Reusing them is the cheapest way to guarantee that every pen feature behaves identically on the native feed, and the e2e `pen` and `tablet` suites keep testing the real thing. (`setPointerCapture` on a synthetic id throws `NotFoundError`; `TabletSurface` already wraps it in try/catch, and the feed never leaves the sheet, so capture is not needed.)

### 8.3 Sample -> events (pure; `shared/penEvents.ts`; table-driven tests)

State: `inRange`, `mask` (bits: tip 1, lower 2, upper 4, eraser 32). `newMask` from the sample. `pressure = tip ? (p > 0 ? p : 0.5) : 0` (0.5 is what `TabletSurface` assumes for a pen without pressure).

| Transition | Events (in order) |
|---|---|
| out -> in | `pointerover`, `pointerenter` (buttons 0, pressure 0), then the rule below for the same sample |
| hover move (mask 0 -> 0) | `pointermove` buttons 0 |
| mask 0 -> nonzero | `pointerdown`: `button` = the first pressed in the order tip 0, lower 2, upper 1, eraser 5; `buttons = newMask` |
| mask nonzero -> other nonzero | `pointermove` with `buttons = newMask`, `button = -1` (this is how Chromium reports a side button pressed while the tip is down) |
| mask nonzero -> same | `pointermove` |
| mask nonzero -> 0 | `pointerup`: `button` = the one released last (tip 0), `buttons 0`, pressure 0 |
| in -> out | `pointerup` first if the mask was nonzero, then `pointerout`, `pointerleave` |
| reset (blur, failover, close, backend change) | same as in -> out; never `pointercancel` |

**Reference sketch, tested against the repo's real `penButtons.ts` (resolvePress + tapStep): Appendix A.2.** Every event: `pointerType:"pen"`, fixed `pointerId` (4242), `isPrimary`, `width/height` 1, `tiltX/tiltY` when present, modifiers (`ctrlKey/altKey/shiftKey/metaKey`) from a key-state tracker on `window`, `bubbles/cancelable/composed` true. One event per sample (no coalescing: `getCoalescedEvents()` of a synthetic event is empty and `TabletSurface` falls back to the event itself). **Clicks:** synthetic pointer events never produce `click`, so the synthesiser calls `element.click()` when a `pointerup` lands on the same `button` / `[data-tablet]` element as its `pointerdown` after < 6 px of movement (what `GrabOverlay.buttonUnder` did).

### 8.4 The gate (`penGate.ts`, imported first in `main.tsx`: `installPenGate()` before `watchPen()`)

The first listeners on `window` in the capture phase (`pointerdown pointermove pointerup pointercancel pointerover pointerout pointerenter pointerleave gotpointercapture lostpointercapture`; `pointerrawupdate` is listened to for reporting only, if this Chromium delivers it):

```
if (emitting) return                                   // our own synthetic events
if (e.pointerType === "pen") {
  report(e)                                            // pen:dom: every coalesced event, one message per frame (4.7); pen:witness: <= 30/s, screenX/screenY and buttons (6.3)
  if (captureOn()) { e.stopImmediatePropagation(); if (e.type !== "pointermove" && e.cancelable) e.preventDefault() }
} else if (e.pointerType === "mouse" && penTipRecently()) {
  swallow(e)                                           // the echo rule: a Mouse-mode tablet's tap arrives as a mouse event too
}
```

`captureOn()` = the Tablet sheet is showing and the latest status has `open && !released` and `settings.enabled`. **It does not depend on whether any backend is live** (revision 2; revision 1 opened
the gate when the feed went quiet and needed hold timers for it). With the `dom` backend there is always a consumer for what the gate swallows, so the gate has no timers and no "healthy" state, and
the first event of a stroke is never drawn twice. What gives the pen back to plain pointer behaviour: the capture switch (chip, Ctrl+Alt+G, the strip's Release), the window not being in front
(`released`), the Tablet source not showing, `settings.enabled = false`, a platform other than Windows, and the **self-opening** below.

**Self-opening.** If the synthesiser or the gate's own reporting throws five times within a second, or `pen:samples` has not arrived for 3 s while `pen:dom` reports were being sent (a broken IPC), the gate opens, a
`FeedEvent` says why ("Pen capture stopped: ..."), and it stays open until capture is switched on again. A bug in our own code must not take the pen away from the whole window.

`penTipRecently()` = the last sample with `tip` was within 300 ms. The gate also reports DOM *mouse* movement as a `Witness{pointerType:"mouse", inRange:false}` at most 10 times a second (main uses it only to
drop calibration pairs while the mouse is in use, 6.3). Compat mouse events: the `preventDefault()` on `pointerdown` already suppresses them; `contextmenu` from a long press stays handled by `penCursor`
(it keys on `penNear`, which the synthetic events keep fresh). The gate swallows pen events **everywhere on the page**, not only on the sheet: otherwise a pen over the notes would draw there while the
sheet draws the same stroke (double ink). To use the pen on the notes, turn capture off. Under `WRITEMIND_E2E` capture starts off (invariant 9), so every existing pen and tablet script is unaffected.

**Page hooks (revision 3).** While capture is on the gate puts the class `pen-capture` on `<html>` and removes it when capture ends. CSS keys on it: the OS arrow is hidden over the page (as `html.pen-active` already does) and `touch-action: none` is set on the stack, the sheet and the sidebar, so a pen drag cannot pan or scroll a pane whose pen events the gate has swallowed
(`app.css` already sets `touch-action: none` on `.stack` and `.tablet` while `html.pen-active`; the gate extends it to the whole page). Compatibility `mousemove` events that Chromium sends for a hovering pen cannot be cancelled (a pointer that is not down cannot have its mouse events prevented): they reach the page as harmless hover; the cancelled `pointerdown` is what suppresses `mousedown` and `click`.
While the sink is on (7.6) the notes window receives no pen events at all, so the gate is idle and `dom` is silent; that is expected, and the sink's own events are reported as `dom` witnesses.

### 8.5 What the existing pen code sees (so nothing else changes)

| Module | Sees | Change |
|---|---|---|
| `penSettings.noticePen` / `penNear` / `seen` | the synthetic pen events (window capture listeners) | none |
| `penLive` (tip/lower/upper/eraser lamps, pressure) | same | none |
| `penCursor` (in-app ring on the sheet, `html.pen-active`, arrow hidden) | same; ring at the sheet's client point | none |
| `penActions` (tap actions via `tapStep`, ExpressKeys) | same | none |
| `TabletSurface` (draw, erase, box, select) | same, through React | none required; the `feed` / `remap` / `external` / `ring` props that served the overlay are deleted (13) |
| `Canvas.tsx` (the notes page) | nothing while capture is on | none |
| `useUndo` / `tabletFocus` (Ctrl+Z over the sheet) | `pointerenter` sets `hovered` | none |
| palm rejection (`penNear` vs touch) | a pen is "near" | none |

### 8.6 The strip

The overlay's button strip moves into the sheet pane as `SheetStrip.tsx` (inside the sheet host, `data-tablet="strip"`), **written by IMPL-C** (it ports the markup and styles out of `GrabOverlay.tsx`, which it replaces, into its own `sheetStrip.css`) and **mounted by IMPL-D** in `CameraPane.tsx`: Send Writing, Send Page, Box, Erase, Undo, Clear, Clear after, six colour swatches, thinner / thicker, Orientation, Rotate ink, Release.
It slides down at the start for 2.5 s, on a dwell at the sheet's top edge (`stripWanted`, existing and tested), and never while a stroke is being written. The pen operates it through the synthesiser's click rule; the mouse and the camera-bar buttons are unchanged. The component is presentational; every handler is one of the actions `useGrabHost` already maps to the code the camera bar uses:

```ts
export interface SheetStripProps {
  /** Slid down (the `stripWanted` rule decides). */
  shown: boolean
  colour: string
  colours: readonly string[]
  boxTool: boolean
  eraser: boolean
  clearAfter: boolean
  canUndo: boolean
  hasInk: boolean
  orientationLabel: string
  /** "overlay" | "driver" | "clip" | null: the tag at the strip's corner. */
  contained: string | null
  onSend(mode: "ink" | "page"): void
  onBoxTool(): void
  onErase(): void
  onUndo(): void
  onClear(): void
  onClearAfter(): void
  onColour(hex: string): void
  onWidth(by: -1 | 1): void
  onOrientation(): void
  onRotateInk(): void
  onRelease(): void
}
```

### 8.7 The chip (`PenHud.tsx`, in the camera bar; text from `FeedStatus.headline`, colour from `severity`; click opens the popover / the check)

| Situation | Text | Severity |
|---|---|---|
| `available == false` | (nothing rendered) | -- |
| `settings.enabled == false` | "Pen: capture off" | off |
| `released` set | "Pen: released - click the window" | wait |
| Windows says the tablet is absent or broken | "Pen: no tablet (Windows: problem 10)" | error |
| no *native* backend can start (`dom` is waiting for the first stroke) | "Pen: no native feed - touch the tablet" | warn |
| backends armed, nothing has seen the pen yet | "Pen: ready - touch the tablet" | wait |
| a native backend is active and live | "Pen: Wintab - 133 Hz" (+ " - contained: overlay" / "driver" / "clip") | ok |
| `dom` (or `overlay`) is active | "Pen: window pointer - reaches 62% of the tablet" (the reach is `min(coverage.x, coverage.y)`; "- 60 Hz" instead when it is 90% or more); tooltip "no tablet feed; maximise WriteMind; run the 20 s check" | warn |
| a native backend that was live is silent while Windows sees the pen | "Pen: Wintab is silent" (the pen keeps working through `dom`) | warn |
| never checked and a tablet is present | adds "- run the 20 s check" to the tooltip | -- |

Revision 1 had a row "witness but nothing live: Pen: pointer only"; it is gone, because with `dom` a pen that Windows delivers is always carried.

The tooltip's containment line reads "contained: overlay (on trial)" until the sink has validated itself, then "contained: overlay" (or "driver", "clip"), "not contained (the overlay did not take the pen here)" after an `ineffective` verdict, or "not contained". A backend switched off by the breadcrumb appends " - Wintab is off after a crash" (severity warn) while no native backend is live.

Next to the chip sits a **Capture: on / off** switch (`data-tablet="pen-capture"`, replacing the old `Grab: on/off` button); turning it off closes the feed and gives the pen back to the whole window. Display names: `wintab-data` Wintab, `wintab-system` Wintab (mapped), `rawinput` Raw HID, `webhid` WebHID, `dom` Window pen, `overlay` Overlay, `inject` Test. The tooltip carries: active backend, rate, frame source ("direction: guessed / measured"), containment, last reason. The existing "Pen" popover (`PenMenu`) replaces its Grab section with: capture on/off, the Contain select (Auto / Driver / Overlay / Mouse clip / None), the per-backend switches (an "Advanced" disclosure), swap side buttons, trace on/off and "Reveal trace", the **Tablet setup check...** button, and the existing "Tablet area" helper (kept: it is the no-code driver alternative).

### 8.8 Capture toggle, Esc, Ctrl+Alt+G, focus

`usePenFeed(enabled)` (replaces `useGrabHost`): while the Tablet source shows and capture is on, `pen:open` with the sheet geometry; refresh it every 250 ms and on resize; `pen:close` on unmount or toggle off. `suspended` as in `useGrabHost`: Esc, panic and a failure let go until the window is focused again or the person turns capture on.
**Esc releases capture only when the keyboard focus is not in a text field** (`.cm-editor`, `input`, `textarea`, `select`, `[contenteditable]`): the editor keeps its Esc (cancel a selection, close a popup) even while the sink is armed because a pen is hovering. The command `tabletGrab` keeps its id and key (Ctrl+Alt+G) and toggles capture; the global shortcut is registered by main only while a mechanism is armed (the same chord is also handled in the page while the window has focus). Main knows the window state itself (`focus/blur/minimize/restore/show/hide/move/resize` events -> `manager.setWindowState`); under `WRITEMIND_E2E` the window counts as focused.

### 8.9 Non-Windows

`pen:open` returns `FeedStatus{available:false}`; no chip, no check, no toggle, no gate listener work beyond a constant-time return. macOS and Linux keep the DOM pen exactly as today.

---

## 9. The Tablet setup check

A 20-second guided check. Engine: `main/pen/check.ts` (IMPL-B, pure, vitest). UI: `PenCheck.tsx` (IMPL-B; IMPL-D mounts it). The engine counts in main so it keeps counting while the renderer is busy or the window is not in front.

### 9.1 Steps (`CHECK_STEPS`; about 18 s plus an optional 4 s; `env` runs while the person reads the first prompt)

| Step | Seconds | Measured, per backend | Decides |
|---|---|---|---|
| `env` | -- | Windows' PnP state of VID 056A (status, problem), Wacom driver version and service, Wintab interface (spec/impl, tablets, contexts), Raw Input digitizer devices, **Windows' pointer devices (type, device rect, mapped display rect)**, WebHID devices (via the helper), faults recorded by the breadcrumb (5.8), displays and scale, koffi | `unavailable` reasons; the first advice line |
| `hover` | 4 | samples, in-range, rate, gap p95, x/y reach, `moved`; DOM witnesses (how many pen events Windows delivered to the page: this is also the `dom` row); frame pairs | liveness, rate, the frame fit |
| `tap` | 3 | tip downs, pressure max and distinct levels | pressure verdict |
| `lower` | 3 | which side-button bit toggled | `swapButtons` evidence |
| `upper` | 3 | the other bit | |
| `sweep` | 5 | reach in x and y, frame score; the trail preview. **Hover, not touch** | coverage verdict, the frame, "does the ink go the right way?" |
| `away` (optional) | 4 | samples while WriteMind was not the foreground window | informational: does the backend keep delivering unfocused (only matters if a stray tap steals the focus) |

**The check never asks for a touch outside the middle of the tablet** (revision 3). The sink does not arm during a check (9.2), and a tip-down stroke along the edge of the tablet would click whatever lies under the pen: the taskbar, another program's close button, WriteMind's own title bar. Hover is enough for reach, direction and the side buttons. A barrel press without contact is not a click in Windows Ink, but a Wacom side switch set to Right Click or Double Click can click while hovering, so the side-button steps ask for the MIDDLE of the tablet too. The only contact is the taps in the middle, which is inside the window.

### 9.2 Mechanics

`pen:check-start`: the manager starts **every native** candidate at once (5.3.6; the system context and the overlay / sink are the two optional tests of 9.6, never part of the 20 s), holds the blur release (a check holds a lease on "window may be unfocused"), zeroes per-backend baselines, and the engine `begin()`s. The person presses Start; each step has a visible countdown and auto-advances; **Skip** and **Cancel** exist; everything is driven with the mouse (the pen is busy being tested). **While a check runs the sink does not arm** (7.4), so that the `dom` row counts what Windows delivers to the page; only the explicit sink test (9.6) arms it, and nothing arms before or after it until the check ends. The engine receives every backend's samples and every witness, emits a `CheckSnapshot` 4 times a second, and `finish()` returns the `CheckReport`; the manager persists `report.learned` (frames per backend, `pointerMode`, and `swapButtons` **if** the evidence is unambiguous: the nearest-the-tip press showed only `upper` across >= 3 presses and the other step only `lower`; it applies it and says so on the verdict page with an Undo link).

### 9.3 Verdict per backend (`Verdict`)

| Verdict | When |
|---|---|
| `unavailable` | `available()` said no, or E2E; reasons = its reason |
| `failed` | `start()` failed or went failed during the check; reasons = the status reason |
| `silent` | started, **0** in-range samples during `hover`..`sweep`. With witnesses > 0 (the pen demonstrably moved) the reason is "no data while Windows saw the pen N times"; with none it is "no data, and Windows saw no pen either: was the pen near the tablet? Run the step again" |
| `partial` | samples > 0 but one of: never `moved`; rate < 30 Hz; coverage < 0.6 in x or y after `sweep`; pressure never > 0 after `tap`; frame unresolved on a `device`-frame backend |
| `works` | >= 40 samples, `moved`, rate >= 30 Hz, coverage >= 0.6 on both axes, pressure > 0 observed. A missing side button or an unresolved frame are *reasons*, not downgrades (frame unresolved -> `partial`, see above) |
| `skipped` | switched off in settings or by the breadcrumb (reason "the app stopped while it was starting last time", with the Pen-menu switch to try again), or not part of the 20 s (the overlay row shows the sink's validation state, 7.6, and is never part of the 20 s), or the check ended before it ran |

`overall`: `ok` if any row `works`, `partial` if only partials, else `none`. `winner`: the highest-priority `works` row, else the best `partial`. The `dom` row is judged by the same rules (its coverage is the window's reach, so a half-width window reads `partial` with "reaches 50% of the tablet's width; maximise WriteMind"), and it can be the report's `winner` ("what is feeding the sheet"); but **only a tablet-native winner is persisted** (5.6), so a check that ends with only `dom` working leaves the stored winner alone.

### 9.4 Advice (plain words; `CheckReport.advice`)

| Pattern | Says |
|---|---|
| tablet present with a problem code | "Windows says the tablet is not working (problem 10, CM_PROB_FAILED_START). Unplug it and plug it back in, or restart the PC; if it stays, reinstall the Wacom driver. This is not WriteMind." |
| no Wacom device at all | "Windows does not list a Wacom tablet. Check the cable." |
| every native backend silent, `dom` works | "Windows delivers the pen to this window but no tablet interface could be read, so the sheet is driven from the pen's position on the display (it reaches N% of the tablet). That is fully usable. Maximise WriteMind (not full screen) for the rest, and use Copy diagnostics so the native feed can be fixed. If it still misbehaves, restart the 'Wacom Professional Service' (Services app) and run the check again." |
| every backend silent, no DOM pen events and no pointer-range witness while the person moved the pen | "Windows delivered no pen events to this window, and nothing read the tablet. The pen may be out of range, the tablet may be in Mouse mode, or Windows Ink may be off for it (Wacom Tablet Properties, Mapping). Run the step again; if it stays, Copy diagnostics." |
| `dom` coverage below 0.9 | "The window pen reaches only N% of the tablet. Maximise WriteMind (not full screen) for the rest." |
| every native backend failed, `dom` reaches less than 0.9, the sink `effective` | "The tablet cannot be read directly here, and the window does not cover the display, so the overlay is used: everything under the pen is covered while the pen is near." |
| every native backend failed, `dom` reaches less than 0.9, the sink `untested` or `ineffective` | "No native backend can read this tablet and the window covers only N% of the display. Maximise the window, or let the overlay try: it covers the whole display while the pen is near and validates itself the first time: [Test overlay]." |
| `works`, frame source `default` | "Direction is a guess. Draw the two lines so the ink goes the way you write." (opens the stroke calibration) |
| lower/upper not both seen | "Only one side button is reported. In Wacom Tablet Properties another action may be set on the other one." (Windows Ink itself exposes one barrel button, so on `dom` this line is expected and is shown as a note) |
| a device-frame backend has coverage below 0.6 on an axis | "X reports only part of the tablet (N% across). A Wacom Mapping set to a portion of the screen, or the Area helper, does that. Set Mapping back to the full screen, or switch Pen capture off and use the Area." |
| `pointerMode == "mouse"` | "The driver is in Mouse mode. Switch to Pen mode (Wacom Tablet Properties, Mapping) for absolute positions." |
| `works`, the sink `untested` (no pen visit has validated it yet) | "The pen works. The overlay that holds the pen to the sheet checks itself the first time you write; nothing to do." |
| `works`, the sink `ineffective`, `unsafe` or switched off, and no driver mapping | "The pen works, but taps outside the sheet still reach other windows (the overlay did not take the pen here). Maximise WriteMind, or try the driver mapping: [Test driver mapping] [Test overlay again]." |

### 9.5 The screen (a card inside the sheet pane, not a window; operable with the mouse; `PenCheck.tsx` is IMPL-B's, IMPL-D mounts it)

```
 Tablet setup check                                                  [x]
 Step 3 of 6 - Lower side button                                  2 s left
 Hover and press the side button NEAREST THE TIP, again and again.
 backend     samples   Hz    pressure   lower  upper
 Wintab        412     133   0.81         *      .
 Raw HID         0      -      -          .      .
 WebHID          0      -      -          .      .
 Window pen    430      60   0.80         *      .
 Overlay      (the sink: on trial / effective / ineffective)
 [ pen trail, screen frame ]    Windows delivered 51 pen events to this page
 [Skip step]                                                       [Cancel]
```

The verdict page lists each backend as `works / partial / silent / failed / unavailable` with its headline and reasons, the winner, the advice, the learned items (with Undo for the button swap), the two containment test buttons (9.6), **Copy diagnostics**, and **Reveal trace**. The trail preview on the `sweep` step has "Does the ink go the way you moved the pen? [Yes] [Turn it] [Mirror it]" wired to `pen:frame-set`.

### 9.6 Optional containment tests (explicit buttons, invasive, short, always followed by a release)

`pen:contain-test("driver")`: C opens a **probe** system context with the sheet rectangle (guard first), shows "The pointer may jump onto the sheet for a few seconds. Sweep the pen over the whole tablet.", samples `GetCursorPos` every 20 ms for 5 s, closes it in `finally`, and reports `honored` / `ignored` / inconclusive ("move the pen further"). `pen:contain-test("sink")`: 4 s pen sweep with the sink on, then 3 s "now put the pen down and move the MOUSE over the sheet". Each result is a `CapabilityRecord` (state, time, note with scale and bounds) saved by the manager. The sink test is the same measurement as the sink's passive validation (7.6), forced, and a pass clears an `ineffective` record.

### 9.7 Copy diagnostics (`pen:check-copy`, one text block, < 30 KB)

JSON: versions (app, Electron, Windows), `EnvSummary`, settings, persisted state (winner, frames, capabilities, last check), every backend's `BackendStatus` (counters, reason, facts, device claims vs seen), the last `CheckReport`, the last 80 trace events, the first 12 raw records per backend (hex), the HID layouts, the trace file path. No window titles, no note content, no file names from the notes.

### 9.8 Scripted for tests

`CheckEngine` takes time and samples as inputs, so a unit test replays a scripted person (sample streams per step, with and without a silent backend) and asserts verdicts and advice. The e2e script does the same through `pen:inject` and `pen:check-step`.

---

## 10. pen-trace.jsonl

**Where:** `app.getPath("userData")\pen-trace.jsonl` (= `%APPDATA%\@writemind\desktop\`, next to `grab.log`), plus `.1` and `.2` rotations. **Why:** so that, with no check run at all, there is already evidence of what each backend saw the first time a pen came near. The check's **Reveal trace** opens the folder; **Copy diagnostics** quotes the useful part.

**Writer** (IMPL-B `trace.ts`, `createTrace(paths, enabled)`): in-memory ring of the last 200 lines for `tail()`; appends buffered and written at most every 500 ms; rotates at 2 MiB, keeps three files (<= 6 MiB); a torn last line from a kill is tolerated by the reader; a full disk or a write error never reaches the pen. `settings.trace = false` stops `raw`, `smp`, `dom` and `cur` records but keeps `session`, `ev`, `st` (they are tiny and are the diagnostics).

| `k` | Fields | When | Cap per session |
|---|---|---|---|
| `session` | `v:1, at, app, electron, os, pid, displays, env` (short `EnvSummary`) | every `open()` | 1 |
| `ev` | `t, b, e, d?` (`b` = a `BackendName` or `manager` / `renderer` / `containment` / `check`) | every transition: start, stop, live, stale, failed, winner, failover, mask-fallback, prox-polarity-flipped, frame set, contain arm / release / test, sink on / off / mouse-wins / validated, crash-suspect, slow-native-call, ffi-canary-broken, check steps, settings change, focus / blur, panic | all |
| `lay` | `b, dev, layout` | at backend start: the Wintab device + stored context dump; the HID layout JSON and descriptor summary | 1 per start |
| `raw` | `t, b, n, hex, note?` | one raw packet / report | the first 400 per backend, then every 25th up to 2000 |
| `smp` | `t, b, x, y, p, f` (`f` = `sampleFlags`) | a normalised sample, recorded **before** the frame transform so the frame can be re-fitted offline | every 10th up to 3000 per backend |
| `dom` | `t, ty, pt, x, y, bu, p` | DOM pen events seen by the gate | the first 100, then every 10th up to 1500 |
| `cur` | `t, x, y` | OS-cursor polls used as calibration pairs | 400 |
| `st` | `t, s` (compact `FeedStatus`) | every 5 s while open | -- |

The `dom` backend writes no `raw` records: the `dom` kind holds the raw witness values (`screenX/screenY` DIP, buttons), and its `smp` records are the converted samples (screen-frame fractions). `session.env` includes `pointerDevices` (1.1), so the first trace line of a session already says what Windows' pen stack saw.

**Privacy:** no window titles (the Wintab spike's `fg` field is replaced by `self` / `other`), no note text, no file names from the notes. `session.env` contains the tablet's PnP instance id, which includes its **serial number**; fine for Sean's own diagnostics, said so on the Copy page.

**Replay and analysis** (IMPL-B): `replayTrace(text, {speed})` reads `lay` + `raw` records, runs the matching decoder, and yields `PenBatch`es in the recorded timing (or as fast as possible): the golden tests, the e2e (`pen:inject` from a replay), and `tools/pen-analyse.mjs <file>` all use it. The analyser prints per backend: counts, rate, gap p95, reach, pressure range, button bits seen, proximity-bit statistics, the re-fitted frame and margin, the first and last 5 events, and plain verdict lines in the style of the spikes' `analyseTrace`. It also reads the spikes' own formats (`wacom-trace.jsonl`, `live-trace.jsonl`, the Wintab `pk` lines), so a run of the old `live.ps1` scripts is analysable too.

## 11. Settings and persistence

Owner: IMPL-D (`state.ts`).

`app.getPath("userData")\pen-state.json`, written atomically (temp + rename, previous good copy kept as `.bak`), debounced 400 ms, read tolerantly (garbage or a missing key means defaults, so a file written before revision 2 gets `backends.dom = true`; unknown keys are kept). Small. `inFlight` (backend -> ISO time) and `faults` (backend -> `{at, note}`) are the crash breadcrumb of 5.8; `inFlight` is flushed synchronously, the only write that is not debounced. The kill switch of 5.8 is the file `pen-off` in the same folder, or `WRITEMIND_PEN=off`.

```json
{
  "version": 1,
  "settings": { "enabled": true, "backends": { "wintab-system": true, "wintab-data": true, "rawinput": true, "webhid": true, "dom": true, "overlay": true },
                "prefer": null, "contain": "auto", "swapButtons": false, "trace": true },
  "device": { "key": "wintab:WACOM Tablet:9500x15200", "name": "WACOM Tablet", "seenAt": "2026-10-04T09:12:00Z" },
  "winner": { "backend": "wintab-data", "at": "2026-10-04T09:12:31Z" },
  "frames": { "wintab:WACOM Tablet:9500x15200": { "frame": { "turn": 1, "flipY": true }, "source": "dom", "rms": null, "margin": 3.1, "at": "..." } },
  "capabilities": { "driver": { "state": "untested", "at": null, "note": null },
                    "sink":   { "state": "untested", "at": null, "note": null },
                    "clip":   { "state": "untested", "at": null, "note": null } },
  "pointerMode": null,
  "demoted": { "webhid": "2026-10-05T09:00:00Z" },
  "lastCheck": { "at": "...", "overall": "ok", "winner": "wintab-data", "summary": "..." },
  "display": { "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1200 }, "scale": 1 },
  "inFlight": {},
  "faults": {}
}
```

The renderer's own `localStorage` keeps what it keeps (`writemind.pen` button actions, `writemind.orientation`, clear-after, sheet aspect). Migration, once, then the keys are removed: `writemind.grabAuto === "false"` -> `settings.enabled = false`; `writemind.grabPenOnly` is dropped (the pen is exclusive by construction now). Capability records carry the display `bounds` and `scale` they were measured at; a mismatch at arm time counts as `untested`.

---

## 12. Modules and who writes what

All paths relative to `apps/desktop/`. Every file has exactly one owner. Each owner writes the unit tests named here, runs `npm test` and `npm run typecheck` (no lock needed) and builds through `C:\CLAUDIO\agents\build-locked.ps1` only. Nobody commits.

### 12.0 Order of work and the handshake

| Milestone | What | Who |
|---|---|---|
| M0 | `shared/pen.ts` and `main/pen/types.ts` from section 3; a compilable **stub** of every factory below (`// STUB owned by IMPL-X: replace wholesale`, returning an `unavailable` backend / an inert object); `registry.ts` importing them. Typecheck green. | D (round 1: done for revision 1's contract; the delta of the top box is round 2's first task) |
| M1 | pure modules with unit tests: A `wintab.ts`, `hid/*`, `frame.ts`, `batcher.ts`; B `trace.ts`, `check.ts`, `replay.ts`; C `clip.ts`, `lease.ts` + `guard.ts` protocol; D `penEvents.ts`, `manager.ts` against `FakeBackend`, `state.ts`, `penGate.ts` | all |
| M2 | native and integration: A `win32/winmsg/wintabNative/wintabBackend/rawNative/hidNative/rawinputBackend`; B `webhid/*`, `pointerRange`, `env`, `PenCheck`; C `containment`, `overlay` (sink + backend), `panic`, `sweep`, `SheetStrip`, `SheetReach`, build edits; D `ipc.ts`, preload, `penFeed.ts`, `usePenFeed`, chip, mounting, CameraPane/PenMenu edits | all |
| M3 | the e2e `penfeed` suite green on `inject` and `dom` (offscreen); `registry.ts` wired to the real classes; deletions (section 13) | D (+C for `pensink`) |
| M4 | gated real-OS tests run by hand where safe; docs; final reports (what was built, how verified, what was not) | all |

**Status at 2026-10-04 12:20 (measured; see the box at the top):** M0 done for revision 1's contract; M1 largely done (the pure modules and the manager exist; tests exist for check, clip, env, guardCore, lease, trace, penEvents and the manager, but 35 of them fail, and `wintab`, `hid/*`, `batcher`, `frame`, `state` have none);
M2 started (`win32`, `winmsg`, the `hid/*` natives, `guard`, `sweep`; C's build entries for `pen-guard`, `pen-hid` are in `scripts/build.mjs` and `electron-builder.yml`, and `pen-guard.mjs` is in the 12:03 build). M3 and M4 not started. Round 2 continues from there: restart order in the box at the top, work orders in 12.7.

**Until M3 the old Grab keeps working untouched** (its files are only deleted at M3, after the new path passes its e2e), so every intermediate build is usable and the lead can checkpoint at any time.

**A writes before anyone needs it (first hour):** nothing new is blocking (`win32.ts`, `winmsg.ts`, `hid/layout.ts`, `hid/decoder.ts` exist). **B writes early:** `pointerRange.ts` (D's registry and C's sink read it). **C writes early:** `lease.ts` fixed (the tree is red until then). **D writes early:** the contract delta.

### 12.1 IMPL-A -- backends and decoders (`src/main/pen/`)

| File | Exports (names are binding) | Notes |
|---|---|---|
| `win32.ts` | `loadWin32(): Win32 \| {error}`; `Win32 {getCursorPos(), foregroundPid(), highResTimer(on), lastError(), screenSize(), koffi}` | exists. One koffi loader for the pen stack; **all koffi struct and proto names prefixed `WMP_` and declared once per process** (koffi types are process-global; a redeclaration throws); x64 assertion with a clear message |
| `winmsg.ts` | `createMessageWindow(onMessage): MessageWindow {hwnd, post(), destroy()}`; `destroyAllMessageWindows()` | exists. Ported from `rawNative.createMessageWindow`; the WNDPROC handler is tiny, never throws, always calls `DefWindowProcW` |
| `wintab.ts` | constants, `decodeWintabPackets`, `encodeWintabPackets`, `parseLogContext`, `writeLogContext`, `parseAxis`, `normalisePacket`, `WintabNormaliser`, `ClockAligner`, `tiltFromOrientation`, `MASK_LADDER`, `plausible()` | exists (pure); spike code + adaptive polarity + mask ladder + the new leave timeouts (via `VisitTracker`). **No tests yet** |
| `wintabNative.ts` | `loadWintab()`, `WintabSession`, `closeAllWintab()`, `installWintabExitCleanup()`, `recoverStaleContexts()`, `readInterface/readDevice/readDefaultContext/contextCounts`, `wintabFacts(): Record<...> \| null` (for `EnvDeps`) | **stub**. Spike code; every opened handle is in a module-level set; **FFI safety of 4.2** (over-allocated buffers with a canary, asserted sizes, timed steps) |
| `wintabBackend.ts` | `createWintabBackend(mode, paths): PenBackend` (system mode also implements `SystemMapped`) | **stub**. Section 4.2 |
| `hid/layout.ts`, `hid/decoder.ts` | `HidLayout`, `readBits`, `PenDecoder`, `penScore`, `isPenLayout` | exist. Section 4.3, **plus the revision 2 rules**: one primary report per device, the vendor page traced not decoded (vendor fallback only as described), physical extents for the orientation guess and `DeviceInfo.aspect`, no range-based `looksDriverMapped`. **No tests yet** |
| `hid/fromWebHid.ts`, `hid/fromHidP.ts` | `layoutFromWebHid(collections)`, `layoutFromProbe(json)` | exist; the two producers of `HidLayout` |
| `hid/rawParse.ts`, `hid/rawNative.ts`, `hid/hidNative.ts` | `parseRawInput`, `registerRawInput`, `unregisterRawInput`, `readRawInput`, `listRawDevices`, `getPreparsed`, `readCaps`, `probeLayout` | exist; x64 offsets in one place. Add the canary rule of 4.2 to the buffers |
| `rawinputBackend.ts` | `createRawInputBackend(): PenBackend`, `rawDeviceList(): EnvSummary["rawDevices"]` | **stub**. Section 4.3; `PrimaryPicker`; `mouseProbe` option used by the check |
| `frame.ts` | `defaultFrame(family, rawX, rawY)`, `inferFrameFromPairs(pairs): {frame, score, margin} \| null`, `inferFrameFromStrokes(a, b)`, `FramePair`, `frameKey(family, name, rawX, rawY)` | exists except `inferFrameFromStrokes` and a fixed header; pure; the correlation algorithm of 6.3 (the manager owns pair buffering and cadence). **No tests yet** |
| `batcher.ts` | `SampleBatcher`, `VisitTracker`, `RateMeter` (rate, gap p95) | exists; shared by every backend. **No tests yet** |

Tests (`test/pen/`, none of the following exist yet): `wintab.test.ts`, `wintabBackend.test.ts` (fake session and API: open order, lease call, mask fallback, system re-open order, stop releases, canary break), `hidDecoder.test.ts`, `rawParse.test.ts`, `frame.test.ts`, `batcher.test.ts`, `rawinputBackend.test.ts` (fake message source; a real-OS block gated by `WM_PEN_REAL=1` using Windows' synthesized pen).
Fixtures in `test/fixtures/pen/`: the spikes' `ms-synth-pen.json`, `gamepad-real.json`, **`wacom-ctl472.json` (Raw Input, real) and `wacom-ctl472-real.json` (WebHID, real)** copied in, plus generated ones (15.3). The spikes' own tests (wintab 54, rawinput 37, webhid 46, contain 38) are the source of most of these.

### 12.2 IMPL-B -- WebHID, witnesses, diagnostics, trace, check

| File | Exports | Notes |
|---|---|---|
| `webhid/webhidBackend.ts` | `createWebHidBackend(deps): PenBackend` | **stub**. Section 4.4 (cut line) |
| `webhid/permissions.ts` | `installHidPermissions(session, {vendorIds})` | scoped to the `pen-hid` partition |
| `webhid/hostPage.ts`, `src/preload/penHid.ts`, `src/helpers/pen-hid.html` | the page-world `WebHidPenSource` (on A's decoder; bundled to `out/helpers/pen-hid.js`), the `contextBridge` preload, the static page | private IPC `pen:hid-*` documented at the top of `webhidBackend.ts` |
| `pointerRange.ts` | `createPointerRangeWitness(onWitness)`, `listPointerDevices(): PointerDeviceSummary[] \| null` | **stub**. 7.6; on A's `winmsg`; the witness ignores `Microsoft HID RID` devices; the listing is read-only and feeds `EnvDeps.pointerDevices` |
| `env.ts` | `collectEnv(deps): Promise<EnvSummary>` | exists. (`EnvDeps` gains `pointerDevices(): PointerDeviceSummary[] \| null`, passed in like `rawDevices`, so `env.ts` stays free of koffi) one PowerShell call (`-NoProfile -NonInteractive`, 6 s timeout, JSON out; the tested script is Appendix A.3, ~1 s cold); cached 30 s; **skipped under E2E** unless `WRITEMIND_PEN_NATIVE=1`. One failing test (12.7) |
| `trace.ts` | `createTrace(paths, enabled): TraceFile`, `parseTrace(text)` | exists; section 10 |
| `replay.ts` | `replayTrace(text, opts)` | missing; section 10 |
| `check.ts` | `createCheckEngine(deps): CheckEngine` | exists; section 9; pure. Revision 2: a row for `dom` (judged by the same rules, coverage = the window's reach), the new advice rows of 9.4, `winner` may be `dom` but only a native winner is persisted. **Revision 3:** a backend switched off by the breadcrumb is `skipped` with its note (5.8); advice rows reworded for the self-validating sink (9.4) |
| `diagnostics.ts` | `buildDiagnostics(parts): string` | missing. **Moved from D in revision 3.** Assembles the Copy text from the pieces (9.7); pure, < 30 KB; D's `ipc.ts` supplies the pieces and calls it |
| `src/renderer/PenCheck.tsx`, `penCheck.css` | the check card of 9.5 | missing. **Moved from D in revision 3.** Props `{ snapshot: CheckSnapshot; api: PenApi["check"]; onFrame(f: FrameTransform \| null): void; onClose(): void }`; D mounts it in `CameraPane.tsx` and supplies `onFrame` (-> `pen:frame-set`) |
| `tools/pen-analyse.mjs`, `tools/make-pen-fixtures.mjs` | CLIs | the fixture generator is deterministic (seeded), so goldens never churn |

Tests: `webhidBackend.test.ts` (fake `hid`: permission scope, `open()` refusal reason, hot-plug, stop closes), `trace.test.ts` (exists), `check.test.ts` (exists: scripted people, every verdict row and every advice row; extend), `env.test.ts` (exists), `replay.test.ts`, `diagnostics.test.ts` (required keys present, no `title` key, under 30 KB with a full trace), `pointerRange.test.ts` (fake koffi: synthetic devices ignored, `stop()` unregisters).

### 12.3 IMPL-C -- containment and safety

| File | Exports | Notes |
|---|---|---|
| `lease.ts` | `createLease(options): Lease` | exists, **broken** (12.7 C1). Spawns the guard detached; implements `LeaseApi` + the clip lease; section 7.5 |
| `guard.ts` | (process entry) | exists; bundled to `out/main/pen-guard.mjs`; imports nothing from the app except the pure `clip.ts` and `guardCore.ts` |
| `guardCore.ts` | every release decision of the guard as plain logic over injected ports | exists; each rule of 7.5 is a unit test with a fake clock and a fake OS |
| `clip.ts` | `validateClipRect`, `staleClipDecision`, `rectsEqual`, `intersect`, protocol encode/parse, `MIN_CLIP_W/H`, `DEFAULT_LEASE_MS/BEAT_MS/IDLE_MS` | exists (23 tests so far; the spike had 38: port the rest) |
| `sweep.ts` | `sweepAtStart(paths, log)`, `sweepPending()` | exists; before anything arms. **No tests yet** |
| `containment.ts` | `createContainment(deps): Containment`, `CONTAIN` (the constants of 7.6) | **stub**. The state machine of 7.4 over three mechanism adapters; capability gating; **the sink's auto-trial and passive validation (7.6)**; `sinkWanted()`; `test()` |
| `overlay.ts` | `createSink(deps): Sink`, `createOverlayBackend(deps): PenBackend` | **stub**. The demoted `grab.ts` (7.6, 4.5); one window shared by both |
| `panic.ts` | `installPanic({onPanic, armed})` | **stub**. The global Ctrl+Alt+G registered only while anything is armed; unregisters in `finally` |
| `src/renderer/PenSink.tsx`, `penSink.css` | the sink page | route `?pen-sink=1` (D adds the route in `main.tsx`); uses `window.wm.penSink` (`PenSinkApi`, 3.1) |
| `src/renderer/SheetStrip.tsx`, `sheetStrip.css` | the strip of 8.6 | **moved from D in revision 3.** Ported from `GrabOverlay.tsx`; presentational (props in 8.6); D mounts it |
| `src/renderer/SheetReach.tsx` | the reach hint of 7.7 | **moved from D in revision 3; now P1**. Presentational (props in 7.7); D mounts it |
| `src/shared/grab.ts` | trimmed: keep `overlayBounds`, `OVERLAY_MARGIN`, `coversDisplay`; **`GrabModes` and its constants are deleted** (the sink's rules replace them) | `sheetGeometry.test.ts` keeps guarding the geometry; `grab.test.ts` loses its `GrabModes` tests |
| `tools/free-pen.ps1`, `tools/free-pen.cmd` | the panic scripts | 7.5 |
| `scripts/build.mjs`, `electron-builder.yml` | **C is the only editor of these two files.** Entries already added: `src/main/pen/guard.ts` -> `out/main/pen-guard.mjs` (esm), `src/preload/penHid.ts` -> `out/preload/pen-hid.cjs` (cjs), `src/main/pen/webhid/hostPage.ts` -> `out/helpers/pen-hid.js` (iife, `platform: "browser"`); `asarUnpack: out/main/pen-guard.mjs` | done |

Tests: `clip.test.ts` (extend to the spike's 38), `lease.test.ts` (exists: fake child: beat, expiry, EOF, guard-lost, hold / drop, journal), `containment.test.ts` (every arm condition, every release trigger of 7.4, capability gating, `unsafe` marking, driver-mapping wanted, **the sink's `on` conditions (a)-(f), mouse-wins, tip-down deferral, the validation outcomes**), `overlay.test.ts` (sink states, heartbeat, the overlay backend's samples), `sweep.test.ts`, `guardProof.test.ts` (**real processes**, the spike's P1-P8, gated by `WM_PEN_REAL=1`; it sets a real clip for under a second and releases it in `finally`).

### 12.4 IMPL-D -- manager, IPC, renderer, tests, docs

| File | Exports / purpose |
|---|---|
| `src/shared/pen.ts`, `src/main/pen/types.ts` | section 3 (apply the delta of the top box first) |
| `main/pen/registry.ts` | builds the backend list from the factories and the env (`createRegistry(deps)`), the only place that names concrete backends; **reads the kill switch and applies the breadcrumb faults before any backend is created (5.8)** |
| `main/pen/manager.ts` | `createFeedManager(deps): FeedManager`; sections 5 and 6.3 (pair buffering, cadence, persistence of frames); feeds `containment.update()` and `check.feed()`; starts / stops the pointer-range witness with the feed. Revision 2: `dom` in the label and family tables, WebHID stage on `liveNative`, no non-native winner, the headline rows of 8.7. **Revision 3:** the frame-settle rule (5.4), the breadcrumb (5.8), `endCheck` stores only native winners, the check's candidates keep `dom`, `overlay` is a stage-0 candidate when `containment.sinkWanted()`, `STAGE_OVERLAY_MS` gone |
| `main/pen/backendCore.ts` | the bookkeeping every backend shares (counters, `seen`, `reach`, rate meter, local liveness, batching); the `dom` backend uses it too |
| `main/pen/domBackend.ts` | `createDomBackend(deps: DomDeps): PenBackend & DomIngest` (section 4.7): `ingest(reports)` converts `DomPenReport`s to screen-frame samples; facts `coverage.*`, `cover.*`, `work.*`; tests with a fake `displayAt` |
| `main/pen/state.ts` | load / save `pen-state.json`; migrations; `inFlight` and `faults` (5.8) |
| `main/pen/ipc.ts` | `installPenIpc({manager, check, trace, ...})`: handlers by `PEN_CHANNELS` and `PEN_SINK_CHANNELS` (sender-checked), window-state wiring, E2E handlers only under `WRITEMIND_E2E`; supplies the pieces to B's `buildDiagnostics` |
| `main/pen/fake.ts` | `FakeBackend` (scripted: start delay / failure, a sample script, silence), `InjectBackend` |
| `src/shared/penEvents.ts` | the pure synthesiser of 8.3 |
| `src/renderer/penFeed.ts`, `penGate.ts`, `usePenFeed.ts`, `PenHud.tsx` | section 8. `penGate.ts`: swallows while `captureOn()`, reports on `pen:dom` and `pen:witness`, self-opens (8.4). `ipc.ts` routes `pen:dom` to the `dom` backend's `ingest` |
| mounting | `CameraPane.tsx` mounts `PenCheck` (B), `SheetStrip` and `SheetReach` (C) and wires their handlers to the code the camera bar already uses |
| surgical edits | `main.ts` (all of it inside one `try`/`catch`, 14.1 #19: create paths, trace, lease, the shared `Sink`, containment (its `probe` built from `createWintabBackend("system", paths)`), env (A's `rawDeviceList` / `wintabFacts` and B's `listPointerDevices` into `EnvDeps`), manager; `sweepAtStart` at ready, before anything arms; `installPenIpc`; replace `installGrab` and the window hooks `closed` / `render-process-gone` / `did-start-loading` (today `grab?.stop()`) with `manager.close(...)`; `before-quit` / `will-quit` -> `manager.dispose()`), `preload.ts` (`wm.pen`, `wm.penSink`, remove `grab*`), `wm.d.ts`, `renderer/main.tsx` (`installPenGate()` first; `?pen-sink` route), `CameraPane.tsx` (tablet parts only; the camera lane owns the rest), `PenMenu.tsx`, `penSettings.ts` (migrations), `TabletSurface.tsx` (remove overlay props), `app.css` / `camera.css` (only for the chip) |
| e2e | `e2e/lib/penfeed.mjs`; `e2e/suites/penfeed/` (15.4); with C, `e2e/suites/pensink/` replaces `grab/` |
| docs | **D is the only editor of `docs/PARITY.md`, `docs/TODO.md`, `docs/KEYS.md`.** A, B, C put their status and evidence in their final reports and in file headers; D folds them in |

Tests: `penEvents.test.ts` (exists), `penManager.test.ts` (exists; 15.2), `state.test.ts`, `ipc.test.ts`, `penGate.test.ts`, `domBackend.test.ts`, `safety.test.ts`, and the edited `grab.test.ts` (with C).

### 12.5 Shared-file policy

Only D edits `main.ts`, `preload.ts`, `wm.d.ts`, `main.tsx`, `App.tsx`, `CameraPane.tsx`, `PenMenu.tsx`, `commands.ts`, `menu.ts`, `app.css`. Only C edits `scripts/build.mjs` and `electron-builder.yml`. **Components written by A, B and C ship their own CSS file** (`penSink.css`, `sheetStrip.css`, `penCheck.css`, imported by the component), so nobody edits `app.css` for them.
The one cross-lane edit allowed in round 2 is D adding `dom: "Window pen"` to `BACKEND_LABEL` in B's `check.ts` as part of the contract delta (the compiler demands it). Re-`Read` right before any edit and anchor on small unique strings; if a typecheck fails because of someone else's in-flight file, wait and retry (up to ~10 min) rather than fixing it.

### 12.6 Porting map (spike -> repo; the spikes' tests move with their code)

| Spike file (`C:\CLAUDIO\spikes\...`) | New file | Changes |
|---|---|---|
| `wintab-spike\wintab.ts` | `wintab.ts` | adaptive proximity polarity, mask ladder + `plausible()`, leave timeouts via `VisitTracker`; `inferFrame*` move to `frame.ts` |
| `wintab-spike\wintabNative.ts` | `wintabNative.ts` | `WMP_` struct names, lease hook, journal path from `PenPaths`, FFI safety (4.2) |
| `wintab-spike\wintabPen.ts` | `wintabBackend.ts` | `PenBackend` shape; message-only window; cursor-pair logic goes to the manager |
| `wintab-spike\trace.ts`, `capture.ts`, `analyse.ts` | `trace.ts`, `tools/pen-analyse.mjs` (B) | one unified format (section 10); reads the old one too |
| `rawinput-spike\src\hidLayout.ts` | `hid/layout.ts` (merged with the WebHID layout) | neutral flat layout |
| `rawinput-spike\src\hidNative.ts`, `rawNative.ts`, `rawParse.ts` | `hid/hidNative.ts`, `hid/rawNative.ts` (+ `winmsg.ts`), `hid/rawParse.ts` | `WMP_` names |
| `rawinput-spike\src\penSample.ts` | `hid/decoder.ts` (mapper) and `batcher.ts` (batcher, `RangeWatchdog` -> `VisitTracker`) | no auto-rotation in the decoder |
| `rawinput-spike\src\penRawInput.ts` | `rawinputBackend.ts` | `PenBackend` shape; synthesized pen excluded by default; `PrimaryPicker` |
| `webhid-spike\src\hidPen.ts` | `hid/decoder.ts`, `hid/fromWebHid.ts`, `hid/layout.ts` | merged with the Raw Input mapper |
| `webhid-spike\src\webhidPen.ts` | `webhid/hostPage.ts` | runs in the helper page's own world |
| `webhid-spike\electron\main.cjs` | `webhid/permissions.ts`, `webhid/webhidBackend.ts` | dedicated `pen-hid` session |
| `contain-spike\clip.ts` | `clip.ts` (policy) and `lease.ts` (the guard backend) | Wintab holds added |
| `contain-spike\guard.mjs` | `guard.ts` | `hold-wintab` / `drop-wintab`, journal |
| `contain-spike\free-cursor.ps1` | `tools/free-pen.ps1` | also closes dead `WriteMind pen *` contexts |
| `wspike-contain\lab.cs` (pointer-device notifications) | `pointerRange.ts` | koffi |
| `GrabOverlay.tsx` (the strip markup and styles) | `SheetStrip.tsx`, `sheetStrip.css` (C) | presentational; props in 8.6 |
| spikes' `test\fixtures\*` | `test/fixtures/pen/` | |

### 12.7 Round 2 work orders (each lane's own order; "done when" is what the lead will check)

**IMPL-D (the critical path).**
1. **The contract delta** (top box; 30 min): copy the blocks of section 3 over `shared/pen.ts` and `main/pen/types.ts` (keep the file's own comments), add `dom: "Window pen"` to `BACKEND_LABEL` in `manager.ts` and `check.ts`, add `sinkWanted()` to `fakeContainment` in `penManager.test.ts`. Tell A, B, C when it is in. Done when `npm run typecheck` shows nothing but C's `lease.ts` errors (or nothing).
2. **Fix what is red in your own files.** `manager.ts` `headlineFor`: the regex `/^d+$/` must be `/^\d+$/` (the chip says "Windows: 10" instead of "Windows: problem 10"). `penManager.test.ts` first-run test: the sticky rule is right and the test is wrong, it must expect `rawinput` until `UPGRADE_AFTER_LIVE_MS` has passed with the pen up. The backoff test: a failure counts as witnessed only if a witness is active at that moment, so the test must send a witness just before each timeout. The test "nothing live, witnesses present: ... headline 'pointer only' ... overlay at STAGE_OVERLAY_MS" asserts revision 1's behaviour (a 'pointer only' chip, a staged overlay) and is rewritten to 15.2 #5 and #30. Checked on a scratch copy: the regex fix alone turns the chip test green.
3. **Manager rules of this revision:** R5, R12, R19, the breadcrumb and kill switch (5.8), `overlay` as a stage-0 candidate, the `dom` candidate in the check, the headline rows of 8.7. Tests 15.2 #21-#34.
4. `domBackend.ts` + test, `registry.ts`, `state.ts` additions, `ipc.ts` (+ `PEN_SINK_CHANNELS`), `preload.ts` / `wm.d.ts`, `main.ts` wiring. Done when the app starts with the new path and `inject` drives the sheet.
5. Renderer: `penGate.ts`, `penFeed.ts`, `usePenFeed.ts`, `PenHud.tsx`, `CameraPane` / `PenMenu` edits; mount B's and C's components. Done when `npm run e2e -- --suite penfeed` is green.
6. The deletions of section 13, the docs, the e2e `pen` and `tablet` suites unchanged and green.

**IMPL-C (OS-level safety, the sink, two renderer components).**
1. **`lease.ts` first** (the tree is red until it is fixed). Import `sweepPending` from `./sweep` and end `start()` with `const run = sweeping ? sweeping.then(() => begin(), () => begin()) : begin(); starting = run; void run.finally(() => { if (starting === run) starting = null }); return run` (`settle()` clears `starting` and can run synchronously when the spawn throws, so `starting` must be assigned first and cleared from the promise, not from `settle` alone). Checked on a scratch copy: with exactly this change `tsc` is clean for the file and all 32 tests of `lease.test.ts` pass. Done when that is true in the tree.
2. `containment.ts` with the sink's auto-trial and validation (7.6), `CONTAIN` constants, `sinkWanted()`, the three adapters, capability gating; tests with fakes for every row of 7.4 and every clause (a)-(f).
3. `overlay.ts` (sink window + overlay backend), `PenSink.tsx`, `penSink.css`; tests for the states, the heartbeat, the samples.
4. `panic.ts`, `tools/free-pen.*`, `sweep.test.ts`, the rest of the spike's `clip` tests, `guardProof.test.ts` (gated).
5. `SheetStrip.tsx` / `sheetStrip.css` (port from `GrabOverlay.tsx`), `SheetReach.tsx` (P1).
6. After D's e2e is green: delete `main/grab.ts`, `renderer/GrabOverlay.tsx`; trim `shared/grab.ts` and `grab.test.ts`; rewrite `e2e/suites/grab` as `pensink` with D (desktop suite: it moves the real cursor, run only on request).

**IMPL-A (backends and decoders).**
1. **Port the missing tests of the modules that already exist** (they have none in the tree): `wintab.test.ts` (the spike's 54, minus the frame inference that moved), `hidDecoder.test.ts` and `rawParse.test.ts` (rawinput 37 + webhid 46, deduplicated), `batcher.test.ts`, `frame.test.ts` (Appendix A.1's 33 cases), with the real fixtures. Done when these pass; this is also where a porting mistake in round 1 shows up.
2. The missing pure pieces: `inferFrameFromStrokes`, `PrimaryPicker`, the vendor-page fallback of 4.3; fix `frame.ts`'s header.
3. `wintabNative.ts` then `wintabBackend.ts` (4.2 with the FFI safety rules); tests with a fake API; a real-dll block gated by `WM_PEN_REAL=1` (context count before == after).
4. `rawinputBackend.ts` (4.3) and `rawDeviceList()`; tests with a fake message source; a gated block with Windows' synthesized pen.
5. Hand `wintabFacts()` and `rawDeviceList()` to D for `EnvDeps`.

**IMPL-B (witnesses, diagnostics, check, trace, WebHID).**
1. `env.test.ts` (one failing test: the second `collectEnv` after an uncached failure must run; the counter expectation in the test is the suspect; decide by 9.1 and A.3, which say a failed query is a note and is not cached).
2. `pointerRange.ts` (witness + `listPointerDevices`), with the synthetic-device rule; D and C read it.
3. `check.ts` changes of revision 2 and 3 (the `dom` row, advice rows, `skipped` rows for breadcrumb faults); tests for every new row.
4. `diagnostics.ts` and `PenCheck.tsx` / `penCheck.css` (9.5, 9.7).
5. `replay.ts`, `tools/pen-analyse.mjs`, `tools/make-pen-fixtures.mjs`, the fixtures and goldens (15.3).
6. WebHID (4.4): `permissions.ts`, `hostPage.ts`, `penHid.ts`, `pen-hid.html`, `webhidBackend.ts`; if short of time ship it with `backends.webhid = false` and say so.

**The green gate (R18).** At the end of the round `npm run typecheck` is clean and `npx vitest run` fails nothing of ours; the lead runs both, then the locked build, then `npm run e2e -- --suite penfeed,pen,tablet`.

---

## 13. Removal and demotion

| Thing | Fate | Who |
|---|---|---|
| `main/penHook.ts` (WH_MOUSE_LL signature hook) and its `classifyExtraInfo` tests | **deleted** | D |
| `main/grab.ts` | replaced by `main/pen/overlay.ts`; then deleted | C writes, D deletes |
| `shared/grab.ts` | trimmed to `overlayBounds`, `OVERLAY_MARGIN`, `coversDisplay`; **`GrabModes` is deleted** with its constants and tests (the sink's rules, 7.6, replace it) | C |
| `renderer/GrabOverlay.tsx` | replaced by `PenSink.tsx`; then deleted | C writes, D deletes |
| `renderer/useGrabHost.ts`, `grabTypes.ts`, `grabDiag.tsx` | deleted (replaced by `usePenFeed.ts`, `PenHud.tsx`, `PenCheck.tsx`, `SheetStrip.tsx`) | D |
| `TabletSurface` props `remap`, `external`, `ring`, and `SurfaceHandle.feed` | deleted | D |
| `TabletPage.onOp/apply/exportState/importState`, `SheetOp`, `SheetState` and their "two views" tests | kept until nothing imports them, then deleted with their tests | D |
| preload `grab*`, `wm.onGrab`, `e2eGrab*` and their `wm.d.ts` entries; `ipcMain` `grab:*` handlers; `installGrab` in `main.ts` | deleted | D |
| `?grab=1` | becomes `?pen-sink=1` | C, D |
| `e2e/suites/grab/*` | rewritten as `pensink` (desktop) | C + D |
| localStorage `writemind.grabAuto`, `writemind.grabPenOnly` | migrated once, then removed | D |
| `tabletArea.tsx` (the Area helper) | **kept**: it is the driver-only, no-code alternative | -- |
| `GRAB_EXIT_KEY` (Ctrl+Alt+G) and the `tabletGrab` command | kept as the capture toggle / panic | C, D |
| `e2e/lib/harness.mjs` `noGrab()` and `grabActive()`; the `tablet` suites' `await noGrab()` | `noGrab()` becomes a harmless no-op (capture starts off under E2E, so the scripts need no edit; today it sets `writemind.grabAuto` and calls `window.wm.e2eGrab`, which goes away); `grabActive()` goes with the `grab` suite. A surgical edit to a harness-lane file, announced to that lane | D |

---

## 14. Safety checklist

### 14.1 Rules (reviewers check each; `safety.test.ts` enforces the checkable ones)

1. Every OS-state-changing call has a named release **in the same module**, performed synchronously by that module's `stop()`.
2. `stop()` is idempotent and safe after a failed `start()` and from an exit handler.
3. Every exit path runs the releases: `before-quit`, `will-quit`, `window-all-closed`, `process.on("exit" | "uncaughtException" | "SIGINT" | "SIGTERM" | "SIGBREAK")` -> `manager.dispose()`, `closeAllWintab()`, `lease.dispose()`.
4. State that survives a crash is registered with the guard **before it matters** (system contexts, clips) or journalled (every Wintab context) and swept at the next launch.
5. **Never close a handle that was not positively identified** (name marker + dead pid). **Never guess a Wintab handle.**
6. A system context and a clip require a ready guard (fail closed). No in-process fallback.
7. Nothing that outlives the process (a system context, a clip) is armed unattended on an unproven mechanism (7.2); the sink, which dies with the process, is on bounded trial instead (rule 17).
8. **Native backends are off under `WRITEMIND_E2E`** unless `WRITEMIND_PEN_NATIVE=1`: `wm-stop.ps1` kills test instances hard, which leaks Wintab contexts (limit 32). Test instances never open a context, registration, hook or clip against the real tablet.
9. **Forbidden in `src/main/pen/**`** (static scan): `BlockInput`, `SetWindowsHookEx*`, `SendInput`, `mouse_event`, `keybd_event`, `SetCursorPos`, `SetPhysicalCursorPos`, `SetSystemCursor`, `RegisterPointerInputTarget*`, `RIDEV_NOLEGACY` as a registration flag, `setFullScreen(true`, kiosk. `ClipCursor` only in `guard.ts`, `clip.ts`, `lease.ts` (`NULL` only in the last); `WTClose` only in `wintabNative.ts` and `guard.ts`.
10. Every `koffi.register` has a matching `koffi.unregister` in `stop()`; every message-only window is destroyed; batcher and watchdog timers are `unref()`ed.
11. No tick blocks the main thread for more than 10 ms; an overrun is traced and halves the poll rate.
12. Disk writes are bounded (trace rotation, state debounce) and failures are swallowed.
13. No window titles or user content are written anywhere.
14. Nothing in the app enters full screen; the sink never covers a monitor's exact rectangle (existing `sheetGeometry.test.ts`). **That test scans every line of `apps/desktop/src`** for `setFullScreen(true`, `kiosk: true`, `fullscreen: true`, `requestFullscreen`, `PadMode`, `tabletPad` and friends, so a comment in `src/main/pen` must not spell them either; the pen safety test that lists the forbidden Win32 names lives in `test/`, not `src/`.
15. **FFI buffers** are allocated at twice the computed size with a canary that is checked after every call that writes into them; the sizes the driver reports are asserted (4.2). `safety.test.ts` checks that the native modules allocate through the one `canaryBuffer()` helper.
16. **The breadcrumb** (5.8): a backend that makes native calls sets `inFlight` before `start()` and clears it only as 5.8 says; a leftover at launch switches it off with a note. The kill switch (`WRITEMIND_PEN=off`, `pen-off`) is read before anything native is loaded.
17. **The sink never trusts itself** (7.6): hit-testing only under (a)-(f), never flipping with a tip down, off 400 ms after the last pen signal, off at the first real mouse event, `unsafe` when it stays on. `safety.test.ts` scans `src/` for `setIgnoreMouseEvents(false` outside `overlay.ts`.
18. **Nothing that outlives the process is armed by the automatic path** (7.2): `contain: "auto"` with `capabilities.driver` not `honored` never starts `wintab-system` and never arms a clip; `containment.test.ts` asserts it.
19. **The pen subsystem can never stop the app from starting.** `main.ts` creates it inside a `try`/`catch`; an exception is logged and leaves the app exactly as it was before this feature (`available: false`: no chip, no gate, plain pointer on the sheet).
20. **No exception escapes a `main/pen` callback.** Every timer, listener and IPC handler goes through one `guarded(name, fn)` wrapper that traces and swallows (Electron would otherwise show its "JavaScript error in the main process" dialog); the gate's own listener and the synthesiser are guarded the same way in the renderer and count toward the self-opening threshold (8.4).

### 14.2 What is created, and how each thing is undone

| OS-level thing | Created by | Normal release | If the app crashes / is killed | If the app hangs | Next launch / by hand | Proven by |
|---|---|---|---|---|---|---|
| Wintab **data** context | A `WintabSession` | `WTClose` in `stop()` and the exit hooks | guard closes it by name (when ready); else the journal | guard lease | `recoverStaleContexts` (name + dead pid only) | unit (fake API); real-dll test `WM_PEN_REAL=1`: context count before == after; kill test |
| Wintab **system** context | A (mode system) | as above, plus `setSheetPhysical(null)` | **guard mandatory**: closes it | guard lease (800 ms) | sweep, `free-pen.cmd` | unit; guard proof; containment probe |
| `timeBeginPeriod(1)` | A `win32.ts` | `timeEndPeriod`, refcounted | the OS restores it at exit | -- | -- | unit (fake) |
| Raw Input registration | A | `RIDEV_REMOVE` | dropped by the OS at exit [verified: SIGKILLed child left nothing] | -- | -- | real-OS test (`GetRegisteredRawInputDevices`) |
| Message-only windows, koffi WNDPROCs | A / B | `destroy()`, `unregister` | the OS | -- | -- | unit; real-OS |
| Pointer-device notifications | B | `RegisterPointerDeviceNotifications(NULL, FALSE)` | the OS with the window | -- | -- | real-OS |
| WebHID helper window, device handles | B | `close()` each device, destroy window and listeners | the OS | the window's own heartbeat | -- | unit (fake `hid`) |
| `ClipCursor` | guard (C) | `ClipCursor(NULL)` iff still our rectangle | **guard**: stdin EOF ~14 ms | **guard**: lease 800 ms | `sweepStaleClip`, `free-pen.cmd` | spike proofs ported, `WM_PEN_REAL=1` |
| The sink window (shown / hit-testable) | C | `destroy()`; hit-testing off per 7.6 | the OS | heartbeat 6 s -> destroy; a stuck "on" is turned off by the next real mouse event, or is `unsafe` after 60 s | -- | unit (rules); desktop e2e |
| `inFlight` breadcrumb in `pen-state.json` | D | cleared as 5.8 says | a leftover switches that backend off at the next launch | same | the person turns the backend on again in the Pen menu; `pen-off` / `WRITEMIND_PEN=off` switches the subsystem off | unit |
| Global shortcut Ctrl+Alt+G | C `panic.ts` | `unregister` in `finally` | the OS | -- | -- | unit |
| The guard process | C | `quit` / EOF | exits on EOF | -- | its journal | guard proof |
| `pen-state.json`, `pen-trace*.jsonl`, `pen-leases.json`, `wintab.journal.json` | D / B / C / A | bounded, atomic | a torn last line is tolerated | -- | -- | unit |
| PowerShell child (env probe) | B | killed at 6 s | the OS | -- | -- | unit (fake) |

---

## 15. Test plan (no pen needed)

### 15.1 Layers

| Layer | How | Proves | Cannot prove |
|---|---|---|---|
| T1 pure unit | `npm test` (vitest, node) | decoders on synthetic buffers, the HID layout compiler on real and model descriptors, normalisation, frames, batching, visit tracking, synthesiser, gate (fake window), check verdicts, trace caps, clip validation, lease protocol, containment state machine, static safety scan | that a real driver sends what the synthetic bytes say |
| T2 manager with fakes | vitest, fake timers, `FakeBackend` | selection, liveness, failover, staged starts, backoff, demotion, persistence, focus handling, panic, calibration, E2E gating | real timing |
| T3 recorded-trace replay | golden `*.jsonl` -> decoders -> `PenSample` JSON | decoder regressions; **the first real trace Sean sends becomes a fixture** | -- |
| T4 e2e on the real built app | `npm run e2e -- --suite penfeed` (offscreen, `inject` and `dom`) | the whole path main -> IPC -> gate -> synthesiser -> sheet -> capture; orientations; buttons; gate; chip; check; trace file; release | any hardware |
| T5 real-OS, no pen | `WM_PEN_REAL=1 npx vitest run apps/desktop/test/pen/real`; `npm run e2e -- --desktop --suite pensink` | `wintab32.dll` open / close leaves the driver's context count unchanged; Raw Input receives Windows' synthesized pen end to end; the guard releases a real clip on kill / hang / starve; the sink window rules on a real display | the Wacom itself |
| T6 by hand, once, with the pen | the setup check | everything in section 16 | -- |

Never in CI: T5 (it moves the real cursor or sets a real clip for under a second). T1-T4 are the gate.

### 15.2 Manager scenarios (T2; each is one test, fake timers, `FakeBackend`s with scripts)

1. First run: `wintab-data` and `rawinput` start together; the first to go live is active; the other keeps counting; the winner is stored after 3 s and 30 samples (a native one, see 21).
2. A stored winner starts alone and goes live; no other backend starts.
3. The stored winner stays silent with a witness: the others start at 3 s.
4. The active goes stale: failover to the other live one; a leave sample is synthesised; `FeedEvent failover`.
5. No native backend live, DOM pen events present: `dom` goes live and is active (headline "window pointer"); `webhid` still starts at `STAGE_WEBHID_MS` (the stage guard is `liveNative`); `overlay` is a stage-0 candidate whenever `containment.sinkWanted()` and is *active* only when nothing above it is live.
6. No witnesses: nothing is marked stale and no later stage starts.
7. A higher-priority backend becomes live: takes over only after `UPGRADE_AFTER_LIVE_MS` and with the pen up.
8. `start()` times out / returns `later`: failed with the reason, backoff 5 / 15 / 45 s, demoted for 24 h after the third failure with witnesses; a re-plug event clears it.
9. `start()` throws: failed, not a crash.
10. Blur: backends stop after `BLUR_GRACE_MS`; focus restarts them; a running check holds the blur release.
11. `panic`: everything stops and stays stopped until the window is focused again or capture is turned on.
12. Calibration: pairs feed `inferFrameFromPairs`; accepted results are persisted and applied; a `default` frame is labelled as a guess; `pen:frame-set` overrides; `null` returns to automatic.
13. `swapButtons` exchanges lower / upper after the frame, once.
14. `prefer` narrows to one backend; a disabled backend never starts.
15. Under the E2E flag: native backends unavailable with the stated reason; `inject` works.
16. `wintab-system`: replaces `wintab-data` only when containment wants it, never both open past the handover; falls back when the guard is not ready.
17. A `BackendEvent error fatal` fails the backend; non-fatal is counted.
18. Status pushes: state changes at once, counters at most 4/s, 1/s with no UI.
19. Persistence round trip; corrupt file -> defaults + a `.bak` is kept; migration of `writemind.grab*` keys.
20. The check mode starts every candidate, ignores demotion, and forwards every backend's samples to the engine.
21. `dom` and a native backend both reporting: `dom` is active for the first stroke (its first four samples are handed over, none lost); the native backend takes over only at a pen-up after `UPGRADE_AFTER_LIVE_MS`; the stored winner is the native one, **never `dom`, `overlay` or `inject`**.
22. `dom` alone (every native backend silent): it stays active across visits, is never `stale` or `failed`, the chip reads "window pointer", and the pen is never lost.
23. `prefer` set to a native backend that stays silent: `dom` carries the pen.
24. `domBackend.ingest`: conversion to display fractions (last pixel = 1), two displays, a point on no display (dropped), clamping, non-finite numbers dropped, at most 512 reports per message, `buttons` bits to `tip / lower / upper / eraser`, the leave report; `coverage.*` and `cover.*` for a maximised window, a half-width window and a window partly off the display.
25. Every listener of `onSamples` that throws is isolated (a bug in the renderer feed never kills a backend) and `dom` reports arriving while the feed is closed are dropped.
26. **Frame-settle (5.4):** a live `dom` and a native backend with a `default` frame: no takeover until the fit lands (pairs from `dom` witnesses) or `FRAME_SETTLE_MS` of liveness with the pen up; with nothing else live the default-frame backend is active at once and the chip says "direction guessed"; a frame saved by an earlier run counts as fitted.
27. **Breadcrumb (5.8):** `startBackend` writes `inFlight` (synchronously) before `start()` is called, asserted by call order on a fake store; a clean `stop()`, a failed start and `NATIVE_SAFE_MS` of life each clear it; a store loaded with `inFlight` entries comes up with those backends switched off (`settings.backends[x] === false`, `faults[x]`), the chip says so, the check shows `skipped`, and turning the switch back on clears the fault. Never for `dom`, `inject`, `overlay`.
28. **Kill switch:** `WRITEMIND_PEN=off` or a `pen-off` file => `available: false`, nothing starts, no chip, no gate, and no native module is loaded.
29. `endCheck` stores a native winner only; a check that ends with only `dom` working leaves the stored winner alone.
30. `candidates(true)` (the check) keeps `dom`; `overlay` is a candidate if and only if `containment.sinkWanted()`; `STAGE_OVERLAY_MS` no longer exists.
31. **Containment (C):** the sink arms only under 7.6 (a)-(f); it turns off 400 ms after the last pen signal, at the first real mouse event (and then stays off until 1.5 s without a pen signal), when the native backend goes stale with the overlay backend off (`no-consumer`), and never flips while a tip is down; validation outcomes (`ratio` 0.5 -> `effective`; 0.02 after 1.5 s -> `ineffective`; no native backend and no events -> `ineffective`); `unsafe` after 60 s on without a pen signal; `contain: "auto"` with `capabilities.driver` untested never starts `wintab-system` and never arms a clip.
32. **FFI canary (A):** a fake native layer that writes past the computed packet size makes the backend fail fatally with both sizes in the reason, and the `inFlight` entry stays.
33. **Esc (D, gate test):** Esc releases capture when the focus is on the sheet or the body and does not when it is in `.cm-editor`, an input, a textarea or a contenteditable.
34. **Sink witnesses:** pen events reported by the sink reach `manager.witness` as `dom` witnesses, feed calibration pairs, and keep a live native backend from being judged stale while the sink absorbs the pen.
35. **Guarded callbacks (14.1 #19, #20):** a backend listener, a timer callback and an IPC handler that throw are traced and swallowed and the manager keeps running; a registry that throws while being created leaves `available: false` and the rest of the app untouched.

### 15.3 Fixtures and goldens (`test/fixtures/pen/`, generated by `tools/make-pen-fixtures.mjs`, seeded, deterministic)

* `wintab-figure8.jsonl` -- a `lay` record (Wintab device + context from the spike's real dump: 9500 x 15200, pressure 32767) and `raw` hex packets for a hover, a figure-eight with a pressure ramp, a lower-button press, a dropout, and a leave; `wintab-figure8.golden.json` -- the expected `PenSample[]`.
* `hid-wacom-like.jsonl` and `hid-ms-synth.jsonl` -- layouts (model Wacom-style, and the real Microsoft synthesized pen caps) and reports.
* `trace-session.jsonl` -- a whole session (`session`, `ev`, `raw`, `smp`, `dom`, `st`) for the replay and analyser tests.
* A bad packet stream (scrambled fields) that must trigger the mask fallback.

Regenerate with `node tools/make-pen-fixtures.mjs --write` and review the diff; a golden that changes is a decoder behaviour change and is said out loud.

### 15.4 E2E (T4), `e2e/suites/penfeed/` (on `inject` and `dom`; `WRITEMIND_E2E` forces native off and capture off until a test turns it on)

1. `01-inject-draws-on-the-sheet` -- Tablet source, feed live; a rectangle with a pressure ramp in each of the four orientations: the stored sheet strokes (`__wmSheet`) have the right corners to within 1% and rising pressures; the in-app ring is at the right place; the chip reads "Pen: Test".
2. `02-gate-and-failover` -- `e2e.config({capture:true})`; a DOM pen stroke over the notes and over the sheet (trusted CDP pen events, the harness helpers with `{ pen: true }`; not the script-constructed `pe()`, 4.7) leaves no ink on the notes (the `dom` path puts it on the sheet, see 7); with capture off the same stroke draws where it points, as a plain pointer. Injected samples flowing as well: `inject` is the active backend (it outranks `dom`) and the DOM strokes are still swallowed. A still pen (no samples for 0.5 s while the last one was in range) does not open anything: the gate has no timers. The echo rule: tip-down samples plus a DOM mouse `pointerdown` on the sheet draws nothing; the mouse alone draws. Self-opening: a test hook makes the synthesiser throw five times in a second; the gate opens, a `FeedEvent` names the reason, and capture must be switched on again.
3. `03-buttons-through-the-feed` -- lower button as a tap action (undo), hold actions (select, pan), upper button, the "Test buttons" lamps, a side button pressed with the tip down.
4. `04-chip-and-check` -- chip text and colour per state; a scripted person runs the check by injecting a stream per step and calling `pen:check-step`: verdict rows, advice, the swap evidence; **Copy diagnostics** returns JSON with the required keys and no `title` key; the trace file holds `session`, `ev`, `raw`.
5. `05-release-and-safety` -- blur (`e2e.config({focused:false})`), Esc with the focus on the sheet (and not with the focus in the editor), Ctrl+Alt+G, `pen:panic`: `e2e.state()` shows `open:false`, no containment armed; the process list has no extra windows; the harness' `GetClipCursor` check shows the full screen.

6. `06-feed-perf` -- 200 Hz injected for 5 s while drawing: frame times and the main-to-sheet latency stay inside the `perf` suite's limits (numbers printed as notes).
7. `07-window-pen` -- the baseline with no native backend and no `inject`: capture on, pen events from CDP (`Input.dispatchMouseEvent` with `pointerType: "pen"`, i.e. the harness helpers with `{ pen: true }`; NOT the script-constructed `pe()`, whose `screenX` and `screenY` are 0) at positions all over the window; the sheet strokes appear at the whole-window to whole-sheet mapping in the four orientations (corners to within 1%); `dom` is the active backend, the chip reads "Pen: window pointer", `facts` show the window's coverage; at a device-pixel-ratio of 1.5 (CDP `Emulation.setDeviceMetricsOverride`) the positions are still right (the display-scale question of 4.7); the whole path survives a `Page.reload`.

`pensink` (desktop, `--desktop`): the sink on / off rules with the OS-level injector (`e2e/lib/inject.ps1`); a Windows synthesized pen through the Raw Input backend with `WRITEMIND_PEN_NATIVE=1` and `allowSynthetic`.

### 15.5 What stays unproven until the pen is in hand

A real packet decoding; DOM pen events (`pointerType: "pen"`, pressure, buttons, `screenX`) from the real pen; liveness on the actual driver stack; the frame fit from a real hand; system-context honouring under Windows Ink and DPI; the sink with the real pen; pointer-range for the Wacom; the feel (latency, stroke smoothness); the packaged guard. Section 16 turns each into a measured result.

---

## 16. Unverified on Sean's hardware, and Sean's runbook

### 16.1 Every unknown, and what the design does if the answer is bad

| Unknown | If it is bad, the design... | How it is learned |
|---|---|---|
| The tablet stays up (it died at the 15:28 reboot that followed the driver install, came back at 18:44:41, and may die again at a boot) | nothing can work; the chip says exactly that (problem code and name) and the advice says re-plug / restart / reinstall the driver | `env` step, chip |
| The real pen reaches Chromium as `pointerType: "pen"` with pressure, tip and the barrel in `buttons` (the `dom` floor); `screenX/Y` right at display scales other than 100% | the check's `dom` row reads 0 and the advice says "Windows delivered no pen events to this window" (Mouse mode? Ink off?); Wintab / Raw Input / WebHID are unaffected; a scale error is caught by e2e 07 | `hover` step (`dom` row), trace `dom`, e2e |
| Opening a Wintab context changes how Ink reaches our window (the Wacom driver can switch an application to Wintab mode) | the DOM witnesses go quiet while Wintab flows: reported as a fact in the check ("Wintab live, Windows delivered N pen events"), not as a failure; the pointer-range witness keeps stale detection alive; the echo rule covers pen events that arrive as mouse events | `hover` step, rows side by side |
| Windows maps the whole tablet to the whole display (what the pointer-device probe shows now) | a Wacom Mapping set to a portion of the screen, or the Area helper, shows as partial coverage on a device-frame backend and as partial reach on `dom`; the advice row says what to set back | `sweep` step |
| Wintab delivers packets that decode | mask ladder and plausibility; the raw bytes are in the trace; otherwise Raw Input / WebHID / overlay | `hover` step; trace `raw` |
| Wintab flows with the 6.4.x router driver under Windows Ink | same fallbacks; reason strings | `hover` |
| `TPS_PROXIMITY` polarity | adaptive flip, traced | automatic |
| A still pen sends nothing | two-tier leave timeouts; proximity signals win | automatic; trace |
| Which side button is "lower" | `lower` / `upper` steps; automatic swap when unambiguous; manual switch | `lower`, `upper` |
| The frame (turn / flip) | default guess, flagged; correlation fit from DOM and cursor pairs; guided strokes; manual buttons | `hover`, `sweep` |
| Raw Input streams `Col03` / `Col04` while Ink reads them (listed and registered: verified; native 0..32767 over 15200 x 9500: verified from the descriptor) | the row reads `silent`; the vendor-page fallback may still find the pen; Wintab, WebHID and `dom` carry it | `env`, `hover` |
| WebHID `open()` is allowed | the refusal text is the reason; cut line | `hover` |
| A Wintab system context is honoured (and at this DPI) | `ignored` -> sink or none; the record is per display scale | optional driver test |
| The sink absorbs the real pen (a hit-testable window receives `pointerType: "pen"`); pointer-range fires for the Wacom | the sink validates itself in the first pen visit (7.6): `ineffective` within 1.5 s -> disarmed, the chip says "not contained", the pen keeps working through the native backends or `dom`; no pointer-range signal -> the sink arms from DOM witnesses and native visits instead | passive validation; the optional "Test overlay" re-measures |
| Sean's window is not maximised (1280 x 800 on 1920 x 1200): `dom` reaches about 0.67 x 0.62 | the chip and the reach hint say so and the advice says "maximise (not full screen)"; native backends and the sink are unaffected | `dom` facts, the check |
| A native backend crashes or freezes the app on the first real packet or at `WTOpen` | the canary stops an overrun cleanly; otherwise the breadcrumb switches the backend off at the next launch and the chip says so; `pen-off` switches the subsystem off; `dom` carries the pen | 5.8 |
| The first stroke from a native backend goes the wrong way round (a guessed frame) | the frame-settle rule keeps `dom` drawing until the fit lands (6 s at most); otherwise the chip says "direction guessed" and the agreement monitor catches a wrong fit | 5.4, 6.3 |
| The pen acts as a mouse (Mouse mode) | echo rule stops double ink; `pointerMode` shown; clip becomes valid; advice says switch to Pen mode | RAWMOUSE absolute flag in the check |
| The poll loop really achieves ~4 ms | `gapP95Ms` is in the status; a slow loop is visible, not hidden | status, trace `st` |
| The packaged guard works | lease `lost` -> driver and clip refused; data contexts continue | first packaged run |
| It feels right (latency, smoothness) | Sean decides; the trace has the gaps | by hand |

### 16.2 Sean's runbook (also the text of the "Tablet setup" help in the popover)

1. The tablet works as far as Windows is concerned (read healthy on 2026-10-04 at 12:13; it was dead from the 15:28 reboot on 2026-10-03 until 18:44). If after a restart Windows says it is not working again (the chip says "problem 10"), unplug it and plug it back in; if it stays dead, reinstall the Wacom driver; WriteMind cannot fix that. After a re-plug, if the pen buttons act oddly, restart "Wacom Professional Service" (Services app).
   Keep WriteMind **maximised** (not full screen) if you can: the pen is then over the page almost everywhere. Your saved window is 1280 x 800, which is two thirds of the screen in each direction.
2. Start WriteMind the usual way. Input Devices > Tablet. Look at the chip: "Pen: ready - touch the tablet". Write on the tablet; the ink should appear on the sheet. Until the chip says "contained", keep the pen to the middle of the tablet: its edges are the screen's edges, where the taskbar and the window buttons are. The chip may show amber "Pen: window pointer" for the first stroke or two and then go green "Pen: Wintab - 133 Hz" (or Raw HID / WebHID: whichever door works).
   While the pen is near the tablet a transparent layer (the "overlay") sits over the screen so that the pen cannot click other programs; it lets go the moment you move the mouse, and the chip says "contained: overlay". While capture is on the pen writes **only** on the sheet; use the mouse for buttons, or press Ctrl+Alt+G (or the chip's switch) to give the pen back to the whole window.
3. Click the chip > **Tablet setup check** (20 seconds). Follow the prompts; read the verdict.
4. If the chip says "not contained" and strays bother you: in the verdict, **Test driver mapping** (and **Test overlay** to measure the overlay again). A passing driver mapping is switched on by Contain: Auto; a failing one is written off. Or set Contain to None.
5. If anything is off: **Copy diagnostics** and paste it to me, or send `%APPDATA%\@writemind\desktop\pen-trace.jsonl` and `pen-state.json`.
6. If the mouse or the pen seems stuck after a crash: double-click `tools\free-pen.cmd`.
7. **If WriteMind freezes or closes when you open the Tablet source:** end it (Task Manager) and start it again. The next start has switched the culprit backend off and says so on the chip ("Wintab is off after a crash"); the pen still works through the window pointer. If it keeps happening, create an empty file named `pen-off` in `%APPDATA%\@writemind\desktop\` (or start with the environment variable `WRITEMIND_PEN=off`): the pen subsystem stays off entirely and the sheet behaves as it did before. Delete the file to turn it back on.
8. If WriteMind will not start at all, the independent probes still exist: `C:\CLAUDIO\spikes\wintab-spike\capture.cmd`, `rawinput-spike\tools\live.ps1`, `webhid-spike\tools\live.ps1`, `wspike-contain\probe.cmd`.

---

## 17. Risks, decisions you may want to overrule, later work

### 17.1 Risks (most likely to cost time first)

1. **The tablet/driver state.** The 6.4.14 driver install was followed by a dead tablet (Code 10 from the 15:28 reboot on 2026-10-03 to 18:44:41, then healthy with no known cause; still healthy at 12:13 on 2026-10-04). It may die again at a boot, and nothing is verifiable while it is dead. Not ours to fix; the chip says so with the problem code.
2. **No real Wintab packet and no real HID stroke report has ever been decoded.** Mitigated by the mask ladder, plausibility checks, over-allocated canary buffers (4.2), the breadcrumb (5.8), raw hex in the trace and golden replays; still the biggest implementation risk, and the most likely thing to fail on the first real run.
3. **The router driver may leave the HID transports silent.** Windows Ink reads `Col03` / `Col04` itself, which makes reports likely to exist, but a second reader is unproven. Wintab is the primary for that reason; Raw Input and WebHID are hedges; and `dom` is the floor that does not depend on any of them.
3b. **The floor itself is unverified:** nobody has seen a DOM pen event from the real pen in WriteMind. If Windows Ink is off for this tablet, or the pen is in Mouse mode, `dom` reads 0 and only the native backends can help; the check says which.
4. **Containment is unproven for a real pen, and now partly automatic.** The pen sink (7.6) is tried by itself and validates itself in the first pen visit (my estimate: effective ~75%); if it does not, or for the taskbar band and the title-bar buttons, strays stay possible and the chip says "not contained". The driver mapping and the clip still need a proof and a guard.
4b. **The sink is the one screen-wide thing the app now does by itself.** Its failure mode is a mouse that does not click while a pen is near. It is bounded: hit-testing only under a fresh pen signal and never with a tip down, 400 ms after the last signal it is click-through, a real mouse event turns it off, a stuck "on" is `unsafe` after 60 s, the page's heartbeat kills it, Ctrl+Alt+G and the chip release it. Revision 2 avoided this risk by leaving the pen uncontained until a test; revision 3 judges the risk smaller than leaving about 60% of the tablet pointing at the desktop (17.2).
5. **A native call can hang or crash the main thread** (`WTOpen` with a wedged Wacom service; a buffer overrun in `WTPacketsGet`). The 4 s budget cannot preempt a blocking FFI call. Mitigated, not removed: canary buffers and asserted sizes, the breadcrumb that switches the culprit off at the next launch, and the `pen-off` kill switch. **The real fix is to run the native backends in an Electron `utilityProcess`** (17.3); do that first if the breadcrumb ever fires on Sean's machine.
6. **Leaked state if both app and guard die.** Journal + sweep + `free-pen.cmd`.
7. **Four people editing one tree.** Contract file, stubs, one owner per file, one editor per shared file. The contract delta touches every lane (a new backend name); the compiler finds each place, and D applies it first. Round 1 ended with a red tree because a lane was stopped mid-edit: the green gate (R18) is the answer.
8. **Packaged-build unknowns** (guard unpack, `detached` under a launcher job, the `RunAsNode` fuse).
9. **Several displays and mixed DPI.** Calibration uses the display the window is on; how the driver maps one tablet across several displays is not modelled (the Area helper and the driver's own Mapping tab remain the answer there).
10. **Scope.** Cut order if time runs short: WebHID (ship disabled), then the reach hint's polish, then strip polish, then `penAspect`. The ladder, manager, **the `dom` backend**, gate, synthesiser, trace, check and the sink are the core and must land: `dom` is cheap and is the only piece that works whatever the driver does, and the sink is the only thing that can hold the pen to the sheet.

### 17.2 Decisions I made that Sean or the lead may want to overrule

* **(Revision 3) Containment is layered by what a mechanism leaves behind (7.2).** The sink is on auto-trial; the driver mapping and the clip are proof-gated. Revision 2's "none until proven" would have left most of the tablet uncontained on Sean's saved window until an optional test, and the old Grab (which he used) was on by default.
  The sink is a window of ours with its own brakes. **To revert:** set `DEFAULT_SETTINGS.contain` to `"none"` (one line): then neither the sink nor the overlay backend is ever created, and the rest of the design is unchanged.
* **(Revision 3) `GrabModes` is deleted** rather than kept as a fallback: its cursor heuristics needed the forwarded mouse moves that the new sink does not ask for, and the authoritative signals (a native backend's visit, a DOM witness, pointer-range) plus "a real mouse always wins" cover the same ground.
* **(Revision 3) A backend that took the app down is switched off until the person turns it on again**, not demoted for a day (5.8): a crash deserves a human decision.
* **(Revision 3) Esc is not taken from a text field** (8.8). The old Grab's "Esc lets go" survives for focus outside the editor.
* **(Revision 3) Ownership rebalanced** (R13): the check UI and the diagnostics text moved to B, the strip and the reach hint to C. If a lane is cut short, the displaced files are the first to hand back to D.
* **(Revision 3) The E2E channel is `pen:inject`**, as the brief says.
* Capture **stops when the window is not in front** (grace 1.5 s). Alternative: keep reading in the background -- rejected, the pen would act on the other app while we also draw.
* The gate swallows the pen **everywhere on the page**, not only on the sheet (otherwise double ink), and **whenever capture is on**, not only while a feed is healthy: the `dom` backend always has a consumer for it. Alternative: revision 1's gate that opened itself when the feed went quiet -- rejected, it needed hold timers, doubled the first event of a stroke, and "the pen is a normal pointer again" is the worse fallback for a person who wants the whole tablet to be the sheet. Cost to remember: while capture is on the pen cannot operate anything except through the sheet (the mouse and the switch still can).
* **The `dom` baseline exists**, costs one small backend and one IPC channel, and means the pen cannot be lost by a wrong guess about the native backends. Alternative: no baseline, trust the ladder -- rejected, every rung is unverified.
* Only a tablet-native backend is ever stored as the winner.
* Capture starts **off** under E2E (so no existing pen or tablet script changes behaviour). Native backends are off under E2E.
* The hook is deleted rather than demoted (it cannot work for a pointer-handling window).
* Wintab ranks above Raw Input above WebHID (reasoned, not measured: all three are in the same state, plumbing verified and strokes not, and the order only breaks ties; Raw Input has the smaller blast radius if it works, since a registration leaves nothing behind, and Wintab the better odds of delivering).
* The overlay no longer draws; the strip lives in the notes window.
* The check applies an unambiguous button swap by itself (with an Undo link).

### 17.3 Later work (not in this round)

* **Moving the native backends into an Electron `utilityProcess`** (Wintab, Raw Input, pointer-range) so a driver hang or a bad buffer cannot take the UI with it: the `PenBackend` interface is already process-agnostic (a proxy backend forwards `start/stop/status` and batches over a `MessagePort`; the decoders are pure). Priority one if the breadcrumb ever fires.
* A `GetCurrentInputMessageSource`-in-`WM_NCHITTEST` probe: if a koffi-owned layered window can be hit-testable for the pen only, the sink stops blocking the mouse at all (10-minute spike, needs no tablet).
* A signed UIAccess helper with `RegisterPointerInputTarget` -- the only true capture; needs a certificate Sean must choose to trust.
* `penAspect`: the sheet adopts the tablet's physical aspect when it differs from the display's.
* Several tablets at once; tilt-aware pens; auto-send after idle.
* Writing a Wacom application-specific profile for WriteMind: declined (it edits system configuration).

---

## Appendix A. Tested reference sketches

Each of these ran on 2026-10-03 (scratch, outside the repo): A.1 and A.2 were type-checked with `tsc --strict` and run after bundling with the repo's esbuild (41 checks, 0 failures); A.3 was run on this machine. They are starting points, not mandates: the implementer may restructure, but the behaviour and the thresholds are the contract.

### A.1 `main/pen/frame.ts` -- `inferFrameFromPairs`

Cases covered: all 8 transforms with a rectangle-and-cross sweep, with a driver "portion of screen" mapping, and with a waving hover; 10% / 15% / 18% of pairs spoiled by a moving mouse; refusals for a diagonal scribble, a straight line, ten pairs, and pure noise.

```ts
/**
 * REFERENCE SKETCH for main/pen/frame.ts `inferFrameFromPairs` (design section 6.3, appendix A.1).
 * Tested 2026-10-03 on synthetic strokes: 8 transforms x {rectangle+cross, driver "portion of screen" mapping, waving hover},
 * 10% / 15% / 18% of pairs polluted by a moving mouse, and the refusals (diagonal scribble, straight line, 10 pairs, pure noise): 33 / 33.
 * IMPL-A may restructure it; the thresholds and the refusals are the contract.
 */
import { applyFrame, type FrameTransform } from "../../shared/pen"

export interface FramePair { raw: { x: number; y: number }; screen: { x: number; y: number } }
export interface FrameFit { frame: FrameTransform; score: number; margin: number }
export type FrameRefusal = { frame: null; reason: string }

export const FRAME_CANDIDATES: FrameTransform[] = ([0, 1, 2, 3] as const).flatMap((turn) => [false, true].map((flipY) => ({ turn, flipY })))

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
const sd = (a: number[], m = mean(a)): number => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)

/** Pearson correlation; 0 when either side is constant. */
export function corr(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b), sa = sd(a, ma), sb = sd(b, mb)
  if (sa < 1e-9 || sb < 1e-9) return 0
  let c = 0
  for (let i = 0; i < a.length; i++) c += (a[i]! - ma) * (b[i]! - mb)
  return c / a.length / (sa * sb)
}

/** Correlation after dropping the worst `trim` share of pairs by their residual from a per-axis least-squares line. */
function trimmedScore(t: [number, number][], sx: number[], sy: number[], trim: number): number {
  const line = (a: number[], b: number[]): number[] => {
    const ma = mean(a), mb = mean(b)
    let n = 0, d = 0
    for (let i = 0; i < a.length; i++) { n += (a[i]! - ma) * (b[i]! - mb); d += (a[i]! - ma) ** 2 }
    const k = d ? n / d : 0
    return a.map((v) => mb + k * (v - ma))
  }
  const tx = t.map((q) => q[0]), ty = t.map((q) => q[1])
  const fx = line(tx, sx), fy = line(ty, sy)
  const worst = tx.map((_, i) => Math.max(Math.abs(fx[i]! - sx[i]!), Math.abs(fy[i]! - sy[i]!)))
  const keep = worst.map((r, i) => [r, i] as const).sort((a, b) => a[0] - b[0])
    .slice(0, Math.max(8, Math.floor(worst.length * (1 - trim)))).map((q) => q[1])
  const pick = (a: number[]): number[] => keep.map((i) => a[i]!)
  return Math.min(corr(pick(tx), pick(sx)), corr(pick(ty), pick(sy)))
}

export interface InferOptions { minPairs?: number; minSd?: number; maxCross?: number; accept?: number; runnerUp?: number; trim?: number }

/**
 * Which of the 8 transforms takes the device frame to the screen frame, from pairs of (device sample, where the pointer stack
 * says the pen is). Scale- and offset-free, so a driver "portion of screen" mapping or a sheet-sized system-context mapping does not matter.
 */
export function inferFrameFromPairs(pairs: FramePair[], o: InferOptions = {}): FrameFit | FrameRefusal {
  const minPairs = o.minPairs ?? 24, minSd = o.minSd ?? 0.08, maxCross = o.maxCross ?? 0.8
  const accept = o.accept ?? 0.9, runnerUp = o.runnerUp ?? 0.6, trim = o.trim ?? 0.2
  if (pairs.length < minPairs) return { frame: null, reason: "too few pairs" }
  const rx = pairs.map((p) => p.raw.x), ry = pairs.map((p) => p.raw.y)
  const sx = pairs.map((p) => p.screen.x), sy = pairs.map((p) => p.screen.y)
  if (sd(rx) < minSd || sd(ry) < minSd) return { frame: null, reason: "raw spread too small" }
  if (Math.abs(corr(rx, ry)) >= maxCross) return { frame: null, reason: "ambiguous: x and y move together" }
  const scored = FRAME_CANDIDATES.map((frame) => {
    const t = pairs.map((p) => applyFrame(p.raw.x, p.raw.y, frame))
    const plain = Math.min(corr(t.map((q) => q[0]), sx), corr(t.map((q) => q[1]), sy))
    return { frame, score: plain >= accept ? plain : trimmedScore(t, sx, sy, trim) }
  }).sort((a, b) => b.score - a.score)
  const best = scored[0]!, second = scored[1]!
  if (best.score < accept) return { frame: null, reason: "no good fit" }
  if (second.score > runnerUp) return { frame: null, reason: "runner-up too close" }
  return { frame: best.frame, score: best.score, margin: best.score - second.score }
}
```

### A.2 `shared/penEvents.ts` -- the sample-to-event state machine (pure)

Run against the repo's real `renderer/penButtons.ts` (`resolvePress` + `tapStep`). What the existing code decided for the synthesised events; these become `penEvents.test.ts`:

| Scenario (samples) | Events | The existing code decides |
|---|---|---|
| hover, tip down, move, tip up | over, enter, down(button 0, buttons 1), move, up | `draw` |
| lower pressed in the air, then drag with the tip, released | down(button 2, buttons 2), move(buttons 3), move(buttons 2), up(button 2) | `select` (the default HOLD) |
| lower set to Undo (a TAP): pressed and released in the air | down(button 2), up(button 2) | `tap undo`, **fires once** |
| lower set to Undo: pressed while the tip is down | down(button 0, buttons 1), move(buttons 3), move(buttons 1), up | `draw`, **no tap** |
| upper (default Pan) held while hovering, then tip | down(button 1, buttons 4), move(buttons 5), up | `pan` |
| upper set to Next colour (a TAP): pressed and released in the air | down(button 1), up(button 1) | `tap nextColour`, **fires once** |
| the pen leaves range with the tip down | down, up, out, leave | `draw`; the stroke is closed first |

```ts
/**
 * REFERENCE SKETCH for shared/penEvents.ts (design section 8.3, appendix A.2). Pure: no DOM.
 * Tested 2026-10-03 against the repo's real renderer/penButtons.ts (resolvePress + tapStep) on seven scenarios: a plain stroke;
 * the lower button as a HOLD (select) pressed in the air then dragged; as a TAP (undo) pressed and released in the air (fires once);
 * pressed while the tip is down (not a tap); the upper button as Pan and as a TAP (next colour); leaving range with the tip down.
 * It describes events; penFeed.ts turns each into `new PointerEvent(...)` on the element under the point.
 */
import type { PenSample } from "./pen"

export type SynthType = "pointerover" | "pointerenter" | "pointermove" | "pointerdown" | "pointerup" | "pointerout" | "pointerleave"

export interface SynthEvent {
  type: SynthType
  /** DOM `button`: tip 0, upper 1, lower 2, eraser 5; -1 for a move. */
  button: number
  /** DOM `buttons` mask: tip 1, lower 2, upper 4, eraser 32. */
  buttons: number
  pressure: number
  tiltX?: number
  tiltY?: number
}

export interface Synth {
  /** One sample in, the events it causes out (in order). */
  step(s: PenSample): SynthEvent[]
  /** Blur, failover, close, backend change: end any contact and leave. */
  reset(): SynthEvent[]
  readonly inRange: boolean
  readonly mask: number
}

const TIP = 1, LOWER = 2, UPPER = 4, ERASER = 32

const maskOf = (s: PenSample): number =>
  (s.tip ? TIP : 0) | (s.lower ? LOWER : 0) | (s.upper ? UPPER : 0) | (s.eraser ? ERASER : 0)

/** The first pressed button, in the order tip 0, lower 2, upper 1, eraser 5. */
function firstPressed(next: number): number {
  if (next & TIP) return 0
  if (next & LOWER) return 2
  if (next & UPPER) return 1
  if (next & ERASER) return 5
  return 0
}

/** The button released last when the mask goes to zero (tip first). */
function lastReleased(prev: number): number {
  if (prev & TIP) return 0
  if (prev & LOWER) return 2
  if (prev & UPPER) return 1
  if (prev & ERASER) return 5
  return 0
}

export function createSynth(): Synth {
  let inRange = false
  let mask = 0
  const leave = (out: SynthEvent[]): void => {
    if (mask !== 0) out.push({ type: "pointerup", button: lastReleased(mask), buttons: 0, pressure: 0 })
    if (inRange) {
      out.push({ type: "pointerout", button: -1, buttons: 0, pressure: 0 })
      out.push({ type: "pointerleave", button: -1, buttons: 0, pressure: 0 })
    }
    inRange = false
    mask = 0
  }
  return {
    get inRange() { return inRange },
    get mask() { return mask },
    reset() { const out: SynthEvent[] = []; leave(out); return out },
    step(s) {
      const out: SynthEvent[] = []
      if (!s.inRange) { leave(out); return out }
      const next = maskOf(s)
      // 0.5 is what TabletSurface assumes for a pen without pressure
      const pressure = next & TIP ? (s.p > 0 ? s.p : 0.5) : 0
      const tilt = { ...(s.tiltX !== undefined ? { tiltX: s.tiltX } : {}), ...(s.tiltY !== undefined ? { tiltY: s.tiltY } : {}) }
      if (!inRange) {
        out.push({ type: "pointerover", button: -1, buttons: 0, pressure: 0, ...tilt })
        out.push({ type: "pointerenter", button: -1, buttons: 0, pressure: 0, ...tilt })
        inRange = true
      }
      if (mask === 0 && next !== 0) out.push({ type: "pointerdown", button: firstPressed(next), buttons: next, pressure, ...tilt })
      else if (mask !== 0 && next === 0) out.push({ type: "pointerup", button: lastReleased(mask), buttons: 0, pressure: 0, ...tilt })
      else if (mask !== next) out.push({ type: "pointermove", button: -1, buttons: next, pressure, ...tilt })
      else out.push({ type: "pointermove", button: -1, buttons: next, pressure, ...tilt })
      mask = next
      return out
    },
  }
}
```

### A.3 `main/pen/env.ts` -- the environment probe (Windows PowerShell 5.1, read-only)

```powershell
# main/pen/env.ts runs this ONE script (powershell.exe -NoProfile -NonInteractive -Command <this>), 6 s timeout, JSON on stdout.
# Read-only. Tested 2026-10-03 on Windows 10 19045 / Windows PowerShell 5.1: about 1.0 s from a cold start.
$ErrorActionPreference = 'SilentlyContinue'
$out = [ordered]@{}
$devs = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_056A' })
$out.tablet = @($devs | ForEach-Object {
  $code = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode').Data
  [ordered]@{ instanceId = $_.InstanceId; name = $_.FriendlyName; class = $_.Class; status = [string]$_.Status; problem = [string]$_.Problem; problemCode = $code }
})
$svc = Get-Service -Name WTabletServicePro
$out.service = if ($svc) { [string]$svc.Status } else { $null }
$ver = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -eq 'Wacom Tablet' } | Select-Object -First 1
$out.driver = if ($ver) { [string]$ver.DisplayVersion } else { $null }
$out | ConvertTo-Json -Compress -Depth 4
# Output on this machine, healthy (2026-10-03 21:5x CDT): FIVE devices, the USB device and its four HID children, all OK. (PowerShell 5.1 writes "&" as &; JSON.parse reads it.)
# {"tablet":[{"instanceId":"HID\\VID_056A&PID_037A&COL03\\6&25D3763C&0&0002","name":"HID-compliant pen","class":"HIDClass","status":"OK","problem":"CM_PROB_NONE","problemCode":0}, ...COL04 digitizer..., {"instanceId":"USB\\VID_056A&PID_037A\\2DA00L1059230","name":"Wacom Tablet","class":"HIDClass","status":"OK","problem":"CM_PROB_NONE","problemCode":0}, ...COL01 Wacom Pointer (class Mouse), COL02 vendor-defined...],"service":"Running","driver":"6.4.14-1"}
# Output while the tablet was dead (2026-10-03 16:58 CDT): ONE device (-PresentOnly hides the ghost HID children), so the reducer must cope with both shapes:
# {"tablet":[{"instanceId":"USB\\VID_056A&PID_037A\\2DA00L1059230","name":"Wacom Tablet","class":"HIDClass","status":"Error","problem":"CM_PROB_FAILED_START","problemCode":10}],"service":"Running","driver":"6.4.14-1"}
# The reducer rule (env.ts parseProbe, already written that way): the entry with a non-zero problem code wins, else the USB parent, else the first entry.
```

---

## Decisions (implementers; append only, one block per lane)

### wimpl-b-webhid (IMPL-B, WebHID), 2026-10-04

* **WebHID is in** (4.4 stands). Files: `main/pen/webhid/{protocol,primary,hidSource,hostPage,permissions,electronHost,webhidBackend}.ts`, `preload/penHid.ts`, `helpers/pen-hid.html`. `createWebHidBackend(deps)` keeps the contract signature; `createWebHidBackendWith(deps, options)` is the same class with injectable host / permissions / clock for tests. `scripts/build.mjs` already had the three entries (`pen-hid.cjs`, `pen-hid.js`, `helpers/` copy); the locked build produces them.
* **`WebHidDeps` as the registry must fill it:** `session: session.fromPartition("pen-hid")`, `preload` = `out/preload/pen-hid.cjs`, `page` = `out/helpers/pen-hid.html`, `log`. The backend installs the permission hooks on that session in `start()` and takes them off in `stop()`; the session must never be the notes window's.
* **Private IPC (`webhid/protocol.ts`, not in `PEN_CHANNELS`):** `pen:hid-samples`, `pen:hid-raw`, `pen:hid-status` (page to main) and `pen:hid-command` (main to page). Main listens on the helper's own `webContents.ipc`, so the sender check is structural. Everything is validated by `parse*` before use.
* **Primary-report rule implemented locally** (`webhid/primary.ts`), on top of the existing `layoutFromWebHid` / `PenDecoder`, so it does not wait for A: best `penScore` among NON-vendor top-level collections, ties to descriptor order; the vendor page (>= 0xff00) is only the fallback. `hid/decoder.ts` and `hid/layout.ts` are untouched. If A adds an equivalent to the shared decoder, `primary.ts` can shrink to a call into it.
* **Vendor fallback (4.3 applied to WebHID):** the vendor report is decoded only when it streams (> 3 reports in 2 s) while the primary has been silent for 2 s, and stops being decoded when the primary speaks again. The idle heartbeat (1 per 5 s) can never trigger it.
* **Visit logic lives in main** (`VisitTracker` over `BackendCore`), not in the page: a device whose primary report has an In Range field (the Wacom) is authoritative, others time out after `LEAVE_HOVER_MS` / `LEAVE_CONTACT_MS`. The page sends decoded device-frame samples, at most 2 ms apart; main re-batches at `BATCH_MS`.
* **`start()` budget** is 3.5 s (load 2.5 s, handshake 1.5 s, devices to the rest), under `START_TIMEOUT_MS`. Nothing listed: one `requestDevice` through `executeJavaScript(..., userGesture = true)`, then `armed` with the reason (never `failed`); a hot-plug re-adopts and emits the `device` event. A refused `open()` is `failed`, `retry: "later"`. Missing `navigator.hid` is `retry: "never"`.
* **A hidden helper window is a window.** `electronHost` has a 2 s watchdog: no other BrowserWindow left means the helper reports "gone" and destroys itself, so a forgotten `stop()` cannot keep the app alive after the notes window closes. The proper path is still `manager.close()/dispose()` running before the last notes window goes (D).
* **CSP** `default-src 'none'; script-src 'self'` on the helper page (checked: the script loads from `file:`). **Test hook:** the page reads `window.__penHidTestHid` before `navigator.hid` (planted by `WebHidBackendOptions.testScript`, only the e2e harness sets it).
* **Fixtures:** `test/fixtures/pen/wacom-ctl472-real.json` (the REAL WebHID metadata) is copied from the spike; A's `rawinput` fixtures are theirs.
* **Two B-owned tests fixed:** `check.test.ts` (the label list now has `dom`, as the contract delta requires) and `env.test.ts` (the second `collectEnv` after an uncached failure runs, so the counter is 2).
