# What WriteMind does

The tour. [README](../README.md) is the short version; [AGENTS.md](../AGENTS.md)
is how the code is put together.

- **Notes are files.** `~/Documents/WriteMind/*.md`, one per note, readable
  by anything. The title is the note's first `# heading`, or its file name.
- **Sections are folders.** Make a section in the sidebar and it is a folder
  on disk; a folder inside it is a subsection. The section you have selected
  is where the next new note goes. Drag a note — or a whole section — into
  another one and the file really moves, so Finder agrees with the sidebar.
- **An edit button** puts duplicate and delete on every row, and the order
  you drag rows into is remembered.
- **A markdown editor, and a preview of it.** The bar sits over the editor
  pane; the button on its right lights up while the preview is showing
  (⇧⌘P). Bold, italic, underline, bullets and quote are on the left
  (⌘B ⌘I ⌘U ⇧⌘L ⌃⌘Q); they wrap or unwrap the selection, and undo knows
  about it.
- **Six heading levels, named the way you'd say them.** Title, Chapter,
  Author, Section, Subsection and Subsubsection — the Author line renders
  italic and slightly bigger than the body text. From the `aA` menu, the
  Format menu, or ⌘1 title, ⌘2 chapter, ⌘3 author, ⌘4–⌘6 section to
  subsubsection, ⌘7 back to body.
- **Sections of a note are cells.** A heading owns everything under it
  until the next heading of its rank, and the brackets down the right-hand
  side show the nesting the way a Wolfram notebook does. Click one to fold
  that section away — the note itself is untouched, the caret steps over
  what is hidden, and what you closed is still closed when you come back.
  ⌃⌘↑ and ⌃⌘↓ move the whole section, everything nested in it included.
- **Indentation that follows the structure.** ⌘] and ⌘[ — or Tab and
  Shift-Tab — move the lines you're on in and out; a quote gains another
  level, anything else gains two spaces. Backspace inside a line's
  indentation takes a level off instead of a character.
- **Link to a note, or to one part of one.** Type `/link` and a banner asks
  you to select the section to point to: open another note, put the cursor in
  a block — or highlight the exact run of text — and click Link Here. The
  highlighted text is marked in that note as linked to, and the link lands
  where you typed `/link`. Links are clickable in the preview.
- **Write in the preview.** Click any block and it opens where it is, with
  its markdown styled as you type — the `**` fades, the word goes bold, a
  heading is heading-sized — and every button on the bar works on it: bold,
  the heading ladder, lists, quotes, indentation, text style, maths. Return
  starts the next block (in a list it carries the list on), ⌫ in an empty
  block takes it away, ↑ and ↓ move between blocks, and the line that appears
  between two blocks adds one there. Only the block you are in is ever
  rewritten; the rest of the file is never touched.
- **A notebook page, off the camera.** With the camera on a dotted notebook,
  the viewfinder button brings the page in: found and squared up first, so a
  notebook that was crooked in the frame comes in straight. The chevron
  beside it picks what arrives — **just the writing**, lifted off the paper
  in the pen's colour with the printed dots left behind, **the whole
  page** as a picture, trimmed to its edges, or **the raw picture** exactly
  as the camera sees it. Either way it is an object you
  can move, scale and rotate like any other, and every page comes in at the
  same size: the notebook's page shape is learned from the first capture and
  kept, so pages line up instead of each being as big as the camera happened
  to see it. The page's own edge is trimmed away on the way in.
- **A section of the page.** The dashed-box button on the video pane lets
  you drag a box over part of the picture and bring in just that — the
  writing inside it, or the picture — squared up and placed where it was on
  the page.
- **The words in a picture, into the note.** Select a picture — a pasted
  screenshot, a captured page, a chunk of writing — and the read button under
  it recognises the text and puts it into the note just below the picture.
  English and Japanese both, kana and numbers included: a Japanese-first
  reading is tried and kept when it finds any, so an English page keeps the
  accuracy an English-first reading gives it. What comes back is markdown —
  a word with a line through it arrives struck out, a word with a ring round
  it in bold, a drawn arrow as →, and a line of algebra as this app's maths,
  raised digits and all. The picture itself is put away rather than deleted,
  and the Revert button on the bar brings it back and takes the words out
  again.
- **A flow chart sketched on paper comes in as a flow chart.** Reading a
  picture that holds one brings the boxes in as nodes — rectangles, rounded
  rectangles, ovals and diamonds — with the words inside them as their
  labels, and the arrows between them as real connectors that follow the
  nodes when they move. It is deliberately hard to trigger: a node is found
  as the PAPER a drawn outline encloses (which survives an arrow touching
  the box), every candidate is named again by a classifier that refuses
  anything it cannot name, a line with nothing at either end is never a
  connector, an arrowhead is only drawn where a barb was actually seen,
  and nothing at all comes out unless the page holds two nodes, or one with
  an arrow on it. A page of ordinary writing gives nothing.
- **Printed dots are not text.** A dot-grid page is recognised by the
  regularity of its dots, which are painted out in the paper's own colour
  before anything is read — so a row of dots never arrives as "・・・".
- **Lists that carry on.** Return at the end of a bullet or a numbered
  item starts the next one; Return on an empty item ends the list. The
  chevron beside the list button picks dots, dashes or numbers — `- `, `* `
  and `1. ` on disk, a round bullet, a dash and a number on the page.
- **Code blocks, in five languages.** The `</>` button (⌘8) fences the
  selection or opens an empty block; its chevron tags the fence C, C++,
  Wolfram, Python or TypeScript, and the block is coloured — in the editor
  and in the preview — by a palette that has a light and a dark half, so it
  reads either way round.
- **Tables, with grid lines or without.** The table button writes a GFM
  table with the first header cell selected (⌃⌘T). Its chevron picks the
  look, and the choice lives in the markdown itself: pipes at both ends is
  a grid, no outer pipes is a header rule and nothing else.
- **Strikethrough.** ⇧⌘X, written `~~like this~~`, struck through in the
  editor and in the preview.
- **Crop a picture.** Select one and the crop button sits at its bottom
  left: drag the corners of the box, then ↩ (or the tick) keeps what is
  inside; esc leaves it alone. ⌘Z on the drawing layer brings the rest back.
- **Flow charts.** The shapes button arms a rectangle, rounded rectangle,
  oval, diamond, triangle or parallelogram; drag on the page from one corner
  to the other and that is where it goes, or click once for one at its own
  size. Double-click a node to give it a label. Hold ⌥ and drag from a node
  to draw an arrow — or turn the arrow tool on and drag from anywhere. An
  arrow between two nodes is routed like draw.io's: right angles, the fewest
  corners that join them, round anything in the way, and into its own lane
  when two would run down the same corridor. Every segment carries a small
  circle at its middle — drag it and that part of the line moves, the rest
  following, and where you let go is where it stays. A bar picks the head at
  either end (or none) and a solid, dashed or dotted line. Delete a node and
  its arrows go with it.
- **Text boxes.** The text-box button drops a box you type straight into;
  it floats over the page like a picture — drag, scale, turn, arrow to it —
  and grows to fit what you wrote.
- **The note keeps clear of pictures.** A picture, a captured page or a
  text box takes its band of the page: the note's text runs above it and
  carries on below, never through it, and the cursor cannot land beside it.
  A pasted or captured picture lands just under the line the cursor is on,
  flush with the text, and the cursor moves to the line after it — until
  you drag it somewhere else.
- **Marks.** The next button puts down the things drawn all the time —
  check marks, crosses, stars, boxes, circles, triangles, arrows and lines —
  as objects in the pen's colour.
- **A folder can leave the project without leaving the disk.** Right-click
  a folder in the sidebar: *Remove Folder from Project* hides it (Folder ▸
  Hidden Folders brings it back); *Move to Trash* is the one that moves it.
- **⌫ deletes what you last selected** on the drawing layer — writing, ink or
  a picture. ⌘V pastes a picture wherever you are, source or preview. A middle
  click closes a tab.
- **Font, size and colour** for the selected text, from the T button. It
  writes a `<span style="…">`, so other markdown apps still read the note.
- **⌘D, as in Sublime Text.** The word under the cursor, then one more
  occurrence per press, all editable at once. ⌃⌘G takes every one.
- **It opens side by side.** Every launch shows the notes and the video
  together, whatever was put away last time.
- **Collapse what you're not using.** The notes list and the video from the
  sidebar's header; the notes pane from the corner of the video. ⌃⌘S, ⌃⌘E,
  ⌃⌘C.
- **A pen — and every stroke is an object.** The pen button puts a drawing
  layer over the editor; the menu under it picks the size and the colour (a
  circular colour well plus six swatches). ⌘Z undoes a stroke while the pen
  is up — ⇧⌘Z puts it back — and Undo Drawing sits in the Edit menu at ⌥⌘Z
  whatever has the keyboard. Put the pen down and the drawings become
  things you can handle: drag one to move it, or use the buttons that appear
  — move, turn, resize, delete. Hold **⌘ and drag** for a selection box —
  anything it *touches* comes with it, whole or not. Clicks that land
  anywhere else still go to the text.
- **Pictures on the page.** The image button adds one, ⌘V pastes one, and
  they behave like any other object on the layer. Files live in
  `.drawings/media/`; a note's own copies go with it when it moves and go
  when it does.
- **Maths, written as Wolfram Language.** The `f(x)` button opens a pane of
  shapes — integrals with their bounds (single, double and contour), sums
  and infinite series, Taylor series, limits including one-sided ones,
  ordinary, partial and mixed derivatives, grad, div, curl and the
  Laplacian, exponents, roots, fractions, matrices, the trigonometric and
  hyperbolic functions, π, e, ∞, ℝ ℤ ℚ ℂ, ± ≈ ≡ ∝ ∀ ∃ ⇒ ⇔ ∴ ⊥ ∠ and the
  Greek alphabet.
  Fill in the parts, watch it set, and insert it inline or on its own line.
  What the note holds is the WL — `Integrate[x^2, {x, 0, 1}]` — in a code
  span or a ```wl block, so the file is still plain markdown; the preview
  typesets it.
- **Any camera the Mac can see.** The **Input Devices** menu in the menu bar
  lists built-in, USB, Continuity Camera and Desk View devices with a
  checkmark on the live one; plugging one in refreshes the list. The
  camera you pick is remembered; a first launch never asks. Two buttons in
  the corner turn the picture a quarter turn either way, for a camera that
  is mounted sideways.
- **A bar you can put away a piece at a time.** The toolbar is in
  sections — Style, Structure, Insert, Maths, Flow Chart, Capture — and the
  grip at the end of each one folds it down to a single icon; right-click
  the bar for the list. Every shortcut lives in the **Format** menu, so
  folding a section never takes its keys with it. Hovering a button names
  it, shows its keys and says what it does.
- **Tabs for the notes you have open.** The wheel walks along them, and the
  button at the right-hand end lists every open note — the way back to one
  that has scrolled off the end.
