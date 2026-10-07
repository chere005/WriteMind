# SPEC-WM: the `.wm` note, `.wmdm` text, `drawing.json` and the project file

Format version 1. Written 2026-10-07 against the code at 2.15.0.

A note is a `.wm` file: a ZIP archive holding the text (`note.wmdm`), the drawing layer (`drawing.json`), the pictures and ink snapshots the note uses, and a `manifest.json`. A project is a small JSON file listing folders and `.wm` files. Notes written by 2.15.0 and earlier (`.md` + `.drawings/`) are converted once, in one direction (section 5).

## 0. Conventions

- MUST, MUST NOT, SHOULD, MAY are meant in the RFC 2119 sense. Everything is normative unless it sits in a paragraph that starts "Note".
- **[code]** the rule is what 2.15.0 does today (the file that does it is named). **[new]** the rule is introduced by this format; 2.15.0 does not do it. A rule with no tag in sections 2 and 3 is [code].
- "Reader" is anything that opens a `.wm`; "writer" anything that produces one. The app is both.
- "Preserve" means: the bytes (for a text entry, the decoded text; for JSON, the value) come back in the next file written, in the same place, unchanged.
- Offsets and "characters" in the text format are UTF-16 code units, because the parser's ranges are. They are never stored in a file.

## 1. The `.wm` container

### 1.1 Identity

- Extension `.wm` (readers match it case-insensitively; writers write lower case). Media type `application/vnd.writemind.note+zip`.
- [new] The first entry of the archive is `mimetype`, **stored** (method 0), no extra field, no data descriptor, whose content is exactly the 34 bytes `application/vnd.writemind.note+zip` (no newline). So every conforming file has, at fixed offsets:

  | Bytes | Value |
  |---|---|
  | 0-3 | `50 4B 03 04` |
  | 8-9 | `00 00` (method: stored) |
  | 14-17 | `C7 B6 5C 4E` (CRC-32 of the string, little endian) |
  | 18-21 and 22-25 | `22 00 00 00` (34, compressed and uncompressed size) |
  | 26-27 and 28-29 | `08 00` (name length) and `00 00` (extra length) |
  | 30-37 | `mimetype` |
  | 38-71 | `application/vnd.writemind.note+zip` |

  A sniffer decides "this is a `.wm`" from bytes 0-3, 30-37 and 38-71 alone. A full reader MUST also open an archive whose `mimetype` entry is not first (a repacked file), provided the entry exists with that content; it MUST NOT write such a file back with the entry anywhere but first.

### 1.2 Layout

| Entry | Required | Content |
|---|---|---|
| `mimetype` | yes | 1.1 |
| `manifest.json` | yes | 1.7 |
| `note.wmdm` | yes (empty is allowed) | the text, section 2 |
| `drawing.json` | no | the drawing layer, section 3. Absent means an empty drawing. A writer MUST write it whenever the drawing has any item, and MAY omit it when it has none. |
| `media/<name>` | no | a picture: the files `drawing.json` images and picture cells of the text name |
| `snapshots/ink-<uuid>.svg` | no | one SVG per drawing cell (ink cell), the picture the text's `![ink](...)` line points at |
| `attachments/<name>` | no | any other file the note carries (nothing writes one yet) |
| `legacy/<name>` | no | files kept from a conversion (5.4) |
| anything else | no | unknown: 1.8 |

Writers emit entries in this order: `mimetype`, `manifest.json`, `note.wmdm`, `drawing.json`, `snapshots/*`, `media/*`, the rest. Readers MUST NOT depend on the order (beyond 1.1), and MUST find entries through the central directory, never by scanning local headers.

An example listing (entries only):

```text
mimetype                                            stored   34
manifest.json                                       deflate  412
note.wmdm                                           deflate  3 180
drawing.json                                        deflate  9 877
snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg   deflate  2 204
media/3f9c2a7e5b1d4c80.png                          stored   58 311
```

### 1.3 ZIP profile

- PKWARE APPNOTE 6.3.x. Methods 0 (stored) and 8 (deflate) only. A reader that meets another method, an encrypted entry (general-purpose bit 0), a multi-disk archive or an unsupported feature MUST refuse the whole file, and leave it untouched.
- ZIP64 MUST be supported by readers and used by writers when an entry size or offset reaches 2^32-1 or the entry count reaches 65 535.
- Names are UTF-8. Writers set general-purpose bit 11 on any entry whose name is not pure ASCII. Readers read names as UTF-8 whether or not bit 11 is set, and refuse the file if a name is not valid UTF-8.
- Writers write an empty archive comment, no data descriptors on `mimetype`, and MAY use them elsewhere. Readers MUST handle both, and MUST take sizes and CRCs from the central directory and check them: a CRC mismatch or an entry that inflates past its declared size makes the file unreadable (refused, untouched).
- Entry timestamps are not normative; writers SHOULD use the note's `modified` time.

### 1.4 Compression

- `mimetype`: stored.
- `manifest.json`, `note.wmdm`, `drawing.json`, `snapshots/*.svg`: deflate (writers SHOULD; readers accept either).
- `media/*` and `attachments/*`: stored when the extension is one of `png jpg jpeg gif webp heic heif avif mp4 mov zip` (case-insensitive), deflate otherwise (`svg`, `pdf`, unknown).
- A writer that keeps an entry it did not change MAY copy its compressed bytes as they are.

### 1.5 Entry names

An entry name is valid when all of these hold; a reader MUST refuse the whole file (untouched) at the first name that is not:

- relative: it does not start with `/`, and has no drive part (`C:`);
- forward slashes only: no `\`;
- no segment is empty, `.` or `..`;
- no control character (U+0000-U+001F, U+007F) anywhere;
- no segment is longer than 255 UTF-8 bytes, and the whole name is not longer than 1024;
- no segment ends in a space or a dot (Windows would drop it).

Case and Unicode:

- Names are compared exactly, byte for byte, when a reference is resolved. A reader MUST NOT fold case or normalise Unicode to find an entry.
- Two entries with the same exact name make the file invalid.
- A writer MUST NOT write two entries whose names are equal after Unicode simple case folding (`A.png`, `a.png`): the file would not unpack on macOS or Windows.
- Writers SHOULD write NFC.
- A directory entry (a name ending `/`) is allowed, ignored, and not written.

A reader MUST NOT write an entry to the file system under the name it has in the archive. Entries are read into memory or a stream. (This is what makes `../x` harmless; 1.5 rejects it anyway.)

File names inside `media/`, `snapshots/` and `attachments/` are one segment. A picture's name, wherever it is written (the text's reference, `drawing.json`'s `file`), is that one segment and nothing else.

### 1.6 Limits

A reader MUST accept, and MAY refuse beyond: 20 000 entries; 256 MiB for each of `note.wmdm`, `drawing.json`, `manifest.json`; 2 GiB for any other entry; 8 GiB uncompressed in all. A reader refuses a file that exceeds the limits it enforces without reading further, and says which limit. A reader SHOULD also refuse an entry whose declared ratio is above 1000:1 when it inflates to more than 16 MiB.

Note: the sidebar needs a note's title and snippet, which today come from the first 8192 bytes of the file ([code] `notes.ts` `noteAt`). For a `.wm` that is the first 8192 bytes of `note.wmdm`; reading it needs the central directory and one inflate, not the whole file.

### 1.7 `manifest.json`

UTF-8 JSON object. [new]

```json
{
  "format": "writemind-note",
  "version": 1,
  "id": "0b6f5c1e-8d4a-5c0e-9a77-2f1d3b6a9e10",
  "created": "2026-10-08T09:14:03Z",
  "modified": "2026-10-08T09:20:41Z",
  "app": { "name": "WriteMind", "version": "2.16.0" }
}
```

| Key | Type | Rule |
|---|---|---|
| `format` | string | MUST be `writemind-note`. Anything else: refuse. |
| `version` | integer >= 1 | The format version, 1 here. Raised only for a change an older reader would misread (1.8). |
| `id` | string | A UUID, lower case. Set when the note is created and never changed by a save. A copy of a note (Duplicate) gets a new one. |
| `created` | string | RFC 3339 UTC (`Z`). Set once. |
| `modified` | string | RFC 3339 UTC. Set by every write that changes any entry; not by opening. |
| `app` | object | `name` and `version` of the app that last wrote the file. Informational. |
| `legacy` | object | Present on a converted note, 5.3. |

A reader MUST tolerate a missing `app`, `modified` or `legacy`. A missing `id` or `created` is repaired on the next write (a new `id`; `created` from the file's time). Key order and formatting are not normative.

### 1.8 Unknown entries, unknown keys, future versions

- **Unknown entries** (any name this section does not define, in any folder) are preserved on write: same name, same decoded bytes, same relative order.
- **Unknown keys** in `manifest.json` and in `drawing.json` (at the top level, and inside any item) are preserved: same key, same JSON value.
- **A file with `version` greater than the reader's own** is opened READ-ONLY. The reader MUST NOT write it (no autosave, no conversion, no "repair"), and says that a newer WriteMind wrote it. Changes that only add entries, keys, item kinds or text constructs do not raise `version`; those a reader preserves (above and 2.8, 3.6).
- **A file with the same `version`** is written with everything it had.
- A writer never deletes an entry the person did not remove. In particular a picture no longer named by the text or the drawing stays in `media/` until the person runs a clean-up ([code] `housekeeping.ts`: nothing is ever deleted on its own).

### 1.9 Writing

A `.wm` is never edited in place. Every save writes the whole archive again, [code] through `atomic.ts` `writeFileAtomic` plus [new] the two fsyncs:

1. Writes to one file go one after the other (a queue per absolute path; case-folded on Windows).
2. The target must not be read-only (`access(W_OK)`); if it is, throw, at once.
3. Write the new archive to `<file>.tmp` beside it (`Name.wm.tmp`: the same directory, so the rename never crosses a disk).
4. [new] `fsync` the temporary file, then close it.
5. Run the guard (below), immediately before the rename. It is also run once before step 3, so that a refusal costs no work.
6. `rename` the temporary file over the target. On `EBUSY`, `EPERM` or `EACCES` retry up to 5 times, waiting 15 ms and doubling each time; any other error is final.
7. [new] On POSIX, `fsync` the directory.
8. On any failure remove the temporary file, leave the target as it was, and report the error. The buffer in memory is kept.

A reader never opens `*.tmp` as a note. A new note is created without replacing a file that appeared since its name was chosen ([code] `createNote` uses `wx`; [new] for a `.wm`: write the temporary file, then `link` it to the name and remove the temporary, or an equivalent no-replace rename).

**The write guard** [code] `packages/core/src/notes/writing.ts` `mayWrite`, over digests instead of text [new]: the app owns the file only while the bytes on disk are the bytes it last read or wrote. It keeps, per absolute path, `known` = the SHA-256 of the file bytes it last read or wrote, and before each write computes `onDisk` = the SHA-256 of what is there now (or none):

| `onDisk` | `known` | Write? |
|---|---|---|
| none | none | yes (a new note saving itself the first time) |
| none | some | no (trashed or moved; an autosave does not put it back) |
| some | none | no (never read: not ours) |
| some | some | yes only if equal |

When the answer is no: nothing is written, the buffer is kept, the person is told in the footer, and the folder watcher brings the newer file in. After a successful write `known` is the digest of the bytes just written.

Note: today's drawing sidecar and ink snapshots are written with no guard ([code] `storeSidecar`, `saveInkSnapshot`). In a `.wm` the text, the drawing and the snapshots are one file, so one writer, one queue and one guard cover all of them: a save of the drawing carries the current text, and a save of the text carries the current drawing.

### 1.10 Reading

- Read the whole file once; parse from that snapshot (the rename in 1.9 means the snapshot is a whole old or whole new file).
- Set `known` (1.9) from those bytes.
- A file with no valid `manifest.json` is refused.
- A reference to an entry that is not there is not an error: the picture is shown as missing, the reference stays in the text, nothing is written for it.

## 2. `note.wmdm`: the text

`.wmdm` is today's markdown note text plus WriteMind's own conventions: the markdown marker line, the escape rule of text cells, anchors, maths, run cells, and references into the container. It is not meant to read well in another markdown viewer: a text cell's words rely on line breaks and backslashes a viewer will show literally.

### 2.1 Bytes and lines

- UTF-8. Writers write no byte-order mark; a reader that finds one strips it.
- Lines end with `\n`. A reader splits on `\n` alone (not on U+2028 or `\r`); a `\r` at the end of a line is tolerated (it is trimmed when a line is classified, and dropped from a paragraph's words) and is preserved if the line is not edited. Writers write `\n` only.
- "Trim" is JavaScript `String.prototype.trim` (all Unicode white space, `\r` included). A line is **blank** when its trim is empty.
- A writer MUST NOT change the line endings, trailing white space or final newline of text it did not edit. A cell is edited by replacing its own range; nothing else is touched.

### 2.2 Cells

The text is a sequence of **cells**. A cell is a block of consecutive lines, or a run of blank lines. Parsing is one pass, line by line (`packages/core/src/markdown/parser.ts`, class `Machine`; the incremental parser MUST give the same cells as a whole parse).

Inside a fenced block (2.4.9) every line belongs to the fence until it closes. Otherwise a line is classified by the **first** of these that matches (its trim is `t`):

| # | Rule | Effect |
|---|---|---|
| 1 | an open table and `t` continues it (2.4.7) | the line is a table row |
| 2 | `t` starts with three backticks | ends the open cell; opens a fenced cell |
| 3 | `t` is empty | ends the open cell; counts toward a blank run |
| 4 | a paragraph's last line is a table header and `t` is its delimiter row | opens a table (2.4.7) |
| 5 | `t` equals `<!-- markdown -->` | ends the open cell; opens a paragraph cell marked markdown |
| 6 | `t` is a rule (2.4.5) | a rule cell, one line |
| 7 | `t` is a heading (2.4.1) | a heading cell, one line |
| 8 | `t` is exactly one picture (2.4.6) | a picture cell, one line |
| 9 | `t` starts with `>` | quote line |
| 10 | `t` is a task item (2.4.4) | todo line |
| 11 | `t` starts with `- ` or `+ ` | bullet line |
| 12 | `t` starts with `* ` | dash line |
| 13 | `t` is 1-4 digits then `. ` or `) ` | numbered line |
| 14 | otherwise | paragraph line |

A line of rules 9-14 continues the open cell when it is of the same kind and otherwise ends it (so `- a` straight under a paragraph line starts a list, and `# h` straight under a list starts a heading). Rules 2, 5, 6, 7, 8 end the open cell and a table, a fence, a heading, a rule and a picture are each their own cell **even when no blank line separates them** from the cell above or below.

A cell's range runs from the first character of its first line to the last character of its last line, without the line break after it. A paragraph's range includes its marker line.

**Blank runs.** `N` consecutive blank lines (outside a fence) are: nothing for `N` = 1 or 2 (they are the separators); for `N` >= 3 a `blank` cell of `N - 2` empty lines. Writers separate cells with exactly one blank line and write a deliberate empty cell as `N` = 3 or more.

Example: `a`, 2 blank lines, `b`, 3 blank lines, `c` is the cells paragraph `a`, paragraph `b`, blank (1 line), paragraph `c`.

**What a reader that does not know a cell kind does:** every line that matches no rule above is a paragraph line, so unknown syntax degrades to a text cell with its characters intact. Every cell is written back over its own range and nothing else is touched. An unknown fenced block (2.4.9) is a code cell with its info string kept.

### 2.3 Text cells and markdown cells

Only the body-text **paragraph** has two kinds.

- A **markdown cell** is a paragraph whose first line is the marker `<!-- markdown -->` (alone on the line, surrounding white space allowed). Its words are the lines after the marker, joined with one space, read as markdown (2.5). The marker is part of the cell's range: deleting, moving or copying the cell takes it along. It is an HTML comment, so another markdown viewer shows nothing for it.
- A **text cell** is any other paragraph: its words are its lines exactly as the person typed them, every line break kept, nothing drawn as formatting. The file spells it with the **escape rule**.
- **Older notes rule.** An unmarked paragraph that contains UNESCAPED markup WriteMind writes (a bold, italic or strike pair; a `<u>`, `<span ...>`, `<mark ...>` or `<a ...>` tag other than the id-only anchors of 2.6.3; a `[..](..)` link; a code span, which includes `wl:` maths) is read as a markdown cell. Readers MUST apply it. Writers write the marker on every markdown cell they write, and MUST NOT add or remove a marker on a cell the person did not edit.
- Link anchors (2.6) are not markup for this purpose: a text cell that holds them stays a text cell.

**The escape rule.** A text cell's file text is its visible words with a backslash in front of each character that would otherwise change the file's meaning, and in front of nothing else. A reader reads `\` followed by one of ``\ ` * _ { } [ ] ( ) # + - . ! ~ < > |`` as that character alone (the backslash hidden); any other backslash is itself. The writer escapes:

- at the head of a line: `#` of a heading, `-` `*` `+` of a list or a rule, `>`, the `.` or `)` of `1.`, the first backtick of a fence, the `!` of a picture line, the first unescaped `|` of a table line or delimiter row;
- inside a line: the opening mark (both characters when it is doubled: `**`, `__`, `~~`, doubled backticks) of the first piece of markup the line would form, then the next, until none is left: `*`, `_`, `` ` ``, `[`, `<` (a tag or `<!`), `~`;
- a `\` that precedes a character the reader would take it to escape.

Link anchors are left as they are.

Example. The words `# not a heading` / `- or a list` / `**x** 1. a_b` are written

```text
\# not a heading
\- or a list
\*\*x** 1. a_b
```

The property a conforming implementation keeps (checked over 17 822 random lines): for any visible text `v` of non-blank lines, `unescape(escape(v)) == v`, and the file text `escape(v)` parses as exactly one text cell whose words are `v`.

Inside fenced blocks nothing is escaped or unescaped. Inside a markdown cell the same ``\ ` * _ ...`` set is honoured when markup is read, so `\*` is a literal star.

### 2.4 Blocks

Syntax, one example, and what a reader that does not know the construct preserves. "Preserve" is always: the lines, character for character.

**2.4.1 Heading.** One to six `#`, then a space (or nothing), then the words. Seven or more `#`, or `#` not followed by a space, is a paragraph line. The ladder: `#` Title, `##` Chapter, `######` Author (drawn italic, a little larger than body, not a sixth heading), `###` Section, `####` Subsection, `#####` Subsubsection. Sections are derived from headings and are not stored; which are folded is session state, not text.

```text
## Chapter words
```

**2.4.2 Text paragraph and markdown paragraph.** 2.3.

```text
Two lines, kept
as two lines.

<!-- markdown -->
**Bold** joined with _this_ line.
```

**2.4.3 Lists.** One item per line, a flat list: indentation in the source is kept and is not structure.

| Kind | Marker | Writer writes |
|---|---|---|
| dots | `- ` or `+ ` | `- ` |
| dashes | `* ` | `* ` |
| numbered | 1-4 digits, then `. ` or `) ` | `1. `, `2. `, ... |

A marker with no words (`- ` alone) trims to `-` and is a paragraph line. The number of a numbered item is not significant on reading.

```text
- dot
- dot
* dash
1. first
2. second
```

**2.4.4 To-do list.** `-`, `*` or `+`, a space, `[ ]`, `[x]` or `[X]`, then nothing or a space and the words (one space is removed; further spaces are words). `- [ ]x` is not a task. Writers write `- [ ] ` and `- [x] `. Task lines are checked before bullets.

```text
- [ ] to do
- [x] done
```

**2.4.5 Rule.** After trimming and ignoring spaces, three or more of one character from `-` `*` `_`, and nothing else. Writers write `---`.

**2.4.6 Picture cell, drawing cell.** A line that is only `![alt](dest)`. `alt` has no `]` or line break; `dest` has no `)` or line break; `dest` is either `<angle-bracketed>` or a path optionally followed by a quoted title (`"t"` or `'t'`); an empty path is no picture. `dest` names a picture in the container (2.6.1) or elsewhere.

```text
![a picture](media/3f9c2a7e5b1d4c80.png)
![ink](snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg)
```

A **drawing cell** (ink cell) is the picture cell whose file name is `ink-<uuid>.svg` (UUID in lower case or upper case). The cell's identity is that UUID, not its alt text (writers write `ink`). Its strokes live in `drawing.json` as the item `{"kind":"cell","id":"<uuid>",...}` (3.5); the SVG is a derived picture of it.

An unknown reader shows a picture, or nothing, and preserves the line.

**2.4.7 Table.** A GitHub pipe table, one cell from header to last row.

```text
| Key | Does |
|:----|-----:|
| a   | b    |
```

- Header: a line with an unescaped `|`, not indented by two or more columns (a tab is four). It may directly follow a paragraph line; that line is then the header and the lines above it are a paragraph of their own.
- Delimiter row: as many cells as the header, each `-+` with an optional `:` at either end (`:--` left, `:-:` centre, `--:` right), and a `|` in the line.
- Body rows: while a line has an unescaped `|` and starts no other block (a list item, quote, heading, fence, rule or picture). `\|` is a pipe inside a cell; the pipes at the two ends are optional.
- A short row is padded and a long one is cut to the header's width **in what is shown**; the source line is preserved.

**2.4.8 Quote.** Lines starting with `>`; the words are what follows `>`, trimmed, joined with a space.

```text
> a quote
> over two lines
```

**2.4.9 Fenced blocks.** A line whose trim starts with three backticks opens; the rest of the trim is the **info string**. The block ends at the first later line whose trim starts with three backticks (whatever follows them); an unclosed fence runs to the end of the note and is still a code cell. Body lines are kept raw, never trimmed. Only backticks fence (the parser does not know `~~~`).

Because any such line closes the block, a body line whose trim starts with three backticks MUST be written with a leading `\`.

The info string (trimmed, lower-cased for comparison) decides the cell:

| Info string | Cell | Meaning |
|---|---|---|
| `wl` | maths cell | display maths: the body is a Wolfram Language expression, typeset when the caret is not in it |
| `eval wl`, `eval python`, `eval c`, `eval c++`, `eval rust` | evaluation cell | code the note runs; coloured as that language |
| `eval <other>` | evaluation cell, environment unknown | never run, coloured plain; info string preserved |
| `out` | answer cell | what the evaluation cell above it printed |
| `c`, `cpp`, `wolfram`, `python`, `typescript`, `rust`, `java`, `bash`, `zsh`, or empty | code cell | coloured only; empty is plain |
| anything else | code cell, plain | info string preserved |

On reading, evaluation tags and code languages also accept the aliases `cpp`/`cc`/`cxx`/`hpp`/`h` (C++), `mathematica`/`wls`/`m`/`wolfram` (Wolfram), `py`/`python3`, `ts`/`tsx`/`js`/`javascript`, `rs`, `sh`/`shell`; writers write the canonical form (`eval c++` but a code fence `cpp`). `wl` is maths, never code; a Wolfram code cell is ```` ```wolfram ````.

`````text
```wl
\[Alpha]^2 + Sqrt[x]
```

```eval python
print(6 * 7)
```

```out
42
```
`````

An **answer cell** is found by position: the cell after an evaluation cell, blank cells between them skipped, and only when its info string is `out`. A run replaces that cell or inserts a new one; nothing else is replaced. Inside it one convention: a line in square brackets is the app speaking (`[stderr]`, `[exit 3]`, `[timed out]`, `[stopped by SIGSEGV (segmentation fault)]`, `[output cut at 64 KB]`, `[no output]`); every other line came out of the program. Output is cut at 64 KiB.

An unknown reader keeps the whole fence, info string and body.

**2.4.10 Blank cell.** 2.2.

### 2.5 Inline markup

Read inside markdown cells, headings, list items, quotes and table cells; never in text cells (a text cell has only its escapes and anchors) and never in fenced bodies. Read on the line with escapes masked, so an escaped mark is just that character. A reader that does not know a construct treats it as words and preserves its characters.

| Construct | Syntax | Example | Notes |
|---|---|---|---|
| bold | `**x**` or `__x__` | `**bold**` | the opening mark is followed by a non-space and the closing one preceded by one. Writers write `**`. |
| italic | `*x*` or `_x_` | `_it_` | same space rule, and `x` holds no `*` or `_`. Writers write `_`. |
| underline | `<u>x</u>` | `<u>under</u>` | HTML |
| strike | `~~x~~` | `~~gone~~` | |
| font, size, colour | `<span style="font-family: F; font-size: Npx; color: #RRGGBB">x</span>` | see 2.8 | declarations are `;`-separated; `font-size` is an integer in px; other declarations are read, ignored and preserved. Applying a style over an existing span replaces it. |
| highlight, anchor | `<mark id="wm-xxxxxxxx">x</mark>` | | 2.6.3 |
| code | single backticks, or doubled backticks round a span that holds a single one | `` `code` `` | contents are not markup |
| maths | `` `wl:EXPR` `` | `` `wl:x^2 + 1` `` | a code span whose text starts `wl:` and has a non-empty expression after it (white space trimmed). `` `wl:` `` alone is code. Typeset in markdown cells only; a text cell shows the span as typed. |
| link | `[text](dest)` | `[the plan](Plan.wm#wm-1a2b3c4d)` | 2.6.2 |
| picture | `![alt](dest)` | `![dot](media/ab12.png)` | the same syntax as 2.4.6, anywhere in a line |
| escape | `\` + one of the escapable characters | `\*` | 2.3 |

Note: the display rule above is `sourceStyle.ts`; the older-notes detection (2.3) is stricter for `_` and `__`, which must not touch a letter or digit outside the pair (so `snake_case_name` does not make a paragraph markdown, though a markdown cell would draw `case` in italics).

Precedence (what covers what): fenced bodies first, then double-backtick spans, single-backtick spans, links, HTML tags, bold, italic, strike. Pictures are found before all of them. Unmatched marks are words.

### 2.6 References, links, anchors

**2.6.1 References into the container.** [new] A picture destination that points into the container is exactly `media/<name>` or `snapshots/<name>`:

- no `./`, no `../`, no leading `/`; `<name>` is one segment.
- `<name>` is written percent-encoded except `A-Z a-z 0-9 . _ ~ -`; a reader decodes it (`%20` is a space; an invalid escape is read literally).
- `snapshots/` is for `ink-<uuid>.svg` only; everything else is `media/`.
- A reader MUST also read the 2.15.0 spelling, `[./][../]*.drawings/media/<name>` ([code] `images.ts` `mediaFile`), and resolve it to the same entry (`ink-<uuid>.svg` to `snapshots/`). Writers write the new spelling only.
- Any other destination (a URL, an absolute path, another relative path) is external: preserved verbatim, never bundled, never rewritten.

**2.6.2 Links between notes.** `/link` is an editor gesture; none of it is stored. What it writes is [code] `notes/linking.ts`:

```text
[Title](Other%20Note.wm#wm-1a2b3c4d)
```

- `dest` is the target's **file name** (with the `.wm` extension, [new]; `.md` before), percent-encoded for a path (`urlPathAllowed`: everything outside `A-Za-z0-9-._~!$&'()*+,;=:@/` is encoded), then `#` and an anchor if the link is to a part. A whole-note link has no `#`. The title has no `]` and no line break; an empty title is the file name.
- Resolution of `dest` (`resolveLinkTarget`), over the notes of the open project, in this order; the first rule that finds candidates answers, and among several candidates the one nearest the source wins (same folder, then the longest shared path):
  1. if `dest` contains a separator, the path taken relative to the source note's folder;
  2. a note whose file name equals the name in `dest`;
  3. the same, ignoring case;
  4. a note whose name without extension equals `dest`;
  5. the same, ignoring case;
  6. [new] when `dest`'s extension is `.md`, `.markdown` or `.txt`: the note whose name is `dest` with that extension replaced by `.wm`, then the same ignoring case.
- A link to a note that is not found is left as written and opens nothing.

**2.6.3 Anchors.** The part of a note a link points at:

- a heading: its **slug**: lower-cased, letters and digits (any script) kept, space `_` `-` become one `-`, everything else dropped, ends trimmed; `section` when nothing is left. No markup is written;
- a highlighted run: `<mark id="wm-xxxxxxxx">words</mark>`;
- any other block: `<a id="wm-xxxxxxxx"></a>` immediately in front of the block's first line's text.

`wm-xxxxxxxx` is `wm-` and eight lower-case hex digits, unique in the note. To follow `#id`, the reader looks for the first `id="id"` in the text and scrolls to the `<` before it; else for the heading whose slug is `id`; else it just opens the note. Anchors are hidden in text cells and are not formatting.

### 2.7 What a writer writes

- One blank line above and below every cell it writes, none doubled, none at the start or end of the note; except that a line break alone is enough where the parser already ends the cell (2.2). Pasted cells, new cells, an answer cell and a duplicate follow the same rule.
- A new markdown cell: marker first. A new text cell: the escape rule.
- Everything else as the tables above say it.

### 2.8 Example `note.wmdm`

Each construct once. This text parses to the cells listed under it with the 2.15.0 parser, except that the parser does not yet recognise the `media/` and `snapshots/` destinations as the container's (2.6.1): it reports `file: null` for both pictures.

`````text
# Field notes

Plain words, kept as typed.
A second line stays a second line. \# not a heading, \*not bold* either.

<a id="wm-5e6f7a8b"></a>A text cell that other notes link to.

<!-- markdown -->
**Bold**, _italic_, <u>underline</u>, ~~strike~~, <span style="font-family: Georgia; font-size: 18px; color: #2D7DD2">styled</span>, `code`, maths `wl:x^2 + 1` and a <mark id="wm-9c0d1e2f">highlighted run</mark>. See [the plan](Plan.wm#wm-1a2b3c4d) and ![dot](media/3f9c2a7e5b1d4c80.png).

## Lists

- dot item
- another dot
* dash item
- [ ] still to do
- [x] done
1. first
2. second

> a quote
> over two lines

---

| Key | Does |
|:----|-----:|
| a   | b    |

![a picture](media/3f9c2a7e5b1d4c80.png)

![ink](snapshots/ink-3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90.svg)

```wl
\[Alpha]^2 + Sqrt[x]
```

```eval python
print(6 * 7)
```

```out
42
```

```python
# code that is only coloured
```
`````

Cells, in order (what the 2.15.0 parser returns): heading 1; text paragraph (two lines; the escapes are gone from its words); text paragraph (the anchor is hidden); markdown paragraph (marker length 18); heading 2; bullets (2); dashes (1); todos (2: open, done); numbered (2); quote ("a quote over two lines"); rule; table (header `Key`,`Does`; aligns left, right; one row); picture; picture (drawing cell); code `wl`; code `eval python`; code `out`; code `python`.

## 3. `drawing.json`: the drawing layer

[code] `packages/core/src/drawing/model.ts` (`writeDrawing`, `decodeDrawing`), `inkCell.ts`, `shapes.ts`. Today it is the hidden sidecar `.drawings/<note>.json`; in a `.wm` it is this entry, with the same content.

### 3.1 File

UTF-8 JSON, one object: `{ "items": [ ... ] }`, written by `JSON.stringify(value, null, 1)` (one-space indent; not normative). The array order is the paint order, first item at the bottom; the exporters paint in this order. There is no version key of its own: the schema version is `manifest.version`.

Readers also accept [code]:

- a top-level `strokes` list (the oldest sidecars), read before `items`;
- a leading byte-order mark;
- an empty or blank file as an empty drawing.

Writers never write `strokes` or a BOM.

### 3.2 Coordinates and transforms

- Points are `{ "x": number, "y": number }`, in **fractions of the pane**: `(0,0)` the top-left, `x` to the right, `y` down, `(1,1)` the bottom-right. The pane is the rectangle the drawing layer covers over the page. Widths of pictures and shapes are fractions of the pane's width; `aspect` is height over width.
- Stroke `width` and connector or shape `lineWidth` are in pixels of the page, not fractions.
- Every item has a `transform`: `{ "dx", "dy", "scale", "rotation" }`: `dx` and `dy` are a translation in fractions of the pane's width and height, `scale` a positive factor (never below 0.02 after a gesture), `rotation` radians, clockwise on screen. The scale and rotation are applied about the item's own centre **in points of the page**, then the translation. The centre is the middle of the item's untransformed bounding box (a stroke's points, an image's or shape's `center` and box, a connector's path). This makes a rotated stroke keep its shape at any pane aspect ratio.
- Inside a drawing cell (3.5) the same rules hold with **the cell's width** in place of the pane's width and height, on both axes.
- Identity transform: `{ "dx": 0, "dy": 0, "scale": 1, "rotation": 0 }`.

### 3.3 Items

Every item is an object with a `kind`. All other fields below are written by the writer; the reader's default for a missing or wrong-typed field is in the last column. `id`: a string, unique in the drawing; a missing one is replaced by a fresh UUID (so a writer always writes it). Numbers are finite; anything else takes the default.

**`stroke`** (a stroke with no points is dropped)

| Field | Type | Default |
|---|---|---|
| `id` | string | new UUID |
| `colorHex` | string, `#RRGGBB` | `#1C1C1E` |
| `width` | number, px | 3 |
| `points` | list of points | (required: empty list drops the item) |
| `pressures` | list of numbers 0..1, one per point | absent; a list of another length, or with a non-number, is dropped whole; values are clamped to 0..1 |
| `transform` | transform | identity |
| `group` | string or null | null |

**`image`**

| Field | Type | Default |
|---|---|---|
| `id` | string | new UUID |
| `file` | string: the name of an entry of `media/` | `""` |
| `center` | point | `{0.5, 0.5}` |
| `width` | number: fraction of the pane's width | 0.35 |
| `aspect` | number: height over width | 1 |
| `transform` | transform | identity |
| `hidden` | boolean: put away (read into words), not deleted; not painted, not picked | false |
| `group` | string or null | null |

**`shape`** (a flow-chart node, a mark, or a text box)

| Field | Type | Default |
|---|---|---|
| `id` | string | new UUID |
| `shapeKind` | one of `rectangle`, `roundedRectangle`, `oval`, `diamond`, `triangle`, `parallelogram`, `text`, `check`, `cross`, `star`, `question` | `rectangle` |
| `center` | point | `{0.5, 0.5}` |
| `width` | number | 0.18 |
| `aspect` | number | by kind: 0.55 rectangle, rounded rectangle, parallelogram; 0.6 oval; 0.7 diamond; 0.8 triangle; 0.3 text; 1 others |
| `colorHex` | string | `#1C1C1E` |
| `lineWidth` | number, px | 2 |
| `fillHex` | string or null | null |
| `label` | string: what a node (or text box) says; marks have none | `""` |
| `transform` | transform | identity |
| `group` | string or null | null |

`kind` is `"shape"`; the shape's own kind is `shapeKind` because both would be called `kind`. A reader also takes `kindName` for `shapeKind`. `text` is a box of words with no outline of its own. Nodes are every kind except `check`, `cross`, `star`, `question` (the marks).

**`connector`** (an arrow or line)

| Field | Type | Default |
|---|---|---|
| `id` | string | new UUID |
| `start`, `end` | point | `{0.3, 0.5}`, `{0.7, 0.5}` |
| `startNode`, `endNode` | string (the `id` of a shape in the same list) or null; an empty string is null | null |
| `startHead` | `none` or `arrow` | `none` |
| `endHead` | `none` or `arrow` | `arrow` |
| `line` | `solid`, `dashed`, `dotted` | `solid` |
| `colorHex` | string | `#1C1C1E` |
| `lineWidth` | number, px | 2 |
| `transform` | transform | identity |
| `bends` | list of points: the corners between the ends, for a line attached to a node | `[]` |
| `overrides` | list of `{ "index": integer, "vertical": boolean, "value": number }`: segments moved by hand (`index` the segment, `vertical` when it runs up and down so `value` is an x; else a y; a fraction of the frame). They win over the routing. Written only when there is one. | absent |

A connector with an end on a node is routed and its `start`, `end` and `bends` are the routed points as last stored. A connector has no `group`. Deleting a node deletes the connectors attached to it.

**`cell`** (an ink cell; 3.5)

| Field | Type | Default |
|---|---|---|
| `id` | string: a UUID; it is also the name of the snapshot | new UUID |
| `aspect` | number > 0: height over width of the cell | 200/720 |
| `items` | list of items other than `cell` (a cell never holds a cell) | `[]` |

### 3.4 Groups and nodes

A group is nothing but a shared `group` string on the items in it. It changes what a click and a marquee pick up; it moves nothing. Connectors are held by their nodes (`startNode`, `endNode`).

### 3.5 Drawing cells

A drawing cell is one item of the drawing, hidden on the page (it is not painted, picked, erased or measured with the page's items), in the text by `![ink](snapshots/ink-<uuid>.svg)`. Its `items` use fractions of the cell's shown width on both axes (3.2). `snapshots/ink-<uuid>.svg` is a derived picture of it: the cell drawn at the width it was shown at (720 when that is not known; the width is not stored in the model) and `width * aspect` tall, with transparent background and pictures named by `href` relative to the snapshot (`../media/<name>`, [new]; 2.15.0 writes the bare name beside the snapshot), plus `<metadata id="writemind-ink">` holding the cell's JSON item (XML-escaped). A reader MUST NOT need the snapshot for anything: it regenerates a missing snapshot from the cell. If a snapshot has no cell in `drawing.json` and carries the metadata, the reader MAY adopt the cell from it.

Items taken off the page into a cell, and back (docking, undocking), are re-expressed by a pure translation in points; that is not stored.

### 3.6 Tolerant decode, preservation

The reader is **total**: whatever bytes it is given it returns a drawing and never throws; the file is only "damaged" in the sense below.

- A field that is missing or the wrong type takes the default in 3.3. A list that is not a list is empty.
- An item that is not an object, has no `kind`, has a kind the reader does not know, or is a stroke with no points is **not an item** in the model. A cell's own items are read the same way.
- The file is **damaged** when it is not JSON, is JSON of another shape, or any item was not usable. The caller keeps a copy of the file before the next save replaces it (the `Recovered` copy).

[new] Preservation. 2.15.0 drops what it does not understand (an unknown field on an item, an unknown top-level key, an item of an unknown kind, the original `shapeKind` of a kind it maps to `rectangle`). A conforming reader keeps it:

- every unknown field of an item, of the top-level object and of a cell is preserved and written back with the item;
- an item of an unknown kind is kept in the list in its place, as opaque JSON; it is not painted or picked, but it is saved, and it survives its neighbours being edited and reordered;
- an unknown `shapeKind` is painted as a rectangle in the same box and its original string is written back unchanged;
- a damaged item is kept as opaque JSON as well and is reported, not dropped.

A writer writes every known field of every item it writes (so a file is self-describing); `pressures` and `overrides` only when present.

### 3.7 Example

```json
{
 "items": [
  { "kind": "stroke", "id": "s1", "colorHex": "#1C1C1E", "width": 3,
    "points": [ { "x": 0.1, "y": 0.1 }, { "x": 0.2, "y": 0.15 } ], "pressures": [ 0.4, 0.6 ],
    "transform": { "dx": 0, "dy": 0, "scale": 1, "rotation": 0 }, "group": null },
  { "kind": "image", "id": "i1", "file": "3f9c2a7e5b1d4c80.png", "center": { "x": 0.5, "y": 0.5 },
    "width": 0.35, "aspect": 0.75, "transform": { "dx": 0, "dy": 0, "scale": 1, "rotation": 0 },
    "hidden": false, "group": "g1" },
  { "id": "n1", "kind": "shape", "center": { "x": 0.3, "y": 0.3 }, "width": 0.18, "aspect": 0.55,
    "colorHex": "#1C1C1E", "lineWidth": 2, "fillHex": null, "label": "Start",
    "transform": { "dx": 0, "dy": 0, "scale": 1, "rotation": 0 }, "group": "g1", "shapeKind": "rectangle" },
  { "kind": "connector", "id": "c1", "start": { "x": 0.3, "y": 0.4 }, "end": { "x": 0.7, "y": 0.4 },
    "startNode": "n1", "endNode": null, "startHead": "none", "endHead": "arrow", "line": "solid",
    "colorHex": "#1C1C1E", "lineWidth": 2, "transform": { "dx": 0, "dy": 0, "scale": 1, "rotation": 0 },
    "bends": [] },
  { "kind": "cell", "id": "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90", "aspect": 0.2778, "items": [] }
 ]
}
```

(Line breaks inside an item are for reading only.)

## 4. The project file

[code] `apps/desktop/src/main/project.ts`. A project is the list of what the sidebar shows; nothing else. Which notes are open, where the caret was, what was folded and unsaved text are the **session**: one file per project in the app's user-data folder (`Sessions/<project-file-name>-<hash of its path>.json`, `default.json` for an untitled project), never in the project file.

### 4.1 File

Extension `.writemind-project` (appended when a name is given without one). UTF-8 JSON, one object:

| Key | Type | Meaning |
|---|---|---|
| `version` | integer | 1. Read as 1 when missing or not a number. |
| `folders` | list of strings | The folders of the project, in sidebar order. Empty is allowed on reading (the app then shows its default folder). |
| `excluded` | list of strings | Folders inside the project's folders that are kept out of the sidebar and left on disk. Missing is an empty list. |
| `files` | list of strings | [new] The `.wm` files open in the project, in tab order, as the Sublime-style project lists them. A listed file is part of the project whether or not it lies under a listed folder. Missing is an empty list. |

Strings of other types in these lists are ignored on reading. Entries that do not exist are kept (they show as missing), never dropped by a save.

Writers print the Mac's way (Foundation `.prettyPrinted + .sortedKeys + .withoutEscapingSlashes`) so a project shared through git does not change shape when the other machine saves it: keys sorted (`excluded`, `files`, `folders`, `version`), two-space indent, `"key" : value`, one list item per line at four spaces, an empty list as `[`, a blank line, `  ]`, no trailing newline, slashes unescaped:

```json
{
  "excluded" : [
    "/Users/s/Documents/WriteMind/Archive"
  ],
  "files" : [
    "Notes/Today.wm",
    "/Users/s/Desktop/Scratch.wm"
  ],
  "folders" : [
    "Notes"
  ],
  "version" : 1
}
```

It is written beside-and-renamed like a note (1.9, without the digest guard); a failed save leaves the old file and the project stays "edited".

### 4.2 Paths

- [code] Every path written is absolute and tidy (`path.resolve`). [new] A writer writes a path **relative to the project file's directory**, `/`-separated, when the target lies at or under that directory, and absolute otherwise. A reader accepts both, resolving a relative path against the project file's directory (`..` is allowed here, unlike in 1.5). An untitled project (no file yet) holds absolute paths only.
- A path from the other kind of machine (a POSIX absolute path read on Windows; a drive path or `\\` path read elsewhere) is kept exactly as written; it shows as a folder that is not there and a save does not change it. A relative path is never foreign.
- [new on reading; `addFolder` does it today] Two entries are the same when equal after resolving (case-insensitively on Windows); the later one is dropped from the list. Order is otherwise preserved.
- A file in `files` whose name does not end in `.wm` (case-insensitive) is ignored by the app and preserved.

### 4.3 Unknown keys, versions

[new] Unknown top-level keys are preserved (key and JSON value; their byte layout is not normative, and they print in sorted position). 2.15.0 drops them (`parseProject`). A project with a `version` greater than the reader knows is opened and shown, and saved over only after the person agrees, keeping the version it had; 2.15.0 writes 1 whatever it read.

### 4.4 Other state next to the project

Not part of this format, unchanged: `.writemind/order.json` in each project folder (`{"folders": {"<path relative to the folder, "" for the folder>": ["<row name>", ...]}}`, the hand-kept order of rows; names are file names with extension, so a `.wm` row is named `X.wm`).

## 5. The legacy format and its conversion

### 5.1 The legacy format (2.15.0 and earlier) [code]

A note is a file with extension `.md`, `.markdown` or `.txt` (`NOTE_EXTENSIONS`) in a project folder `F` (or a section folder under it). Its text is the `.wmdm` grammar of section 2 with these differences: picture destinations are `[../]*.drawings/media/<name>` (one `../` per section folder between the note and `F`; the app reads only `<name>`); links name the target's file with its legacy extension.

Hidden folders beside the notes:

- `F/.drawings/<stem>-<h>.json`: the note's drawing, where `stem` is the file name without extension and `h` is the first 12 hex digits of SHA-1 of the note's path **relative to `F`**, forward slashes, with extension, UTF-8 (`Ideas/Plan.md`). Two older places are also read, in this order after it: `<root>/.drawings/<stem>-<h'>.json` with `h'` from the note's **absolute** path (the notes root's, before drawings travelled), and the Mac app's `F/.drawings/<stem>.json` (a different spelling of the same drawing: kinds nested one level down, points as `[x, y]`; `apps/desktop/src/main/macDrawing.ts` `fromMacDrawing` converts it).
- `F/.drawings/media/<name>`: pictures of every note under `F`, by name, shared. Names are `<first 16 hex of SHA-1 of the bytes>.<ext>` for pictures the app saved (so the same picture twice is one file), or a UUID or `TRACE-n.pdf` for pictures a Mac notebook made. A picture is found by name in `F/.drawings/media`, then in every other project folder's, then in the notes root's (`findMedia`).
- `F/.drawings/media/ink-<uuid>.svg`: the snapshot of each ink cell.
- `F/.writemind/order.json`: 4.4.

`F` is the first project folder that equals or contains the note (`ownerOf`).

### 5.2 When and what

Conversion runs once per project folder, on the first launch that opens it with the `.wm`-capable app, and again when a folder is added to a project, over every legacy note under that folder (recursively, skipping every folder whose name starts with `.` and the project's `excluded` folders; those are converted when they are brought back). It is one-way: nothing converts a `.wm` back.

Two passes. Pass 1 decides every note's new name for the whole project (links cross folders). Pass 2 builds the containers.

### 5.3 One note

For a legacy note `N` = `Section/Stem.ext` in `F`:

1. **Read.** `B` = the bytes of `N`. If `B` is not valid UTF-8, skip the note: leave everything as it is and report it (a lossy decode would change the person's words). Strip a BOM.
2. **Name.** The new name is `Stem.wm` in the same folder; if that name is taken by a file that is not this note's own earlier conversion (below), `Stem 2.wm`, `Stem 3.wm`, ... (the app's `uniquePath` rule). So `A.md` and `A.markdown` become `A.wm` and `A 2.wm` (notes are taken in file-name order, case-insensitive, then by extension in the order `.md`, `.markdown`, `.txt`). The stem is already fit for a file name; `fileNames.ts` rules apply to the new one.
3. **Drawing.** `D` = the first of the three sidecar places (5.1) that exists. `drawing.json` = `writeDrawing(decodeDrawing(D))`; for the Mac's spelling `fromMacDrawing` first. If the decode was **damaged** (3.6), or `D` was the Mac's spelling, the original bytes of `D` are also stored as `legacy/sidecar.json`. If no sidecar exists, no `drawing.json` is written (a drawing cell's items then come from its snapshot's metadata when it has them).
4. **Assets.** The set of names = every picture file `drawing.json` names (images, pictures inside cells) + `ink-<id>.svg` of every cell + every `.drawings/media/<name>` the text names (the whole text, code fences included: keeping one file too many costs nothing). For each name, the bytes are the file found by 5.1's search. Pictures go to `media/<name>`, snapshots to `snapshots/<name>`; bytes are copied exactly. A missing snapshot is regenerated from its cell (3.5); any other file that cannot be found is skipped and listed in `legacy.missing`; its references stay as written. The name stays the same, **except** that a name that equals another of the note's names under case folding gets `-2`, `-3` before its extension, in the order met, and every reference to it (`drawing.json` `file`, the text) is rewritten to match.
5. **Text.** `note.wmdm` = `B` with exactly these edits, outside fenced bodies and outside inline code spans, and not inside a text cell (a text cell's words are as typed and must not change; its escaped `[` is not a link):
   - a picture destination `[./][../]*.drawings/media/<name>` becomes `media/<name>` (`snapshots/<name>` for an `ink-<uuid>.svg`), `<name>` kept as written (percent-encoded or not) unless renamed in step 4;
   - a link destination `file[#anchor]` whose decoded `file` ends in `.md`, `.markdown` or `.txt` (case-insensitive), has no URL scheme, and resolves by `resolveLinkTarget` to a note being converted: the extension in the written text becomes `.wm`, everything else (directories, percent-encoding, `#anchor`) untouched. If the target's new name is not `<Stem>.wm` (it was renamed in step 2), the file component is replaced by the new name, percent-encoded as in 2.6.2. `Other%20Note.md#wm-1a2b3c4d` becomes `Other%20Note.wm#wm-1a2b3c4d`.
   - Unresolvable links and links with no extension are left alone. Anchors (`<a id>`, `<mark id>`, heading slugs), markers, escapes, blank lines, line endings, the older-notes paragraphs (no marker is added) are not touched.
6. **Ids.** Anchor ids, drawing item ids, ink cell ids, group ids and snapshot names are kept. The note gets `manifest.id` = the UUID v5 of the name `<sha256 hex of B>:<N relative to F>` in the namespace `d0f4a6a2-6b1e-4f58-9a35-5f0d4c7a1b21`, so converting the same note twice, or on two machines, gives the same id. The note's **identity for links** stays its file name (2.6.2).
7. **Manifest.** `format`, `version` 1, `id`, `created` (the file's birth time when the system has it, else its mtime), `modified` (its mtime), `app`, and
   ```json
   "legacy": { "source": "Section/Stem.md", "sha256": "<hex of B>", "sidecar": ".drawings/<name>.json" or null,
               "converted": "<RFC 3339>", "app": { "name": "WriteMind", "version": "..." }, "missing": ["<name>", ...] }
   ```
   (`missing` only when non-empty.) `sidecar` is the path of the file `D` was read from, relative to `F` (the notes root's older place keeps its `<root>`-relative path).
8. **Write.** As 1.9, to `Section/<new name>`.
9. **Verify.** Read the new file back: `note.wmdm` decodes to the bytes of step 5; every asset entry has the SHA-256 of its source; `drawing.json` decodes to a drawing deep-equal to `decodeDrawing(D)` after step 4's renames. On any difference remove the new file (it is ours) and keep the legacy note as it was; report it.

### 5.4 The backup, then the originals

After pass 2 for a folder `F`:

1. The backup folder is `<parent of F>/<name of F> legacy backup <YYYYMMDD-HHMMSS>/` (local time); if the parent is not writable, `F/.writemind/legacy/<YYYYMMDD-HHMMSS>/`. It mirrors `F`'s layout: `Section/Stem.md` for every converted note, `.drawings/...` and `.writemind/order.json`.
2. Each verified note, and each sidecar it used, is **moved** there (same-volume `rename`; across volumes: copy, `fsync`, compare SHA-256, then remove the original). An original is never removed before a byte-identical copy exists in the backup.
3. `F/.drawings/` (the media, every sidecar, orphans) is moved whole only when every legacy note under `F` was converted; otherwise it stays where it is and the backup receives a copy. The Mac's `<stem>.json` files go with it.
4. `.writemind/order.json` is copied to the backup first and then rewritten atomically with each converted row's name changed to its new name (`Stem.md` becomes `Stem.wm`); every other byte of the file's structure is kept.
5. Open-note paths in the remembered sessions that name a converted note are changed to the new path, each session file rewritten atomically. A note's unsaved text in a session is written into its new `.wm` only when the legacy file still has the bytes the session was an edit of; otherwise it stays in the backup's `unsaved/` (never discarded).

The backup is never deleted by the app.

### 5.5 Idempotence and resuming

- A legacy note is **converted** when a `.wm` beside it has `manifest.legacy.source` equal to its relative path and `manifest.legacy.sha256` equal to the SHA-256 of its bytes. A converted note is not converted again and is not listed (the sidebar lists the `.wm`).
- Running conversion on a folder with no legacy notes does nothing and writes nothing (no backup folder is made).
- A run interrupted between 5.3 and 5.4 is finished by the next run: converted notes are recognised by the rule above and only the move to the backup is done.
- A legacy note whose bytes changed after its `.wm` was made (another app edited it) is a new note: it is converted under a new name (5.3 step 2), not merged and not overwriting.
- A `.wm` file that exists and is not the conversion of the note is never overwritten.

## 6. Conformance

### 6.1 Invariants

1. **Nothing is dropped.** Load then save, with no edit: every entry's decoded bytes, every manifest key, every unknown drawing key and item, every unknown text, in place (1.8, 3.6, 2.2).
2. **Whole file or old file.** At every instant a reader sees a complete old or a complete new `.wm` (1.9). A crash leaves at most `Name.wm.tmp`.
3. **Not ours, not written.** The guard (1.9): a changed or missing file is not overwritten by an autosave.
4. **Untouched text stays.** A save that did not edit `note.wmdm` writes the same decoded bytes; an edit rewrites only the edited cell's range (2.1).
5. **Parse agreement.** Whole-document parse equals incremental parse over any sequence of edits; a text cell's escape rule round-trips (2.3).
6. **References are never silently rewritten.** A reference to a missing entry stays as written (1.10).
7. **Names are safe.** No entry name outside 1.5 is read, written or extracted; no read touches a path outside the container.
8. **Never delete the original.** Conversion moves into the backup only after a verified copy; nothing in 5 removes the only copy of anything (5.4).
9. **Newer is read-only.** A `version` above the reader's is never written (1.8).

### 6.2 Test vectors

Each is an input and an expected result; build the archive with any ZIP library plus the byte rules of 1.1.

1. **Minimal file.** Entries `mimetype` (stored), `manifest.json` (valid), `note.wmdm` = `# T\n`. Bytes 0-71 match 1.1 exactly. Opens; title `T`; saving with no edit gives an archive whose decoded entries equal the input's.
2. **Sniffing.** (a) The same file repacked with `mimetype` second: opens, and is written back with `mimetype` first. (b) `mimetype` content `application/zip`: not a `.wm`, refused. (c) `manifest.json` with `format` `epub`: refused, file untouched.
3. **Unknown things survive.** A file with `extra/x.bin` (3 bytes), a manifest `"x-future": {"a": [1, 2]}`, a `drawing.json` with top-level `"zzz": 1`, an item `{"kind": "sticker", "id": "q"}` between two strokes, and a stroke carrying `"tag": "hi"`. Open, type a character in the text, save. All five are still there, the sticker still between the strokes, `modified` changed, `id` unchanged.
4. **Future version.** `manifest.version` 2 with an entry the reader does not know: opens, the editor is read-only, no autosave runs, the file's SHA-256 is unchanged after a session of attempted edits.
5. **Hostile names.** Archives whose entries are named `../x`, `/abs`, `a\b`, `C:/x`, `media/../../x`, `a//b`, a duplicate `media/a.png` twice, and `media/A.png` plus `media/a.png`; each is refused (the last as a writer error, the others on reading), the file is not modified, and nothing is created outside a temporary directory.
6. **Atomic write and guard.** (a) Kill the process after the temporary file is written and before the rename: the target is byte-identical to before; `Name.wm.tmp` is not listed as a note. (b) Between opening and saving change the file on disk: the save writes nothing, keeps the buffer, reports it. (c) Delete the file, then save: nothing is written. (d) Record the order of calls for one save: write temp, fsync temp, guard, rename, fsync directory.
7. **Text grammar.** The 2.8 example parses to the cell list under it; and `a`, two blank lines, `b`, three blank lines, `c` gives paragraph, paragraph, blank (1), paragraph; `-` alone, `- ` alone and `#nospace` and `####### seven` are paragraph lines; an unclosed fence is a code cell to the end; `- [x]done` is a dot item whose words are `[x]done`, not a task; `\|` stays inside a table cell.
8. **Escape rule.** For the visible words `# not a heading\n- or a list\n**x** 1. a_b`, the file text is `\# not a heading\n\- or a list\n\*\*x** 1. a_b`; it parses to one text cell with those words; an unmarked paragraph `**x**` is a markdown cell; adding the marker does not change what it shows; `<!-- markdown -->` typed as words is written `\<!-- markdown -->`.
9. **Drawing decode.** `drawing.json` = `{"zzz":1,"strokes":[{"points":[]},{"id":"x","points":[{"x":0,"y":0}]}],"items":[{"kind":"sticker"},{"kind":"shape","id":"h","shapeKind":"hexagon"},{"kind":"stroke","id":"p","points":[{"x":0,"y":0},{"x":1,"y":1}],"pressures":[1]},null]}`. Decoded model: items `x` (stroke), `h` (rectangle, defaults), `p` (stroke, no pressures); `damaged` true. Saved back with the 3.6 preservation: `zzz`, the sticker, `shapeKind` `hexagon`, the stroke with no points and the `null` are all still in the file (as opaque entries of `items`; `strokes` itself is not written).
10. **Conversion.** A folder with `A.md` (text: a heading, `[B](B.md#wm-12ab34cd)`, `![](.drawings/media/3f9c2a7e5b1d4c80.png)`, an ink cell line, and a code fence containing `.drawings/media/x.png`), `Sec/B.md` with `<a id="wm-12ab34cd"></a>`, the sidecar `.drawings/A-<sha1("A.md")[:12]>.json` with an image and a cell, the picture and the snapshot in `.drawings/media`. Result: `A.wm` and `Sec/B.wm`; `A.wm`'s text has `[B](B.wm#wm-12ab34cd)`, `![](media/3f9c2a7e5b1d4c80.png)`, `![ink](snapshots/ink-....svg)`, and the fence untouched; `A.wm` has the picture and the snapshot with the source bytes; `manifest.legacy.sha256` is A.md's; the backup folder holds `A.md`, `Sec/B.md` and `.drawings/` byte-identical; the folder has no `.md`; `order.json` names `A.wm`; a second run changes nothing and makes no backup folder.
11. **Conversion edge cases.** (a) `A.md` and `A.markdown`: `A.wm` and `A 2.wm`, and a link to `A.markdown` becomes `A%202.wm` if it resolved to the second. (b) Media `X.png` and `x.png` in one note: the second is `media/x-2.png` and its references follow. (c) A reference to a picture that is nowhere: kept, listed in `legacy.missing`, conversion succeeds. (d) Invalid UTF-8 note: skipped, untouched, reported. (e) A damaged sidecar: converts the readable items and `legacy/sidecar.json` holds the original bytes. (f) A Mac-spelling sidecar (`<stem>.json`, points as `[x, y]`): converted to the flat spelling. (g) `A.md` edited after `A.wm` was made: `A 2.wm` is made, `A.wm` untouched.
12. **Links.** `resolveLinkTarget` with notes `/r/Other.wm`, `/r/Sec/Other.wm` from `/r/Sec/A.wm`: `Other.wm` resolves to `/r/Sec/Other.wm` (nearest), `Other.md` resolves to it too (6), `Other` resolves to it (4), `../Other.wm` to `/r/Other.wm`, `Nope.md` to nothing.
13. **Project file.** (a) The Mac-shaped file `{"excluded":[],"folders":["/a"],"version":1}` reads with no files and writes back in 4.1's layout with `"files" : [`, a blank line, `  ]`. (b) A file with `"x-future": {"a": 1}` and `"files": ["Notes/T.wm"]` read from `/p/proj.writemind-project` resolves the file to `/p/Notes/T.wm`, and a save writes `x-future` back and `Notes/T.wm` relative. (c) `C:\Users\x` read on a Mac is kept as written. (d) A duplicate path is listed once.

## 7. Where the 2.15.0 code has to change

Everything tagged [new] above, and in particular: the note listing and `noteAt` read a file's first 8 KiB as text; `mediaFile` knows only the `.drawings/media` spelling; `decodeDrawing` and `parseProject` drop what they do not know; `mayWrite` is given text; the drawing and the snapshots are written without a guard; `writeFileAtomic` does not `fsync`; `resolveLinkTarget` does not match `X.md` to `X.wm`; `NOTE_EXTENSIONS` is `.md .markdown .txt`; the project file holds absolute paths only and always writes version 1.
