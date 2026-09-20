import AppKit

/// The toolbar's — and the Tab key's — handle on the live NSTextView. SwiftUI
/// owns the text binding; this applies an `Edit` through the text view so undo
/// and the delegate both see it.
final class EditorBridge {
    weak var textView: NSTextView?
    /// A picture on the pasteboard at ⌘V, for whichever text view has the
    /// keyboard — the source editor or a block in the preview. Returns true
    /// when it was taken, and the paste stops there.
    var pasteImage: ((NSPasteboard) -> Bool)?
    /// Opens a block for editing when there is no text view to talk to —
    /// the preview, with nothing clicked yet. Returns true when there will
    /// be one in a moment, so a button press is not lost (Sean, 2026-09-19:
    /// "allow wysiwyg editing including all the buttons on the bar").
    var ensureEditing: (() -> Bool)?
    /// Moving a whole section means nothing inside one block, so while the
    /// preview is up it does it over the whole note instead.
    var moveSectionInDocument: ((Bool) -> Void)?

    /// Do it now if there is somewhere to do it, otherwise open a block and
    /// do it as soon as there is. SwiftUI builds the text view a turn or two
    /// after the block opens, so this waits — briefly, and never forever.
    func perform(_ action: @escaping () -> Void, attempts: Int = 8) {
        if textView != nil { action(); return }
        guard attempts > 0, ensureEditing?() == true else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self] in
            self?.perform(action, attempts: attempts - 1)
        }
    }

    /// The caret's line, in the text view's coordinates — the document's,
    /// for the drawing layer: a pasted or captured picture goes just under
    /// it, flush with the text (Sean, 2026-09-18). Nil without a text view.
    func caretLineFrame() -> CGRect? {
        guard let tv = textView, let layout = tv.layoutManager, let container = tv.textContainer else { return nil }
        layout.ensureLayout(for: container)
        let origin = tv.textContainerOrigin
        let padding = container.lineFragmentPadding
        let length = (tv.string as NSString).length
        let caret = min(tv.selectedRange().location, length)
        var line: CGRect
        if length == 0 || (caret == length && tv.string.hasSuffix("\n")) {
            // The empty line after the last newline, or an empty document.
            line = layout.extraLineFragmentRect
            if line.isEmpty {
                let height = layout.defaultLineHeight(for: tv.font ?? NSFont.systemFont(ofSize: 15))
                line = CGRect(x: 0, y: layout.usedRect(for: container).maxY, width: container.size.width, height: height)
            }
        } else {
            let glyph = layout.glyphIndexForCharacter(at: max(0, min(caret, length - 1)))
            line = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        }
        return CGRect(x: line.minX + origin.x + padding, y: line.minY + origin.y,
                      width: max(0, line.width - 2 * padding), height: line.height)
    }

    /// Put `text` into the note as lines of its own at the first line that
    /// starts at or below `y` (the document's coordinates — under a picture),
    /// or at the very end when nothing does. The caret ends up after it.
    func insert(_ text: String, belowDocumentY y: CGFloat) {
        guard let tv = textView, let layout = tv.layoutManager, let container = tv.textContainer else { return }
        layout.ensureLayout(for: container)
        let ns = tv.string as NSString
        var index = ns.length
        let point = CGPoint(x: container.lineFragmentPadding + 1, y: y - tv.textContainerOrigin.y)
        if ns.length > 0, point.y < layout.usedRect(for: container).maxY {
            let glyph = layout.glyphIndex(for: point, in: container)
            let line = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            var char = min(layout.characterIndexForGlyph(at: glyph), ns.length)
            char = ns.lineRange(for: NSRange(location: char, length: 0)).location
            // The nearest line may be the one ABOVE the picture, ending
            // before the point; the text goes on the line after that one.
            if line.maxY <= point.y + 0.5 {
                char = NSMaxRange(ns.lineRange(for: NSRange(location: char, length: 0)))
            }
            index = min(char, ns.length)
        }
        var block = text.hasSuffix("\n") ? text : text + "\n"
        if index == ns.length, ns.length > 0, ns.character(at: ns.length - 1) != 10 { block = "\n" + block }
        let range = NSRange(location: index, length: 0)
        guard tv.shouldChangeText(in: range, replacementString: block) else { return }
        tv.insertText(block, replacementRange: range)
        tv.didChangeText()
        tv.setSelectedRange(NSRange(location: index + (block as NSString).length, length: 0))
    }

    /// Return at the end of a list item carries the list on with the next
    /// marker; on an EMPTY item it ends the list instead, taking the marker
    /// away. False when the caret is not at the end of a list item, so the
    /// newline goes in as usual (Sean, 2026-09-18: "don't add another bullet
    /// on return").
    @discardableResult
    func continueList() -> Bool {
        guard let tv = textView else { return false }
        let ns = tv.string as NSString
        let selection = tv.selectedRange()
        guard selection.length == 0 else { return false }
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        var line = ns.substring(with: lineRange)
        if line.hasSuffix("\n") { line.removeLast() }
        guard let next = PreviewEditing.listContinuation(for: line),
              selection.location == lineRange.location + (line as NSString).length
        else { return false }
        if next.isEmpty {
            apply(MarkdownFormatting.Edit(range: NSRange(location: lineRange.location, length: (line as NSString).length),
                                          replacement: "",
                                          selection: NSRange(location: lineRange.location, length: 0)))
        } else {
            apply(MarkdownFormatting.Edit(range: selection, replacement: "\n" + next,
                                          selection: NSRange(location: selection.location + 1 + (next as NSString).length,
                                                             length: 0)))
        }
        return true
    }

    /// A line break at the caret, and the caret after it — so typing carries
    /// on under the picture that was just put there.
    func breakLineAtCaret() {
        guard let tv = textView else { return }
        let range = tv.selectedRange()
        guard tv.shouldChangeText(in: range, replacementString: "\n") else { return }
        tv.insertText("\n", replacementRange: range)
        tv.didChangeText()
    }

    /// ⌘D's run: what it last selected, and whether it is matching whole words.
    private var lastSelection: [NSRange]?
    private var wholeWordRun = false

    /// Called when the text changes: the ranges the run remembers are about a
    /// document that no longer exists.
    func endOccurrenceRun() {
        lastSelection = nil
        wholeWordRun = false
    }

    /// Where the caret or selection is right now — nil when there is no editor.
    var selection: NSRange? { textView?.selectedRange() }

    func focus() { textView?.window?.makeFirstResponder(textView) }

    func select(_ range: NSRange) {
        guard let tv = textView else { return }
        tv.setSelectedRange(MarkdownFormatting.clamp(range, to: (tv.string as NSString).length))
        tv.scrollRangeToVisible(tv.selectedRange())
    }

    func bold() { wrap(open: MarkdownFormatting.bold) }
    func italic() { wrap(open: MarkdownFormatting.italic) }
    func underline() { wrap(open: MarkdownFormatting.underlineOpen, close: MarkdownFormatting.underlineClose) }
    func strikethrough() { wrap(open: MarkdownFormatting.strike) }

    /// The caret's section — heading and everything under it — above the
    /// sibling before it, or below the one after (Sean, 2026-09-19). In the
    /// preview a block is only part of a section, so the note does it.
    func moveSection(up: Bool) {
        if let moveSectionInDocument { moveSectionInDocument(up); return }
        guard let tv = textView,
              let edit = NotebookOutline.moveSection(text: tv.string, selection: tv.selectedRange(), up: up)
        else { return }
        apply(edit)
    }

    /// The key of the notebook section the caret is in — what the fold
    /// commands act on. Nil in the preview, and before the first heading.
    func caretSection() -> String? {
        guard let tv = textView else { return nil }
        let sections = NotebookOutline.sections(in: tv.string)
        return NotebookOutline.section(containing: tv.selectedRange().location, in: sections)?.key
    }

    func list(_ style: MarkdownFormatting.ListStyle) {
        lines { MarkdownFormatting.toggleList(text: $0, selection: $1, style: style) }
    }

    func insertTable(grid: Bool) {
        lines { MarkdownFormatting.insertTable(text: $0, selection: $1, grid: grid) }
    }

    func heading(_ level: MarkdownFormatting.Heading) {
        perform { [weak self] in self?.applyHeading(level) }
    }

    private func applyHeading(_ level: MarkdownFormatting.Heading) {
        guard let tv = textView else { return }
        apply(MarkdownFormatting.setHeading(text: tv.string, selection: tv.selectedRange(), level: level))
    }

    func bullets() { lines(MarkdownFormatting.toggleBullets) }
    func codeBlock(language: String = "") {
        lines { MarkdownFormatting.codeBlock(text: $0, selection: $1, language: language) }
    }
    func quote() { lines(MarkdownFormatting.toggleQuote) }
    func indent() { lines(MarkdownFormatting.indent) }
    func outdent() { lines(MarkdownFormatting.outdent) }

    /// Maths, kept as Wolfram Language whichever way it goes in.
    func insertMath(_ wl: String, display: Bool) {
        perform { [weak self] in self?.applyMath(wl, display: display) }
    }

    private func applyMath(_ wl: String, display: Bool) {
        guard let tv = textView else { return }
        let canonical = WLPrinter.canonical(wl.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !canonical.isEmpty else { return }
        apply(MarkdownFormatting.insertMath(text: tv.string, selection: tv.selectedRange(),
                                            wl: canonical, display: display))
    }

    func applySpan(_ style: MarkdownFormatting.SpanStyle) {
        guard let tv = textView else { return }
        apply(MarkdownFormatting.applySpan(text: tv.string, selection: tv.selectedRange(), style: style))
    }

    func removeSpan() {
        guard let tv = textView else { return }
        apply(MarkdownFormatting.removeSpan(text: tv.string, selection: tv.selectedRange()))
    }

    /// Sublime Text's ⌘D: the word under the caret first, then one more
    /// occurrence of it per press, each added to the selection — AppKit
    /// carries several selected ranges, and typing then edits all of them.
    ///
    /// The word-bounded flag is remembered between presses, and DROPPED as
    /// soon as the selection stops being the one this made — a click, an
    /// arrow key or an edit starts the run over rather than searching for
    /// whatever the last run happened to be looking for.
    func selectNextOccurrence() {
        guard let tv = textView else { return }
        tv.window?.makeFirstResponder(tv)
        let ranges = tv.selectedRanges.map(\.rangeValue)
        let continuing = lastSelection.map { previous in
            previous.count == ranges.count && zip(previous, ranges).allSatisfy(NSEqualRanges)
        } ?? false
        if !continuing { wholeWordRun = false }

        guard let step = MarkdownFormatting.selectNextOccurrence(
            in: tv.string, ranges: ranges, wholeWord: wholeWordRun) else { return }
        wholeWordRun = step.wholeWord
        select(step.ranges, in: tv, showing: step.reveal)
    }

    /// Sublime's "Select All Occurrences" — every match of the selection.
    func selectAllOccurrences() {
        guard let tv = textView else { return }
        tv.window?.makeFirstResponder(tv)
        let ns = tv.string as NSString
        let ranges = MarkdownFormatting.normalise(tv.selectedRanges.map(\.rangeValue), in: ns)
        var term = ranges.last(where: { $0.length > 0 }).map { ns.substring(with: $0) }
        var wholeWord = wholeWordRun
        if term == nil, let caret = ranges.last,
           let word = MarkdownFormatting.wordRange(in: tv.string, at: caret.location) {
            term = ns.substring(with: word)
            wholeWord = true
        }
        guard let term, !term.isEmpty else { return }
        let all = MarkdownFormatting.allOccurrences(in: tv.string, of: term, wholeWord: wholeWord)
        guard let first = all.first else { return }
        wholeWordRun = wholeWord
        select(all, in: tv, showing: first)
    }

    /// AppKit wants them ordered, de-duplicated and non-overlapping, or it
    /// drops the lot and leaves a single caret behind.
    private func select(_ ranges: [NSRange], in tv: NSTextView, showing: NSRange) {
        let ordered = MarkdownFormatting.normalise(ranges, in: tv.string as NSString)
        guard !ordered.isEmpty else { return }
        tv.selectedRanges = ordered.map { NSValue(range: $0) }
        tv.scrollRangeToVisible(showing)
        lastSelection = ordered
    }

    /// Backspace inside a line's prefix. Returns false when nothing was done,
    /// so the text view can fall through to an ordinary delete.
    @discardableResult
    func outdentForBackspace() -> Bool {
        guard let tv = textView,
              let edit = MarkdownFormatting.outdentForBackspace(text: tv.string, selection: tv.selectedRange())
        else { return false }
        apply(edit)
        return true
    }

    private func wrap(open: String, close: String? = nil) {
        perform { [weak self] in
            guard let self, let tv = textView else { return }
            apply(MarkdownFormatting.toggleWrap(text: tv.string, selection: tv.selectedRange(),
                                                open: open, close: close))
        }
    }

    private func lines(_ transform: @escaping (String, NSRange) -> MarkdownFormatting.Edit) {
        perform { [weak self] in
            guard let self, let tv = textView else { return }
            apply(transform(tv.string, tv.selectedRange()))
        }
    }

    private func apply(_ edit: MarkdownFormatting.Edit) {
        guard let tv = textView, let storage = tv.textStorage else { return }
        tv.window?.makeFirstResponder(tv)
        guard tv.shouldChangeText(in: edit.range, replacementString: edit.replacement) else { return }
        storage.replaceCharacters(in: edit.range, with: edit.replacement)
        tv.didChangeText()
        tv.setSelectedRange(edit.selection)
        tv.scrollRangeToVisible(edit.selection)
    }
}
