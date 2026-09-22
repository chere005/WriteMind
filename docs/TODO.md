# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

**What goes in here: things that are not built, and bugs that are not
fixed.** Not what has yet to be watched on screen — Sean, 2026-09-20:
"don't list things I haven't tested yet in todos", the second time he has
had to say it. Verification is the job, not an item.

## Open

- **The evaluation cell's margin, four things.** Sean, 2026-09-22, in one
  message; C and Rust landed from it, these did not.
  - **A new evaluation cell is Wolfram** ("default to wolfram"). ⌘9 writes
    whatever `AppState.evaluator` holds, which starts as Python.
  - **And then it is whichever was used last** ("remember last used cell
    type when inserting"). The choice would have to be remembered in the
    defaults the way the pen's size and colour are, and written whenever a
    cell is made or its environment picked.
  - **The marks sit further left, and the cells do not move**
    ("align further to the left but keep the cell start the same").
    `CellMark` is a 44-point column in front of the cell, so moving the
    marks left moves the code with them. The cells' left edge has to stay
    where it is, which means the mark goes in the page's own margin — an
    overlay rather than a row in the stack — and that margin
    (`MarkdownPreview.sideInset`, 28) is narrower than `Out[10]`.
  - **The environment is an icon, not two letters** ("use icons for WL,
    CPP, Python"). `Evaluator.badge` is `WL` / `PY` / `C` / `C++` / `RS`
    today. There is no SF Symbol for a language, so this means art —
    and `SymbolTests` exists because a missing symbol name draws
    NOTHING on this macOS, so whatever is used has to be checked the
    same way.
- **Flow charts, further.** Six shapes come off a sketch now. A tick, a
  cross and a star are read by the classifier and deliberately left as
  ink: they are marks in a note rather than objects, and the app already
  reads a tick in a drawn box as a task item, so putting one on the page
  here as well would read the same ink twice. Worth revisiting if Sean
  wants a tick he can drag.
- **Tables, from scratch.** The feature came out whole on 2026-09-20 (Sean:
  "tables is weird right now... just completely remove tables as a feature
  and we'll rebuild that from scratch"). Gone with it: the GFM block and
  its parsing, the grid you typed in, the toolbar button and ⌃⌘T, and
  reading a ruled table off a photograph, which existed only to write one.
  `git show` the removal commit for the old one when the new one is wanted.
