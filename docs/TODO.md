# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

**What goes in here: things that are not built, and bugs that are not
fixed.** Not what has yet to be watched on screen — Sean, 2026-09-20:
"don't list things I haven't tested yet in todos", the second time he has
had to say it. Verification is the job, not an item.

## Open

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
