WriteMind 3.8.0

- **One Return grows any cell; the second Return arms the bar.** The first Return at the end of a cell (a paragraph, heading, list item, quote, table, code block, maths cell) leaves the caret on a new line that belongs to the same cell: its bracket runs down to it and is lit. The second Return takes that line away and puts up the horizontal bar with the + under the cell, where typing opens the next cell and the + chooses its kind, instead of starting an empty cell. On the rendered page Return at the end of a cell is now this same newline. One Undo gives the line back, the next takes the newline back.
- A lone list marker (`-`, `3.`) directly under a list of its own kind is now that list's empty item, so a list is one lit cell while you type its next item.
