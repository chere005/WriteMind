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
WriteMindTests/    living copy is ~/GIT/WriteMind and this one is never
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

## What each platform can do

`packages/core/src/platform/capabilities.ts` is the ONE place that answers
this. Nothing else asks `process.platform`.

| | macOS | Windows |
|---|---|---|
| The notebook, the drawing layer, the files | yes | yes |
| Export ▸ PDF | yes | yes (Chromium prints the page) |
| The camera, the box, and the ink lifted off the paper | yes | yes |
| Reading handwriting into markdown | yes — `tools/vision/wm-vision.swift` | no |
| Finding the page in the frame by itself | not yet (the helper answers, nothing warps the frame through it) | no |

**The Mac's extra feature is a BINARY BEING THERE.** `tools/build-vision.sh`
compiles `wm-vision` on macOS and does nothing anywhere else, and the
capability is whether that file exists and is executable. Nothing asks
`process.platform` at the point of use, a Mac with no helper built is a Mac
without OCR, and the Windows build shows no button for it at all.

**The rule for the side that cannot do it: say nothing and show nothing.** A
button that is there but dead, or a dialog explaining what this build cannot
do, is worse than an app that simply does not offer it. The one exception is
the camera's box, because its absence changes what the user has to do, and
that is one line in the camera pane.

## The notes folder

The Mac app keeps its notes in `~/Documents/WriteMind`. This one keeps its
own in `~/Documents/WriteMindCross` until `WRITEMIND_NOTES` says otherwise —
two apps writing one folder is the exact shape of the bug that cost two cells
on 2026-09-20, and a port does not point itself at somebody's real notes on
its first run.

`NoteWriting.mayWrite` came across with everything else: the app owns the
file only while the bytes on disk are the bytes it last read or wrote. A
refusal keeps the buffer and says so in the footer.

## Running it

```sh
npm install
npm test                      # the ported rules, against the transcribed suite
npm run dev                   # vite + electron, with the window reloading on save
npm -w @writemind/desktop run build && npm -w @writemind/desktop start
```
