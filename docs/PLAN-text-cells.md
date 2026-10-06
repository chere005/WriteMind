# Text cells and markdown cells

Sean, 2026-10-05, after a five-line paragraph showed as one line on the rendered page:

> a standard text cell which is ctrl+7 and the default cell type is not itself markdown... we need a markdown cell
> type.. change ctrl + 7 to standard plaintext, and ctrl + shift + 7 to be markdown.. lets also make ctrl + 8 code,
> and ctrl + shift + 8 runnable code.. make ctrl + 9 drawing cell

> if a rich text element is added to a plaintext cell via a keystroke or a button, automatically convert its cell
> type to markdown

His choices (same day): a text cell is **pure plain text**; the files stay **clean, with a WriteMind rule**.

## The two kinds

| | Text cell (default) | Markdown cell |
|---|---|---|
| Made by | Ctrl+7 (Body Text), every new cell by default, the + menu "Text" | Ctrl+Shift+7, the + menu "Markdown", or automatically (below) |
| Shows | exactly the characters typed, line for line: every line break kept, nothing formatted, `*` `_` `#` `-` `>` `` ` `` `[` literal | standard markdown: a paragraph's lines joined, inline formatting drawn |
| In the file | an ordinary paragraph (see the escape rule) | the line `<!-- markdown -->` directly above the paragraph, then the paragraph |

Headings (Ctrl+1 … 6), lists, quotes, code, runnable code, maths blocks, tables, pictures and drawing cells stay
their own kinds; this is about the body-text paragraph only.

## The file (clean, with a WriteMind rule)

- A paragraph with no marker is a **text cell**. WriteMind shows its line breaks, and draws nothing in it as
  formatting.
- A markdown cell is the marker line `<!-- markdown -->` immediately followed by the paragraph. The marker is
  hidden in both panes (it belongs to the cell: deleting / moving / copying the cell takes it along), never shown
  as a cell of its own, and an HTML comment is invisible in other markdown viewers.
- **The escape rule (the one exception to "clean").** Characters typed into a text cell that would make the file
  mean something else are written with a backslash, and only those: a line-start `#`, `-`, `*`, `+`, `>`, `1.`,
  ` ``` `, `|` (so a line never turns into a heading, a list, a quote, a fence or a table), and inline `*`, `_`,
  `` ` ``, `[`, `<`, `~` and `\` when they would form markup. WriteMind hides those backslashes in the text cell
  (the caret steps over them as one character, copy gives the plain text). A text cell with nothing special in it
  has no backslashes at all.
- **Older notes.** A paragraph with no marker that contains UNESCAPED markup WriteMind itself writes (`**…**`,
  `*…*`, `_…_`, `~~…~~`, `<u>`, `<span style`, `[…](…)`, `` `…` ``, `wl:` maths) is read as a markdown cell, so
  notes written before this change keep their formatting. The marker is added when that cell is next edited.
- **The Mac** reads the same files: it does not know the rule yet, so it shows text cells with joined lines and the
  escapes as their characters (standard markdown). Port the rule to the Mac when Sean asks.

## Switching

- **Ctrl+7 on a markdown cell** makes it a text cell: the marker goes, the formatting is removed, the visible text
  and its line breaks stay (one undo step).
- **Ctrl+Shift+7 on a text cell** makes it a markdown cell, and from then on its words are read as markdown (Sean,
  2026-10-05: "when converting a cell to markdown, it just processes markdown"): the marker goes on top and the
  escapes' backslashes go, so a literal `**x**` is bold now, a line starting `# ` is a heading (block markup at the
  head of the words makes them that block: the marker goes down to the words still a paragraph, or goes; it is never
  left over a heading), and single line breaks join as markdown joins them. Kept: Link Here's anchors, a line that is
  the marker itself, and a fence that would not close inside the cell (it would take the rest of the note into its
  code). The selection stays on the same visible characters; ONE undo step gives the text cell back exactly. A cell
  that is markdown already is left as it is. (Core `asMarkdownCell`.)
- **Automatic:** a rich-text action in a text cell (Ctrl+B / I / U, Ctrl+Shift+X, the toolbar's B I U S, the T menu
  (font, size, colour), a link (/link), inline maths (a `wl:` code span); there is no inline-code command) first turns the cell into a markdown cell exactly
  as Ctrl+Shift+7 does (its words read as markdown), then applies the formatting to the same visible characters: ONE
  undo step takes both back. Only the text cells the selection has a character of switch (a caret: the cell it is in,
  ends included); an action that changes nothing (the T menu's Remove on a text cell) switches nothing. TYPING the characters (`**`) in a text cell stays literal (the escape rule, while it is a
  text cell).

## Keys (the Ctrl / Cmd + number group)

| Key | Cell |
|---|---|
| Ctrl+1 … Ctrl+6 | the heading ladder (unchanged) |
| Ctrl+7 | Text (was Body Text) |
| Ctrl+Shift+7 | Markdown (new) |
| Ctrl+8 | Code block (unchanged) |
| Ctrl+Shift+8 | Runnable code (was Ctrl+9) |
| Ctrl+9 | Drawing cell (was Ctrl+0) |
| Ctrl+0 | free |

Digits are matched by the physical key (`KeyboardEvent.code` `Digit7`): Shift+7 types `&` on a US layout. The F1 list
and the quick reference group them as one block. These differ from the Mac (⌘9 is its evaluation cell) on purpose.

## Everywhere it has to hold

The parser (core: the marker, the escape rule, the older-notes rule; the incremental parser agrees), the source pane
(marker hidden, escapes hidden, line breaks as typed), the rendered page (text cells keep their lines and draw
nothing; markdown cells as today), the PDF / HTML export (the same), the + menu, the cell-kind commands and the
formatting commands (the automatic switch), copy / cut / paste of cells, the welcome note and Sean's quick
reference (keys), `docs/KEYS.md`, the F1 list.
