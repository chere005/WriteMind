> **SUPERSEDED (2026-10-04, wr-demolish):** the overlay, sink, guard, clip, containment, Raw Input, WebHID, check wizard and trace UI described here were deleted; only the Wintab data backend and the window pen remain (docs/PARITY.md "Pen demolition"). Kept as history and as evidence of what the hardware does.

# Spike: the Wacom pen over WebHID (`navigator.hid`)

Lane: Wacom. Written 2026-10-03 by `wspike-webhid`, updated the same evening once the tablet enumerated again. Code and
scratch live OUTSIDE the repo in `C:\CLAUDIO\spikes\webhid-spike\` (nothing in `apps\` or `packages\` was changed).

## Verdict

**WebHID works as a transport on this machine, with the Wacom driver running, and needs no native module.** Measured on
the real tablet (Electron 44.4.3 / Chromium 152):

- the tablet is listed (`getDevices()` and `requestDevice({filters:[{vendorId:0x056A}]})`) once three session hooks are
  set, with no prompt;
- `device.open()` **succeeds** while `WTabletServicePro` and `WacHidRouterPro` 4.0.0.4 are running, Windows Ink on;
- the `inputreport` listener **receives real reports** from the open handle: a vendor report (id 220) every 5.05 s,
  byte-identical, which is the device's idle heartbeat. They arrive in a normal window, a `show:false` window, an
  offscreen window with `backgroundThrottling:false`, and an offscreen window with Chromium's *default* throttling
  (`visibilityState: hidden`), never focused. So background delivery is not the problem.

**What is NOT proven, because nobody could move the pen:** that the standard pen report (id 213) streams position
while the pen is in use, and what it contains in practice. The decoder for 213 is built from the real descriptor and
tested with synthetic reports only. One run with a moving pen settles it (command at the end). If 213 stays silent while
the vendor report 220 carries the pen, 220 is Wacom-proprietary and has to be reverse-engineered from a trace; the
recorder and analyser produce the byte table for that.

So: viable and the lowest-risk backend on paper; unconfirmed on stroke data. It should not be treated as delivered
until a pen trace has been recorded and looked at.

## What the real device looks like through WebHID

Saved verbatim in `C:\CLAUDIO\spikes\webhid-spike\test\fixtures\wacom-ctl472-real.json`.

**One `HIDDevice`** (not four): VID 0x056A, PID 0x037A, `productName` "CTL-472" (One by Wacom S), `opened:false`
until opened, with three top-level collections. (Windows lists the `HID\...&COL01..04` nodes separately; Chromium shows
the router's merged view, and there is no `0xd:0x2` Pen collection in it.)

| Collection | Input reports |
|---|---|
| `0x1:0x1` Generic Desktop Pointer | none |
| `0xff00:0xa` vendor | **220** (10 bytes): X 16 bit 0..15200, Y 16 bit 0..9500, Tip Pressure 16 bit 0..2047, then 4 vendor bytes. Not marked In Range or Tip Switch. Only the 5 s heartbeat `c0 00 00 00 00 00 00 00 00 01` was seen (X would decode to 192: it is a status record, not a position). |
| `0xd:0x1` Digitizer | **213** (37 bytes): Tip Switch@0, Barrel@1, Invert@2, Eraser@3, Secondary Barrel@4, In Range@5, 2 pad, X@8 (16 bit, 0..32767, Null state), Y@24 (same), Z/distance@40, Tip Pressure@56 (16 bit, 0..2047), 32/64/32-bit vendor and serial fields, Barrel Pressure@200, X Tilt@216, Y Tilt@232 (16 bit, -9000..9000, unit english-rotation x10^-2 = hundredths of a degree = +-90 deg), Altitude, Azimuth, Twist. |

Notes that matter for the decoder:

- X and Y both have logical range 0..32767 but physical 15200 x 9500: orientation must come from the physical size.
  `portraitNative` now does; the tablet is landscape-native, so no rotation is needed.
- Two reports carry X/Y and Tip Pressure. Decoding both would merge two different coordinate scales and let the
  heartbeat produce a "pen at the left edge, in range" sample. The decoder picks one **primary** report (best score:
  Tip Switch, In Range, pressure, barrel, tilt) = 213, and ignores the rival position report by default
  (`reportIds: "all"` or an explicit list overrides).
- X and Y have `hasNull`; a value outside 0..32767 keeps the last position instead of jumping.
- The item has `unitSystem`/`unitExponent`: tilt is converted to degrees with it (`tiltX`/`tiltY` in `PenSample` are
  degrees).
- The pen has "Invert/Eraser" fields; Sean's pen has no eraser end, so `eraser` should stay false.
- `lower` = Barrel Switch (0xd:0x44), `upper` = Secondary Barrel Switch (0xd:0x5a): an assumption until a trace
  shows which physical button sets which.

## What was measured (all on the probe app: its own profile, offscreen, driven over CDP)

| Question | Result |
|---|---|
| `navigator.hid` in an Electron renderer on `file://`? | Present, secure context. Methods `getDevices requestDevice onconnect ondisconnect addEventListener when`. |
| Permission plumbing (all in main) | `ses.setDevicePermissionHandler(d => d.deviceType==='hid' && d.device.vendorId===0x056A)` (makes `getDevices()` list it, nothing persisted), `ses.setPermissionCheckHandler((_,p) => p==='hid')`, and `ses.on('select-hid-device', (e,d,cb) => {e.preventDefault(); cb(pick?.deviceId ?? '')})` for `requestDevice`. The app's existing camera-only `setPermissionRequestHandler` does not interfere. |
| `getDevices()` with Wacom-only permission | The CTL-472, 1 device. `requestDevice` (needs a user gesture, sent over CDP with `userGesture:true`) returns the same one. |
| `device.collections` | `usagePage, usage, type, children, inputReports[]` (+ output/feature); item fields `isConstant isArray isRange hasNull isAbsolute isLinear isVolatile logicalMinimum/Maximum physicalMinimum/Maximum reportSize reportCount unitSystem unitExponent unitFactor*Exponent usages usageMinimum/Maximum`. There is **no `usagePage` on an item**: `usages[]` is `page<<16 | usage` (checked on the real data: 65584 = 0x10030 X). Padding is explicit (`isConstant:true,isArray:true`). `describeCollections` copies every attribute generically (they are prototype getters). |
| Windows quirk | An unsigned 16-bit field with Logical Maximum 0xFFFF arrives as -1 (seen on a gamepad). `fixRange` handles it. Not hit by the Wacom (32767 / 2047). |
| `device.open()` | **Succeeds on the Wacom with the driver running** (5 runs). Also succeeded earlier on a gamepad, a mouse, a keyboard and a consumer-control collection, i.e. Windows grants a shared open and Chromium does not refuse when the host has granted the device. Not blocked by the WebHID blocklist. |
| Reports while the driver runs | The listener got the 5.05 s heartbeat (3 per 14 s run) in every window variant (4 configurations). Each handle has its own queue, so it does not steal from the driver. |
| Window variants (heartbeat delivered?) | show/offscreen, throttling off: yes. `show:false`: yes. `show:false` + default throttling: yes. Offscreen + default throttling (`visibilityState:"hidden"`): yes. Recorded in `out\variants\`. |
| Timers (batching, "pen left") | `setInterval(8)` over 14 s: with `backgroundThrottling:false` 1750/1750 ticks, p50 8 ms, max 9.5 ms; with Chromium's default in an offscreen window 22 ticks, p50 987 ms. So the host window needs `backgroundThrottling:false` (the main app window currently has the Electron default); `show:false` windows are not throttled either way. Cleanest: a hidden helper window that owns WebHID and posts batches to main. |
| Interference with the driver / OS cursor | Not observed: the tablet stayed `Status OK` with the service running, `GetClipCursor` is the full screen afterwards, the open handle sends no output or feature report. Cursor behaviour *during pen use* could not be checked (no pen). |
| Listener | `addEventListener('inputreport')` attaches; real reports arrived. `HIDInputReportEvent` has an illegal constructor, so synthetic tests use a plain `Event` with `reportId/data/timeStamp`. |

Earlier today (15:28 to about 16:40, and again until the evening) the tablet was in `CM_PROB_FAILED_START` (Code 10,
`STATUS_IO_TIMEOUT`) with every HID child a ghost, so no WebHID measurement on it was possible; it enumerates and
works now, which is when the numbers above were taken.

## Re-run 2026-10-04 (a second pass, still no pen movement)

Tablet still `Status OK` (COL01..COL04 present, Wacom services running). `tools\live.ps1 -Seconds 12` (now on port 9424) listed
the CTL-472; `requestDevice` and `open()` succeeded; 2 reports in 12 s, both the vendor heartbeat (id 220, `c0 00 .. 01`), 5.05 s
apart: identical to the evening result. New variant: the host window on a **private session partition** (`pen-hid`), `show:false`,
with the three hooks installed on that session only (`tools\variant.ps1 -HiddenWindow -Partition pen-hid`, result in
`out\variants\partition-hidden.json`): `getDevices` lists the tablet, `requestDevice` is auto-picked, `open()` succeeds, 3 heartbeats
in 13 s reach the listener. So the design's dedicated helper window and session need nothing the default session did not have.
The 46 vitest and `tsc` of the spike are green. Probe stopped afterwards, `GetClipCursor` = full screen (0,0,1920,1200).
Still no stroke on report 213 (no pen could be moved).

## Not verified (needs a pen in use)

1. That report 213 streams X/Y/pressure/buttons while the pen moves in Windows Ink / Pen mode (the heartbeat shows the
   handle is live, not that 213 is). If 213 is silent and 220 carries the pen: reverse-engineer 220 from the trace byte table
   (the leading `0xc0` looks like a status/prox marker).
2. The real value ranges in use (does X reach 32767 at the right edge? does the active area equal the whole tablet?).
3. Which side button sets Barrel vs Secondary Barrel; whether `Invert` ever fires with Sean's pen.
4. Rate and latency (`gapMs`), and any dropped reports under the driver.
5. Reports with the notes window unfocused *and a pen moving*: the delivery mechanism is shown, the pen data is not.
6. Whether the driver's own pointer/cursor behaviour changes while a WebHID handle is open and the pen is used
   (by construction no).

## The one command to settle it

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\CLAUDIO\spikes\webhid-spike\tools\live.ps1 -Seconds 25
```

(starts the probe on port 9424 with only VID 0x056A permitted, exactly what the app would do; lists the device and
collections; `requestDevice`; `open()`; records raw reports to `out\wacom-trace.jsonl` while the pen hovers, draws and
presses each side button; decodes with the same `PenDecoder`; writes `out\wacom-samples.jsonl` and `out\live.json`;
**always stops the probe**). `live.json -> analysis[]` carries the judgement: per-report-id counts, report rate and gaps, x/y
reach, pressure max, buttons, in-range transitions, tilt, `rawBytes` (per byte min/max/distinct of any report the decoder
does not read), and plain-words `warnings`. `tools\variant.ps1` runs the same under a hidden/throttled window.

## The code (`C:\CLAUDIO\spikes\webhid-spike\`)

| File | What |
|---|---|
| `src\hidPen.ts` | Pure, no DOM. `compileLayout` (per-report bit layouts, ranges, repeated usages, padding, children, the -1 maximum, primary report, orientation from physical size), `readBits`, `decodeFields` (Null-state aware), `PenDecoder` (merges across reports, normalises to the `PenSample` contract: x,y 0..1 over each field's own logical range, y down; pressure 0..1; tip from Tip Switch else pressure; `inRange`; tilt in degrees via the unit; options `rotate`, `flipY`, `reportIds`), `penScore`, `describeCollections`. |
| `src\webhidPen.ts` | `WebHidPenSource`: lists/permits by vendor, opens pen-like devices, listens, batches to <=8 ms, silence -> out of range for devices without In Range, hot-plug, `stop()` closes and flushes, `onRaw` for recording, trace header/line. Everything environmental is injectable. |
| `src\trace.ts`, `tools\analyse-trace.mjs` | trace -> `PenSample`s and the summary above. |
| `electron\*`, `tools\*.ps1 / *.mjs` | the probe host (the three session hooks), live/variant runners, the measurements. |
| `test\*.test.ts`, `test\fixtures\*` | **46 vitest**: bit reading, layout, model pens, the real gamepad fixture, the **real CTL-472 descriptor** (primary report 213, field offsets, synthetic reports for stroke / hover / out of range / Null state / both buttons / tilt degrees / rotation, the heartbeat ignored, the source batching and closing, the real 3-report trace analysed). Run: `cd C:\CLAUDIO\spikes\webhid-spike; node node_modules\vitest\vitest.mjs run`; `tsc -p tsconfig.json` is clean. |

To adopt: copy `src\hidPen.ts` + `webhidPen.ts` (+ tests/fixtures) into the repo (plain TS, no dependencies), host
`WebHidPenSource` in a hidden helper `BrowserWindow` (`show:false`, `backgroundThrottling:false`, the three session hooks
scoped to VID 0x056A), `ipcRenderer.send` the batches, and let main re-emit the `PenSample[]` on the pen channel with
`backend:"webhid"`. Not done: nothing in the app was wired, by design (spike).

## Honesty line

Verified on the real tablet: enumeration, permission hooks, collection metadata (descriptor above), `open()` with the
driver running, live report delivery to the listener (heartbeat) in four window configurations, no leftover state.
Verified with synthetic data only: every position/pressure/button/tilt decode and normalisation number (built from the
real descriptor, not from real strokes). Not verified: any real pen stroke. Side effect of the probing: the Wacom
(and earlier a gamepad, a mouse, a keyboard) HID handles were opened and closed with no output or feature reports sent.
