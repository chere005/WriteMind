# WriteMind

<img src="assets/logo-512.png" width="80" alt="The WriteMind mark: a one-stroke WM">

WriteMind is a desktop notebook for writing by hand and by keyboard, for Windows and macOS (Linux builds
from source). Notes are plain markdown `.md` files in an ordinary folder. Pen strokes, pictures and shapes
live in a hidden sidecar file beside each note, so the notes stay readable by any markdown editor.

It is open source under the **BSD 3-Clause licence** ([LICENSE](LICENSE)), © 2026 Shahean Cheren. You may
use, change and redistribute it, commercially or not, as long as the copyright notice stays with it.

## What it does

- **A notebook of cells:**
  - text, markdown, headings, lists and to-dos, quotes, code and tables;
  - typeset maths (Wolfram Language);
  - runnable code cells (Python, Wolfram, C, C++, Rust) with In / Out;
  - drawing cells and picture cells.
- **Two views:** the markdown source, and a rendered page you can still type in.
- **A drawing layer** over the note: pen ink with pressure, shapes, arrows that route around boxes, text
  boxes, marks and pictures. A drawing can be docked into the note as a cell, or undocked again.
- **A video pane:**
  - a document camera that finds the page and squares it up;
  - or a Wacom tablet sheet, with tabs, that you write on with the pen.
  - Either one brings writing into the note as ink, as a picture, as a drawing cell, or as words read by OCR.
- **Wacom pen support** through the Wacom driver: pressure, the tablet mapped to the sheet, and the pen's
  side buttons (hold to erase or select, double-tap to undo or redo).
- **Export** a note to PDF, with text that stays text and drawings that stay vectors.
- **Updates:** Windows copies update themselves from this repo's GitHub Releases; Mac copies point you to
  the new download.

The full tour is [docs/FEATURES.md](docs/FEATURES.md), and the keys are in [docs/KEYS.md](docs/KEYS.md).

## Install

Download from the [latest release](https://github.com/chere005/WriteMind/releases/latest).

- **Windows:** `WriteMind-Setup-<version>.exe`.
  - It installs for your user only, with no admin prompt.
  - It offers to install Python and the Wolfram Engine for runnable cells.
  - The installer is not code-signed yet, so SmartScreen asks first: **More info ▸ Run anyway**.
  - Details: [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md).
- **macOS 13 or newer:** `WriteMind-<version>-mac-arm64.dmg` for Apple silicon, `-mac-x64.dmg` for Intel.
  Open it and drag WriteMind into Applications. Details: [docs/INSTALL-MAC.md](docs/INSTALL-MAC.md).

## What this project implements itself

Everything that makes WriteMind what it is was written in this repo, in TypeScript:

| Part | Where |
| --- | --- |
| The markdown parser (a full and an incremental parse, with exact source ranges per block) | `packages/core/src/markdown` |
| Cells and their rules: text vs markdown cells, the bar between cells, splitting, merging, moving, docking | `packages/core/src/cells`, `packages/editor` |
| The Wolfram Language maths parser and typesetter, and the maths palette | `packages/core/src/math`, `packages/editor/src/math.ts` |
| The drawing model: strokes, shapes, routed arrows, groups, ink cells, sidecar files | `packages/core/src/drawing`, `apps/desktop/src/renderer` |
| Page finding and perspective correction for the camera; ink lifted off the paper | `packages/core/src/capture` |
| OCR results turned into markdown (lines, marks, handwriting rules) | `packages/core/src/capture/textRecognition.ts` |
| PDF page layout (what goes on which sheet, where the drawing lands) | `packages/core/src/export` |
| The editor's behaviour on top of CodeMirror: brackets, the rendered page, maths display, keys | `packages/editor` |
| The desktop app: notes and folders, projects, the Wacom pen, the camera and tablet panes, export, updates, runnable cells | `apps/desktop` |

Every file in `packages/core` names the Swift file it was ported from (see below), and the test suites
(`npm test`, plus end-to-end suites in `e2e/`) cover the model and the app.

## Third-party software and what it is used for

Shipped inside the app (all permissive licences; full list with versions in
[docs/THIRD-PARTY.md](docs/THIRD-PARTY.md)):

| Software | Licence | Used for |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) (Chromium + Node.js) | MIT; Chromium's parts mostly BSD-3 | The app shell: the window, drawing (Chromium's Skia), the camera, and writing PDFs (`printToPDF`, Skia's PDF backend). Its notices ship as `LICENSES.chromium.html`. |
| [CodeMirror 6](https://codemirror.net/) and Lezer | MIT | The text-editing engine: input, selection, undo history, layout. WriteMind's cells are built on top of it. |
| [React](https://react.dev/) | MIT | The user interface around the editor (bars, panes, dialogs). |
| [koffi](https://koffi.dev/) | MIT | Calling native libraries from Node: the Wacom driver's Wintab interface on Windows. |
| [electron-updater](https://www.electron.build/auto-update) | MIT | Downloading and installing updates on Windows. |

Used from your computer, not shipped:

| Software | Used for |
| --- | --- |
| Wacom driver (`Wintab32.dll`) | Pen input with pressure and side buttons on Windows |
| Apple Vision (macOS) / `Windows.Media.Ocr` (Windows) / Tesseract (Linux, if installed) | Reading words out of a picture (OCR) |
| Python, Wolfram Engine, C / C++ / Rust compilers | Runnable code cells, when installed (the Windows installer can fetch Python and the Wolfram Engine with winget) |

Build and test tools only, never shipped: TypeScript (Apache-2.0), Vite, esbuild, Vitest and
electron-builder (MIT).

**Network use:** the app's only connections are update checks against this repo's GitHub Releases, and the
download of an update you accept. There are no analytics, remote fonts or other services.

## The code

```sh
npm install
npm test        # the unit suites
npm run dev     # the app
npm run e2e     # the end-to-end suites
```

- [docs/BUILDING.md](docs/BUILDING.md): builds, installers and releases for Windows, macOS and Linux
  (Arch: [packaging/arch/PKGBUILD](packaging/arch/PKGBUILD))
- [docs/PORT.md](docs/PORT.md): what was ported, what was rebuilt, and why CodeMirror
- [docs/TESTING.md](docs/TESTING.md): typecheck, unit tests and the end-to-end suites
- [docs/TODO.md](docs/TODO.md): what is next
- [AGENTS.md](AGENTS.md): how the code is put together

## Where it came from

WriteMind began as a macOS-only Swift app, now kept as a reference at
[chere005/WriteMindSwift](https://github.com/chere005/WriteMindSwift). This repo (named WriteMindCross until
2026-10-06) is its cross-platform successor. A snapshot of the Swift source is kept in `WriteMind/` and
`WriteMindTests/`; it is what the TypeScript was ported from, and it is not built or shipped.
