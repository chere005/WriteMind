# Spike: the Wacom pen through Wintab (`wintab32.dll` via koffi)

Lane: Wacom. Written 2026-10-03 by `wspike-wintab`. Code and scratch live OUTSIDE the repo in
`C:\CLAUDIO\spikes\wintab-spike\` (nothing in `apps\` or `packages\` was changed). Raw outputs are in
`C:\CLAUDIO\spikes\wintab-spike\results\`.

## Verdict

**Wintab is reachable from Electron's main process with koffi, and everything that can be checked without a moving
pen works: the interface/device/cursor queries, DATA and SYSTEM contexts opening and closing, a hidden
`BrowserWindow` owning the context, window messages arriving through `hookWindowMessage`, the mouse untouched.
What it cannot answer without a pen: whether packets actually flow, whether they flow while another window has
focus, and whether a SYSTEM context's `lcSysOrg/Ext` really re-maps the cursor.** The draft modules and a trace
recorder are ready so the first minute with a working tablet settles all three (see "First minutes").

### Update 21:23 (second session): the tablet is back, the numbers below are now live

The first session ran while `USB\VID_056A&PID_037A\2DA00L1059230` was in `CM_PROB_FAILED_START` (Code 10; see
`wacom-webhid.md`) and Wintab said `IFC_NDEVICES = 0`. When this was re-checked the device was `Status OK`,
`probe1.cjs` now reports **`NDEVICES 1`** and the PnP id `2DA00L1059230`, and the extents are **unchanged: X 0..9499,
Y 0..15199** - so the portrait extents are real, not an artefact of a cached description (the device, in Wintab's
natural frame, is "portrait in, landscape out": the driver turns it for a landscape-mounted tablet, which is exactly
what `inferFrameFromCursor` finds out at runtime). New with a live tablet: cursor 1 "Pressure Stylus" and cursor 2
"Eraser" now also appear with `physid 1`, type `0x4022`, `pktdata 0x5ff` and a garbage button-name buffer (4 buttons) -
a physical-id cursor entry for the real pen; cursors 4/5 are the classic 3-button stylus / 1-button eraser. The
code identifies the eraser by `CRC_INVERT` (capabilities & 4) and by `TPS_INVERT` in the packet status, and takes the
button count from each packet, so neither entry breaks it. Repeated with the healthy tablet: `probe3.cjs` (DATA and
SYSTEM contexts open, driver keeps `sys 1280 0 640 1200`, mouse unchanged, `GetClipCursor` the whole screen) and a
15 s `capture.mjs --fg` (context 2 -> 3 -> 2, closed cleanly, **0 packets because nobody moved the pen**). Everything
under "Not known" is still unknown for that reason only. The rest of the document keeps the first-session wording; where it
says "cached" read "live" for the device numbers.

### Re-check 2026-10-04 (third pass, "try again")

Nothing in the repo was changed by this lane; the draft modules were re-verified as they stood: 54 vitest tests pass and
`tsc` is clean in `C:\CLAUDIO\spikes\wintab-spike\`; `probe1` still reports `NDEVICES 1`, X 0..9499, Y 0..15199;
`probe3` again shows DATA and SYSTEM (`sys 1280 0 640 1200`) contexts opening and being stored as asked, `SendInput`
moves unchanged in all four phases, `GetClipCursor` the whole screen; an 8 s `capture --fg` recorded **0 packets**
(nobody moved the pen), contexts 2 -> 3 -> 2, closed cleanly. The only handles closed were the ones this run opened.
The draft's `PenSample` is field-for-field the one in `apps\desktop\src\shared\pen.ts` (`t` there is epoch ms from
`performance.timeOrigin`; `wintab.ts` aligns `PK_TIME` to `Date.now()`, so the build lane should pass its clock in).
The unknowns are unchanged: packet flow, flow while another window is foreground, and whether `lcSys*` re-maps the cursor.

## What was measured (Wintab 1.4 spec, implementation 1.39, "Wintab Digitizer Services")

| Question | Result |
|---|---|
| `wintab32.dll` loads in node and in Electron 44 main via koffi 3.3.2 | yes; no native build. 64-bit; HCTX is a small integer (e.g. 0x801..0x807), `koffi.address()` turns it into a bigint to pass back. |
| `WTInfoW(0,0)` (is Wintab there) | 8790 bytes: yes. `WTI_INTERFACE`: spec 1.4, impl 1.39, `NDEVICES 0`, `NCURSORS 6`, `NCONTEXTS 32` (the driver-wide limit), `NEXTENSIONS 5`, `CTXSAVESIZE 172`. |
| Device 0 | "WACOM Tablet", `HWC_HARDPROX`, 100 pkt/s, `DVC_PKTDATA 0x1ff`; X 0..9499, Y 0..15199, units cm (TU_CENTIMETERS=2), resolution 1000 lines/cm (so 9.5 x 15.2 cm: a One by Wacom S, 152 x 95 mm, but **portrait**); normal pressure 0..32767; no tangent pressure; orientation axes: azimuth 0..0, altitude -900..900, twist 0..0 (the S has no tilt, so tilt must be optional); no rotation. |
| Cursors | 0 "Puck" (16 buttons), 1 "Pressure Stylus" (3 buttons: names `tip`, `barrel`, `barrel 2`; `CSR_PKTDATA 0x1dff`), 2 "Eraser" (1 button, `CRC_INVERT` capability 0x4, type 0xc000); 3-5 repeat them (second tool id). So eraser = cursor 2 or 5 / `CSR_CAPABILITIES & 4`, or `TPS_INVERT` in `pkStatus`. Sean's pen has no eraser end: expect only 1 and 4. |
| Default contexts (`WTI_DEFCONTEXT`, `DEFSYSCTX`, `DDCTXS+0`, `DSCTXS+0`) | 212 bytes (`LOGCONTEXTW`, the layout in `wintab.ts` was checked against these dumps). **`inExt` 9500 x 15200 but `outExt` 15200 x 9500** (portrait in, landscape out) for the digitizing contexts; system contexts `outExt` 1920 x 1200 = the screen; `lcSysExt` 1920 x 1200; `pktData 0x1c0`, `moveMask 0x180`, `msgBase 0x7ff0`. |
| DATA context (`lcOptions` without `CXO_SYSTEM`) | `WTOpenW` succeeds, driver stores `status 0x4` (`CXS_ONTOP`), our `pktData 0x15fe` accepted, `WTQueueSizeSet(128)` ok. No packets pending (no pen). |
| SYSTEM context with `lcSysOrg/Ext` = the right 640x1200 strip and `lcOut*` the same | `WTOpenW` succeeds, **the driver keeps the rectangle exactly** (`WTGetW`: sys 1280,0,640,1200), `status 0x4`. Nothing refused. **Whether it moves the cursor into that strip is unknown without a pen** (see "Cannot be known"). |
| Mouse while contexts are open | `SetCursorPos` and `SendInput` absolute moves behave identically before, with a DATA context, with a SYSTEM context, and after close (`results\probe3-open-close.txt`). `GetClipCursor` stays the whole screen. |
| Hidden `BrowserWindow` as owner | `win.getNativeWindowHandle().readBigUInt64LE()` works as `hwnd`; with `CXO_MESSAGES` the driver posted a real `WT_CTXOPEN` (0x7ff1) which `win.hookWindowMessage(0x7ff0 + n, cb)` delivered (`wParam` = HCTX, `lParam` = options); a synthetic `WT_PROXIMITY` (0x7ff5) posted by us arrived the same way and parses (`LOWORD` = entered the context, `HIWORD` = entered hardware proximity). So the message path for proximity and `WT_PACKET` is real; only the driver's own proximity/packet posts need a pen. A message-only `STATIC` window also works as owner for pure polling. |
| Timer resolution in Electron main | **`setInterval(4)` ticks every ~15 ms by default** (hidden window, Windows' 15.6 ms tick); with `timeBeginPeriod(1)` it ticks every ~4.5 ms. `WintabSession.open` calls `timeBeginPeriod(1)` (reference-counted) and `close` gives it back. Without it the "batched <= 8 ms" contract cannot be met by polling alone; the `WT_PACKET` message (`WintabPen.kick()`) is the second line. |
| Packet size | the app's mask is 48 bytes: ten 4-byte fields (status, time, changed, serial, cursor, buttons, x, y, normal pressure) and a 12-byte orientation. Never `PK_CONTEXT`. Order and sizes are the wintab.h ones (no Wintab SDK header exists on this machine - searched `C:\` for `wintab*.h` - so this is from the published header, not verified against a file; the driver did not complain, and `lcPktData` read back unchanged). |

## The incident (my mistake; read before touching contexts)

The driver keeps a context open **after its process is killed** (verified: a child that opened 3 contexts and was
`SIGKILL`ed left `STA_CONTEXTS` +3 for good; nothing times out). Trying to clean up those leaks I called `WTClose` on
**guessed handle numbers** (2050-2052). The driver accepts `WTClose` from any process, and handle numbers are
handed out in no useful order (observed 2054, 2050, 2055, 2051 in one run), so one of those guesses closed a context
that was not mine: `STA_CONTEXTS/SYSCTXS` went from the original **2/2** to **1/1** after all my own were gone.
The surviving one (handle 0x801) went from `CXS_OBSCURED` to `CXS_ONTOP`, i.e. the closed one had been above it. Most
likely owner: the Wacom service (no process has `wintab32.dll` loaded; the tablet is in Code 10 anyway, so the context
had nothing to serve), possibly a stale leak of an older program. **If the pen buttons, Tablet Properties or mapping
misbehave after the tablet is re-plugged, restart the "Wacom Professional Service" (or reboot) - that recreates
the driver's own contexts.** Rule written into `wintabNative.ts`: never close a handle that was not positively
identified; our contexts are named `WriteMind pen <pid>` in `lcName` (`WTGetW` returns it) and only a journalled
handle whose name still carries a DEAD pid's marker is closed (`recoverStaleContexts`; verified: kill -9 the recorder,
the next start closes exactly that handle and the driver count returns to baseline).

## What can and cannot be known without a moving pen

**Known / verified now:** the API loads and the structure layouts are right (212-byte context, 16-byte AXIS);
DATA and SYSTEM contexts open, are stored as asked, close cleanly (`STA_CONTEXTS` back to baseline); the mouse is
not disturbed; window messages work through a hidden BrowserWindow; the 15 ms vs 4.5 ms timer finding;
leaked contexts survive process death and are recoverable only by handle.

**Not known (needs the pen on a healthy tablet):**
1. That packets arrive at all, at what rate (spec says 100/s; a Pen mode / Windows Ink driver may feed Wintab differently).
2. **Whether packets arrive while the Wintab owner is not the foreground window** and with Windows Ink on. The spec
   makes delivery depend on the context's priority/overlap order, not on focus; the Wacom driver is known to behave
   that way for data contexts but this was not seen. `capture --fg` records the foreground title with every packet.
3. **Whether a SYSTEM context with a sub-rectangle re-maps the cursor.** Per the spec `lcSys*` is the screen area the
   tablet maps to for the system cursor while the context is on top; many modern drivers ignore it when Windows Ink
   owns the cursor. The driver stored it without complaint, which proves nothing. `capture --system --rect x,y,w,h`
   plus the trace column `cx,cy` (OS cursor) answers it: if the cursor stays inside the rectangle, this is the
   mapping we want and the whole "tablet = just the sheet, mouse still free" problem is solved at driver level.
4. The direction of the portrait-to-landscape turn and the Y origin (Wintab says lower-left; the portrait extents
   are suspicious, see above). Solved at runtime, no question asked: `inferFrameFromCursor` pairs each packet with the
   OS cursor (Pen mode puts the cursor where the pen is, in the screen's frame) and picks the one of 8 flips/turns
   with the least error; `inferFrame` does the same from two deliberate strokes if the cursor does not follow.
5. `TPS_PROXIMITY` polarity (spec: "cursor is out of context"; assumed, one constant `PROX_BIT_MEANS_OUT`).
6. Which side button is "lower" (assumed: logical button 1 = `barrel` = bit 0x2 = lower, `barrel 2` = bit 0x4 = upper).

## Proximity, buttons, eraser, cleanup (as built)

* **Proximity:** a packet with `TPS_PROXIMITY` set ends the visit; otherwise the visit ends `IN_RANGE_TIMEOUT_MS` (120 ms)
  after the last packet (`WintabNormaliser.tick`); `WT_PROXIMITY` with `LOWORD(lParam) = 0` ends it at once
  (`WintabPen.onWindowMessage`). One leave-range sample (`inRange:false, p:0, tip:false`) is emitted per visit.
* **Buttons:** low word of `PK_BUTTONS`, bit n = logical button n: tip 0x1 (-> `tip`; pressure > 0 also counts), barrel 0x2 -> `lower`,
  barrel 2 0x4 -> `upper`. The high word (a change code) is ignored. Eraser: cursor index in the eraser set from `WTI_CURSORS`, or `TPS_INVERT`.
* **Time:** `PK_TIME` is the driver's ms clock; the smallest (arrival - PK_TIME) seen is the offset, and a batch that arrives
  together uses its NEWEST packet for it, so 10 ms spacings survive (`pushBatch`).
* **Cleanup:** `WTClose` in `close()`; `process.on('exit')`, SIGINT/SIGTERM/SIGBREAK and `uncaughtException` close every open
  session (`installWintabExitCleanup`; call `closeAllWintab()` from Electron's `will-quit` too); the handle is journalled
  and recovered at next start as above; `timeEndPeriod` is paired. A hard kill (`wm-stop.ps1`, Task Manager, power) cannot
  be caught - the journal is the only defence, and it works only on the next WriteMind start.
* **Context shape:** DATA by default (`lcOptions` 0, `lcOut* = lcIn*`, so packets carry raw tablet units, no scaling surprises);
  SYSTEM only on request. `pktMode 0` (absolute), `moveMask = pktData`, queue 256.

## The code (draft; the build lane moves it to `apps\desktop\src\main\pen\`)

| File | What |
|---|---|
| `wintab.ts` | Pure: constants, `decodeWintabPackets`/`encodeWintabPackets`, `parseLogContext`/`writeLogContext` (212 bytes), `parseAxis`, `normalisePacket`/`WintabNormaliser` (-> `PenSample`), `ClockAligner`, `tiltFromOrientation`, `inferFrameFromCursor`, `inferFrame`, `parseProximityMessage`. |
| `wintabNative.ts` | koffi: `loadWintab`, `readInterface/readDevice/readDefaultContext/contextCounts`, `WintabSession.open/poll/close`, exit cleanup, `recoverStaleContexts`, `highResTimer`. |
| `wintabPen.ts` | The service: poll timer + `kick()` on `WT_PACKET`, batches to `onBatch`, proximity, frame inference from the cursor, optional trace hook. Electron-agnostic (the caller wires `hookWindowMessage`). |
| `trace.ts`, `capture.ts`, `analyse.ts`, `capture.cmd` | Record a JSON-lines trace of raw packets + OS cursor (+ foreground title) and analyse it. |
| `electronSpike.ts` | The Electron-main check above (`electron out\electronSpike.mjs`). |
| `*.test.ts` | 54 vitest tests on synthetic buffers: `cd C:\CLAUDIO\spikes\wintab-spike; node node_modules\vitest\vitest.mjs run` (`node_modules` is a junction to the repo's). `tsc -p tsconfig.json` clean. `node build.mjs` bundles `out\*.mjs`. |

Integration sketch for the build lane: on start `recoverStaleContexts(api, userData/wintab.journal.json)`; create a hidden
`BrowserWindow` (or reuse the main window's HWND); `WintabSession.open({hwnd, mode:"data", messages:true, journalPath})`;
`for off in WT_MSG: win.hookWindowMessage(0x7ff0+off, (w,l) => pen.onWindowMessage(off, l.readUInt32LE(0)))`; `new WintabPen({...,
cursor: () => screen fractions of GetCursorPos on its display, onBatch: batch => webContents.send("pen:samples", batch)})`;
`pen.start()`; `will-quit` -> `pen.stop(); closeAllWintab()`. Keep the renderer on pointer events as the fallback backend (`backend` field).

## First minutes with a healthy tablet (what to run, in order)

1. Re-plug the tablet. `node C:\CLAUDIO\spikes\wintab-spike\probe1.cjs` - `NDEVICES` should be 1; note the real X/Y extents.
2. `C:\CLAUDIO\spikes\wintab-spike\capture.cmd --seconds 60 --fg` - hover, press, draw corner to corner, press both side buttons,
   click into another window mid-run. The report says: packet rate, whether the cursor follows the pen, the inferred
   frame, which button words appeared, proximity bit counts, which windows were in front while packets flowed.
3. `capture.cmd --seconds 30 --system --rect 1280,0,640,1200` - does the cursor now stay in the right strip (`cx` range in the trace)?
4. If (3) holds, the Tablet-sheet pane can ask the driver for exactly its own rectangle (physical pixels from main, as `Area` does) and
   no overlay, hook or full screen is needed; if not, DATA-context samples (this module) drive the sheet and the OS cursor is left alone... but
   then the driver still moves the cursor over the whole screen, so pair it with the overlay or the Windows Ink / containment results.

## Honest status

Built and unit-tested (54 tests, synthetic buffers); the Win32/Wintab calls verified live on the cached description
(no tablet, no pen); the Electron message route verified with a real `WT_CTXOPEN` and a synthetic `WT_PROXIMITY`;
the hard-kill recovery verified. **No real packet has ever been decoded**, and the decoder's offsets for `PK_ORIENTATION` (3 ints) and
the 4-byte packing are from knowledge of `wintab.h`, not from a file or a trace.
