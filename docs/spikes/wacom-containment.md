# Spike: cursor containment and stray clicks (Wacom lane)

Written 2026-10-03 by `wspike-contain`. Code and scratch live OUTSIDE the repo; nothing in `apps\` or `packages\`
was changed. Windows 10 19045, one 1920x1200 display at 100 %, taskbar 30 px, not elevated, no UIAccess.

* `C:\CLAUDIO\spikes\wspike-contain\lab.cs` / `lab.exe` (C# 5, `csc` from .NET 4; every experiment below, raw output
  in `exp1-ptr0.txt exp1-ptr1-pen.txt exp3-ptr0.txt exp3-ptr1.txt exp4.txt`), `probe.cmd` + `analyze-probe.mjs`
  (for Sean, below), `probe-selftest.ps1`.
* `C:\CLAUDIO\spikes\contain-spike\` the draft module: `clip.ts` (policy + guard backend + sweep), `guard.mjs` (the
  separate process that owns the clip), `clip.test.ts` (38 vitest tests), `guard-proof.mjs` (real processes, real
  clip: kill / hang / starve / both-die), `free-cursor.ps1` (panic button), `fake-parent.mjs`, `electron-guard-check.mjs`.

## Verdict (read this)

1. **`ClipCursor` does not contain a Windows-Ink pen.** It clamps everything that moves the *mouse* cursor
   (`SendInput`, `mouse_event`, `SetCursorPos`, relative moves, even input carrying the pen signature) to the
   rectangle, but a synthetic **pen** (`InjectSyntheticPointerInput`, the same pointer stack a Wacom pen in Pen mode +
   Windows Ink uses) is not clamped at all: `WM_POINTERUPDATE` arrives at the unclamped position and, when the
   window lets the pen drive the cursor, the OS cursor goes outside the clip too. So `ClipCursor` is **not** the
   fix for "a tap clicks the taskbar". It only helps a driver that sends *mouse* events (Wacom **Mouse mode**).
   Measured on a synthetic pen; unverified on the real one (it was in Code 10 on 2026-10-03; healthy on 2026-10-04 but nobody can move the pen) - `probe.cmd` settles it
   in 20 s the first time the tablet works.
2. **A `WH_MOUSE_LL` hook that swallows is useless against the pen and unsafe in general.** It can swallow pen-signed
   *mouse* events, but (a) the window under the pen still gets the pen as `WM_POINTER*` (measured: swallowing changes
   nothing for pointer messages), and (b) as soon as the window handles `WM_POINTER` (Chromium does) the pen sends
   **no mouse event at all and the hook never fires**. That reproduces Sean's `grab.log` (hook installed, no pen
   transition ever) and is the reason the hook never saw his pen. Do not build a swallowing hook.
3. **`RegisterPointerInputTarget(hwnd, PT_PEN)`, the only API that would make one window receive all pen input and
   keep it from other windows, is denied without UIAccess** (error 5; the `Ex` variant answers 50). UIAccess needs a
   signed binary installed in a secure folder. Not available to the Electron app as is.
4. **Pen presence is available without elevation:** `RegisterPointerDeviceNotifications(hwnd, TRUE)` succeeded and a
   hidden window received `WM_POINTERDEVICEINRANGE / CHANGE / OUTOFRANGE` for the pen (synthetic, but the same
   stack), independent of focus and of the screen mapping. That is the right "pen in range" signal for arming
   anything, replacing the signature hook (which cannot see a pointer-aware window's pen).
5. **A clip outlives its owner.** After `TerminateProcess` of the process that set it, and after a *normal* exit that
   did not call `ClipCursor(NULL)`, `GetClipCursor` from another process still shows the rectangle. Any other process
   can release it (`ClipCursor(NULL)`). So a crash while clipped traps the mouse: hence the guard design.
6. **Recommended recipe:** do not clip by default. Stray pen taps are handled by (i) the Grab overlay as the pen sink
   (exists), (ii) a visible dead band for the taskbar (below), (iii) the driver's own Tablet area / Wintab system
   mapping (other spikes). `clip.ts` is the opt-in for Mouse-mode tablets, with the guard making it crash-proof.

## Experiments

Method: a topmost, non-activating test window (1000x700 at 100,100) with a message loop, so we see what a window
*receives* (`WM_MOUSEMOVE` via `GetMessagePos`, `WM_POINTER*` via `GetPointerInfo`) next to `GetCursorPos`, and an
optional `WH_MOUSE_LL` hook on the same thread. Clip rect (500,300)-(900,600). Every run: `ClipCursor(NULL)` in
`finally` + `ProcessExit` + a 120 s dead-man timer; `GetClipCursor` checked after (always the full screen).
Real clicks only ever landed on the test window.

### (1) ClipCursor vs. how the cursor is moved

| Moved by | Target (200,200) / (1000,700) outside the clip | What the window received |
|---|---|---|
| `SendInput` absolute | cursor (500,300) / (899,599) - clamped; right/bottom are exclusive | `WM_MOUSEMOVE` at the clamped position |
| `mouse_event` absolute | same | same |
| `SetCursorPos` (returns TRUE) | same | same |
| `SendInput` relative +2000/+1500 | (899,599) | clamped |
| `SendInput` absolute with `dwExtraInfo` 0xFF515700 (pen stand-in) | clamped | clamped |
| **synthetic pen hover**, window passes `WM_POINTER` to `DefWindowProc` | cursor goes to (200,200) / (1000,700): **not clamped** | `WM_POINTERUPDATE` (200,200), source 8/2 (pen/injected); the LL hook sees a pen-signed move |
| synthetic pen hover, window **handles** `WM_POINTER` (returns 0, as Chromium) | cursor does not move at all | `WM_POINTERUPDATE` at the unclamped position; **the hook sees nothing** |
| synthetic pen contact drag (either window style) | cursor does not follow the contact | `WM_POINTERUPDATE` at the unclamped position |

Same numbers with the clip off, so the clip changes only the mouse-class rows. Take-away: a pen position and a
cursor position are different things on this stack; the clip governs the second. (Synthetic injection and a real HID
pen share the pointer stack; they differ in the device layer, which is why this is flagged unverified for the real pen.)

### (3) Swallowing hook (`hookMode=1`: return 1 for pen-signed events outside the sheet rect)

* Pen-signed (0xFF515700, and the touch variant 0xFF515780) `WM_MOUSEMOVE` outside the sheet: swallowed - cursor stays
  put, no message. Inside: passes. Pen-signed button down/up outside: swallowed (no `WM_LBUTTONDOWN`); inside: delivered.
* Unsigned events (a real mouse) are never touched: moves and clicks outside went through. (A hook that swallowed
  *everything* outside a rect would trap the real mouse and is not even worth demonstrating.)
* With the synthetic pen: the promoted move is swallowed when the window passes `WM_POINTER` on, **but the window still
  receives `WM_POINTERUPDATE/DOWN` at (200,200)**, i.e. explorer's taskbar would still see the tap. With a
  pointer-handling window the hook is never called for the pen.
* `GetCurrentInputMessageSource` inside the hook works (pen-promoted: 8/2; plain `SendInput`: 0/0).

### (4) Pointer APIs (`exp4.txt`)

| API | Result |
|---|---|
| `GetPointerDevices` + `GetPointerDeviceRects` | One device listed before the experiment, `\??\Microsoft HID RID\000D_0002\1`, INTEGRATED_PEN, deviceRect (0,0)-(50800,31750) himetric, displayRect = the screen. My synthetic device became `...\15`. The name pattern says `\1` is itself a synthetic device from another process; **no real Wacom was enumerated on 2026-10-03** (the USB device was in `CM_PROB_FAILED_START`; see the 2026-10-04 re-check below). Note for later: `GetPointerDeviceRects` gives the tablet-native range and its mapped screen rect, and `ptHimetricLocationRaw` in a `WM_POINTER` is in device units - a pen position in tablet coordinates with no Wintab, available from any window that receives the pen. |
| `RegisterPointerInputTarget(hwnd, PT_PEN)` | **false, error 5 (access denied)**, hidden or visible window, no UIAccess token (`TokenUIAccess=0`). |
| `RegisterPointerInputTargetEx(hwnd, PT_PEN, observe=false / true)` | false, error 50 (not supported) for both. |
| `RegisterPointerDeviceNotifications(hwnd, TRUE)` | **true**; the hidden window then received `PTRDEVCHANGE`, `PTRDEVINRANGE` and `PTRDEVOUTOFRANGE` around a synthetic pen stroke. |
| `GetCurrentInputMessageSource` in a window procedure | mouse `SendInput`: 2/2 (mouse/injected); pen: 8/2; `SetCursorPos`-driven: 0/4. |
| `EnableMouseInPointer` | not used: process-wide, turns *this* process's mouse into pointer messages, nothing global. |

UIAccess, for the record: the exe needs a manifest with `uiAccess="true"`, an Authenticode signature chaining to a
trusted root, and to run from `%ProgramFiles%` or `%WinDir%`. A small signed helper (not Electron) would hold the
registration and forward pen samples to the app. That needs a certificate Sean trusts - a decision for him, not
something to set up unattended (it changes the machine's trust store).

### (2) Persistence and the watchdog (real processes, real clip)

* `TerminateProcess` of the clipper: clip stays. Normal exit without release: clip stays. `ClipCursor(NULL)` from a
  different process: releases. (This is the whole basis of the guard.)
* **Gotcha found on the way:** libuv (so `child_process` in Electron/Node) puts children in a job object that kills
  them when the parent dies, with `TerminateProcess` and no cleanup. A non-`detached` guard therefore dies WITH the app
  and leaves the clip behind (reproduced: `WM_NODETACH=1 node guard-proof.mjs` fails P1). The guard must be spawned
  `detached: true`.

`node guard-proof.mjs` (Node 24, 0 failures, 3 consecutive runs, plus a 4th with a fresh process tree):

| Scenario | Result |
|---|---|
| P6 renewed by beats every 250 ms | still armed after 3 lease periods; `free` releases in 0 ms; marker file written/removed |
| P1 app killed (`TerminateProcess`) while armed | released **~14 ms** later (stdin EOF in the guard), guard exits |
| P2 app **hung** (event loop blocked) | released **807-851 ms** after arming (lease 800 ms); guard stays idle and can be re-armed |
| P3 app alive but not beating | released at the lease (833-850 ms), guard says `expired`, same guard arms again |
| P4 **guard** killed while armed, app alive (`createContainment` + `guardBackend`) | the app releases at once (**12-21 ms**) and reports `guard-lost` |
| P7 Esc (`disarm`) through the guard | released in 16 ms |
| P5 app AND guard killed (what Task Manager "End task" on a tree does) | **clip persists** (the one residual trap). The marker file names it; `sweepStaleClip` at next launch releases exactly that rect |
| P8 a foreign clip (no marker) | sweep leaves it; the guard refuses to arm over it and `quit` leaves it |

The guard also runs under `ELECTRON_RUN_AS_NODE=1 electron.exe guard.mjs` (checked with the repo's Electron), so the
app can start it from `process.execPath` with no extra binary. Unverified: the packaged app (asar/unpack of koffi and
`guard.mjs`; a launcher job that forbids breakaway would make `detached` fail - then containment must stay off, never
fall back to the in-process backend).

A native timer inside the same process cannot be the lease: the clip is OS state with no lease of its own, so a
frozen or dead process cannot give it back. The lease has to live in another process.

## Threat model and releases

| What can trap the mouse | Why | Release |
|---|---|---|
| App crashes / is killed | clip outlives the process | guard: stdin EOF (~14 ms) |
| App hangs (stuck event loop, debugger break) | nothing renews | guard: lease 800 ms |
| Guard crashes | app still alive | app undoes at once (`guard-lost`), and compares before releasing |
| App and guard both killed | nothing alive | marker + `sweepStaleClip` at next launch; `free-cursor.ps1` any time (a desktop shortcut) |
| Person wants out | - | Esc (polled by the heartbeat tick, no global shortcut stealing Esc), Ctrl+Alt+G (existing panic), pen leaves range, window blur / hide / minimise, 20 s without pen activity, any `disarm` reason in `clip.ts` |
| Another program's clip (a game, a remote client) | clip is global | never armed over, never released: `foreign-clip` / `foreign` |
| Display change (resolution, DPI, monitor unplugged) | rect no longer right | `display-changed` disarm on the screen-metrics event |
| Bad rect (empty, off-screen, tiny, whole screen) | would trap or do nothing | `validateClipRect` refuses, never "repairs" |
| Session lock / UAC secure desktop | the OS may drop the clip itself | unverified; the lease expires anyway while the machine sleeps |

Not allowed and not done: `SetSystemCursor`, hiding the cursor desktop-wide. `Esc` and the arm conditions assume the
keyboard keeps working, which a clip never affects.

## Recipe

1. **No cursor confinement by default.** The pen path is not affected by it (1), and a clipped real mouse is a cost.
2. **Pen sink = the Grab overlay** (exists). Remaining hole is the taskbar band (Explorer sits above every
   top-most window; measured earlier by the Wacom lane). Mitigate in Grab, not with Win32: make the tablet's bottom
   `taskbar/display height` (2.5 %) a visible dead band on the sheet (map the usable tablet over the *work area*, draw
   a hatched strip), so nobody writes where the taskbar is. Cheaper than any OS trick; an auto-hidden taskbar or the
   driver's Portion-of-screen removes it entirely.
3. **Arming signal = `RegisterPointerDeviceNotifications`** (pen in/out of range) rather than the pen signature hook,
   plus the tablet-native `inRange` from whichever backend wins the other spikes.
4. **Mouse-mode tablets only (opt-in setting, off by default):** `createContainment` with `guardBackend`. Arm when the
   Tablet sheet is showing, the window is focused and visible, and the pen is in range; rect = the sheet's physical
   pixel rect (content origin + display scale from main); beat every 250 ms; `activity()` from pen samples; disarm on
   every reason above. Spawn the guard `detached`, `windowsHide`, `ELECTRON_RUN_AS_NODE=1`, with `--marker
   <userData>\clip-marker.json`; call `sweepStaleClip` once at startup.
5. **If Sean wants true pen capture,** the only API is `RegisterPointerInputTarget` from a signed UIAccess helper
   (verdict 3). Park it until the tablet works and he decides about a certificate.

## For Sean's return (20 s, settles the open question)

`C:\CLAUDIO\spikes\wspike-contain\probe.cmd` with the tablet working: 10 s with no clip, 10 s with a 580x430 clip box
in the middle of the screen. Move the PEN in and out of the box (hover, tap, drag, taskbar), then the MOUSE. It
writes `probe-trace-real.txt` and prints, per phase: which device types the messages came from (8 = pen), whether the
hook ever saw the pen signature, and whether the OS cursor and the pen's pointer positions stayed inside the clip.
Esc ends it; the clip is released in every path and `free-cursor.ps1` runs after it. Self-tested here with a synthetic
pen and mouse (`probe-selftest.ps1`).

## Re-check 2026-10-04 (tablet healthy, still no pen movement)

`lab.exe info` / `lab.exe exp4` re-run (`exp4-rerun.txt`). The Wacom is now enumerated by the pointer stack:
`GetPointerDevices` lists **`CTL-472` twice** (`INTEGRATED_PEN` and `EXTERNAL_PEN`), `deviceRect` (0,0)-(15201,9501)
himetric (152.01 x 95.01 mm, aspect 1.600 = the 1920x1200 screen, so the driver maps the whole pad to the whole screen
with no aspect letterbox), `displayRect` (0,0)-(1920,1200). So a pointer-aware window can normalise
`ptHimetricLocationRaw / (15201, 9501)` into the `PenSample` 0..1 range with no Wintab (to be confirmed with a real
trace). Everything else is unchanged on the healthy device: `RegisterPointerInputTarget` error 5 (no UIAccess),
`...Ex` error 50, `RegisterPointerDeviceNotifications` true. Clip is `(0,0)-(1920,1200)` before and after.
The regression suite re-ran green: `guard-proof.mjs` 0 failures; `clip.test.ts` 38 passed (run it with
`node C:/GIT/WriteMindCross/node_modules/vitest/vitest.mjs run --root C:/CLAUDIO/spikes/contain-spike`; `npx vitest
--config` in that folder picks a second vitest copy from the spike's node_modules and reports "No test suite", which is not a test failure).

## Not verified (needs the real pen)

* Everything about the pen above is synthetic. In particular: that a real Wacom pen in Pen mode + Ink is also
  unclamped by `ClipCursor`, that its pointer messages carry `ptHimetricLocationRaw` in the device range shown by
  `GetPointerDeviceRects`, and that `RegisterPointerDeviceNotifications` fires for it.
* Whether the clip survives a lock screen / Ctrl+Alt+Del (the secure desktop), and what Windows does to a clip when the
  display configuration changes.
* The guard inside the packaged build.
