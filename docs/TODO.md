# What is left

The port's list. A to-do here is something UNBUILT or a bug UNFIXED —
never "not yet checked on screen".

## Ported and running

The notebook: the parser, the cells and their brackets, the seams and the
bar, the + and its kinds, the heading ladder, the four list styles with
tickable to-dos, quote, fenced code, bold/italic/underline/strike, indent
and outdent, split and merge, move section, the note tree, the tab row, the
autosave with its write guard, the folder watcher, Export ▸ PDF, and the
capability table. Also: folding (double-click a section bracket, or the ⋯
marker; remembered per note), the session (open notes, the one in front,
caret and closed sections, restored on launch from the app's user-data
folder), dragging a row (reorder, move into a section, a section into a
section; the open tab follows the file), `/link` and following a link,
`<span style>` font/size/colour (the T button), the code highlighter for
C, C++, Python, TypeScript, Rust, Java, Bash, Zsh and Wolfram (a
transcribed scanner, no CodeMirror language packages), Alt-D, and the
rendered-page toggle. The editor-level e2e scripts are kept outside the
repo in `C:\CLAUDIO\e2e\wm\` (fold, session, drag, links, features, cells).

## Not ported yet, in the order they are worth doing

- **The drawing layer, the rest of it.** Everything on the Mac's list now
  works: pictures (paste, drop and Insert ▸ Image land them; the ✂ handle on
  a picked picture opens the crop box — four corners, ✓ keeps the part as a
  new file via `cropped`/`cropRect`), a node's label (double-click it),
  connector routing (`reconnect` after every change, including a change
  that arrives from outside the canvas such as a capture or a window resize;
  the line drawn from `route(connector)` with right angles; a circle on
  every segment of a picked routed line, dragged into `overrides`; an arrow
  dropped with an end on a node is attached to it — `attachableAt`), and
  undo through the app: `DrawingHistory` is shared by the canvas, a paste
  and a capture, `useUndo.ts` makes Ctrl+Z / Ctrl+Shift+Z (and Edit ▸
  Undo / Redo in the app's own menu) take back whichever of the note's
  words and its drawing was edited LAST, and go on down that one before
  turning to the other (interleavings of words and drawing edits made
  between two undos are approximated by that rule). E2E:
  `connectors.mjs`, `pictures.mjs`, `pen.mjs` in `C:\CLAUDIO\e2e`.
- **The camera, the rest of it.** The viewfinder, the box, Writing and Page,
  the ink lifted off the paper, the capture landing where it was on the
  page, reading the words out of a picture on macOS, WARPING (the
  "Straighten" button: drag the four corners onto the page's, and
  `warpToPage` undoes the perspective in plain arrays — the box is carried
  through the same homography with `pageBox`, and the page's true shape comes
  from `pageAspect`, the pinhole estimate, not from edge lengths) and the
  FLOW-CHART READER (`capturePipeline.ts`: a Writing or Page capture runs
  `flowChartItems` on its ink at 800px; a chart lands as nodes and arrows in
  a band under the picture, the arrows routed on arrival, and one Undo takes
  the picture and the chart back together) all work. E2E with Chromium's fake
  capture device playing a .y4m: `makevideo.mjs`, `camera-flow.mjs`,
  `camera-warp.mjs`. Still missing: (1) FINDING the page by itself — the
  macOS helper's `page` command answers (`findPage` in `helpers.ts`) but
  has no IPC and nothing feeds its quad into the corners; (2) the words for a
  chart's labels — `chartFrom` is passed `[]`, so on every platform a node
  comes in unlabelled (double-click to type one); the macOS `text` command's
  per-line boxes are not yet turned into `FlowWord`s, and the same chart
  reading is not yet run from the Aa handle on a picture (the Swift
  `flowChart(from:under:)`).
- **The rendered page, the rest of it.** The toggle (◧ on the bar,
  Ctrl-Shift-P) is the SAME editor with the markdown's marks put away
  (`#`, `**`, backticks, a link's URL) except on the caret's own line — so
  the seams, brackets, folds and cells are the markdown side's own. Not
  ported: the Mac's separate block-by-block editor (headings drawn only as
  rendered blocks, the box of a to-do as a control that is not the
  widget it already is, images inline).
- **Maths: the linear form is DONE.** The ∑ button on the bar
  (`MathPalette.tsx`: a popover of `MATH_GROUPS`, a field per slot, a live
  typeset preview, "Insert inline" / "As a block" through `insertMath`, or
  any Wolfram Language typed by hand) and the notebook extension
  (`mathView.ts`) that typesets a `wl:` code span and a `wl` fence as the
  `typesetInline` runs, with the source coming back when the caret is in it
  (a click on typeset maths puts it there). `C:\CLAUDIO\e2e\maths.mjs` is
  the e2e. Not ported: the TWO-DIMENSIONAL view (`MathView`: stacked
  fractions, radicals with a roof, big operators with limits above and
  below) — the core has only the linear form — and that the extension lives
  in the app (`mathView.ts`) rather than in `@writemind/editor`.
- **Small things not carried over**: ⌘D is Alt-D here (Ctrl-D is Split,
  as on the Mac where ⌘D and ⌃D differ) with Alt-Shift-D for every
  occurrence; a link in the markdown is followed by Alt-click, because
  Ctrl/⌘-click on the page belongs to the drawing layer's marquee;
  "Remove Folder from Project", the edit mode (duplicate / trash on every
  row) and projects are not ported.
- **Packaging, the rest of it**: the three targets are configured and the
  macOS bundle has been packed and run from `dist-electron/`. Still to do:
  run the Linux build ON Linux (an Arch box or a container — a
  `.pkg.tar.zst` cannot be cross-built from a Mac), the Windows build on
  Windows, a signed Mac build (Sean's keychain holds TWO identities with
  the same name, and `codesign` refuses an ambiguous one), and a `dtp`
  lane of its own.
