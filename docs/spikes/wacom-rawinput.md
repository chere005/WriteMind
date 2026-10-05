# Spike: the Wacom pen over Raw Input + HID (`RegisterRawInputDevices`, `WM_INPUT`, hid.dll)

Lane: Wacom. Written 2026-10-03 by `wspike-rawinput`. Code and scratch live OUTSIDE the repo in
`C:\CLAUDIO\spikes\rawinput-spike\` (module, 26 vitest, live probes) and `C:\CLAUDIO\spikes\wspike-rawinput\`
(first probes). Nothing in `apps\` or `packages\` was changed.

## Verdict

*Re-checked 2026-10-04 11:53 (second pass of the lane): all five Wacom PnP nodes `OK`, 37 spike vitest pass, no test instance
running, `GetClipCursor` = whole screen, no registration left. Nothing new could be learned without a moving pen. The repo's
`npm test` / `typecheck` currently fail only in other agents' in-flight pen files (`pen/lease.ts`, `lease.test.ts`, `env.test.ts`,
`penManager.test.ts`, `ocr.test.ts`), not in anything of this spike. The repo stubs `pen/rawinputBackend.ts` / `pen/hid/*` belong to the
design's IMPL-A and are the place this spike's modules land.*

**UPDATE 21:25: the tablet is back (PnP `OK`, Code 10 gone) and the REAL Wacom descriptors are now read; see "Real Wacom caps".**
The pen collections are standard digitizer pens whose X/Y are **tablet-normalised (logical 0..32767 over the 15200 x 9500 active
area), not screen pixels**; they ARE listed by `GetRawInputDeviceList`, registration with `RIDEV_INPUTSINK` succeeds, and the
Wacom vendor collection delivered real `WM_INPUT` with the app unfocused. What is still UNVERIFIED is the one thing that needs a
moving pen: whether Col03/Col04 (pen / digitizer) actually stream while the driver is in Pen mode + Windows Ink (nobody was at
the machine; only an idle vendor heartbeat arrived). One command settles it (`tools\live.ps1`, ~40 s, nothing hooked or
grabbed).

Before that, the whole delivery path was built and proven with real `WM_INPUT` messages from Windows' own pen source (below).

What is proven (real OS, real Electron 44.4.3, no pen movement needed):

1. **Caps + layout from Windows' own parser.** `GetRawInputDeviceInfo(RIDI_PREPARSEDDATA)` + `HidP_GetCaps / GetValueCaps /
   GetButtonCaps / GetLinkCollectionNodes`, then a one-time **layout probe** (write each field's logical min and max into a
   fresh report with `HidP_SetUsageValue`, diff the bytes; `HidP_SetUsages` per button) gives every field's absolute bit
   offset. The pure TS decoder then needs no FFI per report. Cross-checked against `HidP_GetUsageValue` / `HidP_GetUsages` and
   `HidP_SetUsageValue` byte-for-byte on 300 random reports per device across all 13 HID raw devices on this PC
   (`live/roundtrip.ts`); the one failure is a vendor collection (VID_258A Col04) whose buttons are array-style fields, and
   array fields are reported as probe notes and not decoded (irrelevant to a pen: its switches are bit flags).
2. **Delivery.** `RegisterRawInputDevices` with `RIDEV_INPUTSINK | RIDEV_DEVNOTIFY` to a hidden window; `WM_INPUT` arrives
   with the app NOT focused, via **both** mechanisms inside Electron: `BrowserWindow.hookWindowMessage` on a `show:false` window
   and a koffi message-only window (`CreateWindowExW(HWND_MESSAGE)` + koffi `WNDPROC`). A self-`PostMessage` (with
   wParam/lParam), a `SendMessage`, and real injected mouse `WM_INPUT` (`SendInput`) all arrived on both, plain node (with a
   `PeekMessage` pump) also works. **Recommendation: the koffi message-only window** (no extra renderer process, independent of
   any BrowserWindow's lifetime, same code in node tests).
3. **A real HID-pen `WM_INPUT` stream decoded end to end.** Windows publishes pen pointer input as Raw Input from a virtual HID
   device `\\?\Microsoft HID RID\000D_0002\<n>` (usage `0x0D/0x02`; one standing instance `\1`, and a fresh one per pen
   device, announced by `WM_INPUT_DEVICE_CHANGE` / `GIDC_ARRIVAL`, e.g. `\17`). Injecting a *synthetic* pen
   (`CreateSyntheticPointerDevice(PT_PEN)` + `InjectSyntheticPointerInput`, hover only) produced one `RAWHID` report per
   injection that went through probe -> decode -> `PenSample`, 1437 of 1500 injected in 120 ms received, handler cost
   avg 22 microseconds, max 0.94 ms. **Its X/Y are SCREEN PIXELS** (descriptor says 0..32000; an injected x=1500 arrives as 1500),
   i.e. screen-mapped, not tablet-native: usable for pen-vs-mouse, in-range, pressure, tilt, switches, hover, never for the
   tablet mapping. The module marks it `backend: "rawinput-synth"` and normalises over the screen size.
4. **`RIDEV_NOLEGACY` is not an option for the pen.** Measured (`live/nolegacy.ts`, `live/regvariants.ts`): see the table. It
   cannot be registered for usage `0x0D/0x02` at all (error 87). It is accepted for the *mouse* usage, but then the cursor
   still follows both `SendInput` and an injected pen, so it would not stop the pen moving the cursor either.
5. **Cleanup paths.** `stop()` is idempotent; `RIDEV_REMOVE` verified with `GetRegisteredRawInputDevices`; a child that
   registered and was `SIGKILL`ed (no `finally`, no exit handler) left nothing behind: the parent registered the same usages
   immediately and kept receiving real `WM_INPUT`. No hook, clip, context or injected input is involved in the delivery path.

## The tablet was down at the USB level (HISTORY, fixed by 21:25; it explains the first half of the work)

Confirmed independently of `wacom-webhid.md`: `USB\VID_056A&PID_037A\2DA00L1059230` ("Wacom Tablet", One by Wacom S, CTL-472) is
present in `CM_PROB_FAILED_START` (Code 10), `ProblemStatus` 3221225653 = `0xC00000B5` `STATUS_IO_TIMEOUT`, `LastArrivalDate`
15:28:49 today (boot 15:28:39), function driver `WacHidRouterPro` 4.0.0.4 (installed 13:05; the service is *Stopped*, exit
1077 = "no attempt since boot"). Every `COL01..04` / `MI_xx` node is a ghost (`Present = False`; they started once at 13:05:21).
**Raw Input therefore lists NO device with VID 056A** (`GetRawInputDeviceList` returns 20 devices, none Wacom, one `Microsoft
HID RID` pen). I cannot restart it (no elevation, and device resets are system changes). **Needs Sean's hands: unplug and
re-plug the tablet, or reboot.**

Timeline note: the `grab.log` failure ("hook installed, no pen transition") was logged 15:23-15:26 local (log times are UTC),
BEFORE the 15:28 reboot, so the tablet was working then; that finding stands.

## What the hook failure probably means (inference, not proof)

`penHook.ts`'s `WH_MOUSE_LL` classifier **does** classify Windows' synthetic pen as `pen` (hover over 10 injected moves: `pen` x10;
a `SendInput` mouse: `mouse` x2, `live/hook-vs-synth.ts`, hook installed < 1 s and removed in `finally`). So the signature
mechanism works for pens that arrive through the pointer stack. Sean's real pen did not trigger it, which fits the PnP log: the
Wacom's cursor movement is probably arriving as plain mouse input from its **pointer collection** (`COL01`, `mouhid` +
`wacomrouterfilter` upper filter), not as pointer-stack pen input. If so, a Raw Input `RAWMOUSE` event for that node carries the
device handle, from which `RIDI_DEVICENAME` contains `VID_056A`: **pen-vs-mouse by device node, no signature needed**. That is
built (`onMouseSource` -> `{wacom, absolute, device, name}`, verified only with injected input: relative, not Wacom) and would also
replace the Grab overlay's pen/mouse switching hook. UNVERIFIED on the Wacom.

## Real Wacom caps (read 2026-10-03 21:25, tablet back; fixture `test/fixtures/wacom-ctl472.json`)

Raw Input now lists `Col03` (usage 0x0D/0x02 pen), `Col04` (0x0D/0x01 digitizer), `Col02` (vendor 0xFF00/0x0A), plus Windows' own
`Microsoft HID RID\000D_0002\1`; and `Col01` (Wacom Pointer) is a Raw Input *mouse* device whose name contains `VID_056A`, so
`isWacomName()` works on the real name (its events are unverified without a pen).

**Pen collection Col03** (input report 38 bytes, feature 2 bytes; link collections Pen -> Stylus), a single input report **ID 209
(0xD1)**; offsets are in bits from the report start (ID byte included):

| Field | Page:Usage | Offset | Bits | Logical | Physical |
|---|---|---|---|---|---|
| Tip Switch, Barrel, Invert, Eraser, Secondary Barrel, In Range | 0D:42, 44, 3C, 45, 5A, 32 | 8, 9, 10, 11, 12, 13 | 1 each | | |
| X (has null state) | 01:30 | 16 | 16 | **0..32767** | 0..15200 (0.01 mm) |
| Y (has null state) | 01:31 | 32 | 16 | **0..32767** | 0..9500 |
| Z (hover distance?) | 01:32 | 48 | 16 | 0..1024 | 0..1000 |
| Tip Pressure | 0D:30 | 64 | 16 | **0..2047** | |
| Serial numbers | FF00:5B, 0D:5B, FF00:77 | 80, 112, 176 | 32, 64, 32 | | |
| 0D:31 | | 208 | 16 | 0..1024 | |
| X Tilt, Y Tilt, Twist (0D:3D, 3E, 40) | | 224, 240, 256 | 16 signed | **-9000..9000** (0.01 deg) | |
| 0D:3F, 0D:41 | | 272, 288 | 16 | 0..36000 | |

`Col04` has the same fields under **report ID 213 (0xD5)**. The same pen is exposed twice, so the module keeps ONE collection per
VID:PID (`PrimaryPicker`: the first to speak owns the stream until it is silent for 250 ms); samples never duplicate or interleave.
**Col02 (vendor 0xFF00)** is an 11-byte report ID 220 (0xDC): X 0..**15200** and Y 0..**9500** (raw counts), pressure, a 3-byte
vendor array. With the pen away it sent `dc c0 00 .. 01` (x=192, y=0, no pressure) twice in 10 s: an idle heartbeat. It is only
traced by default (`allowVendorPage` to decode it), otherwise it would inject bogus (0.013, 0) positions.

What this settles: (1) the numbers are normalised to the *tablet*, the screen mapping is not baked in; (2) pressure is 11 bit (2048
levels, not the 12 bit I guessed); (3) tilt is hundredths of a degree (the mapper rescales to degrees); (4) the report is 38 bytes,
not the 10 of the vitest synthetic, so `decodeReport` is now tested on the real shape (`test/wacom.test.ts`, 11 tests: reports built
by `encodeReport` from the real layout, corners, pressure, both barrels, invert, tilt, hover, null state, sibling collections).
Which of Barrel 0D:44 / Secondary 0D:5A is the physically lower switch is still unknown (`swapBarrels` flips it).

## Raw Input device list on this machine (read-only enumeration, first run, tablet down)

12 type-2 (HID) devices (vendor/consumer collections of a keyboard, a mouse, a gamepad, a headset...) plus one
`\\?\Microsoft HID RID\000D_0002\1`. The usable pen caps below are that one; they are the only pen caps that exist here.

`\\?\Microsoft HID RID\000D_0002\1` (HIDP_CAPS: usage page 0x0D, usage 0x02, input report 16 bytes, no output/feature,
link collections 2: Pen application collection -> Stylus 0x20). Report ID 1:

| Field | Page:Usage | Bit offset (incl. ID byte) | Bits | Logical min..max | Physical |
|---|---|---|---|---|---|
| X | 01:30 | 8 | 16 | 0..32000 | 0..300 (units 0x11, exp -2) |
| Y | 01:31 | 24 | 16 | 0..32000 | 0..300 |
| Tip Switch | 0D:42 | 40 | 1 | | |
| In Range | 0D:32 | 41 | 1 | | |
| Tip Pressure | 0D:30 | 42 | 16 | 0..1024 | |
| Barrel Switch | 0D:44 | 58 | 1 | | |
| Invert | 0D:3C | 59 | 1 | | |
| Eraser | 0D:45 | 60 | 1 | | |
| X Tilt | 0D:3D | 61 | 8 signed | -90..90 | |
| Y Tilt | 0D:3E | 69 | 8 signed | -90..90 | |
| Twist | 0D:41 | 77 | 16 | 0..360 | |
| Scan Time | 0D:56 | 93 | 32 | 0..65535 | |

Fixture: `C:\CLAUDIO\spikes\rawinput-spike\test\fixtures\ms-synth-pen.json` (real caps + probed layout). There is **no** second
barrel switch (`0D:5A`) in it. The Wacom's own pen collection is expected (from the PnP names and
`HID_DEVICE_UP:000D_U:0002`) to be a standard digitizer pen on the same pages, but its report ID, field order, 16-bit counts
(a CTL-472 should be 15200 x 9500 counts at 2540 lpi, ~4095 pressure levels: recollection of the Linux driver table, NOT
verified), second barrel switch and tilt are unknown until it starts. The vitest "tablet" layout is a clearly labelled
synthetic of exactly that shape.

## `RegisterRawInputDevices` variants (live; each removed straight after)

| Registration | Result |
|---|---|
| pen `0D/02` `INPUTSINK \| DEVNOTIFY` | ok (this is what the module uses, plus `0D/01` digitizer) |
| digitizer `0D/01` `INPUTSINK \| DEVNOTIFY` | ok |
| page-only `0D` (`RIDEV_PAGEONLY`) | ok |
| pen `0D/02` `EXINPUTSINK` | ok |
| pen `0D/02` **`NOLEGACY`** / `NOLEGACY \| INPUTSINK` | **FAIL, error 87** (`ERROR_INVALID_PARAMETER`): the flag is for mouse/keyboard only |
| pen `0D/02` `INPUTSINK` without `hwndTarget` | FAIL 87 (a sink needs a window) |
| pen `0D/02` `APPKEYS` | FAIL 1004 (keyboard-only flag) |
| mouse `01/02` `NOLEGACY \| INPUTSINK` (short window, removed in `finally`) | ok, **but the cursor still moves** for `SendInput` (300 -> 386) and for the injected pen (followed it to its end point), and afterwards the mouse is normal (`SendInput` moved 300 -> 386 again; `GetClipCursor` = whole screen; no stray processes). Effect on `WM_MOUSEMOVE` / clicks to other windows was not observable from a message-only window and is documented behaviour I did not test. |

**Risk written down:** `NOLEGACY` on the mouse usage is system-wide (it stops legacy mouse messages for every window, for as
long as the registering process lives). It cannot do what the lane needs and it can lock out Sean's mouse clicks if a crash
leaves the process alive and hung. Do not use it. The pen cannot be detached from the cursor through Raw Input; Raw Input only
OBSERVES. The containment spike (`wacom-containment.md`) is the place for "stop the pen moving the cursor".

## Things measured on the way (useful for the integration)

* `WM_INPUT_DEVICE_CHANGE` with `RIDEV_DEVNOTIFY` fires `GIDC_ARRIVAL` at registration for devices already present, and for new
  ones (the `\17` pen). Hot-plug of the real tablet is therefore handled by `resolve()` on first sight.
* One `WM_INPUT` per report in all measurements; the parser still handles `dwCount > 1` (unit-tested, including a lying
  `dwCount`).
* Pen-promoted *mouse* raw events (injected pen) are `RAWMOUSE` with `MOUSE_MOVE_ABSOLUTE | VIRTUAL_DESK | NOCOALESCE` (0x43),
  `lastX/lastY` in screen pixels, `ulExtraInformation` 0x2A; `SendInput` mouse events are relative (flags 0). Device handle 0 for
  injected input.
* Contact (pressure > 0) with the synthetic pen was **not** exercised: a full-screen window of another application (the Claude
  desktop app, pid 12764, z-band above anything this process can raise) covers the whole screen, so `WindowFromPoint` never
  returned the test window and the harness refused to inject a pen-down onto someone else's window. Hover only.
* `hookWindowMessage` needs no pumping and survives `show:false`; with default Chromium throttling it would still run (it is
  driven by the OS message loop, not timers). Batching (<= 8 ms) uses `setTimeout(...).unref()` in the main process, which is
  not throttled.

## Not verified (needs a moving pen)

1. DONE: all of Col01 (mouse), Col02, Col03, Col04 are listed by `GetRawInputDeviceList` and registration succeeds.
2. **THE open question:** that `WM_INPUT` arrives for Col03 / Col04 while the driver is in Windows Ink / Pen mode. X/Y are
   tablet-normalised (32767 = the whole active area), so if they stream, the data contract is met. If only the vendor Col02
   streams, record with `--vendor` and run with `allowVendorPage` (raw counts, 15200 x 9500). If nothing streams, the Wacom
   service holds the devices exclusively and Wintab / WebHID (other spikes) are the fallback.
3. Which of Barrel (`0D:44`) / Secondary Barrel (`0D:5A`) is the physically *lower* switch (`swapBarrels` flips it).
4. Whether the Wacom pointer node shows up in `onMouseSource` as `wacom: true, absolute: true`.
5. Real pressure/tilt/contact decoding on real reports (the decoder is proven on the OS's own parser and on Windows' synthesized
   device, not on a Wacom report).
6. Orientation: for a portrait-native pad `rotate: "auto"` turns it a quarter clockwise; the CTL-472 is landscape-native so this
   is not expected to matter.

## When the tablet is back (one command)

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\CLAUDIO\spikes\rawinput-spike\tools\live.ps1 -Seconds 25
```
(or double-click `C:\CLAUDIO\spikes\rawinput-spike\RECORD-PEN.cmd` for just the recording). It prints the PnP state, lists
every digitizer / Wacom Raw Input device with caps and probed layout (`dist\devices.json`), then records pen reports for the
digitizer page and vendor page `0xFF00` (INPUTSINK, so it works while another window is focused) to `dist\live-trace.jsonl` and
prints a per-device summary: report count and Hz, X/Y/pressure ranges, in-range / tip transitions, barrel counts. Only devices on
the digitizer page or with VID 056A are written to the trace. Move the pen corner to corner, press hard, hold each side switch.
`replayTrace()` rebuilds `PenSample`s from any such trace with no hardware.

## Integration plan (when the answer is yes)

* Move `hidLayout.ts`, `rawParse.ts`, `penSample.ts`, `trace.ts` (pure) and `hidNative.ts`, `rawNative.ts`, `penRawInput.ts` (FFI)
  to `apps/desktop/src/main/pen/`, alongside the vitest files (the pure ones need no mocking; the native ones are
  `skipIf(!win32)` and only move the cursor by 3-6 px and restore it).
* `main.ts` wiring: `new PenRawInput({ source: koffiMessageSource(), emit: batch => win.webContents.send("pen:samples", batch) })`
  started when the Tablet source shows (or Grab starts), `stop()` on hide / `before-quit` / `window-all-closed` /
  `uncaughtException`. `PenSample` is exactly the agreed contract (+ `backend`).
* The koffi load follows `penHook.ts` (`createRequire(import.meta.url)("koffi")`, optional dependency, `{ok:false,error}` when
  it will not load). Struct offsets are x64 only (`nativeAvailable()` says why not).
* Prefer the tablet's native device over the synthesized one when both talk (already in `PenRawInput`: the synthesized pen is
  muted for 500 ms after a native report).

## Files (all under `C:\CLAUDIO\spikes\rawinput-spike\`)

| File | Role |
|---|---|
| `src/hidLayout.ts` | pure: layout types, `decodeReport`, `encodeReport`, bit helpers |
| `src/hidNative.ts` | koffi: device list, preparsed data, caps, `probeLayout`, `decodeWithHidP` / `encodeWithHidP` (OS-parser cross-check) |
| `src/rawParse.ts` | pure: `RAWINPUT` parsing (HID with `dwCount` reports, mouse), builders for tests |
| `src/rawNative.ts` | koffi: `RegisterRawInputDevices`, `GetRawInputData`, message-only window, `GetRegisteredRawInputDevices` |
| `src/penSample.ts` | pure: `PenSample`, report -> sample mapper (y down, landscape, tilt, barrels), 8 ms batcher, range watchdog |
| `src/penRawInput.ts` | the session: message sources (koffi window / `hookWindowMessage`), device tracking, trace sink, `onMouseSource` |
| `src/trace.ts` | pure: trace parse / replay / summarise |
| `test/decoder.test.ts`, `test/native.test.ts`, `test/wacom.test.ts` | 37 vitest (11 on the real Wacom layout) (`node node_modules\vitest\vitest.mjs run --root .` from the spike dir) |
| `live/*.ts` + `run.mjs` / `run-electron.mjs` | probes: `probe-caps`, `roundtrip`, `delivery-node`, `delivery-electron`, `inject-pen-node`, `burst`, `nolegacy`, `regvariants`, `crash-*`, `hook-vs-synth`, `record`, `list-devices` |
