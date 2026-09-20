# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

## Open

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
- **Shift-click and cmd-click on a bracket are not proven on screen.**
  The drag down the gutter is (five cells, five brackets lit). The other
  two share the same `CellSelection` arithmetic and are covered by its
  tests, but no tool here can send a modified click — `app_click` has no
  modifiers, and the display-scope takeover needs Sean at the keyboard.
- **⌘D's multi-cursor has probably been broken all along.** The gutter
  drag found the cause: a delegate answering only the SINGULAR
  `willChangeSelectionFrom…CharacterRange` makes AppKit collapse every
  multi-range selection to one. That is fixed now, so ⌘D should work —
  nobody has watched it.
- **Everything on the layer floats free, including a connector's ends.**
  Objects no longer move the text at all. A drawing beside a cell whose
  text grows now stays where it was put, which is what "completely
  separate" means and may still want a passive memo later.
