# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

**What goes in here: things that are not built, and bugs that are not
fixed.** Not what has yet to be watched on screen — Sean, 2026-09-20:
"don't list things I haven't tested yet in todos", the second time he has
had to say it. Verification is the job, not an item.

## Open

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
- **The two panes are close to the same height, not exactly.** The blank
  line between cells and a fence's own lines are drawn at the rendered
  page's gap, and the heading ladder already matches — but a code block's
  twelve points of padding and a quote's bar are the rendered page's
  alone, so a note with many of those still differs by a few points a
  block.
