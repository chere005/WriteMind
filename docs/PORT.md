# WriteMind, on two platforms

The Mac app is 24,583 lines of Swift. A third of it — the 7,914 lines that
import nothing but Foundation — is the app's actual behaviour: the parser,
the cell and seam arithmetic, the formatting commands, the drawing geometry,
the shape reading, the note rows. The other two thirds are SwiftUI, AppKit,
TextKit, Vision and AVFoundation, and none of that exists on Windows.

So the port is not a translation of the app. It is:

1. the pure third, transcribed into TypeScript **with its tests**, and
2. a new shell around it, built out of what the web platform is good at.

The tests are what make it safe. `WriteMindTests/` is 9,406 lines of XCTest
against pure functions; a rule and its test transcribe together, and a rule
whose test passes on both sides is a rule that ported. Every test file under
`packages/core/test/` names the Swift file it came from.

## What is where

```
packages/core      the model. No DOM, no Electron, no React. Ported from the
                   Swift files of the same name, function for function
packages/editor    CodeMirror 6 extended until it is WriteMind's notebook:
                   the decorations, the seams, the brackets, the keys
apps/desktop       Electron: one window, the file work, the React shell
WriteMind/         THE MAC APP, as a reference. It is a snapshot — the
WriteMindTests/    living copy is ~/GIT/WriteMindSwift; this one is never
tools/             edited here (`git pull macos main` brings it forward)
```

## Why CodeMirror

The single hardest thing in the Mac app is the notebook editor, and it is
hard because TextKit 1 was bent into shape for it: `MarkerHiding` and
`BulletGlyphs` are layout-manager glyph substitution, folding is a custom
typesetter laying out zero-height line fragments, the seams are measured off
`boundingRect(forGlyphRange:)`, and a multiple selection needs the plural
delegate method or AppKit collapses it.

CodeMirror 6 does all four natively:

| The Mac | Here |
|---|---|
| glyph substitution to fade `#` and draw `- ` as a bullet | replace and mark decorations |
| `FoldingTypesetter` / `FoldingLayoutManager` | the fold service |
| `willChangeSelectionFromCharacterRanges:` | several ranges, natively |
| `boundingRect(forGlyphRange:)` for the seams | `view.lineBlockAt(pos)` |

The rules did not change. `CellSeams` still says where the bar goes;
`CellSelection` still says which bracket is held; `CellTypes` still says what
the + opens. They are imported from `@writemind/core` by both the editor and
the shell, and neither may decide any of it for itself.

## The rendered page is the same view

The Mac's rendered page is a second view: SwiftUI blocks, one `NSTextView` for the block being
edited, the note written back block by block (`MarkdownPreview`, `BlockEditor`). On CodeMirror it is
cheaper and safer to keep ONE view: every block that is not open is a block widget standing over the
characters it came from (`packages/editor/src/preview/`), and the open block is those characters, styled.
One document, one selection, one undo — so "only the block you are in is ever rewritten" is true because
there is no second copy to convert, and the brackets, seams, + menu, folds and held-cell commands are the
markdown side's own. Which blocks are open is a pure rule in the core (`cellStates`); so are Return, Backspace
and the keys of a bar (`cells/preview.ts`), tested from the Swift tests of the same names.

## What each platform can do

`packages/core/src/platform/capabilities.ts` is the ONE place that answers
this. Nothing else asks `process.platform`.

| | macOS | Windows | Linux (Arch) |
|---|---|---|---|
| The notebook, the drawing layer, the files | yes | yes | yes |
| Export ▸ PDF | yes | yes | yes (Chromium prints the page) |
| The camera, the box, and the ink lifted off the paper | yes | yes | yes |
| Reading a picture's words | `wm-vision` (Vision) | Windows' own OCR engine (`Windows.Media.Ocr`, nothing to install; Japanese is an optional Windows capability, `docs/OCR-WINDOWS.md`), else `tesseract` if installed | `tesseract` if installed |
| Finding the page in the frame by itself | `findPage` (plain arrays, `capture/findPage.ts`) - the Mac app keeps Vision | yes, the same code | yes, the same code |

**A CAPABILITY IS A FILE BEING THERE, and that is the whole rule.** There is
no table of operating systems in the code: `capabilitiesFor(platform,
{ocr, engine, japanese})` asks one question, and the shell answers the helper half by looking
for `wm-vision` (built by `tools/build-vision.sh` on macOS), Windows' engine (a probe of
`helpers/wm-ocr.ps1` that works) or `tesseract`
on the PATH — Arch's `tesseract` and `tesseract-data-eng`, which the package
lists as OPTIONAL. A Mac with no helper built is a Mac without OCR. Nothing
anywhere else asks `process.platform`.

Vision reads handwriting and tesseract does not, much — so the Mac keeps
its extra feature rather than everyone being levelled down to the worst
reader, which is what a "one codebase" port usually costs.

**The rule for the side that cannot do it: say nothing and show nothing.** A
button that is there but dead, or a dialog explaining what this build cannot
do, is worse than an app that simply does not offer it. The one exception is
the camera's box, because its absence changes what the user has to do, and
that is one line in the camera pane.

## The notes folder

The Mac app keeps its notes in `~/Documents/WriteMind`. This one kept its own
in `~/Documents/WriteMindCross` (unless `WRITEMIND_NOTES` said otherwise) —
two apps writing one folder is the exact shape of the bug that cost two cells
on 2026-09-20, and a port does not point itself at somebody's real notes on
its first run.

Since the 2026-10-06 rename (this repo became WriteMind, the Swift one
WriteMindSwift; Sean chose to rename the folder too) the default is
`~/Documents/WriteMind` (Windows: `Documents\WriteMind`). The first launch
moves `WriteMindCross` there when no `WriteMind` folder exists yet; when both
exist it keeps using `WriteMindCross` and says so, which keeps the two apps
apart on a Mac that has both. A fresh install on a Mac that has only the Swift
app's `~/Documents/WriteMind` opens that folder, so there the two apps share it.

`NoteWriting.mayWrite` came across with everything else: the app owns the
file only while the bytes on disk are the bytes it last read or wrote. A
refusal keeps the buffer and says so in the footer.

## Linux, and Arch in particular

Sean, 2026-09-21: "make a version of writemind for linux also.. make sure
to target functioning on ArchLinux". It is the same build; what Arch needed
was four things, and all four are in the tree rather than in a wiki page:

- **`pacman` is a target** beside the AppImage, and `packaging/arch/PKGBUILD`
  is the other route — built from source against Arch's OWN `electron`
  rather than shipping a second Chromium, which is what an AUR user
  expects.
- **Wayland**: the app sets `--ozone-platform-hint=auto` itself, so a
  Wayland session gets a Wayland window instead of a blurred Xwayland one.
- **The notes folder** is `app.getPath("documents")`, which reads the XDG
  user directory — a machine whose documents folder is somewhere else is
  respected rather than corrected.
- **Trashing a note** is `shell.trashItem`, which on Linux is `gio trash`;
  glib2 is a dependency because without it a trash would be a delete.

`docs/BUILDING.md` is the how.

## Running it

```sh
npm install
npm test                      # the ported rules, against the transcribed suite
npm run dev                   # vite + electron, with the window reloading on save
npm -w @writemind/desktop run build && npm -w @writemind/desktop start
```
