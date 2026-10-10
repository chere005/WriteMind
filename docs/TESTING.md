# Testing WriteMind (the TypeScript port)

Three layers, cheapest first:

| Layer | Command | What it checks |
|---|---|---|
| Types | `npm run typecheck` | `tsc -b` over `packages/*` and `tsc -p apps/desktop` |
| Unit | `npm test` | vitest over `packages/*/test` and `apps/*/test`: the model, the rules transcribed from the Swift XCTests, the shell's own rules |
| End to end | `npm run e2e` | the REAL built app, driven over the Chrome DevTools Protocol with real mouse / key events and a synthetic pen: `e2e/` |

CI (`.github/workflows/ci.yml`, windows-latest, Node 24) runs typecheck, unit tests and the build as a gate, and the
end-to-end suites as a second job that may fail (`continue-on-error`) and always uploads its report and screenshots as
the `e2e-report` artifact. On pushes to main its mac-package job runs the same unit tests on macos-15, and they must
pass there too: a test about Windows paths builds them with `path.win32` or picks this system's own, never assumes it.

## Running the end-to-end suites

```
npm run build                          the suites test apps/desktop/out, so build first
npm run e2e                            every suite (about 10 minutes)
npm run e2e -- --suite cells           one suite (comma list, or repeat the flag)
npm run e2e -- --suite cells/03-seams  one script of a suite
npm run e2e:list                       what there is
npm run e2e -- --snapshot              test a COPY of the build taken now (use this when anyone else may rebuild)
npm run e2e -- --port 9416             use exactly this debugging port (default: any free one)
npm run e2e -- --file some/script.mjs  one script from anywhere, on a fresh instance
npm run e2e -- --desktop               also the desktop suites (a suite that injects OS input and moves the real mouse)
npm run e2e -- --keep --no-retry --fail-fast --repeat 3 --grep seams --script-timeout 90 --suite-timeout 600
```

Exit code 1 when any check failed, a script crashed, timed out or reported nothing, or an electron process had to be
swept. Results go to `e2e/.results/<timestamp>/` (git-ignored): `report.txt` (read this), `report.json`, `report.md`
(also appended to `$GITHUB_STEP_SUMMARY` in CI), `logs/<suite>/<script>.log` (everything the script printed) and
`shots/` (screenshots; **look at them**). `e2e/.results/latest.*` is the last run.

### Writing a script that draws, or presses a command key

* The page ink layer (`.wm-canvas`) belongs to the RENDERED page (2.17.0): a script that draws starts with
  `freshNote({ rendered: true })` (or `setRendered(true)` after a reload).
* The command key of the machine is `MOD` (⌘ on a Mac, Ctrl elsewhere); a Mac editing chord (⌘A / C / X / V) is carried
  by the key event's `commands`, as AppKit sends it. Redo is Ctrl+Shift+Z on every platform (Ctrl+Y is not a Mac key).

### What the runner does for you

For each suite it starts an isolated, offscreen instance of the built app and runs the suite's scripts in name order
against it, each as its own node process:

* temp **profile** (`--user-data-dir`) and temp **notes folder** (`WRITEMIND_NOTES`) under the OS temp dir, so nothing
  of the person's own WriteMind or notes is ever touched; both are deleted afterwards (`--keep` keeps them);
* `WRITEMIND_OFFSCREEN=1` (the window opens at -32000,-32000, never takes focus, never full screen) and
  `WRITEMIND_E2E=1` (the menu / window / dialog hooks `window.wm.e2e*`);
* the occlusion flags (`CalculateNativeWinOcclusion`, `disable-renderer-backgrounding`,
  `disable-backgrounding-occluded-windows`) that keep an offscreen window painting — CodeMirror's layers go stale
  without them;
* a free debugging port (or `--port`);
* for `video` suites, Chromium's fake capture device playing a synthetic `.y4m` (a flow chart, a page in perspective;
  `e2e/lib/fixtures.mjs` writes them);
* a per-script timeout (default 120 s, kill of the script's process tree), a per-suite timeout, **one retry on a fresh
  instance for scripts marked flaky**, and a restart of the instance if a script leaves the page dead;
* a guarantee that no electron is left: instances are stopped **by pid** (never by image name), swept by their unique
  temp profile as a safety net, and also on Ctrl-C / crash.

### Suites

| Suite | Covers |
|---|---|
| `smoke` | the app starts offscreen, makes a note, takes typing |
| `cells` | brackets on their cells, hold / extend / add / remove, move / duplicate / delete, clipboard, typing over a run, dragging a held bracket; the seams between cells (hover, click, Enter, Escape, arrows, the + menu and its kinds) |
| `editor` | typing and the formatting keys, list continuation, undo; the code highlighter, the T popover, the rendered page; folding; `/link`; sidebar drag and drop; session restart (restarts the app); the right-click menu; pointer selection, to-do boxes |
| `drawing` | connectors and routing, labels, undo; pictures (paste, drop, crop, Edit ▸ Undo); pen ink, pick / move / resize / turn / group; text boxes and marks; a 1.5x display; hover feedback, shapes / arrows / text boxes in drawing cells, Undock (08-10), the handles round a picked object and the one inspector over it (11) |
| `export` | File ▸ Export… ▸ Wolfram Notebook (with the real engine when this machine has one, and with a stand-in that never answers), and a copied drawing cell on the system clipboard (Mac), pasted back: `export/01`, `02`. The engine half of the fixture: `node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/check-wolfram.ts` |
| `pen` | stroke with pressure, eraser end, barrel button; the bar and the pen chip; every pen button action and the ExpressKeys; the pen cursor; palm rejection and finger scroll |
| `maths` | the palette, insertion inline / as a block, typesetting (MathML), source back on click |
| `camera` | a fake camera: the flow-chart reader, squaring a tilted page through four corners |
| `tablet` | the tablet sheet as the video source: writing, box, chart, page, undo, erase, pen buttons on the sheet |
| `format` | a note is a `.wm`: a legacy folder converts on launch (originals moved to a backup, a notice), typing, a pen stroke and a pasted picture land inside the file (read back by `e2e/lib/wm.mjs` and the system's `unzip -t`), a restart brings them back, the export reads it |
| `undo` | Ctrl+Z through FILE operations (`docs/PLAN-undo.md`): five things (type, rename, move, trash another note, type) and five Ctrl+Z / Ctrl+Shift+Z checking text, names, folder and sidebar after each press; six trashes and the third-step boundary with the backups; text and file steps interleaved across two notes; a tab switch, a disk reload, a taken name, a failing undo, the open note's own creation undone, a restart |
| `tabs` | the tab row: the sidebar / rendered / video switches (sidebar open and shut), the video button's menu, the tabs, the +, the open-notes list and count at 460px and wide, and a tab's right-click menu (Rename, Duplicate, Move to, Trash) checked on disk. A script that presses a key uses Cmd on a Mac (the older `chrome` scripts press Ctrl and several of them fail on a Mac at the foundation commit, with or without this suite) |
| `chrome` | the three bars and their groups, one-press-one-action keys, the application menu, edit mode, projects; the overlays (07 the find card, 08 the seven dialogs: inert page, Tab trap, Esc, Move to Trash on Cancel, the key list's search, 09 popovers' Esc, the footer's mode chip and the Esc that stops the pen, the link card, the divider) |
| `sidebar` | the sidebar: its 36px bar, the search (⇧⌘F, typing, results, accents, the arrow keys, Enter into the Find bar, Escape), row ⋯ and right-click menus, Move to, the + menu and New Section, edit mode and the arming trash, the footer's project menu, the add row as a drop target (`sidebar/_lib.mjs` seeds the notes; each script gets its own app) |
| `integration` | the merged app from its NEW surfaces (docs/PLAN-bars-2026-10.md; Sean, 2026-10-10: "make sure the cell behavior, moving the input cursor, search, and undo are all implemented properly"). **Every step, and every press of Ctrl+Z / Ctrl+Shift+Z, reads the whole picture** (`integration/_lib.mjs`: the tab in front, the words, the caret, whether the keyboard is in the notes, the files on disk and what each holds, the sidebar's rows, the drawing objects in each note) and compares it with what the steps so far must have made. 01: type-rename-move-trash-type of the plan's P8 done through the Style menu, the tab menu, the sidebar row menu and the seam's +; 02: six file operations from the tab menu, the row menu and the + menu, only three undo, the oldest backup gone, bystander files untouched; 03: twelve steps across two open notes (Find / Replace All, Table, Move Section, rename, the seam's +, a text box, a shape and the inspector's duplicate and delete, Duplicate, New Section) undone and redone in the order the rule gives; 04: the keyboard and the caret after every menu, dialog, field and popover; 05: cells made by the Style menu, the seam and Table (caret, one undo, Redo), the arrows cell-bar-cell, a held cell, Move Section; 06: the sidebar's search while notes come and go (rename, trash, undo, a damaged .wm), Enter into the Find card, the Find card over cells of every kind. Each script is its own app (`isolation: script`); they take minutes, not seconds |
| `perf` | typing / scroll / pen frame times on a long note (generous limits; numbers are printed as notes) |

Each suite folder has an optional `suite.json`:

```json
{ "description": "...", "video": "chart" | "tilted", "isolation": "suite" | "script",
  "scriptTimeoutSec": 120, "timeoutSec": 900, "flaky": ["x.mjs"], "desktop": true, "args": [], "order": ["a.mjs"] }
```

and a script can say so in its first lines: `// @e2e flaky`, `// @e2e desktop`, `// @e2e video=tilted`,
`// @e2e isolated` (a fresh app for this script alone), `// @e2e timeout=300`.

### Known issues

`e2e/known-issues.json` lists checks that fail today because of a bug tracked elsewhere:
`{ "script": "tablet/01-sheet-as-camera", "check": "text in the check's name", "reason": "..." }`. Such a check prints
`XFAIL` and shows as KNOWN in the report; it does not fail the run. When it passes again the runner prints FIXED and the
entry should be deleted. Keep the list short; every entry needs a reason.

## Writing a script

A script is a plain node ES module that imports the harness, which connects to the instance the runner started and
waits for the app:

```js
import { ok, finish, freshNote, setDoc, doc, key, click, brackets, shot } from "../../lib/harness.mjs"

await freshNote()                       // a new note, open, pen up, video pane closed
await setDoc("One\n\nTwo")
const b = await brackets()
await click(b[0].right, b[0].y)
ok("a bracket click holds the cell", (await doc()).length > 0)
await shot("held")                      // e2e/.results/<run>/shots/<suite>__<script>__held.png
finish()                                // prints the totals; exit code 1 if anything failed
```

Output protocol (one line per check, read by the runner): `PASS name`, `FAIL name  detail`, `SKIP name  why`,
`XFAIL`/`XPASS` (known issues), `NOTE text`. A script that exits non-zero, crashes, or reports no check at all fails.

The harness (`e2e/lib/harness.mjs`; the CDP client is `lib/cdp.mjs`, instance control `lib/instance.mjs`):

* checks: `ok`, `test(name, fn)` (a throw fails only that block), `skip`, `note`, `finish`
* real input: `click`, `dblclick`, `rightClick`, `hover`, `drag`, `dragPath`, `key("d", {ctrl, shift, alt})`,
  `typeText`, `insertText`, `touch`, `mouse`; pen: `pe`, `penHover`, `penStroke`, `seg`, `rectPts`, `line`
  (pass `{ pen: true }` to the mouse helpers for a CDP pen pointer)
* editor: `doc`, `setDoc`, `sel`, `setSel`, `ranges`, `selText`, `focus`, `lineBoxes`, `brackets`, `armed`, `VIEW`
* app: `freshNote`, `openNote`, `reloadApp`, `restartApp`, `seedNotes`, `resetNotes`, `writeNoteFile`, `readNoteFile`,
  `closeAllTabs`, `setPen`, `arm` (Shapes / Marks menu), `handles`, `saved(file)` (the drawing sidecar), `canvasBox`,
  `menu`, `menuClick`, `pickNext` (answer to the next native dialog), `windowInfo`, `showVideoPane`, `pickTablet`,
  `pickCamera`, `guardClipboard`
* DOM: `js`, `send`, `press(selector)` (synthetic click), `clickEl`, `centerOf`, `rectOf`, `pick`, `setSelect`,
  `setInput`, `waitFor`, `until`

To work on a script against a live app:

```
node e2e/instance.mjs start --name mine --port 9416 --hold     (run it in the background; --hold keeps it alive)
WM_PORT=9416 node e2e/suites/cells/03-seams.mjs
node e2e/instance.mjs stop --name mine
```

or simply `npm run e2e -- --file e2e/.scratch/try.mjs --snapshot` (a fresh instance per run; `e2e/.scratch/` is
git-ignored). With `WM_PORT` alone the notes folder is read from the app and screenshots go to `e2e/.results/manual/`.

### Things that bit us (read before writing the next one)

* **Hover is `pointerenter`, and a synthetic `PointerEvent` does not produce one.** Features that depend on "the pen is
  over the sheet" (Ctrl+Z over the sheet, a button tap on the sheet) need a real move first:
  `hover(x, y, { pen: true })`.
* **A script that presses a command key must press the machine's own**: the app's key table is `CmdOrCtrl`, so on a Mac
  `key("f", { ctrl: true })` is a key that does nothing. `e2e/lib/overlays.mjs` has `mod` (Cmd on a Mac, Ctrl elsewhere) and
  `replaceChord`; the older scripts that type Ctrl fail on a Mac today, before any change.
* **The window is set to 1440x900** (offscreen) when the harness loads, so layout and coordinates are the same every
  run. Do not hard-code points that depend on the viewport; derive them from `rectOf` / `brackets()` / `lineBoxes()`.
  A click at the far right of a line lands on the cell brackets, not the text.
* **The video pane may start open**, which halves the editor. `freshNote()` closes it; `freshNote({ video: true })`
  keeps it.
* **A restored session brings tabs back** (`closeAllTabs()` first if a count matters). Everything in `localStorage`
  (pen settings, collapsed bar groups, the video source) survives `reloadApp()` within a suite: clear it explicitly.
* **Undo goes last-thing-first** across the note's words, its drawing and the tablet sheet.
* **Clicking a picked object's handles is not clicking the object**: a mark placed 60 px from another can have its
  Delete handle under the next drag. Spread things out.
* **Windows backslashes in test source**: write file paths with `path.join` and JS regexes for backslashes with care
  (`/\\\\/g` inside a template literal that is evaluated in the page).
* **The build changes under you** when several people work in the tree: `--snapshot` tests one consistent copy.
* **The right-click menu uses the real system clipboard**; `guardClipboard()` saves its text and puts it back.
* Do not put the display in full screen, do not read or write the person's real notes, do not kill electron by name.
  The harness refuses to run `resetNotes()` on a folder that does not look like a test one.

## The desktop suites

There are none at the moment (the `grab` suite went with the overlay it tested). `--desktop` still exists for a suite that marks itself `desktop`.

## Moving other people's scripts in

Scripts written elsewhere (for example `C:\CLAUDIO\agents\e2e\<area>\`) move in like this:

1. copy to `e2e/suites/<area>/NN-name.mjs`;
2. replace the local CDP / helper imports with `../../lib/harness.mjs`, drop any hard-coded port, notes path or profile
   (use `notesDir()`, `seedNotes`, `freshNote`), change `shot("C:/...png")` to `shot("name")`, `done()` to `finish()`;
3. make sure it prints PASS / FAIL lines and ends with `finish()`;
4. add `noGrab()` first if it shows the tablet sheet, `// @e2e video=chart|tilted` if it needs the fake camera;
5. `npm run e2e -- --suite <area> --snapshot` until green, and add it to the table above.
