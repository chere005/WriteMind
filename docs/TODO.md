# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

## Open

- **Cells are the note; everything else floats.** The plan, step by
  step, is [PLAN-cells-and-floating.md](PLAN-cells-and-floating.md): cut
  every object loose from the cells (no bands, no anchors, no pushes), then
  make the whole seam between two cells the insertion cursor, in both
  panes, with the armed line as the caret. Sean, 2026-09-20.
- **Flow charts, further.** Rectangles, rounded rectangles, ovals and
  diamonds come off a sketch; triangles, parallelograms, ticks and crosses
  are deliberately left as ink. The composite (hole-finding grouping +
  classifier veto) is measured on drawn corpora and in the suite, not yet
  on a photograph of a real whiteboard.
- **OCR, further.** Strikethrough, rings, arrows, checkboxes, algebra, an
  arrow between two words of a line and a table drawn by hand are all read
  now. A filled square bullet wider than the ink mask's local window still
  reads as an empty checkbox, and a drawn table is only read when it is
  ruled: a table of columns lined up by eye, with no lines drawn, is still
  read as prose.
- **Deleting across a hidden marker.** A selection that spans one `**` of a
  pair can leave `**bold*` behind. The delete should take the pair.
- **The two panes are close to the same height, not exactly.** The blank
  line between cells and a fence's own lines are drawn at the rendered
  page's gap, and the heading ladder already matches — but a code block's
  twelve points of padding, a table's cell padding and a quote's bar are
  the rendered page's alone, so a note with many of those still differs by
  a few points a block.
- **A tagged release.** The lane runs now that there is a remote
  (`sh tools/dtp.sh`), but nothing is tagged and the version is still 0.1.0.
