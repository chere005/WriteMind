# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

**What goes in here: things that are not built, and bugs that are not
fixed.** Not what has yet to be watched on screen — Sean, 2026-09-20:
"don't list things I haven't tested yet in todos", the second time he has
had to say it. Verification is the job, not an item.

## Open

- **A note lost two cells during a deploy, and the cause is not found.**
  2026-09-20, 19:27: `~/Documents/WriteMind/Untitled.md` went from 120
  bytes to 45 — the last heading and the four lines under it were replaced
  by two blank lines — while `tools/deploy.sh` ran with an instance of the
  app still open on that note. The deploy smoke-launches `dist/WriteMind.app`,
  so two instances had the same file open, which AGENTS.md already warns
  against for a different reason ("do not rebuild under a running app").
  It has not been reproduced and nothing is pinned. Until it is, quit the
  app before every deploy — and the real fix is probably that a second
  instance must not write a note the first one has open.

- **Flow charts, further.** Rectangles, rounded rectangles, ovals and
  diamonds come off a sketch; triangles, parallelograms, ticks and crosses
  are deliberately left as ink. The composite (hole-finding grouping +
  classifier veto) is measured on drawn corpora and in the suite.
- **Tables, from scratch.** The feature came out whole on 2026-09-20 (Sean:
  "tables is weird right now... just completely remove tables as a feature
  and we'll rebuild that from scratch"). Gone with it: the GFM block and
  its parsing, the grid you typed in, the toolbar button and ⌃⌘T, and
  reading a ruled table off a photograph, which existed only to write one.
  `git show` the removal commit for the old one when the new one is wanted.
- **OCR, further.** Strikethrough, rings, arrows, checkboxes and algebra
  are read now, and an arrow between two words of a line. A filled square
  bullet wider than the ink mask's local window still reads as an empty
  checkbox.
- **Deleting across a hidden marker.** A selection that spans one `**` of a
  pair can leave `**bold*` behind. The delete should take the pair.
- **The two panes are close to the same height, not exactly.** The blank
  line between cells and a fence's own lines are drawn at the rendered
  page's gap, and the heading ladder already matches — but a code block's
  twelve points of padding and a quote's bar are the rendered page's
  alone, so a note with many of those still differs by a few points a
  block.
