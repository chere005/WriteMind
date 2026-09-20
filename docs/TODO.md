# What is next

The open list. Everything already built is in [FEATURES.md](FEATURES.md); how
it is built is in [AGENTS.md](../AGENTS.md).

## Open

1. **Watch it in use.** Everything below was reasoned and unit-tested, not
   watched: the sidebar drag without edit mode, marks dragged out, ⌥-drag
   arrows and their segment handles, the notebook brackets and folding,
   Japanese OCR on a real page, a dot-grid capture, the toolbar's tooltips
   and collapsing sections.
2. **WYSIWYG, the rest of the way.** A block opens styled as you type
   (`MarkdownSourceStyle` in `BlockEditor`) and every bar button now works
   with nothing clicked (`EditorBridge.ensureEditing` opens a block first).
   What is NOT done is hiding the markers altogether — a true rich-text
   surface with an attributed-string ⇄ markdown converter covering `**`,
   `_`, `<u>`, `~~`, `<span style>`, headings, lists, quotes, fences, `wl:`
   maths, links and tables. Plan that before writing it; the source editor
   stays the source of truth.
3. **OCR, further.** The marks that are read now are strikethrough, rings,
   arrows and algebra. Not done: tables drawn by hand, checkboxes, and
   arrows that should land BETWEEN two words of the same line (they are
   placed on their own line at the right height instead).
4. **The camera pane's own bar** has never had the tooltip treatment the
   editor's bar got.
