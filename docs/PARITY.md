# Parity checklist (Windows pass, 2026-10-03)

Status: works / fixed / missing / untested. The evidence scripts of this pass
(`t02.mjs` ...) now live in the repo as the end-to-end harness, `e2e/` (run with
`npm run e2e`; `docs/TESTING.md`): `t01`/`t02`/`p3` = `editor/01-typing-and-keys`,
`t03` = `cells/02-selection-and-drag`, `t04`-`t06` = `cells/03-seams`,
`t07` = `editor/08-pointer-and-todo`, `t13` = the same, `t14` = `editor/07-context-menu`,
`t15` = `pen/05-touch-and-palm`, `t10`/`t11` = `drawing/03-ink-select-transform`,
`t12` = `drawing/01-connectors`, `t16` = `drawing/05-hidpi`, `t17`/`t18` =
`drawing/04-textbox-and-marks`, `t19` = `editor/03-fold`; `wm/{fold,links,drag,
session,features}` = `editor/03..06`, `02`; `buttons/b1` = `pen/03-buttons-and-expresskeys`;
`chrome/*` = `chrome/01..04`; `maths.mjs` = `maths/01`; `camera-*` = `camera/01..02`;
`tablet/flow` = `tablet/01-sheet-as-camera`. The Pad and its scripts are gone.

## Done in this pass

| Feature | Status | Evidence |
|---|---|---|
| Typing, list continuation, Ctrl-B/I/U/Shift-X, Ctrl-1..8, Tab/Shift-Tab, Ctrl-D/M, undo/redo, Alt-D, code auto-pair | works | t02.mjs |
| Caret visible on dark theme (was black on dark), selection colour (was pale on dark), active-line band removed | fixed | theme.ts, t03 |
| Cell brackets: click, shift, ctrl, drag-down picks a run live, drag of a HELD bracket moves the run, edge auto-scroll, wider hit area, hover colour | fixed (drag was missing) | t03.mjs |
| Seams: hover, click, type opens cell, Enter opens empty cell, Escape disarms, caret hidden while armed (class was wiped by CodeMirror on focus), + menu keeps caret on the bar, menu Esc and clamps inside window, paste at a bar | fixed | t04/t05/t06.mjs |
| Italic with `*`, Mac inline regexes ported; snake_case_name no longer italic | fixed | p3.mjs |
| Folding, caret steps over folds | works | t19.mjs, old/fold.mjs |
| Todo tick by click, rendered toggle | works | t07.mjs |
| Right-click menu Cut/Copy/Paste/Select All (via main `edit:native`) | fixed (was none) | t14.mjs |
| Pen strokes, undo/redo, marquee, move/scale/turn, delete, group | works | t10/t11.mjs |
| Palm rejection while the pen is near, finger scroll in pen mode, pen touch-action | fixed (new) | t15.mjs |
| Handles of a thin selection no longer stack | fixed | Canvas.tsx |
| Flow shapes, label, routed arrows follow | works | t12.mjs |
| Rounded rectangle is drawn square | FIXED 2026-10-03 (d1-shapes): painted with `roundRect`, radius 0.2 of the short side; outline, hit test and arrow landing use the same rounded polyline | `shapes.test.ts`, `agents/e2e/d1/a1.mjs` |
| Marks (tick, cross, star, query), picture paste | works | t18.mjs |
| Text boxes (card, wrap, live growth, readable ink, re-edit by double-click); `text` added to NODE_KINDS so Shapes menu offers it | fixed (was missing); core `textBox.ts` + 10 transcribed tests | t17.mjs |
| HiDPI 1.5x: canvas crisp, handles aligned | works | t16.mjs |

## Next steps, in order

1. ~~Rounded-rectangle outline~~ done (d1-shapes).
2. ~~Run `cells.mjs` and `pen.mjs`~~ done 2026-10-03 (h1-e2e-harness): both are in the repo as `e2e/suites/cells` and `e2e/suites/pen`, isolated from the real notes, and pass against the current build (`npm run e2e`).
3. ~~Untested: links, tabs, session restore~~ done (e2-editor-polish, last section but one). Still untested: Export PDF, camera/capture/OCR, maths palette, crop, window resize (strokes stretch with the pane, same as Mac), rendered mode shows fence lines.
4. Add a unit test for the inline regexes (they live in the editor package; no DOM needed) and for seam Enter/Escape.
5. Selection box colour for held cells only highlights text width (Mac highlights the cell); consider a line decoration.

## For chrome agent

- ~~Tab title lags~~ fixed (p1-projects-pdf): the tabs take the titles the tree has after every save (`App.tsx` `keepOnly`).
- ~~Marks menu lists only 4 marks~~ fixed (d1-shapes), see the drawing section below. (The Swift `ShapeItem.Kind` has exactly four marks; the "boxes, circles..." of FEATURES.md are the Mac's `MarkMenu` list, which borrows three node kinds and adds the three line buttons.)
- ~~"Hold these together" never says Ungroup~~ fixed (d1-shapes).
- FEATURES.md says indent is two spaces; the code and Swift tests use four.
- A half-applied TopBar change once crashed the renderer (`collapsed.includes` of undefined) when App.tsx did not yet pass the prop.

## Projects, export and the window (p1-projects-pdf, 2026-10-03)

Evidence is `C:\CLAUDIO\agents\e2e\p1\` (port 9412; `t-projects`, `t-export`, `t-export2`, `t-window`, `t-theme`, `t-tabs`,
`t-layout`, `t-firstrun`, `t-focus`, `t-rows`; `run-all.mjs` runs the lot; every one prints PASS/FAIL and a last line ALL PASS). Unit tests: `packages/core/test/pagePlan.test.ts`,
`export.test.ts` (PagePlan + NotePDF tests of the Swift), `apps/desktop/test/project.test.ts`, `layout.test.ts`.

### Projects

| Mac | Here | Status |
|---|---|---|
| Project file: JSON `{excluded, folders, version}`, sorted keys, `"key" : value`, an empty array as a blank line, paths unescaped | `project.ts` `stringifyProject` writes Foundation's exact shape; it reads any JSON, an older file without `excluded` too | works (`project.test.ts`, `t-projects`) |
| A `.writemind-project` from the other kind of machine | a POSIX path on Windows (or a drive path on a Mac) is kept EXACTLY as written, shows as a folder that is not there, and saving does not mangle it | works; the sidebar says "Can't open the notes folder" and offers Add Folder / New Project |
| Open a project with no folders | opens, shows the default folder (`setFolders` fallback) | works |
| Open a file that is not a project | says so in a dialog, nothing changes (the Mac only logs) | works |
| Project menu: name (+ "— edited"), Add Folder, Remove Folder (disabled with one), Save, Save As, Open, New | all there; "edited" also shows for an untitled project that changed (`hasUnsavedProjectChanges`) | works |
| Remove Folder from Project on a section row | right-click menu (`FloatingMenu`): a project folder runs `removeFolder` (greyed with one folder), a nested folder runs `excludeFolder` (kept in `excluded`, left on disk); offered only for a folder that exists AT THE CLICK | works |
| Footer: "N notes · M folders" and the Folder menu (Add Folder, Remove Folder ▸ the other real folders, Hidden Folders ▸ Show X, Reveal) | `SidebarProject.tsx` | works. Not carried: Choose Folder… / Use ~/Documents/WriteMind (a macOS permission workaround) |
| Empty list ("No notes yet" + New Note / New Section); right-click on the blank list | same | works |
| Opening / creating a project closes tabs from folders no longer in it; removing a folder does too | `App.tsx` `keepOnly` after every tree read; the one in front is written first, then the first tab left (else the project's first note) comes forward | works |
| Session per project (`ProjectSession`: a file keyed by the project path, `default` for none) | `Sessions/<stem>-<hash>.json` in userData; the PAGE names the key on every read and write, so the last write of a project that was just left lands in ITS file | works. The Mac reads a project's session only at launch; here Open Project also brings that project's tabs back (a deliberate step past it) |
| Last project restore | `project.json` (file, folders, excluded); an unsaved project comes back by its folders | works |
| The first note opens on launch when there is no session (`selection = notes.first`) | same | works |
| Adding the same folder twice | one folder (paths tidied; case-blind on Windows) | works. A folder inside another may be added (both then show, as on the Mac) |
| Unsaved buffers in the session | carried since e2-editor-polish (hot exit): see "The editor, polished" | works |

### Export (File ▸ Export ▸ PDF…)

| Mac | Here | Status |
|---|---|---|
| `PagePlan` (US Letter 612x792, margin 54, a break between cells, a taller-than-a-sheet object alone and shrunk, overlapping pieces welded) | `packages/core/src/export/pagePlan.ts`, the Swift tests transcribed | works |
| The note rendered as the preview draws it (28/22/18/16/15 ladder, author line italic and bigger, lists, to-dos, quote, code in the Mac's LIGHT code colours, maths, rule, blank cells), always light on white | `blocks.ts` / `inline.ts`; maths is the notebook's MathML (`mathmlString`), an equation wider than the column is zoomed to fit | works; looked at as PNG (`agents/shots/p1-pdf-page-*.png`) |
| Colours checked against the paper (a yellow span or pen is darkened) | `readableInk` against #FFFFFF | works |
| The drawing as vectors over the text, one object at a time: strokes (pressure strokes as segments), shapes, routed connectors with heads and dashes, pictures, text boxes (an empty one prints nothing) | `drawing.ts` (SVG + real text); a hidden picture is not printed | works |
| The column is laid out at the editor pane's width and SCALED onto the paper (not re-flowed) | same; each sheet is laid out at its own top and then scaled (the print engine cuts pages where the LAYOUT is — a transform alone made words print twice) | works |
| Save panel: the note's own name, in Documents, "Where the PDF of “title” goes", a failed write is an alert | same (`exportPdf.ts`); the dialog goes through `askSave` so `e2ePick` answers it | works |
| No header, footer or page number | none | same |
| Export of a selection / a section | the Mac has none | n/a |
| Before: `printToPDF` of the app's own window (toolbar and all) | gone | fixed |

Differences: the face is Segoe UI (the Mac's San Francisco); a link prints blue and underlined; `<mark>` (written by /link) prints
highlighted and `<a id>` anchors are dropped where the Mac prints them as literal text. A code block taller than a sheet is zoomed
(its words may wrap a hair differently).

### The window

| Mac | Here | Status |
|---|---|---|
| Launch: notes and video side by side, EVERY launch (`showEditor = showCamera = true`) | the video shows on launch (it was off) and is not remembered | works |
| `HSplitView` 720:420 ideal, min 460 / 280 | `PaneDivider.tsx` + `shared/layout.ts`: drag, double-click resets, arrow keys when it has focus; the position is a FRACTION, remembered (`writemind.videoFraction`); the mouse never takes the keyboard from the notes | works at 100/125/150/200 % and 900x560…2560x1300 (`t-window`) |
| Sidebar 250 wide | 250 | works (was 232) |
| Window 1280x800, min 900x560 | same (was 1440x900, min 720x480); size, place and maximised are remembered (`window.json`); a window on a monitor that is gone comes back on the primary | works; maximised checked in unit tests only |
| Hide Video / Hide Notes Pane / Hide Notes Sidebar (Ctrl+Alt+C/E/S), never both panes | menu and keys, the labels flip | works |
| One window per profile | `requestSingleInstanceLock` (a second launch brings the first forward) | added (not on the Mac, which allows many windows) |
| Appearance follows the system | `prefers-color-scheme`; the window's first paint matches; `t-theme.mjs` audits every text and icon in both for WCAG contrast (4.5 / 3) over the note, rendered, edit mode, menus, popovers and context menus. Corrections: `--wm-faint`, a second accent for fills (white on the dark accent was 2.5:1), the tab close, the popover's buttons | works (0 findings) |
| Focus returns to the notes after a menu command, a bar or sidebar click, a tab, a context-menu item, a select | `focusReturn.ts` (leaves text fields and open menus alone); the font-and-colour and pen popovers close on Escape and click-away | works |
| Tabs: +, the list, Close Other Tabs, wheel, middle click, context menu (Close / Close Others / Reveal), the title follows the heading | `TabBar.tsx` | works |
| Empty pane: icon, "No note open", "New Note  Ctrl+N" | same | works |
| The sidebar's right-click on a NOTE: New Note Here, New Section Here, Rename…, Duplicate, Reveal, Move to ▸ (the folders, then every section), Move to Trash… | `noteMenu` (`SidebarProject.tsx`), `Prompt.tsx` for Rename (name selected, "The file keeps its extension") and the question before the bin ("It goes to the Recycle Bin, where you can put it back") | works (`t-rows`); the bin's name is the platform's |
| … on a SECTION: Rename… (the folder is renamed on disk; its notes keep their drawings, the open tabs follow, it keeps its place in the order; a taken name becomes "name 2"), Remove Folder from Project, Move to Trash… | `renameSection` in `main/notes.ts` | works (`t-rows`) |

Not done / not verifiable here: the note row's date under the title (the Mac shows "Oct 3 · snippet"); a section row that is SELECTED
(decides where the next note goes — here the open note's folder does); a real change of display scale while running (checked by
device-metrics emulation, not by dragging the window between monitors); the real title bar's dark mode. A red "Cannot read properties
of null (reading 'getBoundingClientRect')" bar appears when the last tab closes: `Canvas.tsx` `measure()` runs from its ResizeObserver
after its host is gone (a `?.` fixes it; drawing lane).

## The tablet as a source for the video pane (port-only)

The Mac has a document camera; a Windows tablet has a pen. **Input Devices ▸
Tablet** (also the video chevron in the sidebar; remembered, `camera:tablet`)
swaps the camera feed for a dotted sheet written on with the pen.

| Camera feature | On the tablet |
|---|---|
| Writing button | the pen's own **stroke items** (with pressures), placed where the box was at the learned page scale. Not re-traced: nothing is lost to a threshold. |
| Page button | the sheet rendered as a picture (the "Aa" reader works on it where an OCR exists, and is simply absent otherwise) |
| Dashed box | **Box** button (one-shot), the pen's side button, or Ctrl-drag; strokes crossing the edge are cut |
| Flow-chart reader | reads a black-on-white raster of the same ink; nodes/arrows land under the capture (same `flowChartItems` / `placeFlowItems`) |
| Learned page shape / placement | the same `resolveShape` / `placement` (the sheet is the frame; no page-finding) |
| One Ctrl+Z | takes back strokes + chart together (same `editDrawing`) |
| Straighten | hidden (nothing to square up) |
| Auto-send after idle | **not built** |

Sheet extras: Undo (Ctrl+Z while the pen is over the pane), Erase, Clear,
"Clear after" (what was sent leaves the sheet; default on). The sheet is kept
when the pane is put away. Known approximation (shared with the camera): a
chart is fitted into the band under the capture, so it can come out a little
smaller than the strokes it was read from.

**Pen.** Settings ▸ Pen: *Pen side button* = Selects (like ⌘, default) or
Erases (for a pen with no eraser end), honoured on the notes page and the
sheet (`penButtons.ts`). A ⌫ **Erase tool** toggle in the toolbar's pen group
rubs out whole strokes with no hardware button; it is lit and shown on the Pen
chip. While a pen is near, the OS arrow is hidden and an in-app cursor (ring in
the pen colour / arrow-dot over chrome / cross when erasing) follows it; mouse-only
hover events and the press-and-hold context menu are not delivered for the pen;
strokes keep going past the window edge (pointer capture). If the arrow still
shows: Wacom Properties ▸ Mapping ▸ turn off Mouse mode. Not detected
automatically.

### Pen position source: WebHID spike (wspike-webhid, 2026-10-03; nothing in the app changed)

| Piece | Status |
|---|---|
| Tablet-native pen data without a native module (`navigator.hid` in a hidden window), details in `docs/spikes/wacom-webhid.md` | **spike: transport verified on the Wacom, pen strokes not.** With three session hooks (VID 0x056A) `getDevices`/`requestDevice` list the tablet as ONE `HIDDevice` ("CTL-472"; collections Pointer, vendor `0xff00:0xa` with report 220, Digitizer `0xd:0x1` with the standard pen report 213), `open()` **succeeds with the Wacom service/driver running**, and the listener receives real reports (the device's 5 s vendor heartbeat) in a visible, `show:false`, offscreen and offscreen + default-throttled window; **re-run 2026-10-04**: the same on a private session partition (`pen-hid`, hidden window, the three hooks on that session only, as the app helper would host it): list, `requestDevice`, `open()` ok, heartbeats delivered. NOT verified (needs a moving pen): that report 213 streams position/pressure/buttons in Pen mode + Ink. |
| Decoder + `PenSample` normaliser + `WebHidPenSource` + trace recorder/analyser | drafted and tested (46 vitest, outside the repo, `C:\CLAUDIO\spikes\webhid-spike\`; includes the REAL CTL-472 descriptor as a fixture and synthetic reports built from it; primary-report selection so the vendor heartbeat never becomes a sample) |
| Settle it | `powershell -NoProfile -ExecutionPolicy Bypass -File C:\CLAUDIO\spikes\webhid-spike\tools\live.ps1 -Seconds 25` while someone hovers, draws and presses both side buttons: says whether 213 streams, its rate and ranges |

### Pen position source: WebHID backend, in the repo (wimpl-b-webhid, 2026-10-04; design `spikes/DESIGN-pen-capture.md` 4.4)

| Piece | Status |
|---|---|
| `main/pen/webhid/{protocol,primary,hidSource,hostPage,permissions,electronHost,webhidBackend}.ts`, `preload/penHid.ts`, `helpers/pen-hid.html` | **built, unit-tested and exercised in real Electron; wired into nothing yet** (D's `registry.ts` / `main.ts` create it with `createWebHidBackend({session: session.fromPartition("pen-hid"), preload: out/preload/pen-hid.cjs, page: out/helpers/pen-hid.html, log})`). The spike's source moved onto the repo's one decoder; one primary report per device (213 on the Wacom; the vendor report 220 is traced, not decoded, except as a last resort when the primary stays silent while it streams more than 3 reports in 2 s); physical extents for the aspect (15200 x 9500); hot-plug; a refused `open()` is a stated reason, not a crash; a hidden window that outlives the notes window closes itself; stop() destroys the window and puts the session back. |
| Evidence: `npx vitest run apps/desktop/test/pen/webhid` | 96 tests (`webhidPrimary`, `webhidSource`, `webhidBackend`, `webhidHost`) on the REAL CTL-472 collection metadata (`test/fixtures/pen/wacom-ctl472-real.json`) with synthetic reports, the page logic wired to the backend over a fake `navigator.hid` and a manual clock |
| Evidence: `powershell -NoProfile -File C:\CLAUDIO\agents\e2e\webhid\run.ps1 [-Repo]` | real Electron, real window / session / preload bridge / IPC, a PRETEND device planted in the page: 19 PASS lines (41 samples through the bridge, pressure / tilt / barrel decoded, exactly one leave sample, raw hex in the trace, counters over the status channel, window destroyed by stop(), orphan watchdog). `-Repo` runs it against `apps\desktop\out` (the locked build produces `pen-hid.cjs`, `pen-hid.js`, `pen-hid.html`) |
| Evidence: `... run.ps1 -Live` (2026-10-04) | the SAME shipped code on the REAL tablet through real `navigator.hid`, read-only (list, open, close, no output report): `getDevices` lists the CTL-472, `pen-hid` permission hooks allowed VID 056A and denied the other vendors' devices (2dc8, 0b05, 0951), `open()` ok with the driver running, layout compiled from the live descriptor (primary `d:1 #213`, fields at the expected bit offsets), the 5 s vendor heartbeat arrived and was NOT turned into a sample. **Still NOT verified: any real stroke** (nobody moved the pen). |

### Pen position source: Raw Input + HID spike (wspike-rawinput, 2026-10-03; nothing in the app changed)

| Piece | Status |
|---|---|
| Tablet-native pen data via `RegisterRawInputDevices(RIDEV_INPUTSINK)` + `WM_INPUT` + hid.dll, details in `docs/spikes/wacom-rawinput.md` | **spike only; real Wacom caps READ (tablet came back 21:25) but pen streaming UNVERIFIED (no moving pen).** Real: Col03 pen (report 209) / Col04 digitizer (report 213) / Col02 vendor / Col01 pointer are listed; pen X/Y are **tablet-normalised 0..32767** over a 15200 x 9500 area (not screen pixels), pressure 0..2047, tilt +-9000 (0.01 deg), tip/barrel/secondary barrel/invert/eraser/in-range bits; `RegisterRawInputDevices(INPUTSINK)` ok; the vendor collection delivered real `WM_INPUT` (idle heartbeat) with the app unfocused. Verified on the real OS: caps + bit-layout probe from Windows' own HID parser (cross-checked against `HidP_Get/SetUsageValue` on 13 devices), `WM_INPUT` delivery to a hidden window with the app unfocused by BOTH `hookWindowMessage` and a koffi message-only window inside Electron 44, a real RAWHID pen stream (Windows' synthesized `Microsoft HID RID\000D_0002\n` pen, fed by an injected hover pen) decoded to `PenSample`, hard-kill cleanup. |
| What Windows' own pen raw device gives | pen-vs-mouse, in-range, pressure, tilt, switches, hover independent of focus, but X/Y are **screen pixels**, not tablet counts (`backend: "rawinput-synth"`). |
| `RIDEV_NOLEGACY` to stop the pen moving the cursor | **does not work**: rejected for the pen usage (error 87); accepted for the mouse usage but the cursor still follows mouse and pen. Raw Input only observes. |
| Pen-vs-mouse by device node (`onMouseSource`: `RAWMOUSE` device name has `VID_056A`) | built, verified with injected input only; would replace the `WH_MOUSE_LL` signature test (which does classify Windows' synthetic pen as `pen`, so Sean's real pen probably arrives as plain mouse input from the Wacom pointer collection) |
| Decoder + layout probe + `PenSample` mapper + 8 ms batcher + trace recorder/analyser | drafted and tested (37 vitest, outside the repo, `C:\CLAUDIO\spikes\rawinput-spike\`; 11 of them on the REAL Wacom layout from `test/fixtures/wacom-ctl472.json`, the Windows-pen tests use Windows' real caps). Col03/Col04 are one pen exposed twice: `PrimaryPicker` keeps one; the vendor Col02 (raw counts 15200 x 9500, idle heartbeat) is traced but not decoded by default |
| To settle streaming | someone moves the pen: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\CLAUDIO\spikes\rawinput-spike\tools\live.ps1 -Seconds 25` (nothing hooked or grabbed). Do Col03/Col04 report while Ink is on? |

### No full screen, no Pad mode (decision 2026-10-03)

Sean never asked for a full-screen mode and it kept putting the display in full screen by itself (some of
that was test agents), so **Pad mode was removed completely** and nothing in the app can enter full screen:

| Piece | Status |
|---|---|
| `main/pad.ts`, `PadMode.tsx`, `padGeometry.ts` (the geometry the sheet and Grab still need moved into `tabletPage.ts`), the pad strip + CSS, the **Pad** button, Input Devices ▸ Tablet Pad (Full Screen), Ctrl+Alt+T (`tabletPad` in `shared/commands.ts`), the pad IPC (`pad:enter/exit/state`, `e2e:leaveFullScreen`), `pad.test.ts` | deleted |
| View ▸ Toggle Full Screen (Electron role) | removed from the menu (`menu.test.ts` asserts no full-screen role/label/id in any menu, dev or not) |
| the main window | `fullscreenable: false` (no F11 / Win+Shift+Enter / title-bar button / Window API); belt and braces: an `enter-full-screen` handler puts it back; the page's Fullscreen API is refused by the permission handler |
| persisted flags | none ever existed for the pad (`writemind.pen`/orientation/grab keys do not mention it); the ExpressKey suggestion that said "Pad" now says "Send writing" |
| guard | `sheetGeometry.test.ts` scans every `apps/desktop/src` file and fails on `setFullScreen(true`, kiosk, simple full screen, `togglefullscreen`, `requestFullscreen`, `PadMode`, `tabletPad`, `pad:enter` |

What the pad was for is done by the **sheet pane** (the tablet sheet in the video pane), **Grab** (the whole
tablet is the sheet with the notes still visible) and the driver's own **Tablet area** (below).

**Grab overlay vs Windows' idea of "full screen"** (decision 2026-10-03). A transparent top-most window that
EXACTLY covers a monitor can be treated as a full-screen app (taskbar hidden or flickering, notifications and
game bar suppressed). The overlay is therefore configured so that it cannot be one: (1) bounds are the whole display
minus a 2 DIP strip at the bottom (`shared/grab.ts overlayBounds`): never the monitor's exact rectangle (see the known limit about the taskbar band below);
the page maps the pen with the DISPLAY rectangle main reports, so the missing strip moves nothing; (2) `type: "toolbar"`
(WS_EX_TOOLWINDOW), `skipTaskbar`, `focusable: false` (WS_EX_NOACTIVATE: it never becomes the foreground
window, which is what the shell's full-screen / notification-state checks look at), `fullscreenable: false`;
(3) always-on-top level `floating` (was `screen-saver`; on Windows both are plain HWND_TOPMOST, on a Mac
`screen-saver` sits above the menu bar and Dock, which looks like full screen); (4) shown inactive, hidden
whenever the notes window is not in front. Verified by `agents/e2e/wacom/grab-fullscreen.mjs` (reads the real
Win32 styles and `SHQueryUserNotificationState` while the overlay is up).

**Known limit (measured 2026-10-03, display 1920x1200 with a 30 px taskbar, `WindowFromPoint`):** the taskbar band
is Explorer's and sits above every other top-most window, so the overlay can cover it on paper but never receives
the pen there: a pen in the bottom 30 px (2.5 %) of the DISPLAY, i.e. the bottom 2.5 % of the tablet, clicks the
taskbar instead of drawing (a stroke already begun keeps going, pointer capture). Nothing the app can do changes
that on Windows. Ways round it: auto-hide the taskbar, or give the driver a Tablet area ("Portion of screen")
that stops above it. The e2e corner strokes therefore start just above the work area's bottom edge.

**Tablet area** (for people who keep the notes visible): **Area** on the sheet pane
and *Tablet area* inside the Pen popover give the sheet's rectangle in PHYSICAL
pixels of its display (window content origin and display scale from the main
process, `getContentBounds` / `getDisplayMatching`, so it is right at 150% and on a
second monitor), say that the driver controls the mapping, and give the recipe
(Wacom Tablet Properties ▸ Mapping ▸ Screen Area ▸ Portion of screen ▸ Click to
define ▸ click the two corners). **Show area** flashes a red frame with "1" and
"2" corner tags on the sheet. Measure again after moving or resizing the window.

Not built: auto-send, a side-button double-click exit, following the sheet when the
window moves to a monitor of another shape (the sheet keeps the shape it was
created with; `localStorage writemind.sheetAspect` forces one, which the older tablet
e2e uses to get a tall sheet in the pane).

E2E (Wacom lane, run on an offscreen instance: `WM_PORT=9410 node C:\CLAUDIO\agents\e2e\wacom\run-all.mjs`; one script:
`node tablet-flow.mjs`): `tablet-flow.mjs` (write, box, chart, page, undo, erase), `tablet-cursor.mjs`, `tablet-pen.mjs`,
`no-fullscreen.mjs`, `grab-fullscreen.mjs` (see "No full screen"). The older `C:\CLAUDIO\e2e\tablet\`, `pad\`, `grab\`,
`buttons\` folders are superseded (port 9999/9998/9996/9997, hard-coded profiles); `camera-flow-t.mjs`, `camera-warp-t.mjs`,
`cells-t.mjs` there belong to the camera / editor lanes and were not ported.

### Tablet orientation and Grab (port-only, 2026-10-03)

**Tablet orientation** (the Mac's `cameraRotation`, turned into Wacom's wording): a dropdown in the sheet
pane header and the Pen popover, remembered (`localStorage writemind.orientation`): *Match
screen* (default = Landscape 0° on a landscape display), *Landscape (0°)*, *Portrait (90° clockwise)*,
*Landscape flipped (180°)*, *Portrait flipped (270°)*. It says how the tablet is physically turned. The sheet
takes the screen's shape turned by it (landscape on this machine's 1920x1200 display by default; the old
default was the same shape but nothing said so and nothing could change it). In **Grab** the
pen's place on the display is turned back into its place on the sheet (`shared/orientation.ts`), so a tablet
turned on its side still writes upright; the pen ring is drawn on the sheet (the OS arrow is hidden). In the
**pane** the pen is simply a pointer over the sheet (nothing is mapped), so there the orientation only gives
the sheet its shape. Strokes are fractions of the sheet: changing the orientation never moves or destroys
ink, it only changes the page shape the next capture is made on; **Rotate ink** turns the ink a quarter turn
clockwise when that is wanted. Captures need no turning because the sheet is the tablet as the person sees it.
The camera keeps its own rotate buttons (not changed).

**Grab** (`main/grab.ts`, `GrabOverlay.tsx`, `useGrabHost.ts`, `shared/grab.ts`): with the Tablet source
showing and the window in front, the whole tablet is the sheet rectangle, with no full screen. The driver maps
tablet to screen and an app cannot change that, so a transparent, frameless, always-on-top, non-activating
(never takes the keyboard) window covers the display, receives the pen wherever it is, maps it
(`(x - display.x) / display.width` in physical pixels, first and last pixel = the tablet's edges, 100% and 150%)
through the orientation onto the sheet rectangle, draws live ink and a ring there, and ships every change
(`SheetOp`: mark/add/replace/removeAt/undo/redo, plus a full state with history at start) to the notes window,
which owns the one sheet: Send Writing / Page / Box / Undo / Clear / Erase, pen-button taps and ExpressKeys all
work as in the pane. Notes stay visible and the sheet pane is where the ink appears.

*What Windows allows (measured on Windows 10 19045 with synthetic pen via InjectSyntheticPointerInput and
synthetic mouse, `C:\CLAUDIO\e2e\grab\spike`):*
- A transparent overlay with alpha >= 1/255 is hit-testable; the pen reaches it as `pointerType: pen` with
  correct position and pressure, over our window or the bare desktop. A mouse click reaches it as `mouse`.
- It cannot be hit-testable for the pen alone. `setIgnoreMouseEvents(true, {forward:true})` makes it
  click-through: mouse clicks go to the window underneath (measured: pointerdown + click arrive in the notes
  window) and the overlay still gets mouse MOVES (typed `mouse`, from a global low-level hook), but a pen then
  goes to whatever is underneath (hover events over our window come late, contact arrives), and over another
  app the overlay hears nothing. Without `forward` it hears nothing at all.
- So there are two modes (`shared/grab.ts`): **pen** (hit-testable) and **mouse** (click-through).
- **Who is it? A global hook** (`main/penHook.ts`, koffi prebuilt N-API, WH_MOUSE_LL on the main thread, always
  calls the next hook): Windows tags mouse input promoted from a pen with 0xFF515700 in dwExtraInfo (+0x80 for
  touch). Pen-signed event anywhere on the screen = PEN mode at once; unsigned = MOUSE mode at once, switched
  inside the hook so the very first click goes through (measured: a plain click with no prior move reached the
  window under the cursor). A pen's echo (250 ms) and a stroke under way hold the mode. Needed because the
  window cannot hear the pen elsewhere on the desktop (the first Grab build relied on that and only worked
  full screen). Fallbacks when the hook cannot load (HUD says "no hook"): a pen seen over the notes window, the
  cursor moving with no mouse move behind it, the first real mouse event on the overlay, and the 20 s
  watchdog (to mouse mode, never under a stroke). "Pen only while grabbed" pins pen mode.
- **HUD**: the pane header chip reads Grab: pen / Grab: mouse / Grab: off (+ "no hook"); the Pen popover shows
  the last classified input, hook installed yes/no with the error, counts of pen/mouse/touch events,
  overlay bounds and display, and **Copy grab diagnostics**. The last 200 transitions are in
  `grab.log` in the app's userData folder.
- **Verified here without a Wacom** (`grab3.mjs`): SendInput-style `mouse_event` with dwExtraInfo 0xFF515700
  stands in for pen-promoted input and 0 for a real mouse, window 900x700 NOT full screen: signed moves over
  the bare desktop -> PEN; a synthetic pen stroke there lands in the sheet at the proportional place with
  pressure; a plain click -> MOUSE and reaches the window; moves during a stroke do not flip it.
- **NOT verifiable without hardware:** that a real Wacom pen (Windows Ink) really produces LL-hook mouse
  events carrying the signature while the cursor is over a window that handles pointer messages. The
  synthetic pen pointer (InjectSyntheticPointerInput) produces neither cursor motion nor hook events, so it
  cannot test this. If the HUD on the user's machine shows pen counts staying 0 while the pen moves (and
  mouse counts rising), the driver sends unsigned mouse input (Windows Ink off / Mouse mode) and nothing
  can tell it from a mouse: turn Windows Ink on and Mouse mode off in Wacom Tablet Properties.
- ClipCursor / Wintab: not used. Confining the cursor would not change the driver's mapping, and Wintab
  without CXO_SYSTEM would need a native module for no gain over the overlay.
  **Measured 2026-10-03 (spike `docs/spikes/wacom-containment.md`, synthetic pen, real pen unverified):**
  `ClipCursor` clamps every mouse-class move (SendInput, mouse_event, SetCursorPos, relative) but NOT a pen
  pointer (WM_POINTER arrives at the unclamped place, the cursor follows the hover unclamped), so it is no fix
  for stray taps in Pen mode + Ink. A swallowing `WH_MOUSE_LL` is no fix either (the window still gets the pen as
  WM_POINTER; a pointer-handling window gets no mouse event from the pen at all, which is why the hook never saw
  Sean's pen). `RegisterPointerInputTarget(PT_PEN)` is denied without UIAccess (error 5).
  `RegisterPointerDeviceNotifications` works unelevated and gives a focus-independent pen in/out-of-range signal.
  A clip outlives its process (kill -9 and normal exit both leave it): a draft opt-in for Mouse-mode tablets with a
  detached guard process (stdin EOF ~14 ms, lease 800 ms, startup sweep) is in `C:\CLAUDIO\spikes\contain-spike\`
  (`clip.ts`, 38 vitest tests, `guard-proof.mjs`); NOT wired into the app. 20 s check for the real pen:
  `C:\CLAUDIO\spikes\wspike-contain\probe.cmd`.
  **Wintab, measured 2026-10-03 (spike `docs/spikes/wacom-wintab.md`, no pen movement, so no packet was ever seen;
  tablet was in Code 10 at first, healthy again at the 21:23 re-check with the same extents):** the earlier "Wintab needs a native module" is wrong - koffi loads `wintab32.dll` in Electron
  main; DATA and SYSTEM contexts (with a screen sub-rectangle in `lcSysOrg/Ext`, which the driver stores as given)
  open and close without disturbing the mouse; a hidden BrowserWindow can own the context and receive `WT_*`
  messages through `hookWindowMessage`. A tablet-native pen source independent of focus and of the screen mapping
  is therefore buildable (draft decoder, normaliser to `PenSample`, service and trace recorder in
  `C:\CLAUDIO\spikes\wintab-spike\`, 54 tests); whether packets flow with another window in front and whether a
  SYSTEM context re-maps the cursor needs the real pen: `capture.cmd --seconds 60 --fg` and `capture.cmd --system
  --rect x,y,w,h` in that folder. A killed process leaves its Wintab context open in the driver (limit 32): the
  draft journals its handle and closes only a dead-pid-named one at next start. NOT wired into the app yet.

Nothing is trapped: the overlay is hidden unless the notes window is in front, focusable:false, and is destroyed
on Release, Esc, Ctrl+Alt+G (global while grabbed), the notes window closing / reloading / its renderer dying,
the overlay's own page dying (`Page.crash` tested) or going silent (heartbeat 6 s, tested), and quit.
It follows the window to another display and covers that display except a 2 DIP strip at the bottom (never the
exact monitor: see "No full screen" above; a second `setBounds` because Windows trimmed the first during testing). The sheet rectangle is the pane's sheet, so a small pane means
small writing on the screen (the tablet is still all of it); make the pane large, or give the driver the Tablet area.

For no app at all the Wacom driver can do the same: Wacom Tablet Properties ▸ Mapping ▸ Screen Area ▸
Portion of screen (Tablet area helper above). Set nothing else: Pen mode (not Mouse mode), Windows Ink on,
Orientation in the driver left alone (WriteMind's own dropdown does the turning).

E2E: `C:\CLAUDIO\agents\e2e\wacom\` (`grab-overlay.mjs` corners/strokes/sidecar, `grab-hook.mjs` hook-based modes with a small
window, `grab-modes.mjs` modes, exits, four orientations; `inject.ps1` is the synthetic pen/mouse injector and MOVES THE REAL
CURSOR, so `run-all.mjs` runs these three only with `--real-input`). `lib.mjs` exports `noAutoGrab()` for the page-level tablet
scripts (Grab would otherwise keep their synthetic pen away from the pane) and `target()` for the overlay page (`grab=1`).

## Pen buttons and ExpressKeys (Windows pass, 2026-10-03)

The Mac's mouse + modifier idioms, on a Wacom pen and tablet. See
`docs/KEYS.md` (Pen buttons and ExpressKeys) for the table.

| Mac | Pen | Status |
|---|---|---|
| ⌘-drag marquee | lower side button drag (default), or the ⬚ Select tool, or Ctrl | works (`b1.mjs`) |
| ⇧ extends the selection | assignable "Add to selection" button; Shift | works |
| drag moves, handles scale/turn | Select tool then drag on the object; handles are pen-sized | works |
| ⌫ deletes the held items | handle ✕, "Delete selection" button / ExpressKey Ctrl+Alt+9 | works (new) |
| Esc clears | "Clear selection" button / ExpressKey Ctrl+Alt+0 | works (new) |
| scroll the page | upper side button drag (Pan), Tip + Alt, a finger | works (new) |
| right click | "Right-click" tap action | works (new) |
| ⌘Z / ⇧⌘Z | Undo / Redo tap actions, ExpressKeys | works |
| eraser | eraser end, lower button set to Erase, ⌫ tool | works |
| colour, width | Next/Previous colour, Wider/Thinner (buttons and keys) | works (new) |

Not verified on hardware: everything was driven with synthetic pen
`PointerEvent`s (button/buttons combinations above) and real key events, not
a real Wacom. Open: a driver that sends both side buttons as the lower one
cannot give them different jobs; the old `sideButton` setting is migrated into
the lower button; `data-pen="side-button"` is now `data-pen="btn-lower"`.
E2E: `C:\CLAUDIO\agents\e2e\wacom\` (`buttons-page.mjs` notes page + keys,
`buttons-sheet.mjs` sheet).

## Maths in two dimensions (Windows pass, 2026-10-03)

Evidence: `C:\CLAUDIO\agents\e2e\maths\math2d.mjs` (offscreen test instance,
real CDP mouse input; 32 PASS), `gallery.mjs` (every Calculus / Algebra
template, as inline and as a block, screenshots LOOKED at), unit tests
`packages/core/test/{math,mathml}.test.ts`.

| Feature | Status | Notes |
|---|---|---|
| `MathView` stacked fraction, radical with roof, ∑ ∏ with limits above and below, ∫ with bounds on the sign, ∬ ∭ ∮, limit with its approach under, matrix between growing brackets, binomial, ∂ / d fractions, ∇ operators | works | MathML via `mathml.ts` (`mfrac msqrt munderover msubsup mtable`); a stacked fraction under a power is bracketed (the Swift left it bare) |
| Inline maths in a line / block maths centred | works (inline CHANGED by Mathslane-fix2, below) | block is MathML display style; inline was MathML too, and is now the Mac's linear run |
| Line height not disturbed by tall inline maths; sits on the text baseline | REPLACED (Mathslane-fix2) | the negative-margin inline-block did not keep the lines apart, it made stacked inline maths OVERLAP its neighbours by up to 12px and take their clicks; inline maths is now a linear run of text, which cannot be taller than its line (below) |
| Click on typeset maths puts the source back; typeset returns when the caret leaves | works | left half of an inline span → start of its source, right half → end; a block → end of its first source line |
| Selection over typeset runs | works | a selection that covers a span keeps it typeset, one that ends inside shows its source; real mouse drag checked |
| Copy of typeset maths copies the source | works | CodeMirror copies the document slice (checked with a copy event) |
| Palette preview uses the same renderer | works | `mathElement(…, { display: "block" })`; the palette itself was rebuilt as the Mac's one-pane menu (below) |
| Palette popover reaches across the pane divider (video pane open) | fixed | `.top-bar` z-index 5 → 9 (it was under the divider's 8, so "Insert" was unclickable) |
| WL parser: `-x^2` is -(x^2) | fixed (differs from the Swift, which gave (-x)^2 and typeset the Gaussian wrong) | `expression.ts` |
| Floor / Ceiling / Norm in the linear form; CubeRoot / Surd | fixed / added | the Swift printed `⌊⌋ x` |
| Every WLExpression / template test of `MathTests.swift` | transcribed, passing | `math.test.ts`; the 130 palette templates match the Swift ids exactly |
| Dark and light | works | `currentColor`; checked by emulating both schemes |

## The maths palette and the maths tour (m2-math-tour, 2026-10-03)

Source of truth: `WriteMind/Views/MathMenu.swift` (the popover), `Math/MathTemplates.swift`, `Editor/MarkdownFormatting.swift`
`insertMath`, `Editor/MarkdownBlocks.swift` (what a fence is). Evidence: e2e in `C:\CLAUDIO\agents\e2e\m2\` (test port 9417; `palette.mjs`
52 checks, `tour.mjs` 32, `perf.mjs` 5, `rendered.mjs` 4, `print.mjs` 3, plus `..\maths\math2d.mjs` 32 re-run against the new palette; shots
`agents\shots\m2-*.png` were LOOKED at, dark and light), unit tests `packages/core/test/{mathTemplatesParity,mathml}.test.ts`.

| Feature | Status | Notes |
|---|---|---|
| Palette = the Mac's `MathMenu`: ONE scrolled pane of all six groups with a pinned header each (no tabs), the first shape (Definite integral) picked on opening, a field per slot (suggestion as placeholder and value), the editable Wolfram Language line, a 22pt typeset preview, **On its own line** (ticked), Insert | rebuilt (was tabs + two buttons) | `MathPalette.tsx`; the popover starts afresh each opening, as the Mac's does |
| "The fields drive the WL until the WL is edited, then what is in it is inserted"; a later slot edit drives it again | same | |
| Palette data = the Swift's, field for field: 130 templates, group / name / glyph / form / slot labels and suggestions / order | guarded | `mathTemplatesParity.test.ts` reads the reference `MathTemplates.swift` and compares; fails if a `git pull macos` moves it |
| Toolbar button reads ƒ(x), tooltip "Integrals, sums, derivatives — written as Wolfram Language" | fixed (was ∑) | the Mac's SF Symbol is `function` |
| **Keyboard only**: Ctrl+Shift+M / Insert ▸ Maths… opens (also with the Maths section put away) on the picked shape; arrows / PageUp / PageDown / Home / End pick; Tab walks slots, WL, tick, Insert and wraps; Enter inserts as ticked, Ctrl+Enter the other way; Esc closes and returns the keyboard to the note; Enter during IME composition is the IME's | built (port-only keys; the Mac popover is mouse-first) | `docs/KEYS.md`; `palette.mjs` drives every key with real CDP key events |
| Insert replaces the selection; a block mid-line breaks the line either side; one Ctrl+Z takes an insert back (inline and block), Ctrl+Y returns it | works | `insertMath` (same as `MarkdownFormatting.insertMath`) |
| Unparseable input: the preview shows it as typed (mono, secondary — the Mac's `MathView` fallback) with a small "Not an expression yet: it stays as typed" line; Insert still puts it in | works | in the note a half-typed `wl:` span / fence stays text and typesets as soon as it parses and the caret has left |
| A `wl` fence is any line that STARTS with three backticks after its indentation (the Mac's rule), so a ```wl block inside a list item is typeset; the language is the rest of the line; any line starting with three backticks closes it. `~~~` is not a fence (the Mac has none) | fixed (only column 0 was typeset) | `math.ts` |
| Maths in headings, bullets, nested bullets, numbered, to-dos, quotes, folded sections (gone when folded, back on unfold), on the rendered page; line height unchanged by it | works | `tour.mjs`, `rendered.mjs` |
| Japanese text around inline and block maths: same line height as a plain Japanese line; click targets right; typing CJK beside the source | works | `tour.mjs`; **a real IME was not driven** (CDP `insertText` only; keyCode 229 Enter checked) |
| Copy and paste of maths between notes: the source arrives intact and typesets | works | the clipboard is the markdown (no MathML flavour) |
| 200+ equations in a note: set 50-60 ms, a selection move 1-3 ms (1500 equations: 3 ms), typing and scrolling at frame rate, 42 widgets in the DOM at once | works | `perf.mjs` (`N=500` for 1500) |
| Pathological sources (3000 nested brackets, a 20000-term sum) stay text instead of throwing out of the editor's decorations (a 20000-term sum froze the page for 27 s before the 2000-character cap) | fixed | `mathmlFor`: try/catch, 2000-character cap, depth 400 |
| Handwritten algebra now typesets: a lone `=`, `x²` / `x⁻¹` / `x¹⁰` (raised characters), `≤ ≥ ≠ × · ÷ −` typed or read are understood by the WL reader (the OCR path emits exactly `y = 2x + 1`, which the Mac shows as source) | built, differs from the Swift | `expression.ts`; unit-tested |
| Evaluation (Wolfram) | none on the Mac, none here | the Swift has no evaluation; nothing invented |
| Export ▸ PDF with maths | prints the window (Chromium draws the MathML as vector text); an equation wider than the page is a scroll box on screen and is CUT OFF in print | see TODO ▸ Export PDF and maths; `print.mjs` measures it under print media (`Page.printToPDF` is not in Electron's CDP and the Export handler opens a native save dialog even under `WRITEMIND_E2E`) |
| Inline maths: the caret just after it (right after an insert) shows the source until it moves on or you type a space | as designed by the first pass (edges count as inside, so arrows can enter) | |
| The sidebar row's second line and a tab title show a `wl:` span's raw source | not changed | editor lane's titles |

**Re-run on the final tree (m2-math-tour, resumed after a usage limit, 2026-10-03, test port 9420):** `m2/palette.mjs` 52/52, `m2/tour.mjs` 32/32 (the first run after a fresh start failed one click check, then 3 of 3 clean runs: a click raced the first layout of a just-opened note), `perf.mjs` 5, `rendered.mjs` 4, `print.mjs` 3, repo `e2e/suites/maths/01-07` all pass (19/21/38/9/16/21/19), `maths/math2d.mjs` 31/31 after its two inline-2D checks (MathML inside a line, an inline `msqrt` baseline) were rewritten for the linear inline run of Mathslane-fix2. The palette was looked at again (dark): groups, slot fields, WL line, typeset preview, On its own line, Insert. Nothing in the maths lane needed a code change on this pass.

## Maths, after the independent check (Mathslane-fix1, 2026-10-03)

A verifier (Mathslane-v1) drove the maths lane's build and found four problems. Evidence: repo e2e suite
`e2e/suites/maths/` (`02-wide-equations.mjs` 20 checks, `03-palette-keeps-the-keyboard.mjs` 38, `04-products-keep-their-sign.mjs` 9;
run by hand with `WM_PORT=<port> node e2e/suites/maths/0N-….mjs` against an `-E2E` test instance), unit tests
`packages/core/test/mathml.test.ts` (a new block on products), shots in `e2e/.results/manual/`.

| What | Status | Notes |
|---|---|---|
| An equation wider than the pane bent the WHOLE note: `.cm-content` is a flex item of the scroller and may not shrink below its min-content width, which for unbreakable maths is all of it, so every paragraph wrapped at the equation's width and the editor scrolled sideways (a 14-term block made the content 795px in a 640px pane; a 30-term inline one 2053px) | fixed (root cause) | `.cm-content { min-width: 0 }`, installed by `mathRendering` (`math.ts`); the `max-width:100%` / `overflow-x:auto` on the block then do what they always said. The same checks fail (24 of them) with the rule undone, in the page |
| An inline equation wider than its line | fixed, then REPLACED by Mathslane-fix2 (an inline equation is text and wraps; no scroll box) | a ViewPlugin measures each typeset inline equation against the line it is in (read phase) and puts `wm-math-wide` on the ones that do not fit: a scroll box of its own, `max-width: 100%`, thin scrollbar. Only those leave the text's baseline (a scroll box takes its baseline from its bottom edge, so it sits at the text's middle and does not overlap its neighbours); the class follows the pane's width both ways (checked 2200 → 900 px windows) and the caret inside the source and out again. The Mac wraps inline maths as text; MathML cannot break, so a scroll box is the nearest thing |
| `3 × 4 = 12` was drawn `3 4 = 12` (× and · were read as `*`, which is invisible times) | fixed | the parser keeps the sign as written (`written` on the product, port-only), the MathML draws it: `3 × 4`, `a · b`. A number that follows any factor now has a visible dot even when no sign was written: `2*3` is `2·3`, `x*2` is `x·2` (the Mac draws `2 3`, which reads as 23; changed on purpose, `2x`, `2(x + 1)`, `a b` stay side by side). The old test that asserted `3 × 4` equals `3 * 4` was the defect and was changed |
| The palette could not be driven from the keyboard in the verifier's tree: the page's focus-return (`focusReturn.ts`, after a menu command or a click on the bar) crossed the palette's own focus a millisecond after it | already fixed in the tree by the time of this pass (`.math-pop` in `POPUPS`); re-verified with the verifier's scripts and made a regression test | `03-palette-keeps-the-keyboard.mjs` opens it three ways (Ctrl+Shift+M, a mouse click on ƒ(x), Insert ▸ Maths…) and watches the focus for 1.5 s; with a steal simulated in the page it fails 24 checks |
| A click on a bare part of the palette (its heading) handed the keyboard to the note and Esc then closed nothing | fixed (found while re-verifying) | the popover is `tabIndex={-1}` (so the click stays inside it) and hands the keyboard to the picked shape; `MathPalette.tsx` |

## Maths, after the second independent check (Mathslane-fix2, 2026-10-03)

A second verifier (Mathslane-v2-0) found four problems (one high, three medium). Evidence: repo e2e suite
`e2e/suites/maths/` (`05-inline-maths-is-text.mjs` 16 checks, `06-text-after-a-block-stays-visible.mjs` 21,
`07-brackets-and-powers.mjs` 19; `01`-`04` re-run and updated: 19 / 21 / 38 / 9), unit tests
`packages/core/test/mathFix2.test.ts` (30) and `export.test.ts`; run by hand with `WM_PORT=<port> node e2e/suites/maths/0N-….mjs`
against an `-E2E` test instance (port 9438). The verifier's own repro scripts (`agents/e2e/verify/Mathslane-v2-0/{hidden,swallow}.mjs`) pass.

| What | Status | Notes |
|---|---|---|
| **HIGH.** A typeset ```wl block swallowed any text on its closing-fence line: the widget replaces that whole line, so words typed or joined after the backticks were hidden once the caret left (still in the file). Two ordinary flows: Palette Insert "On its own line" with the caret on a blank line between paragraphs (the caret landed at the END of the closing fence), and Backspace at the start of the line right under a block (it joined onto the fence) | fixed (root cause, both halves) | `insertMath` (`templates.ts`) puts the caret on the line AFTER the block when the text already had a line break there (PORT-ONLY: the Mac leaves it at the end of the inserted text, where its always-visible source pane hides nothing; the inserted TEXT is the Mac's, unchanged), so the block is typeset at once and typing starts on a fresh line. And `blockDecorations` (`math.ts`) does not typeset a block whose closing fence has anything but spaces after the backticks: it stays source, so every word is on the page. Typing a newline back after the fence typesets it again. Not changed: the rendered page's handling of a closing fence with trailing text (editor lane's `preview`) |
| **MEDIUM.** Tall inline maths (stacked fractions, derivatives, limits, matrices, binomials) was drawn at full height in a 21.8px line and overlapped the lines above and below by up to 11-12px (the denominator of ∂f/∂x through the next bullet; a 2x2 matrix over the next bullet), and the lower half of its box took the clicks meant for the next line (the caret went into the wrong equation's source) | fixed (root cause: no tall boxes inline) | inline maths is the Mac's LINEAR run (`inlineSpans` in `typesetter.ts`, the Swift `MathTypesetter`): `∫₀¹ x² dx`, `(a + b)/2`, `∂f/∂x`, exponents and limits raised and lowered, in the page's own face. It cannot be taller than its line, wraps with the words round it (the scroll box for a wide inline equation, `wm-math-wide`, is gone), and a press anywhere on it opens its own source, the nearer end (the nearer half of the width of all its wrapped pieces). Block maths on its own line stays MathML. The PDF export sets inline maths the same way (`mathHtml`, `INLINE_MATH_CSS` shared). The 2-D inline form of the first port is gone: a deliberate return to the Mac |
| **MEDIUM.** A power whose base is a call that is drawn as a script, infix or stacked row was not bracketed: `Exp[x]^2` drew e with x and 2 beside it (reads e^(x²)), `Dot[a,b]^2` drew `a·b²`, `Log[2,x]^2` `log₂x²` (Sum, Integrate, Limit, D, Factorial likewise) | fixed | `powerBase` (`mathml.ts`) brackets the base unless, as DRAWN, it stands alone: one token, a root, a subscripted name, something already in brackets, or a name applied to bracketed arguments (`sin(x)²`); the linear typesetter has the same rule (`standsAlone`), which also fixes `(x^2)^3` there (it drew `x²³`). `Factorial[x^2]` is `(x²)!`. The linear form now draws Dot and Cross as products (the Swift drew `Dot(a, b)`) |
| **MEDIUM.** Function application written with round brackets was read as a product and the brackets dropped: `f(2) = 4` showed as `f·2 = 4` (the dot is the rule that a number after any factor needs a sign), `y(0)` as `y·0`, `f(x)` as `f x`, `sin(x)` as `sin x` | fixed | brackets WRITTEN right after another factor are kept: the parser makes them a `group` node (PORT-ONLY, `expression.ts`; elsewhere brackets still only group and are dropped), drawn as the brackets they were and, after a name, exactly as `f[2]` is (function application, no gap, no dot). `f(x)^2` keeps its brackets and its exponent. The product is still a product to WL: it prints back as `f*(2)`. `f(x, y)` (several arguments in round brackets) is still not an expression and stays text |

## Maths, after the third independent check (Mathslane-fix1, 2026-10-04)

Independent verifiers (Mathslane-v1-1b and a second) found six problems (two high, four medium; two of the medium are the same
defect seen twice). Evidence: repo e2e suite `e2e/suites/maths/` (new: `08-rendered-page-and-first-keystroke-keep-the-plugins.mjs`
37 checks, `09-mouse-on-typeset-maths.mjs` 33, `10-nested-scripts-and-deep-nesting.mjs` 12; `01`-`07` re-run and unchanged: 19 / 21 / 38 / 9 / 16 / 21 / 19),
unit tests `packages/core/test/mathFix1.test.ts` (12) and `packages/editor/test/mathInline.test.ts` (9); run by hand with
`WM_PORT=<port> node e2e/suites/maths/NN-….mjs` against an `-E2E` test instance (port 9435). Screenshots LOOKED at:
`e2e/.results/manual/…__maths-{nested-scripts,drag-from-equation,right-click,shift-click-selection}.png`.

| What | Status | Notes |
|---|---|---|
| **HIGH.** Ctrl+Shift+P (the rendered page) killed the inline-maths plugin: the preview replaces whole paragraphs, so `view.visibleRanges` is split round them, a one-line paragraph that is not the first block is the end of one range and the start of the next, its `wl:` spans went into the sorted `RangeSetBuilder` twice and CodeMirror threw ("Ranges must be added sorted"). With two or more equations on that line every inline equation of the note stayed raw text after coming back, until the note was reopened | fixed (root cause) | `linesOfRanges` (`math.ts`) walks each line once. The old loop reproduces the throw in a unit test with a split range; `08` toggles the page for nine shapes of note (heading, quote, list, soft wrap, block after) and checks no "plugin crashed", the widgets back, and a NEW equation typesetting at once |
| **HIGH** (editor lane, found while testing; surgical edit). The first edit that grows the note while its end is in view (the first character of a new note, a keystroke at the end of a short one, `setDoc`) crashed the markdown decoration plugin: `Decorator.patch` mapped `view.visibleRanges`, already in the NEW document, through the change again (`Position N is out of range for changeset of length M`), CodeMirror dropped the plugin, headings / bullets / bold stayed raw markdown until the note was reopened. It also put "plugin crashed" into every maths e2e run | fixed (root cause) | `windowHoldsPage` (`decorations.ts`): only the decorated window (old positions) goes through the change; the visible ranges are used as they are. Unit test for the first character of an empty note, the end of a short note, `setDoc`; `08` types the first character with real input and checks the heading, the bullet and the equations are decorated |
| **MEDIUM** (reported twice). The linear typesetter took time exponential in nesting depth: `standsAlone` drew the arguments of a call to find out whether it is drawn specially and `powerBase` drew them again, so each level doubled the work. 22 nested `Exp[…]^2` took 4 s, 30 would take minutes; in the app a 21-deep `wl:Factorial[…]` took 0.9 s to insert and 0.4 s on EVERY caret move, and the 2000-character and depth-400 caps did not catch it | fixed (root cause) | whether a call is special and how it is drawn are now ONE lookup by name and number of arguments, `specialForm` (`typesetter.ts`), which draws nothing; `standsAlone` asks it. Seventeen forms 40 deep take under 3 ms each (100 deep under 5), unit-tested under 100 ms; in the app five spans 30-40 deep insert in 8 ms and a caret move costs 0-1 ms (`10`). A 20000-case fuzz found the same characters before and after. The MathML path was always linear |
| **MEDIUM.** Inline maths flattened nested scripts: `mathScript` set every run of the piece to one size and one offset (the Swift `script()` does the same), so `wl:Exp[-x^2]` drew e^(−x2), `x^y^z` x^(yz), `Subscript[x, n^2]` x_(n2), and the palette's own Gaussian read as ∫ e^(−x2) dx, while the block (MathML) form was right | fixed (PORT-ONLY, deliberately not the Swift) | scripts compose: each run is scaled by 0.7 about its own baseline and keeps its own raise (`baseline·0.7 + shift`), never below half the text's size (TeX's scriptscript, so a tower of powers stays legible and bounded); a variable in a script keeps its italic, as in the MathML. The characters are unchanged. Looked at: e^(−x²), x^(y^z), e^(x²), x_(n²) at three levels each |
| **MEDIUM.** The press handlers on typeset maths ran for every button and ignored the modifiers: Shift+click lost the anchor, a right-click swapped the equation for its source before the menu opened, a drag that began on an equation gave a caret | fixed | `pressOnMaths` (`math.ts`), inline and block: left = caret in the source as before, and a drag from there selects from the near edge (a drag across an equation selects it, typeset); Shift extends to the near edge and a drag goes on extending; the right button selects the equation (the page's own "move the caret to the click" would otherwise land on its edge, which also shows the source) and the menu opens with Cut / Copy live; Ctrl/Cmd is left to the drawing layer. Not what the verifier suggested for Shift: the head goes to the equation's EDGE, not inside its source, so the equation stays typeset and selected. `inlineSpans` is also memoised per source (the decorations ask on every caret move) |

## The drawing layer, audited against the Swift (d1-shapes, 2026-10-03)

Source of truth: `WriteMind/Drawing/*.swift`, `Views/ShapeMenu.swift`, the Drawing / Shape / Mark XCTests.
Evidence: `packages/core/test/shapes.test.ts` (24 tests: the ShapeTests hit tests, head tip and mark artwork
transcribed; the palettes; the rounded rectangle; the port's own restyle / nudge / order / copy rules) and the e2e
scripts in `C:\CLAUDIO\agents\e2e\d1\` (`a1` shapes + palettes + group, `a2` connectors, `a3` edits + paste + picture,
`a4` pen, `a5` handles / DPI / text box; test port 9413; mouse AND synthetic pen; `reg\` has the older tour scripts
t10 t11 t12 t17 t18 re-run against this build, all passing).

| Feature | Status |
|---|---|
| Rounded rectangle painted round; its outline, hit test and arrow landing are round too (the Swift hits it as a square) | fixed |
| Oval painted as a true ellipse (was a 32-gon) | fixed |
| Shapes painted in the item's own frame: outline width scales with the item, label scales with it and wraps (up to six lines) | fixed |
| Connectors painted from `connectorPaths` (the Mac's `InkPaths`): line pulled back so the arrow tip is the point, butt caps, round only for dotted | fixed (a round cap used to poke past the tip) |
| Mouse strokes smoothed through the midpoints of their samples (`strokeCurve`); pressure strokes stay segment by segment | fixed |
| Marks palette = the Mac's: tick, cross, query, star, box, circle, triangle + Arrow, Both Ways, Line (`MARK_MENU_KINDS`) | fixed (listed 4) |
| Shapes palette: the six nodes (+ Text Box, port extra) and **Arrow tool** (the Mac's "Draw arrows between nodes": stays armed, each end that lands on a node is attached) | built |
| Alt-drag from a node draws an attached arrow without the tool | built (a lone Alt release may flash the Windows menu bar; not hardware-checked) |
| Style bar for an arrow (head at either end, solid / dashed / dotted); opens when an arrow is drawn, and from the ◐ handle | built |
| Colour, width, fill of the picked objects (strokes, shapes, text boxes, arrows) | built (port extra: the Mac has only the arrow bar) |
| Group handle reads Group / Ungroup; Ctrl+G widens the selection to the whole group | fixed |
| Move handle (✥); Shift turns in 15 degree steps | built (the Mac has both) |
| A pasted / dropped / inserted picture, and a capture's picture, arrive picked (`DrawingHistory.select`) | built |
| Handles never leave the pane (the Mac clamps them 14pt in); tiny marks and thin strokes spread their handles apart | fixed |
| Canvas follows a change of display scale without a resize (it polls `devicePixelRatio`; a media-query listener stops firing once re-armed) | fixed, checked at 1.5x and 2x by emulation only |
| Arrow-key nudge (1pt, Shift 10pt, one undo per burst); Ctrl+C / Ctrl+X / Ctrl+V of objects, also between notes (a token line on the text clipboard; pictures are one shared media folder); Front / Back / up / down / Copy in the bar | built, port extras (the Mac has none) |
| Snapping, alignment guides, lock, a text box's font size | the Mac has none; not built |
| Handles on hover, before a click | not built (the Mac has it, for the mouse; a pen does not hover here) |
| A selection that includes an arrow can never say Ungroup (an arrow takes no group) | same as the Swift (`testAConnectorTakesNoGroupOfItsOwn`) |

## Reading a picture's words on Windows (c1-ocr, 2026-10-03)

Source of truth: `docs/FEATURES.md` "The words in a picture", `WriteMind/Camera/{TextRecognition,HandwritingMarks,FlowChartReading}.swift`,
`WriteMindTests/{HandwritingMarks,TextRecognition}Tests.swift`. How it is built and what it cannot do: `docs/OCR-WINDOWS.md`.
Evidence: `packages/core/test/handwritingMarks.test.ts` (35, the Swift HandwritingMarksTests transcribed),
`packages/core/test/textRecognition.test.ts` (41: the TextRecognitionTests that need no Vision, with the reader's answer written out by
hand and the ink drawn in code; JSON parsing, word grouping, Japanese joining), `flow.test.ts` (labelled chart, `mayHoldChart`),
`apps/desktop/test/ocr.test.ts` (the helper's contract with a stand-in PowerShell, the queue / cache / cancel, and the REAL engine
reading a fixture), and the e2e scripts in `C:\CLAUDIO\agents\e2e\ocr\` (`aa.mjs`, `camera-chart.mjs` with `makechart.mjs`,
`tablet-chart.mjs`; test port 9414). A shell for the next run: `restart.ps1 [-Video]`.

| Feature | Status |
|---|---|
| A reader on Windows: `Windows.Media.Ocr` through `helpers/wm-ocr.ps1`, no install for the profile's languages; capability = a probe that works (`readerFor`); order Vision, Windows, tesseract | built; `capabilities.ocrEngine` / `japaneseOCR` say which and whether Japanese |
| Aa handle on a picture, Windows: lines in reading order, a dot grid painted out first, put in the note as a cell, picture put away | built, e2e (Arial / Times / Courier / Segoe Print, 4 lines in ~0.1-0.5 s) |
| ...a word with a line through it as `~~struck~~`, a ringed word as `**bold**`, a drawn arrow as `→` (inline between two readings, or on a line of its own), a box at the head of a line as `- [ ]` / `- [x]`, a line of algebra as `` `wl:...` `` | built (ported `HandwritingMarks` + `TextRecognition.compose`), e2e on drawn pictures |
| Japanese: Japanese first when installed and kept only if it found any, per-character words put back together, no spaces between kana/kanji | built, **UNVERIFIED on a real engine** (this Windows has no Japanese OCR; `ocr.test.ts` draws a Japanese picture and reads it on a machine that has it) |
| Raised digits become powers (`x2` to `x^2`) | not on Windows: the engine gives no per-character boxes (`superscripted` is ported and tested for readers that do) |
| Flow-chart labels: a camera or tablet capture that holds a chart (`mayHoldChart`) is read for its words; the words label the nodes ("Read a flow chart: 3 nodes, 3 labelled."); drawn outlines are rubbed out of the picture the reader sees (thick box lines defeat it) | built, e2e on the camera (fake device playing a labelled chart) and on the tablet sheet |
| ...ink written INSIDE a node no longer stops it being named a rectangle (`componentOf` leaves out the label's words) | fixed; the Swift has the same hole (a behaviour change from the Swift, tested in `flow.test.ts`) |
| Reading never blocks the page: PowerShell in the main process, a queue of two, a cache by picture bytes, `ocr:cancel` kills the engine when nobody else wants the picture; a second click on Aa while reading does nothing; leaving the app cancels | built, unit + e2e |
| Reading order by BAND (`sameBand`), and neighbours a line-height and a half apart are one line (the engine splits "pay    rent today" into three lines; the Mac's middle-to-middle sort would too) | built (a port improvement; Vision's lines never needed it) |
| Finding the page by itself | built since (see "The camera, beyond OCR (c2-camera-parity)": `capture/findPage.ts`) |
| Real pen handwriting through this engine | **weaker than Vision** (a printed-text engine); not measurable here without Sean's hand |

## The rendered page: Write in the preview (e1-preview, 2026-10-03)

The Mac's `MarkdownPreview` / `BlockEditor` / `PreviewEditing` (docs/FEATURES.md "Write in the preview"),
ported. **One difference in kind, on purpose:** the Mac's rendered page is a second view (SwiftUI blocks, one
`NSTextView` per open block, the note written back block by block). Here it is the SAME CodeMirror view, document,
selection and undo with every block that is not open *drawn by a widget standing over its characters*
(`packages/editor/src/preview/`). The Mac's rule — "only the block you are in is ever rewritten, the document is
never round-tripped from rich text" — is therefore true by construction (there is no second copy to convert),
and the brackets, seams, + menu, folds, held-cell commands and undo are the markdown side's own rather than
reimplemented. The toggle is `setPreview` (Notebook.tsx: one call); the markdown side is untouched.

Pure rules: `packages/core/src/cells/preview.ts` (layout/`topRow`/`previewSeams`, `seamKey`, `cellKey`, `opened`,
`arming`, `stillHeld`, `keepsNewlines`, which blocks are open: `cellStates`/`touchingRuns`, `returnInBlock`,
`backspaceInEmptyBlock`) and `markdown/sourceStyle.ts` (`MarkdownSourceStyle.runs` + the inline model the page
draws from). Tests (`preview.test.ts` 83, `sourceStyle.test.ts` 16) are transcribed from `PreviewEditingTests`,
`PreviewSeamTests`, `PreviewLayoutTests`, `ArmedBarTests` (the choice test), `CellSelectionTests` (held-cell keys),
`CellCommandTests` (`stillHeld`) and `MarkdownSourceStyleTests`. Not transcribed, because they test AppKit rather
than a rule: the `NSCursor` hand-back tests, `CodeCellHeightTests` (font metrics), `CellBracketTests` hit-testing of
the SwiftUI bracket column (the port's gutter has its own, already tested).

| Feature | Status | Evidence (`C:\CLAUDIO\agents\e2e\preview\`, port 9411; `run-all.mjs` runs them all) |
|---|---|---|
| Blocks drawn: headings (the 6-rung ladder, Author italic), real bullets / dashes / numbers, nested items, to-do boxes, quotes, coloured code, rules, `<u>` / `<span style>` / strike / code, links, maths (inline `wl:` and `wl` fences, the maths lane's MathML), pictures (`![alt](x.png)` from `.drawings/media`, alt words when missing) | works | `gallery.mjs`, `misc.mjs`, `ticks.mjs`, screenshots `shots\pv-*.png` (dark and light) |
| Click a block: opens in place as styled markdown, caret where the word was clicked (every drawn run knows its source offset); a press in the margin beside a block counts | works | `open.mjs` |
| Return starts the next block; in a list / to-do / numbered / quote it carries on, an empty item ends the list; code takes a plain newline; one undo step | works | `edit.mjs` |
| Backspace in an empty block removes it (and the blank lines); at the end of the note too | works | `edit.mjs` |
| Up / Down walk block, bar, block (and arm the bar above / under the note); Shift+Up/Down extend a block at a time; Page Up/Down | works (the editor's own vertical motion skips drawn blocks, so these are the page's own) | `bars.mjs`, `nav.mjs` |
| The line between two blocks arms; a character / Return opens a block there; the + chooses the kind; Escape / Backspace take the bar back writing nothing | works | `bars.mjs` |
| Whole bar works on the open block: bold, italic, underline, strike, T (span style), the heading ladder, list, quote, code block, indent / outdent, maths palette, split / merge cell | works | `format.mjs`, `maths.mjs` |
| A format command at a bar (the Mac's `atArmedBar`): the ones that make a kind of block (Ctrl+1…7, List, Quote, Code Block) name it for the next character; the rest (bold, indent, maths…) do nothing. Rendered page only — the markdown side is as it was | works | `bars.mjs` |
| To-do box is a control: one character written, nothing opens | works | `ticks.mjs` |
| Cell brackets, drag-down, shift / ctrl-click, move held, duplicate, delete, cut / copy / paste (cells MIME), typing over one or several held cells, Return over held does nothing, Escape lets go | works | `held.mjs`, `nav.mjs` |
| Folding (double-click a section bracket, the ⋯ marker) | works | `misc.mjs` |
| Toggle back and forth: same words, same caret, the cell at the top of the window is put back at the top | works (4 round trips on an 80-cell note) | `toggle.mjs` |
| Only the open block is rewritten | 60 random edits: never more than two blocks touched, every untouched block byte for byte | `only.mjs` |
| 600-cell note: keystroke on the rendered page ~6 ms median (markdown side ~2 ms); caret between blocks ~4 ms | works | `perf.mjs` |
| 250 / 400-gesture random runs (clicks, brackets, gaps, keys, typing, toggles, folds, undo) | no uncaught error | `fuzz.mjs [steps] [seed]` |

Changes outside the lane's new files, all small: `parser.ts` (a block now ends where its own last line ends — a
list continued by Return used to overlap the new item beside it, so the page opened both; the Swift parser has the
same latent overlap; all 90 parser tests unchanged), `brackets.ts` (the caret's bracket is lit at the very end of
its cell, the Mac's `block(containing:)`; picks send `setHolding`), `keys.ts` (cell commands that leave cells
selected send `setHolding`; `nameKind` wraps the four commands that make a kind of block), `extras.ts` (`linkClicks` provides `followLink` and follows on Alt-click only — a plain
click on a drawn link goes, a plain click on a link's words in an open block puts the caret in them),
`seams.ts` (the seam layer was left as tall as the longest note it had drawn, which held the scroll area open
under a shorter one — reset when it has nothing to draw), `notebook.ts` (`atBar`, `applyEdit` declines at a bar
on the rendered page).

Differences from the Mac, so nobody "fixes" them: Escape does not close an open block (there is always a caret on
this page; it takes a bar back and lets go of held cells); Backspace at the start of a non-empty block joins it to
the block above (the editor's own; the Mac does nothing); Ctrl+A selects the note and lights every block (the Mac
selects the open block's text); an open code block shows its fence lines faint (the Mac shows only the code);
cells that touch (a list and the new empty item Return just made) open together; the new empty block shows a grey
hint (Ctrl+1 / Ctrl+Shift+L are this port's keys); heading sizes are the markdown side's ladder so nothing changes
size as a block opens.

Not verified: a real mouse (all clicks are CDP `Input.dispatchMouseEvent`), IME composition inside an open block,
and drag-selecting across drawn blocks by hand (a press on a drawn block opens it, so a drag begins in the open
block).

## One Undo, and the drawing layer toured end to end (d2-undo-tour, 2026-10-03)

**What the Mac does.** Cmd-Z is routed by MODE (`AppState.drawingOwnsUndo`: the drawing's while the pen is up, something
on the layer is picked, a shape is armed or the arrow tool is on; else the text's through the responder chain) and
`store.undoDrawing` / `redoDrawing` are the drawing's own pair (Edit ▸ Undo Drawing, Cmd-Opt-Z). It has no combined
history. The port did something else (take back whichever side was edited last, keep going down that side until empty),
which undid the wrong thing for interleaved edits. **Now: one timeline per note.**

| Feature | Status | Evidence |
|---|---|---|
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z and Edit ▸ Undo / Redo take back EXACTLY the most recent edit, words or drawing; Redo brings back the one undone last | built | `apps/desktop/test/undoTimeline.test.ts` (162 tests: 150 seeded random interleavings of 300 operations, 5 of 3000, against an oracle that checks the pair (words, drawing) after every step), `agents/e2e/d2/u1.mjs` (real keys, real mouse) |
| How: every edit takes a stamp from the note's `EditClock` (`editTimeline.ts`). CodeMirror's history stays the engine for words; a state field mirrors its undo/redo stacks with stamps (it reads the change in `undoDepth` to tell a new group from a joined one from an undo); `DrawingHistory` entries carry stamps. Undo = highest stamp of the two tops, Redo = lowest of the two undone tops | built | as above |
| Typing that follows a drawing edit starts a group of its own (`isolateHistory("before")` added by a transaction extender), so a group never spans a drawing edit | built | test "typing is grouped as CodeMirror groups it, but a drawing edit ends the group" |
| A new edit on either side ends every Redo on both sides (a redo is valid only if it was undone after the newest new edit) | built | tests "a new edit on either side ends every redo" |
| Words + drawing as ONE edit when the app does both: a picture read with Aa (words into the note, picture put away) is one Ctrl+Z (`clock.together()`) | built | test, `agents/e2e/d2/u3.mjs` with the real Windows OCR engine |
| A captured page / camera or tablet capture (picture + strokes + chart) is ONE edit; a text box's typing session is one; a burst of nudges / colour changes is one (and a word edit ends the burst) | works | `editDrawing`, `Canvas.burst`; `t6.mjs` |
| Per note: each open note keeps its own clock, its own drawing history and (behind its tab) its own editor state, so switching tabs no longer wipes Ctrl+Z, and an edit in one note never touches another's undo / redo. A closed note forgets; a renamed one keeps its drawing history | built | tests "each note has its own timeline", `u2.mjs` |
| Edit ▸ Undo Drawing / Redo Drawing keep working as the drawing's own pair (and the drawing edit they undo keeps its place in the timeline) | works | tests, `u4.mjs` (real menu items) |
| An Undo / Redo of something out of sight scrolls it into view | built | `u5.mjs` |
| An undone group that had no net effect (a letter typed and taken back) is stepped over, not counted as a dead Ctrl+Z | built | random tests |
| Ctrl+Z / Ctrl+Y outside a text field are always swallowed (nothing to undo = nothing happens, never the browser's contenteditable undo) | built | `useUndo.ts` |
| Not unified: the tablet SHEET's own strokes (Ctrl+Z while the pen is over the pane still asks `tabletUndo` first), and a text field's own native undo (a label, a text box being typed in) | by design | |

**Data-loss fixes found on the way.** (1) A drawing edit made in the last half second before a tab switch was lost (the
effect that holds the save timer let go of it): `openNote` now writes the drawing first. (2) Closing the window inside the
500 ms debounce lost the last edit of the words AND the drawing: a `beforeunload` handler hands both writes to the main
process (`u6.mjs`).

### The tour (every drawing bullet of FEATURES.md, mouse and synthetic pen)

Scripts in `C:\CLAUDIO\agents\e2e\d2\` (port 9418; a1-a5 are d1's, rerun on a fresh note): pen strokes (mouse in pen mode;
pen with pressure), erase sweeps, marquee, shift-extend, move / scale / turn, nudge, colour, group / ungroup, delete,
duplicate, flow shapes, labels, Alt-drag and tool arrows, a text box, marks, pictures (paste, drop, Insert ▸ Image through
the E2E-pickable dialog, crop, Aa), scrolling, window and pane resizing, reload from the sidecar, 2000 strokes / 50k points.
`t6.mjs` checks, by the canvas pixels, that ONE Ctrl+Z puts the picture back exactly and Ctrl+Shift+Z redoes it exactly for
each of ~20 operations; `t4`/`t4b` that a reload gives a pixel-identical page.

Found and FIXED at the root:

| Finding | Fix |
|---|---|
| **Quadratic geometry.** `applyMatrix` recomputed the item's centre (a pass over all its points) for every point it moved, so outlining, hit testing or painting a stroke cost n² (a 500-point stroke: a quarter of a million allocations per paint; erasing across 2000 strokes ran at 53 ms a move, dragging them all at 55 ms a frame) | `matrixOf(item, size)` works the centre out once (`geometry.ts`, used by `outline`, `frameCorners`, `hitTest`, `paint`, the PDF export). Erase 53 → 16.7 ms (vsync), drag-all 55 → 23 ms, 100 strokes x 500 points all smooth. `unionRect` no longer spreads (a 300k-point stroke overflowed `Math.min(...)`). `geometryScale.test.ts` |
| **The mouse wheel did nothing with the pen down** (the layer takes every pointer event and the page is not inside it) | the layer hands wheel / touchpad scroll to the page's scroller |
| **No rubber band for an arrow being drawn** (the Mac draws a dashed line) | dashed preview in the pen colour |
| Marquee / ghost shape repainted every object on the page on every move | they are painted on the overlay layer now: marquee over 2000 dense strokes 45 → 16.7 ms a frame |
| **Pen strokes with pressure were polylines** (facets at fast writing) | drawn as the mouse stroke is (a curve through the midpoints, `strokePressure`), with the width following the pressure piece by piece, live and committed alike |
| The Insert ▸ Image dialog could not be driven by the E2E harness | `media:choose` goes through `askOpen` like the other dialogs |
| A picture DROPPED on the page went under the caret like a paste, wherever it was let go | it is centred where it was let go (kept inside the pane); a drop that carries no place on the page still goes under the caret |
| Edit ▸ Undo in the menu, with a label or a text box being typed in, undid the document | the menu's Undo / Redo go to the field's own undo while a field has the focus (the keys already did) |

Final rerun (fresh instance, 2026-10-03 evening): u1-u6, t1-t9, a1-a5 and perf.mjs all PASS (2000 strokes / 50k points: scroll,
pen move, undo / redo and drag-all at the 16.7 ms vsync, 116 ms to load). Known flake, not a defect found: `t6.mjs`'s first
operation (the mouse pen stroke) failed its pixel comparison on 2 of ~8 runs while other agents loaded the machine (the redone
stroke differed from the one grabbed 350 ms after drawing it by ~235 anti-aliased pixels) and passed 20 of 20 in isolated loops
that also waited 1.5 s and found zero drift; read it as a timing artefact of a busy machine until it fails on a quiet one.

Decisions kept (Mac parity, not bugs): objects are stored as fractions of the pane (x of its width, y of its height,
counted from the top of the note), so a window or divider resize stretches ink with the pane, as on the Mac ("so a drawing
keeps its place when the window is resized"); they scroll with the words, and text inserted above does not move them (the
layer floats).
Still unbuilt: outline / handles on hover (Mac, mouse), snapping, a sweep of orphaned files in `.drawings/media` (every paste
and crop adds one; nothing removes them — only sidecars of the notes root are known to the app, and projects can add roots,
so a naive sweep could delete a picture another project still uses).

## The camera, beyond OCR (c2-camera-parity, 2026-10-03)

Source of truth: `docs/FEATURES.md` ("A notebook page, off the camera", "A section of the page", "Any camera the Mac can see"),
`WriteMind/Camera/{NotebookCapture,InkVector,CameraZoom,CameraController}.swift`, `WriteMind/Views/{CameraPane,VideoMenu}.swift`,
`WriteMindTests/{NotebookCapture,InkVector,CameraZoom,CameraZoomBox}Tests.swift`.
Evidence: `packages/core/test/{findPage,inkVector,cameraZoom,capture}.test.ts`, `apps/desktop/test/camera.test.ts`, and the e2e scripts in
`C:\CLAUDIO\agents\e2e\camera\` (port 9419; `node runall.mjs` restarts the instance on each video and runs all of them: page-find 21,
devices 42, chrome 22, section 24, text 11, export 7, pale 2, nocam 5 checks, all PASS on 2026-10-03; build first with `restart.ps1` or
`build-locked.ps1`). The videos are made by `makevideos.mjs` (COLOUR .y4m, 1280x720: a crooked dotted page with handwriting on a wood desk
with a mug and a pen, the same with a sketched flow chart, a page of printed type, a page nearly filling the frame, a pale page on a pale
desk) and `truth.json` holds where the page's corners really are; `restart.ps1 -Video <name>` starts the instance with Chromium's fake
capture device playing one; `y4mpng.mjs` turns a frame into a PNG to look at.

| Feature | Status | Evidence |
|---|---|---|
| **Finding the page by itself** (`capture/findPage.ts`, plain arrays, every platform; the Mac keeps Vision): the frame shrunk (the dot grid melts into the paper's tone), 16 thresholds plus Otsu, opening, hole fill, the largest page-shaped blob, its convex hull cut to the four enclosing edges, scored by fill and edge contrast; a Hough line vote with edge support when the desk is as pale as the paper; either answer refined along the real edge at 480 px with a robust line fit | built; 20-60 ms for 1280x720 | `findPage.test.ts` (14, scenes in `scene.ts`: tilted, rolled to landscape, shadow gradient with a pen across the edge, clutter, off the frame, pale on pale by a thin shadow line, nothing, noise, the page IS the frame, 40 random views all within 1.5% of the diagonal, 1-2 px on a large clean view, and a vignette / glare / bright sheet beside the page / heavy noise / out-of-focus lens); e2e: corners within 0.3% of the diagonal on `page-desk` (`page-find.mjs`), a pale desk 0.8% (`pale.mjs`) |
| ...feeds **Straighten**: turning it on puts the four corners ON the page (drag any of them; **Find page** looks again; turning the picture looks again) | built | `page-find.mjs` |
| ...and every capture finds and squares the page by itself with Straighten off (the Mac's `pageQuad`); a page that fills the frame (over 96%) counts as not found | built | `page-find.mjs`, `section.mjs` (a chart on a crooked page is squared up, then read as 3 nodes and 2 arrows) |
| **No page found**: the Mac refuses a whole-page capture (`.page` with no quad and no box returns nil); here it takes the whole picture and the line under the viewfinder says "No page found, so it took the whole picture." (a document camera looking straight down at a page that fills the frame would otherwise never work) | **different on purpose** | |
| Page shape: learned from the first page that was FOUND (never from the frame), kept across launches (`notebookPageShape`), within 12% resampled to exactly it, further off re-learns; short side 1200; the page's edge trimmed (`EDGE_INSET`) | built | `capture.test.ts`, `page-find.mjs` (1.42 remembered: 1200x1704 exactly; 1.1 remembered: measured afresh, 1.414) |
| The writing is lifted off the WHOLE normalised page and the box only picks which of it comes in (a stroke across a small box is not "the page edge"); `inkBox(within:)` ported | built (it was lifted off the box alone) | `capture.test.ts` (`testOnlyTheWritingInsideAWindowCounts`) |
| ...a box over a drawing that is joined up across the page takes the part of it inside the box; a missed printed dot far from the writing no longer stretches the picture to the page's size (`writingBox`, beyond the Swift) | built | `capture.test.ts` (5) |
| **Just the writing, traced into outlines** (`InkVector`): boundary loops of the ink mask, Douglas-Peucker at 0.75 px, filled even-odd; brought in as an **SVG** (the Mac writes a PDF) in the pen's colour, the size of the writing; stays vector in Export > PDF; crops to a PNG; Aa reads it as the picture it draws (flattened on white) | built | `inkVector.test.ts` (8, the Swift tests); `export.mjs` (the PDF has 3225 path segments and no image object), `text.mjs` (Aa on the SVG) |
| **The whole page** as a JPEG of the squared, trimmed page; **the raw picture** (the frame, or the box's part of it, nothing squared, shape not learned) | built: three buttons Writing / Page / Raw, and Image / Writing / Text under a box | `page-find.mjs`, `section.mjs` |
| FEATURES.md's *chevron* that picks the mode | not built as a chevron: the Mac's code no longer has it either (the modes are reached through the three choices under a box); the port shows all three as buttons | |
| The dashed box: a drag is the box (everything outside dimmed, edge dashed), **one click clears it, a double click takes the whole picture** (the picture, not the letterbox bars; zoom allowed for), Image / Writing / **Text** (reads the box into the note as words, only when a reader exists) under it | built | `cameraZoom.test.ts` (`SectionBoxGestureTests`), `section.mjs`, `text.mjs` |
| **Resize by Square** (`CameraZoom`): drag a box, the pane shows that much; zooming twice composes; boxes drawn on the zoomed picture land on the right part of the real one; Original Size; remembered | built (Zoom / Original size in the pane corner, and Turn Left / Turn Right / Original Size / Resize by Square in the video menu) | `cameraZoom.test.ts` (21: `CameraZoomTests` + `CameraZoomBoxTests`), `section.mjs` |
| Quarter-turn buttons in the pane's corner (and the video menu), remembered (`cameraRotation`), the turned picture fits the pane, **captures and the page finder see the picture as it is shown** | built | `cameraZoom.test.ts` (`quarterTurned`), `devices.mjs`, `section.mjs` (a raw capture of a turned picture is 720x1280) |
| **Input Devices**: every camera, a check on the one in use (the pane reports the device it really opened), the Tablet beside them, Turn Camera Off, Refresh Device List; the sidebar's video chevron lists the same | built | `devices.mjs` (the menu is read through `e2eMenu`) |
| The source is **remembered across launches** (a camera's id, the tablet, or off); nothing remembered opens the system's default camera (the Mac waits to be told; Windows has no permission prompt to avoid) | built | `devices.mjs` (relaunch: off stays off with nothing opened; the picked camera comes back and is ticked) |
| **Turn Camera Off** stops every track and the pane stays up with "No camera selected" and the list to pick from (it used to hide the pane) | built | `devices.mjs` |
| **Hot-plug**: a track that ends (camera pulled out) or a device that disappears from the list turns the camera off ("The camera was unplugged"); a camera that appears when the pane was waiting starts it | built; **simulated** (`__wmCamera.simulateUnplug()` and a `devicechange` event on the fake device): no real USB camera was unplugged | `devices.mjs` |
| **Errors said clearly**, as the Mac's four stand-ins: "Camera access is off" (Windows privacy switch named: Settings > Privacy > Camera), "The camera is busy", "No camera found", "That camera is no longer available", "Camera unavailable" plus the engine's words, with the camera list and Refresh on the placeholder | built; each error **injected** by overriding `getUserMedia` (the real Windows privacy switch was not touched) | `devices.mjs`, `camera.test.ts` |
| Video switch on the sidebar bar with the video menu on its chevron (the Mac's header); notes-pane switch: "Back to Side by Side" in the video corner when the notes are away, and "Video Only (Hide Notes Pane)" in the video menu. It is the WINDOW's layout; the display is never put in full screen | built | `chrome.mjs` |
| **No stream left running**: every track stopped and `srcObject` cleared when the pane is put away, the source changes (5 camera/tablet round trips: one stream, never two), the camera is turned off or unplugged. Whole-instance CPU with the 1280x720 fake camera shown: about 28% of one core; pane put away, or on the tablet: 0.3% | verified | `devices.mjs`, `cpu.mjs` (with `cpu.ps1`) |
| The camera is asked for 1920x1080 at 30 fps as an *ideal* (the Mac's `.high`; a bare `video: true` is often 640x480, too coarse for handwriting) | built; **not verified on a real camera** | |
| Flow charts on a camera page: read at 1200 px (was 800) from a halving down-scale (a pen line broke into dashes at 800 and one box of three was refused), and the ink-only reading wins when the words made it worse | fixed | `section.mjs` |
| `capabilities.findsThePage` is true everywhere (it was false everywhere) | CHANGED, with its test | `capabilities.test.ts` |

**Not verified / needs Sean's hands**: a real webcam or document camera (focus, exposure, lens distortion, motion blur, a hand on the
page, glossy glare, a page with a coloured cover or a spiral): the finder was built and measured on synthetic projected scenes and the
fake device only. A real camera unplugged and plugged back in; the real Windows camera privacy switch; the 1080p ideal constraint on his
camera; whether the finder picks the notebook and not something else bright in his room (the corners can always be dragged with
Straighten, or take Raw).

## The editor, polished (e2-editor-polish, 2026-10-03)

Source of truth: `docs/FEATURES.md`, `WriteMind/Views/TabBar.swift`, `WriteMind/Notes/{NoteStore,Project,MarkdownLinking}.swift`,
`WriteMind/Editor/{MarkerDeletion,CodeTyping,MarkdownTextView}.swift`. Evidence: unit tests `packages/core/test/{find,sessionBuffers,markerDeletion,
codeTyping,linking,linkTarget,notes,sourceStyle}.test.ts`, `apps/desktop/test/{findKeys,menu,notes,chromeFixes}.test.ts`, and the e2e scripts in
`C:\CLAUDIO\agents\e2e\e2\` (port 9417, instance e2-editor-polish; `node run-all.mjs` runs all nine: markers 23, list 22, tabs 34, links 47, hotexit 17,
code 24, edit 27, markerdel 13, find 32 checks, all PASS on 2026-10-03; build first with `build-locked.ps1`). The repo suites `cells` (61 checks) and
`editor` 01-04, 06-08 still pass against the same build.

| Item | Mac | Here | Status |
|---|---|---|---|
| **Markers vs Preview** | two switches: `showMarkers` (View > Hide/Show Markdown Markers, Option-Cmd-M) and `mode` (Markdown Preview/Editor, Shift-Cmd-P) | `rendered.ts`: `markersField` and `renderedField`; hiding the markers reads the markdown as the finished page (the caret's line keeps its marks so they can be typed), the file is untouched; the preview toggle leaves the markers alone; both labels flip independently; Ctrl+Alt+M; remembered across a reload | works (`t-markers`) |
| ...deleting over hidden markers | `MarkerDeletion`: a delete, a typed character or a paste over a selection takes whole markers and both halves of a pair | `core/markdown/markerDeletion.ts` + `editor/markerDeletion.ts`, only while the marks are put away (hidden, or the rendered page); shown, half a `**` is a fair thing to delete | works (`markerDeletion.test.ts`, `t-markerdel`) |
| **Format > List and its key** | the chevron's style | the menu item, the toolbar button and Ctrl+Shift+L all write the chevron's style (dots, dashes, numbers, to-dos); the key was hard-coded to dots; pressing it again takes the list off; a list of another style is converted; the choice is remembered | fixed (`t-list`) |
| **Tab title lag** | the tab follows the heading as it is typed | the tab says the new heading ~250 ms after the keystroke, before the autosave; with no heading it falls back to the file name; a stale tree read does not put the old title back | fixed (`t-tabs`) |
| **Tabs** (`TabBar.swift`, `NoteStore.closeTab / closeOtherTabs / reload`) | middle click closes, wheel walks the row, the list at the right end names every open note, Close Other Tabs; NO drag to reorder (the Mac has none) | the same; the tab that takes a closed tab's place is the NEXT one (the last falls to the one before); the overflow list scrolls the chosen tab into view and ticks the front one; a note deleted or trashed outside the app loses its tab (the one in front too: another note comes forward, no error bar); Rename keeps ONE tab with the new name and later typing lands in the renamed file; an external rename drops the tab and the app stays up | works (`t-tabs`) |
| **Links** | `/link`, banner, Link Here, anchors in the target, Alt-click / click to follow | the Mac's two banner lines, Link Here off in the source note and on elsewhere, the banner survives opening notes in other sections, Cancel / Escape / `docs/link` (not a trigger); a heading target writes nothing, a highlighted run becomes `<mark id="wm-...">`, a plain block gets `<a id="wm-..."></a>`; the new link is selected; the source comes back to the front; a plain click follows on the rendered page, Alt-click on the markdown and inside an open block; landing selects the marked run; a closed section holding the target is opened (a link to its HEADING leaves it closed); after the SOURCE is renamed links work, after the TARGET is moved they still resolve, a link to a note that was renamed goes nowhere (as on the Mac) | works (`t-links`, 47 checks) |
| **Hot exit** (`ProjectSession.unsavedBuffers`) | text typed and not yet autosaved is kept in the session and comes back | the session file carries each dirty note's text and the file it was based on, updated as you type; `taskkill /F /T` mid-edit and relaunch: the same tabs, the same front tab, the text, the caret; the file is written; once saved the session stops carrying it; a file changed by another writer meanwhile is left alone and the text is kept as `name (unsaved copy).md`; a note created and typed into at once comes back | works (`t-hotexit`, `sessionBuffers.test.ts`) |
| **Code cells** (`CodeTyping`) | pairs, step over the closer, wrap a selection, Backspace between a pair, Tab / Shift-Tab by four spaces on every selected line, none of it in prose | `core/markdown/codeTyping.ts` + `editor/codeTyping.ts` (on the rendered page Tab is a real tab) | works (`codeTyping.test.ts`, `t-code`) |
| **Indentation, expand selection, move a section, heading ladder, every occurrence, undo of a format key** | per FEATURES.md | real keys on the real app: Ctrl+] / Ctrl+[ (a quote gains a level, a paragraph four spaces), Backspace in indentation takes a level, Tab on a selection; Ctrl+. word, cell, section, note; Ctrl+Up/Down moves heading and body; Ctrl+1..7; the Author line italic and bigger; Alt+Shift+D edits all together; Ctrl+B then Ctrl+Z | works (`t-edit`) |
| **Spell check conventions** (`MarkdownTextView.makeNSView`) | continuous spell check ON; auto-correct, smart quotes, smart dashes, text replacement OFF | `conventions.ts`: spellcheck on, `autocorrect`/`autocapitalize` off, a fenced line and a code span are not checked; straight quotes and `--` stay as typed | works (`t-edit`) |
| **Pasting** (the Mac's view is plain text, `isRichText = false`) | the plain words, never markup; lines into a list are just lines; a URL is the URL | `paste.ts`: a clipboard with both gives `text/plain`; one that only has `text/html` arrives as words (a line to a block, a dash to an item); pictures are the drawing layer's | works (`t-edit`) |
| **A file let go on the window** | nothing opens | `dropGuard.ts`: a dragged file nothing takes is refused over the tab row, sidebar, footer and editor (Chromium would otherwise replace the app with the file); a picture on the page is still taken by the layer | works (`t-edit`) |
| **Find in the note** (`usesFindBar = true`) | Cmd-F bar, Cmd-G / Shift-Cmd-G, Cmd-E, Option-Cmd-F replace | `FindBar.tsx`, `editor/find.ts`, `core/text/find.ts`: Edit > Find submenu; Ctrl+F, Ctrl+H (with Replace), F3 / Shift+F3, Ctrl+E; every match lit, the current one more, "2 of 4" / "Not found", wrap-around, Match case, Whole words, Replace, Replace All (one Ctrl+Z takes it back), Esc closes and gives the note back its keyboard; on the rendered page going to a match selects it (opens its block) | built (`find.test.ts`, `findKeys.test.ts`, `t-find`) |

Not verified / open: `e2e/suites/editor/05-sidebar-drag.mjs` (repo suite) FAILS against the current build for a reason outside this lane: sections now
start open (`Sidebar.tsx`, the Mac's `expanded` on appear), so the script's `order()` also lists notes inside an open section and "it left the root
list" and the checks after it read the wrong rows (the files do move; the script has to count only root rows). Hot exit was checked by `taskkill /F /T`
of the instance, not by a power cut or a Windows shutdown. Spell check was checked as the attributes Chromium needs (`spellcheck` on the content, off on
code), not as red wavy lines on a screenshot (an offscreen Chromium has no dictionary to show). A real IME, a real clipboard (the checks dispatch a
`ClipboardEvent` with a DataTransfer) and a file dragged from Explorer were not tried.
