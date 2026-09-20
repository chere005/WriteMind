# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

## Being worked on

- **Drawn shapes and flow charts, off the page.** Reading a photographed
  sketch as real nodes and arrows: a rectangle round some words becomes a
  node with those words as its label, an arrow between two boxes becomes a
  connector joining them. Three approaches are being measured against a
  drawn corpus — contour geometry, primitive fitting, and the grouping that
  turns loose shapes into a chart — before any of it is written.

## Open

- **Table editing on the rendered page.** A table opens as its markdown
  today. It should be a grid you tab through, with rows and columns added
  and taken away.
- **Markers inside an open cell.** The markdown pane hides `**`, `#` and a
  link's URL and shows them only on the caret's own paragraph. The rendered
  page's cell editor does not do this yet, so clicking a heading still shows
  its hashes for as long as you are in it.
- **OCR, further.** Strikethrough, rings, arrows and algebra are read. Not
  read: tables drawn by hand, checkboxes, and an arrow that belongs BETWEEN
  two words of a line (it lands on a line of its own at the right height).
- **Deleting across a hidden marker.** A selection that spans one `**` of a
  pair can leave `**bold*` behind. The delete should take the pair.
- **The camera pane's own buttons** never had the tooltip treatment the
  editor's bar got.
- **A tagged release.** The lane runs now that there is a remote
  (`sh tools/dtp.sh`), but nothing is tagged and the version is still 0.1.0.

## Watch it in use

None of this can be driven from a script; it was reasoned about and
unit-tested, not watched:

- dragging notes and sections in the sidebar, with edit mode off
- dragging a mark out of the palette; ⌥-dragging an arrow between two nodes,
  then dragging one of its segment circles
- the cell brackets: clicking one, double-clicking a group, ⌥⌘← and ⌥⌘→
- Read Text on a Japanese page and on a dot-grid page
- the camera's box: drag, click to clear, double-click for the whole picture,
  then Image / Writing / Text
- the video dropdown: turn, original size, resize by square, whole screen
- the grips that fold each section of the toolbar away
