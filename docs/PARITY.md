# Parity checklist (Windows pass, 2026-10-03)

Status: works / fixed / missing / untested. Evidence scripts live in
`C:\CLAUDIO\e2e\tour\` (port 9888; `lib.mjs` has the helpers; real CDP input).

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
| Rounded rectangle is drawn square | missing (Swift rounds with radius 0.2 of the short side) | Canvas paint |
| Marks (tick, cross, star, query), picture paste | works | t18.mjs |
| Text boxes (card, wrap, live growth, readable ink, re-edit by double-click); `text` added to NODE_KINDS so Shapes menu offers it | fixed (was missing); core `textBox.ts` + 10 transcribed tests | t17.mjs |
| HiDPI 1.5x: canvas crisp, handles aligned | works | t16.mjs |

## Next steps, in order

1. Rounded-rectangle outline in `Canvas.tsx` `paint` (`roundRect`, radius 0.2 * min side); also hit-test unchanged.
2. Run `C:\CLAUDIO\e2e\cells.mjs` and `pen.mjs` (they use ports 9333/9555 and `~/Documents/WriteMindCross`; not run against this build). `old/cells.mjs` (port 9888) passed.
3. Untested this pass: links (`/link` flow and Alt-click; old/links.mjs failed only on its fixture notes), tabs (middle click, wheel, overflow list), session restore, Export PDF, camera/capture/OCR, maths palette, crop, new picture should arrive selected, window resize (strokes stretch with the pane, same as Mac), rendered mode shows fence lines.
4. Add a unit test for the inline regexes (they live in the editor package; no DOM needed) and for seam Enter/Escape.
5. Selection box colour for held cells only highlights text width (Mac highlights the cell); consider a line decoration.

## For chrome agent

- Tab title lags: the tab/sidebar title shows "Untitled" while the note's first heading has changed, until reload.
- Marks menu lists only 4 marks; Mac has boxes, circles, triangles, arrows, lines too.
- "Hold these together (Ctrl+G)" handle never says "Ungroup" once grouped (Canvas.tsx, mine, not yet done).
- FEATURES.md says indent is two spaces; the code and Swift tests use four.
- A half-applied TopBar change once crashed the renderer (`collapsed.includes` of undefined) when App.tsx did not yet pass the prop.

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

### Pad mode: the whole tablet IS the sheet (port-only)

The driver, not the app, maps a Wacom in Pen mode: the whole tablet to the whole
screen (absolute). WriteMind cannot change that, so a small sheet pane only gets
the small part of the tablet that lies over it and the pen cursor roams the
whole screen. **Pad mode works with that mapping**: the window goes full screen on
its display and shows only the sheet, so the whole tablet maps 1:1 (proportionally)
onto it.

| Piece | How |
|---|---|
| Enter | **Pad** button on the sheet pane, **Input Devices ▸ Tablet Pad (Full Screen)**, **Ctrl+Alt+T** (Ctrl+Cmd+T on a Mac build) |
| Window | main process: `setFullScreen` on the display the window is on; bounds / maximised / already-fullscreen / menu-bar state remembered and put back (`main/pad.ts` decides, `main.ts` does) |
| Exit | **Esc**, the strip's **Exit Pad**, the same shortcut/menu item, losing full screen any other way (Win+Down, View ▸ Toggle Full Screen), or a page reload. Pen side-button double-click: not built |
| Strip | slim, auto-hiding, 48 px targets: Send Writing, Send Page, Box, Erase, Undo, Clear, Clear after, 6 colours, width −/+, the pen chip, Exit Pad. Comes down after the pen hovers ~0.4 s at the top edge, stays while over it, goes away by itself and never while a stroke is being written (so writing right up to the edge is not covered) |
| Captures | the same `takeFromSheet` as the pane (`tabletCapture.ts`): stroke items with pressure, Page picture, Box section, flow-chart reader, learned page shape; sheet clears after a send when "Clear after" is on; one Undo on the sheet brings it back; a toast says what was sent. Measured against the notes pane as it was on entry |
| Shared sheet | pane and pad show ONE sheet. Points are fractions 0…1 of it; widths are in reference units (1000 across), so entering or leaving full screen, resizing or 150% DPI never distorts a stroke. The sheet has the **screen's shape**; a pane of another shape letterboxes it (never stretches) |
| Pen | pen cursor (`penCursor.ts`) works as in the pane (the strip counts as chrome); palm rejection and pointer capture as the pane's (a stroke leaving the window stops at the sheet's edge); Ctrl+Z always belongs to the sheet while the pad is up; touch-action none |
| Display / DPI | the display the window is on (multi-monitor), canvas in device pixels and re-measured when the display scale changes (150% checked) |
| Menu bar | hidden in the pad and restored after (re-applied a beat after Electron's own full-screen bookkeeping). Accelerators are shown-not-registered, so hiding it cannot break them |

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

E2E: `C:\CLAUDIO\e2e\tablet\` (`start.ps1`, `flow.mjs`, `cursor.mjs`,
`camera-flow-t.mjs`, `camera-warp-t.mjs`, `pen-t.mjs`, `cells-t.mjs`; port 9999).

Pad mode E2E: `C:\CLAUDIO\e2e\pad\` (`start.ps1`, `pad1.mjs`, `pad2.mjs`; port 9998, notes
`C:\CLAUDIO\pad-notes`). The window half is read from the main process (`wm.e2eWindow`,
only under WRITEMIND_E2E). The older tablet scripts are copied to `pad\reg\` for port 9998
(run `prep.mjs` first: it gives the sheet a tall shape so their pane coordinates still land).

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
E2E: `C:\CLAUDIO\e2e\buttons\` (`start.ps1`, `b1.mjs` notes page + keys,
`b2.mjs` sheet; `reg/` holds the tablet/cells scripts ported to port 9997).
