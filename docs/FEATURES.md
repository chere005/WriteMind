# What WriteMind does

The tour. [README](../README.md) is the short version; [AGENTS.md](../AGENTS.md)
is how the code is put together.

- **Notes are files.** `~/Documents/WriteMind/*.wm`, one per note: a ZIP that
  holds the words, the drawing and the pictures (docs/SPEC-WM.md). The title is
  the note's first `# heading`, or its file name. Notes from before (`.md` plus
  `.drawings/`) are converted on first launch and the originals kept in a backup
  folder.
- **Sections are folders.** Make a section in the sidebar and it is a folder
  on disk; a folder inside it is a subsection. The section you have selected
  is where the next new note goes. Drag a note — or a whole section — into
  another one and the file really moves, so Finder agrees with the sidebar.
- **The sidebar is a 36px bar and a list.** The bar reads a search field,
  **+** and the pencil. **+** makes a note in the open note's section; its
  corner (or a right-click, or holding it) opens New Note / New Section. The
  **pencil** is edit mode: duplicate and a two-click delete on every row. Rows
  have line icons, titles that clamp to two lines, a count on each section and
  a **⋯** on hover that opens the row's menu (Open, Rename…, Duplicate, Move to
  ▸ indented to the tree and greying the note's own section, Reveal, Move to
  Trash…). Each section starts with one quiet "+ New note" row — where the note
  will land — and a row dropped on it moves into that section, at the top.
  The order you drag rows into is remembered. The rendered and video buttons
  are not here: they are the tab row's, beside the sidebar button.
- **Search Notes (⇧⌘F, Ctrl+Shift+F).** Type in the sidebar's field and the
  results replace the list: each is the note's title, the section it is in and
  one line with the match marked. Titles come first, then the words in the
  notes; case and accents do not matter ("cafe" finds "Café"); every folder of
  the project is searched, `.wm` notes included, without waiting for you (the
  reading is done off the page, cached until a note changes, and cancelled the
  moment you type again). The arrow keys walk the results, **Enter** opens the
  note with the caret on the first match and the Find bar on those words, and
  **Escape** clears the field and gives the keyboard back to the notes. The key
  opens the sidebar first when it is away.
- **One project menu.** The project's name at the foot of the sidebar opens
  everything the Project menu has (Add Folder, Remove Folder, Save, Save As,
  Open, New) and the sidebar's own: Hidden Sections, Reveal, Clean Up Unused
  Files…. The note count is beside it.
- **A markdown editor, and a preview of it.** The bar sits over the editor
  pane (the rendered page's button is in the tab row, beside the sidebar's and
  the video's). Bold, italic, underline and strikethrough are on the left
  (⌘B ⌘I ⌘U ⇧⌘X), after the **Style** button; they wrap or unwrap the
  selection, and undo knows about it.
- **A Style button that says where you are.** It names the cell the caret is
  in — Text, Title … Subsubsection, Dots, Dashes, Numbered, To-do, Quote,
  Markdown, Code, Runnable code, Maths, Drawing — and its menu is the same
  list the `+` between two cells opens, each with its key. Picking one runs
  exactly what its key does: the caret ends where the key leaves it and one
  Undo takes it back.
- **Six heading levels, named the way you'd say them.** Title, Chapter,
  Author, Section, Subsection and Subsubsection — the Author line renders
  italic and slightly bigger than the body text. From the Style menu, the
  Format menu, or ⌘1 title, ⌘2 chapter, ⌘3 author, ⌘4–⌘6 section to
  subsubsection, ⌘7 back to body.
- **To-do bullets.** A fourth kind of list: `- [ ]` and `- [x]`, GFM's
  own task list, so any other markdown editor reads them too. The list
  button's menu picks it, the `+` on the insertion bar offers it, and
  Return carries the list on with a fresh empty box. On the rendered page
  the box is a control — click it and the line is ticked, struck through
  and faded; click it again and it is not. Only the box: a click on the
  words opens the cell for typing like any other.
- **Code cells behave like a code editor.** In a fenced block, `(`, `[`,
  `{`, `"`, `'` and a backtick bring their partner; typing the closer
  steps over it; a bracket typed with something selected wraps it;
  backspace between the two takes both; and Tab — or Shift-Tab — indents
  by a four-space-wide tab, every line of a selection at once. Colouring
  knows C, C++, Python, TypeScript, Rust, Java, Bash, Zsh and Wolfram.
- **Split a cell, merge two.** ⌃D cuts the cell the cursor is in, in two,
  at the cursor; ⌃M joins it to the one below (or, in the last cell, to the
  one above). Both work in the markdown and on the rendered page. A fence
  is never cut in half, and a heading will not swallow the cell under it.
- **A cell is a thing you can hold.** Click its bracket and the whole
  cell is picked up, not a run of characters: type and it is replaced,
  ⌃⌫ takes it away and the stack closes behind it, ⌃⇧D puts a copy under
  it, ⌃⇧↑ and ⌃⇧↓ move it, and dragging its bracket up or down moves it
  too. The same on both sides of the app, the way a Mathematica notebook
  behaves (Sean, 2026-09-20).
- **And several cells at once.** Drag DOWN the brackets and every cell the
  pointer passes is picked up, live; shift-click reaches from the last one
  clicked to the one under the pointer; cmd-click puts a cell in or takes
  it out, so a selection can have a hole in it. Everything a single cell
  answers to, a handful answers to together: type and all of them are
  replaced by what you typed, ⌃⌫ takes exactly them and closes the stack,
  ⌃⇧D copies the run, and ⌃⇧↑/⌃⇧↓ walk the whole run up or down the page
  and leave it held, so pressing again moves the same run again. A drag
  that starts on a bracket that is ALREADY HELD moves the run instead —
  that is how both gestures live on one column. The bracket the caret is
  merely sitting in does not count as held, or there would be nowhere to
  start a selection from; and a click on the column where there is no
  bracket goes to the text behind it, the way the right margin always has.
- **The insertion line between cells.** The WHOLE space between two cells
  answers, edge to edge — and so does the space above the first and
  everything under the last. Move the pointer into one and it turns on
  its side; click and a line runs across the page with a `+` at the
  margin. The line is drawn against the cell it follows, however tall
  the space is — clicking a long way under the last cell puts it just
  below that cell, not where the pointer happened to be. That line is
  the cursor: the caret stops being drawn, no bracket is lit while it is
  up, and the first thing typed becomes a cell of its own there, Return
  opens an empty one, and Escape or a click anywhere else takes the line
  back without leaving an empty cell behind. Press the `+` at the end of
  the line and it drops the kinds of cell down — Body Text, the heading
  ladder from Title to Subsubsection, the three lists, Quote, Code Block
  — and the next thing typed makes a cell of the kind you picked, with
  its marker already written and the caret after it. The Format menu is
  the same list by keyboard: ⌘1 or Quote or a list style at a line picks
  the kind that line will make, rather than restyling the cell beside it,
  and pressing the `+` again shows what you picked. The choice belongs
  to that line and goes with it: click the bar somewhere else and you are
  back to plain text, which is what every bar starts out as. On a
  note with nothing in it yet the line sits where the first cell will
  land, not against the top of the pane. The seams belong to cursor
  mode: with the pen down the drawing layer has the pane and there
  are no seams at all. The markdown pane and the
  rendered page do exactly the same thing, the way a Mathematica notebook
  does on both.
- **The arrow keys walk cell, line, cell.** The line is not only what a
  click makes: ↓ off the bottom of a cell lands ON it, ↓ again goes into
  the next cell, and ↑ comes back the same way. Getting there by arrow
  and getting there by click leave the page in the same state — type and
  you get a new cell between the two, not a character that welds them
  into one.
- **The same place, whichever mode.** Switching between the markdown and
  the rendered page reopens on the cell you were looking at.
- **Sections of a note are cells.** A heading owns everything under it
  until the next heading of its rank, and the brackets down the right-hand
  side show the nesting the way a Wolfram notebook does. Click one to fold
  that section away — the note itself is untouched, the caret steps over
  what is hidden, and what you closed is still closed when you come back.
  ⌃⌘↑ and ⌃⌘↓ move the whole section, everything nested in it included.
- **Code is what is inside backticks, and nothing else.** ``` for a
  block, ` for a span, `` `` `` for a span with a backtick in it (Sean,
  2026-09-20). Four spaces at the front of a line is indentation — it is
  drawn indented and stays a paragraph — so Tab is safe anywhere.
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
  in the pen's colour with the printed dots left behind — traced into
  outlines and brought in as a vector, so blowing it up keeps the strokes
  sharp — **the whole
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
  raised digits and all. The picture itself stays (the words go in just under it);
  Undo takes the words back out.
- **A flow chart sketched on paper comes in as a flow chart.** Reading a
  picture that holds one brings the boxes in as nodes — rectangles, rounded
  rectangles, ovals, diamonds, triangles and parallelograms — with the
  words inside them as their
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
  list button's menu picks dots, dashes, numbers or to-dos — `- `, `* `,
  `1. ` and `- [ ] ` on disk, a round bullet, a dash and a number on the page.
- **Code blocks, in five languages.** The `</>` button (⌘8) fences the
  selection or opens an empty block; its menu tags the fence with one of ten
  languages, and the block is coloured — in the editor
  and in the preview — by a palette that has a light and a dark half, so it
  reads either way round.
- **Cells that run.** An evaluation cell (```` ```eval wl ````, `eval python`,
  `eval c`, `eval c++`, `eval rust`; Format ▸ Evaluation Cell) runs with
  Shift+Enter, and its answer lands under it as an `out` cell — `In[n]` over
  the code, `Out[n]` over the answer. **File ▸ Language Setup…** (every
  platform, and Language Setup… at the end of a cell's Runs As menu) shows
  which program each language runs with and where it was found, and lets you
  choose another — a virtual environment's Python, a Wolfram Engine somewhere
  WriteMind does not look — from the program itself or from the copies it
  found; **Test** runs a small program with it. A program chosen there is the
  only one that language uses: if it goes, the cell says so rather than
  quietly running another. On Windows it installs Python or the Wolfram Engine
  and opens the engine's sign-in window with the installer's own script;
  elsewhere it opens the download pages and gives the command to activate. A
  python that is only a stand-in — the Microsoft Store's shortcut on a stock
  Windows, Apple's `/usr/bin/python3` without the Command Line Tools — is said
  to be one, and the row offers to install or get a real Python.
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
- **Text boxes.** The text-box button drops a card you type straight into;
  it floats over the page like a picture — drag, scale, turn, arrow to it —
  and grows to fit what you write, line by line as you write it. What you
  type sits exactly where it will be drawn, in the same font and the same
  padding, so nothing shifts when the caret leaves. Give the card a fill and
  the words are checked against it: ink that would be unreadable on that
  colour is swapped for black or white.
- **The layer floats over the note and never moves it.** A picture, a
  captured page, a text box, ink, a flow chart — none of them is a cell,
  none of them belongs to one, and none of them opens a hole in the words
  (Sean, 2026-09-20: "floating objects like images, drawing, text fields,
  etc completely separate from the cells"). They sit in the note's own
  coordinates and scroll with it; drag one about, move a cell, switch
  modes, and the text stays exactly where it was. A pasted or captured
  picture is dropped one gap under the line the cursor is on, flush with
  the text, and is yours to move from there.
- **Marks.** The next button holds the things drawn all the time — a tick,
  a cross, a query, a star, boxes, circles, triangles, arrows and lines.
  Pick one and then click where it goes: it lands the size of a line of
  writing, a green tick, a red cross and a yellow query, and the handles
  size and turn it from there (drag the mark itself to move it). Drag instead of clicking to size it as
  it goes down; a line or an arrow runs from the press to the release.
- **A folder can leave the project without leaving the disk.** Right-click
  a folder in the sidebar: *Remove Folder from Project* hides it (the project
  menu's Hidden Sections brings it back); *Move to Trash* is the one that moves it.
- **⌫ deletes what you last selected** on the drawing layer — writing, ink or
  a picture. ⌘V pastes a picture wherever you are, source or preview. A middle
  click closes a tab.
- **Font, size and colour** for the selected text, from the T button. It
  writes a `<span style="…">`, so other markdown apps still read the note.
- **⌘D, as in Sublime Text.** The word under the cursor, then one more
  occurrence per press, all editable at once. ⌃⌘G takes every one.
- **It opens side by side.** Every launch shows the notes and the video
  together, whatever was put away last time.
- **Collapse what you're not using.** The notes list, the rendered page and
  the video each have a button at the left of the tab row, always in that
  order, whether the sidebar is open or shut; the video button's corner
  (or a right-click) opens its menu — Show video, the cameras, the tablet
  sheet, Turn left / Turn right, Refresh devices, Video Only. The notes pane
  is put away from the corner of the video. ⌃⌘S, ⌃⌘E, ⌃⌘C.
- **Two modes over one page, and one button between them.** The drawing
  layer is there in the markdown and on the rendered page alike — the
  drawing belongs to the note, not to one way of looking at it — and the
  pen button says which mode the pane is in: press it to put the pen down
  or pick it up. With the pen **up** the notebook has the clicks: the
  words, the bars between the cells and the brackets, and the drawings are
  things you can handle — drag one to move it. A picked one has eight
  resize handles on its outline and a rotate dot above it, and ONE bar over
  it (below it when there is no room above) with its name, colour, width,
  fill, Aa, order, dock, copy and delete; a small one has a single pill with
  turn and resize under it. A corner scales it about the opposite corner, an
  edge of a node or a text box stretches that one way, and Delete acts on a
  click, never on a press you let go of elsewhere. With the pen **down** it draws, and
  the pointer is a pencil over that pane and nowhere else. In either mode,
  hold **⌘ and drag** to pull a rectangle over the page: it takes
  everything it *touches*, whole or not. The mode is remembered between
  launches and the footer names it whenever the pen is down.
- **Several things held as one.** Pick two or more — a marquee, or ⇧-click
  — and **⌃G** holds them together; the same key on a group you have picked
  takes it apart, and a button beside the selection says which it will do.
  After that, clicking any one of them picks up all of them, a rectangle
  that touches one brings the rest, and move, resize, turn and delete are
  over the whole group. Grouping and ungrouping move nothing: a group is
  only a name they share. Pick a group and something loose together and
  ⌃G makes one bigger group of the lot, so groups nest by swallowing
  rather than by stacking.
  The pen button itself is still the pen, on and off; its menu also picks
  the size and the colour (a circular colour well plus six swatches). ⌘Z
  undoes a stroke while the pen is up — ⇧⌘Z puts it back — and Undo Drawing
  sits in the Edit menu at ⌥⌘Z whatever has the keyboard.
- **Pictures on the page.** The image button adds one, ⌘V pastes one, and
  they behave like any other object on the layer. Files live in
  the note itself (`media/` inside its `.wm`), so they go with it when it moves
  and go when it does.
- **Maths, written as Wolfram Language.** The `f(x)` button opens a pane of
  shapes — integrals with their bounds (single, double and contour), sums
  and infinite series, Taylor series, limits including one-sided ones,
  ordinary, partial and mixed derivatives, grad, div, curl and the
  Laplacian, exponents, roots, fractions, matrices, the trigonometric and
  hyperbolic functions, π, e, ∞, ℝ ℤ ℚ ℂ, ± ≈ ≡ ∝ ∀ ∃ ⇒ ⇔ ∴ ⊥ ∠ and the
  Greek alphabet.
  Fill in the parts, watch it set, and insert it inline or on its own line.
  What the note holds is the WL — `Integrate[x^2, {x, 0, 1}]` — in a code
  span or a ```wl block, so the words stay plain text (`note.mdwm`); the preview
  typesets it.
- **Any camera the Mac can see.** The **Input Devices** menu in the menu bar
  lists built-in, USB, Continuity Camera and Desk View devices with a
  checkmark on the live one; plugging one in refreshes the list. The
  camera you pick is remembered; a first launch never asks. Two buttons in
  the corner turn the picture a quarter turn either way, for a camera that
  is mounted sideways.
- **One row that always fits.** The bar over the note is a single 36px row,
  never wrapping: Style, B I U S, Aa (font, size, colour), List, Quote, Code,
  then the inserts as buttons of their own — Text box, Picture, Table, Maths,
  Shapes — with Move section up / down beside them, and the pen at the right.
  When the pane is too narrow, the inserts and the section moves go into a
  **⋯** menu first, then list / quote / code, and the ⋯ only appears then; each
  runs from there with its icon and key. **Customize toolbar…** (in the ⋯, or
  a right-click on the bar) puts the four sections — Text, Blocks, Insert, Pen
  — away and brings them back. Every shortcut lives in the **Format** menu, so
  putting a section away never takes its keys with it. Hovering a button names
  it, shows its key and says what it does.
- **One pen button.** It toggles the pen (accent fill while it is down) — or
  the eraser: its menu (the caret, a right-click, a half-second hold or the
  down arrow) picks **Pen** or **Eraser**, which switches what the one button
  does (⌥⌘1 and ⌥⌘2 do the same and keep the menu in step), then the
  **colour** (six presets and a custom one) and the **width** (1 2 3 5 8 12),
  **Pen always draws (tablet)** and the tablet's buttons and orientation.
- **Tabs for the notes you have open.** The wheel walks along them, and the
  button at the right-hand end — a list icon and how many are open — lists
  every open note, the one in front checked: the way back to one that has
  scrolled off the end. The tab in front is the colour of the page and runs
  into the toolbar under it; its × shows on it and on whichever tab the
  pointer is over. Right-click a tab for Close, Close Other Tabs, Rename…,
  Duplicate, Move to ▸, Reveal and Move to Trash… (the sidebar row's own
  actions).

## Wolfram notebooks (port-only)

- **File ▸ Export… ▸ Wolfram Notebook** writes the note as a `.nb`: its headings, text, lists, to-dos, quotes, tables and rules
  in Mathematica's own styles; its maths and Wolfram code as Input cells you can evaluate, Python as a Python cell, answers as
  Output cells. Every drawing cell, every band of the floating drawing layer and every picture is an IMAGE in the notebook
  itself (no link), made by the Wolfram Engine from the drawing's SVG. Without an engine (or one that is not activated) the
  file is still written: each image is a closed cell that makes it, and WriteMind says the drawings appear when the cells
  are evaluated (Evaluation ▸ Evaluate Initialization Cells).
- **Copying a drawing cell** (with the bracket, then Copy or Cut) puts it on the clipboard so that it pastes into a Mathematica
  notebook as the image itself, between cells or inside an input; into Pages or Word it is a picture at its size. On a Mac
  the cell is there at once as a cell that makes the drawing, and as the image itself a moment later, when the engine has
  answered. Pasting it back into WriteMind is the cell and nothing else.

## Undo goes through file operations too (2026-10-10, `docs/PLAN-undo.md`)

Ctrl+Z / ⌘Z takes back the newest step: the open note's words or drawing, or one of the last three FILE operations (new
note, duplicate, rename, move, reorder, move to trash, the section versions of those, Clean Up, importing a markdown file).
Ctrl+Shift+Z brings it back. A trashed note or section is restored from a copy the app kept first (nothing is trashed if the
copy cannot be made); the copies are deleted when the step is more than three back, after a new step follows an undo, and when
the app quits. Edit ▸ Undo names the step. The history of a note's words survives renames, moves and closing its tab.

