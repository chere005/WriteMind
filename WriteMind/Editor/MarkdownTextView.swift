import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// A plain-text NSTextView for markdown source. Smart quotes and dashes are
/// off because they corrupt markdown; spelling stays on because it is prose.
struct MarkdownTextView: NSViewRepresentable {
    @Binding var text: String
    /// Changing this resets the undo stack — a new note is not an edit of the old one.
    let documentID: String?
    let bridge: EditorBridge
    /// Called the moment `/link` is completed, with the caret's position.
    var onLinkTrigger: ((Int) -> Void)?
    /// A picture on the pasteboard. Returns true when it was taken, and the
    /// paste stops there.
    var onPasteImage: ((NSPasteboard) -> Bool)?
    /// A click in the text — the drawing layer drops its selection on it.
    var onClick: (() -> Void)?
    /// The cursor to show instead of the I-beam — the pencil while the pen
    /// is up. The text view owns the cursor over the text, so it has to be
    /// the one to change it.
    var cursor: NSCursor?
    /// How far the text has scrolled, so the drawing layer can scroll with it.
    var onScroll: ((CGFloat) -> Void)?
    /// The cell at the top of the window, reported as it scrolls, and
    /// asked for once when the pane appears.
    var onTopCell: ((Int) -> Void)?
    var topCell: Int = 0
    /// The notebook sections that are closed, by key. Their bodies are laid
    /// out with no height and never drawn, and the note's text is not
    /// touched (Sean, 2026-09-19: "show the notebook grouping and
    /// collapsing on the side").
    var collapsed: Set<String> = []
    /// A bracket in the gutter was clicked.
    var onToggleSection: ((String) -> Void)?
    /// False hides the markdown markers — `**`, `#`, the link's URL — while
    /// leaving them in the file, so the editor reads as the finished page
    /// (Sean, 2026-09-19: "allow wysiwyg editing"). The paragraph the caret
    /// is in always shows its own, so they can be typed.
    var showMarkers: Bool = false

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = true
        scroll.backgroundColor = .textBackgroundColor

        // TextKit 1, on purpose: `MarkerHiding` and `BulletGlyphs` are
        // NSLayoutManagerDelegate glyph substitution, which TextKit 2 has
        // no equivalent of — a faded `#` and a `- ` drawn as a bullet both
        // go through it. (The first reason was exclusion paths, which
        // TextKit 2 laid out nothing past; those went with the bands on
        // 2026-09-20, this one did not.)
        let tv = PasteAwareTextView(usingTextLayoutManager: false)
        // A layout manager that can fold: closed sections get line
        // fragments of no height, and are not drawn.
        let folding = FoldingLayoutManager()
        tv.textContainer?.replaceLayoutManager(folding)
        folding.typesetter = FoldingTypesetter(folding.folding)
        tv.delegate = context.coordinator
        tv.isRichText = false
        tv.allowsUndo = true
        tv.usesFindBar = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isContinuousSpellCheckingEnabled = true
        tv.isGrammarCheckingEnabled = false
        tv.font = Self.font
        tv.textColor = .textColor
        tv.insertionPointColor = .textColor
        tv.textContainerInset = NSSize(width: 24, height: 20)
        tv.minSize = NSSize(width: 0, height: 0)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.textContainer?.widthTracksTextView = true
        tv.textContainer?.containerSize = NSSize(width: scroll.contentSize.width,
                                                 height: .greatestFiniteMagnitude)
        tv.defaultParagraphStyle = Self.paragraphStyle
        tv.typingAttributes = [.font: Self.font, .foregroundColor: NSColor.textColor,
                               .paragraphStyle: Self.paragraphStyle]
        tv.string = text
        tv.frame = NSRect(origin: .zero, size: scroll.contentSize)

        scroll.documentView = tv
        // ONE delegate slot: this object substitutes the bullet glyphs and
        // hides the markers in the same pass.
        tv.layoutManager?.delegate = context.coordinator.hiding
        context.coordinator.hiding.isEnabled = !showMarkers
        bridge.textView = tv

        // The cell brackets ride with the text, in the margin the text
        // container already leaves on the right.
        let gutter = NotebookGutter(frame: NSRect(x: tv.bounds.width - NotebookGutter.width, y: 0,
                                                  width: NotebookGutter.width, height: tv.bounds.height))
        gutter.autoresizingMask = [.minXMargin, .height]
        gutter.onToggle = { [weak coordinator = context.coordinator] key in
            coordinator?.parent.onToggleSection?(key)
        }
        // Clicking a bracket picks the cell up — its heading and everything
        // under it — the way a Wolfram notebook does (Sean, 2026-09-19: "i
        // want to select, hide, etc").
        gutter.onSelect = { [weak coordinator = context.coordinator, weak tv] range in
            guard let coordinator, let tv else { return }
            coordinator.select(range, in: tv)
        }
        gutter.onMoveCell = { [weak coordinator = context.coordinator, weak tv] range, up in
            guard let coordinator, let tv,
                  let edit = CellCommands.move(range, up: up, in: tv.string) else { return }
            coordinator.apply(edit, in: tv)
        }
        tv.addSubview(gutter)
        context.coordinator.gutter = gutter

        // The insertion line between two cells, over the text and out of
        // the way of every click that is not in a gap.
        let insertions = CellInsertions(frame: tv.bounds)
        insertions.autoresizingMask = [.width, .height]
        insertions.onArm = { [weak tv, weak insertions] offset in
            guard let tv = tv as? PasteAwareTextView else { return }
            tv.armedGap = offset
            tv.onDisarm = { [weak insertions] in insertions?.disarm() }
            tv.setSelectedRange(NSRange(location: min(offset, (tv.string as NSString).length),
                                        length: 0))
            tv.window?.makeFirstResponder(tv)
        }
        tv.addSubview(insertions)
        context.coordinator.insertions = insertions

        context.coordinator.documentID = documentID
        context.coordinator.watchScrolling(of: scroll)
        // Whatever cell the rendered page was showing, show that one.
        context.coordinator.restore(topCell, in: scroll)
        // The glyphs already exist by now (the string was set above), so
        // the styling and the hiding have to invalidate them by hand —
        // without this nothing is styled and nothing hides.
        context.coordinator.restyle(tv, force: true)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let tv = scroll.documentView as? NSTextView else { return }
        bridge.textView = tv
        context.coordinator.parent = self
        if let tv = tv as? PasteAwareTextView {
            // The closures capture this frame's view, so they are replaced,
            // not kept: an old one would paste into the note that was open
            // when the editor was built.
            tv.onPasteImage = { onPasteImage?($0) ?? false }
            tv.onClick = onClick
            if tv.cursorOverride !== cursor {
                tv.cursorOverride = cursor
                tv.window?.invalidateCursorRects(for: tv)
                if let window = tv.window, let cursor,
                   tv.bounds.contains(tv.convert(window.mouseLocationOutsideOfEventStream, from: nil)) {
                    cursor.set()
                }
            }
        }

        context.coordinator.collapsed = collapsed
        context.coordinator.applyFolding()
        if context.coordinator.hiding.isEnabled == showMarkers {
            context.coordinator.hiding.isEnabled = !showMarkers
            context.coordinator.restyle(tv, force: true)
        }

        if context.coordinator.documentID != documentID {
            context.coordinator.documentID = documentID
            tv.string = text
            tv.undoManager?.removeAllActions()
            tv.setSelectedRange(NSRange(location: 0, length: 0))
            tv.scroll(.zero)
            context.coordinator.restyle(tv, force: true)
            return
        }
        if tv.string != text {
            let selection = tv.selectedRange()
            tv.string = text
            let clamped = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
            tv.setSelectedRange(clamped)
            context.coordinator.applyFolding(force: true)
            context.coordinator.restyle(tv, force: true)
        }
    }

    static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
        if let tv = scroll.documentView as? NSTextView, coordinator.parent.bridge.textView === tv {
            coordinator.parent.bridge.textView = nil
        }
        coordinator.undoManager.removeAllActions()
    }

    /// Where a new cell can go: the middle of the blank space between two
    /// blocks, and the offset a blank line would be typed at. The first
    /// gap is above the first block and the last is under the last one, so
    /// a cell can be opened at either end (Sean, 2026-09-19: "the
    /// horizontal cursor and horizontal lines between cells like in
    /// mathematica").
    static func gaps(in tv: NSTextView) -> [CellInsertions.Gap] {
        guard let layout = tv.layoutManager, let container = tv.textContainer else { return [] }
        let text = tv.string as NSString
        guard text.length > 0 else { return [] }
        layout.ensureLayout(for: container)
        let origin = tv.textContainerOrigin

        func band(_ character: Int) -> (top: CGFloat, bottom: CGFloat) {
            let glyph = layout.glyphIndexForCharacter(at: min(max(character, 0), text.length - 1))
            let line = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            return (line.minY + origin.y, line.maxY + origin.y)
        }

        let blocks = MarkdownParser.positioned(from: tv.string)
        guard !blocks.isEmpty else { return [] }
        var gaps: [CellInsertions.Gap] = []
        let first = band(blocks[0].range.location)
        gaps.append(CellInsertions.Gap(y: max(0, first.top - 7), offset: blocks[0].range.location,
                                       reach: CellInsertions.minimumReach))
        for (above, below) in zip(blocks, blocks.dropFirst()) {
            let bottom = band(max(NSMaxRange(above.range) - 1, above.range.location)).bottom
            let top = band(below.range.location).top
            gaps.append(CellInsertions.Gap(y: (bottom + top) / 2, offset: below.range.location,
                                           reach: max(CellInsertions.minimumReach,
                                                      min((top - bottom) / 2, 6))))
        }
        let last = blocks[blocks.count - 1]
        let bottom = band(max(NSMaxRange(last.range) - 1, last.range.location)).bottom
        gaps.append(CellInsertions.Gap(y: bottom + 7, offset: text.length,
                                       reach: CellInsertions.minimumReach))
        return gaps
    }

    /// A new, empty cell at `offset`: a blank line either side of the caret,
    /// so what is typed next is its own block.
    static func openCell(at offset: Int, in tv: NSTextView) {
        let text = tv.string as NSString
        let place = min(max(offset, 0), text.length)
        var opening = "\n\n"
        var caret = place + 1
        if place == text.length {
            // At the very end there is nothing under it to push down.
            opening = text.length > 0 && text.character(at: text.length - 1) == 10 ? "\n" : "\n\n"
            caret = place + (opening as NSString).length
        }
        let range = NSRange(location: place, length: 0)
        guard tv.shouldChangeText(in: range, replacementString: opening) else { return }
        tv.insertText(opening, replacementRange: range)
        tv.didChangeText()
        tv.setSelectedRange(NSRange(location: min(caret, (tv.string as NSString).length), length: 0))
        tv.window?.makeFirstResponder(tv)
    }

    /// The character at the top of the window: the first one on or below
    /// the fold. A switch to the rendered page puts THIS cell back at the
    /// top, which is how a position survives a mode it was not measured in
    /// (Sean, 2026-09-19: "positions stay the same in markdown and wysiwyg
    /// mode").
    static func cell(atTop offset: CGFloat, in tv: NSTextView) -> Int {
        guard let layout = tv.layoutManager, let container = tv.textContainer else { return 0 }
        layout.ensureLayout(for: container)
        let inside = CGPoint(x: container.lineFragmentPadding + 1,
                             y: max(0, offset - tv.textContainerOrigin.y) + 1)
        let glyph = layout.glyphIndex(for: inside, in: container)
        return layout.characterIndexForGlyph(at: glyph)
    }

    /// Where that character's line starts, in the scroll view's own
    /// coordinates — what to scroll to to put it back at the top.
    static func offset(ofCell character: Int, in tv: NSTextView) -> CGFloat {
        guard let layout = tv.layoutManager, let container = tv.textContainer else { return 0 }
        let length = (tv.string as NSString).length
        guard length > 0 else { return 0 }
        layout.ensureLayout(for: container)
        let clamped = min(max(character, 0), length - 1)
        let glyph = layout.glyphIndexForCharacter(at: clamped)
        let line = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        return max(0, line.minY + tv.textContainerOrigin.y)
    }

    static let font = NSFont.systemFont(ofSize: 15)
    static let paragraphStyle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 4
        // A tab lands on the same four-space grid the indent button uses,
        // so a note written with tabs and one written with spaces line up
        // (Sean, 2026-09-19: "indentation and tab width is 4 spaces").
        style.tabStops = []
        style.defaultTabInterval = MarkdownTextView.tabWidth
        return style
    }()

    /// Four spaces of the editor's own font.
    static let tabWidth: CGFloat = {
        let space = ("    " as NSString).size(withAttributes: [.font: MarkdownTextView.font]).width
        return max(space, 8)
    }()

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownTextView
        var documentID: String?
        /// The editor's own undo stack, not the window's: the source editor
        /// is torn down whenever the preview comes up, and undo actions left
        /// on the window's manager would point at a freed text view (the
        /// same crash BlockEditor.Coordinator.undoManager explains).
        let undoManager = UndoManager()
        /// Draws `- ` as a round bullet AND hides the markers.
        let hiding = MarkerHiding()
        /// Used by the preview's block editor; kept here so both editors
        /// answer to the same glyph rules.
        let bullets = BulletGlyphs()
        /// The re-scan is debounced: styling a long note is tens of
        /// milliseconds, and it must never sit on a keystroke.
        private var restyleWork: DispatchWorkItem?
        /// What was last styled, and whether it was styled at all — so a
        /// pass that would change nothing is not made.
        private var lastStyled: String?
        private var lastStyledRendered = true

        /// True while a tidy is already on its way — the edit it makes
        /// comes back through the same notifications that asked for it.
        private var tidying = false
        /// The notebook's closed sections, and what was last folded away.
        var collapsed: Set<String> = []
        private var lastHidden: [NSRange] = []
        weak var gutter: NotebookGutter?
        weak var insertions: CellInsertions?
        private weak var scrollView: NSScrollView?
        private var scrollObserver: NSObjectProtocol?

        init(_ parent: MarkdownTextView) { self.parent = parent }

        deinit {
            if let scrollObserver { NotificationCenter.default.removeObserver(scrollObserver) }
        }

        func undoManager(for view: NSTextView) -> UndoManager? { undoManager }

        /// Style the source the way the preview's blocks are styled, then
        /// work out which markers can vanish and re-generate their glyphs.
        ///
        /// With the markers showing it does the opposite: plain attributes,
        /// no markers to hide, nothing substituted — the note exactly as it
        /// is written. And it does NOTHING AT ALL when neither the text nor
        /// the mode has changed since the last pass, because this is on the
        /// end of a keystroke (Sean, 2026-09-19: "it keeps trying to render
        /// when i'm in show only markdown mode").
        func restyle(_ tv: NSTextView, force: Bool = false) {
            guard let storage = tv.textStorage, let layout = tv.layoutManager else { return }
            let source = tv.string
            guard force || source != lastStyled || hiding.isEnabled != lastStyledRendered else { return }
            lastStyled = source
            lastStyledRendered = hiding.isEnabled

            let selection = tv.selectedRanges
            let text = source as NSString
            let whole = NSRange(location: 0, length: text.length)
            if hiding.isEnabled {
                MarkdownSourceStyle.apply(to: storage, base: MarkdownTextView.font,
                                          paragraph: MarkdownTextView.paragraphStyle)
                // The blank line between two cells, and a fence's own
                // line, are drawn a few points tall: the gap between two
                // cells is then the same on this side as on the rendered
                // page, and a note is nearly the same height in both.
                let small = NSFont.systemFont(ofSize: MarkdownSourceStyle.structuralSize)
                let tight = NSMutableParagraphStyle()
                tight.setParagraphStyle(MarkdownTextView.paragraphStyle)
                tight.lineSpacing = 0
                tight.paragraphSpacing = 0
                // The gap belongs to the cell above it, not to the blank
                // lines between: one cell, one gap, whatever the file has
                // between them (Sean, 2026-09-20: "cells still aren't
                // stacked with an even small spacing between them").
                let spaced = NSMutableParagraphStyle()
                spaced.setParagraphStyle(MarkdownTextView.paragraphStyle)
                spaced.paragraphSpacing = MarkdownPreview.gapHeight
                for line in MarkdownSourceStyle.cellEndLines(in: source) {
                    let range = NSIntersectionRange(line, whole)
                    guard range.length > 0 else { continue }
                    storage.addAttribute(.paragraphStyle, value: spaced, range: range)
                }
                for line in MarkdownSourceStyle.structuralLines(in: source) {
                    let range = NSIntersectionRange(line, whole)
                    guard range.length > 0 else { continue }
                    storage.addAttributes([.font: small, .paragraphStyle: tight], range: range)
                }
                hiding.setMarkers(MarkerHiding.hideable(MarkdownSourceStyle.runs(in: source), in: text))
            } else {
                storage.setAttributes([.font: MarkdownTextView.font,
                                       .foregroundColor: NSColor.textColor,
                                       .paragraphStyle: MarkdownTextView.paragraphStyle],
                                      range: whole)
                hiding.setMarkers([])
            }
            tv.typingAttributes = [.font: MarkdownTextView.font,
                                   .foregroundColor: NSColor.textColor,
                                   .paragraphStyle: MarkdownTextView.paragraphStyle]
            tv.selectedRanges = selection

            layout.invalidateGlyphs(forCharacterRange: whole, changeInLength: 0, actualCharacterRange: nil)
            layout.invalidateLayout(forCharacterRange: whole, actualCharacterRange: nil)
            tv.updateHiddenMarkers(hiding)
            tv.sizeToFit()
            refreshBrackets(in: tv)
        }

        /// The same, a moment after the typing stops.
        func scheduleRestyle(_ tv: NSTextView) {
            restyleWork?.cancel()
            let work = DispatchWorkItem { [weak self, weak tv] in
                guard let self, let tv else { return }
                restyle(tv)
            }
            restyleWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
        }

        /// One edit to the note, through the text view so undo sees it.
        func apply(_ edit: MarkdownFormatting.Edit, in tv: NSTextView) {
            guard let storage = tv.textStorage,
                  tv.shouldChangeText(in: edit.range, replacementString: edit.replacement) else { return }
            storage.replaceCharacters(in: edit.range, with: edit.replacement)
            tv.didChangeText()
            tv.setSelectedRange(edit.selection)
            tv.scrollRangeToVisible(edit.selection)
            restyle(tv, force: true)
        }

        /// What a bracket holds, selected.
        func select(_ wanted: NSRange, in tv: NSTextView) {
            let length = (tv.string as NSString).length
            let range = NSIntersectionRange(wanted, NSRange(location: 0, length: length))
            guard range.length > 0 else { return }
            tv.window?.makeFirstResponder(tv)
            tv.setSelectedRange(range)
            tv.scrollRangeToVisible(range)
            refreshBrackets(in: tv)
        }

        /// Tab inside a fenced code block: four spaces in, or one level
        /// out. False when the caret is not in a fence, and then the
        /// markdown indent command has it as before.
        private func fenceTab(_ tv: NSTextView, outdent: Bool) -> Bool {
            guard CodeTyping.inFence(tv.string, selection: tv.selectedRange()),
                  let storage = tv.textStorage else { return false }
            let edit = CodeTyping.tabbing(in: tv.string, selection: tv.selectedRange(),
                                          outdent: outdent, unit: MarkdownFormatting.indentUnit)
            guard tv.shouldChangeText(in: edit.range, replacementString: edit.replacement) else { return true }
            storage.replaceCharacters(in: edit.range, with: edit.replacement)
            tv.didChangeText()
            tv.setSelectedRange(edit.selection)
            return true
        }

        /// The caret moved: the paragraph it left hides its markers again
        /// and the one it arrived in shows them — and the empty cell it
        /// left, if it never became one, goes.
        func textViewDidChangeSelection(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            tv.updateHiddenMarkers(hiding)
            refreshBrackets(in: tv)
        }

        /// Put `character`'s line at the top of the window. The layout has
        /// to exist first, and at makeNSView it does not, so this waits a
        /// turn — the same turn the brackets wait for.
        func restore(_ character: Int, in scroll: NSScrollView) {
            guard character > 0 else { return }
            DispatchQueue.main.async { [weak scroll] in
                guard let scroll, let tv = scroll.documentView as? NSTextView else { return }
                let y = MarkdownTextView.offset(ofCell: character, in: tv)
                scroll.contentView.scroll(to: NSPoint(x: 0, y: y))
                scroll.reflectScrolledClipView(scroll.contentView)
            }
        }

        /// The drawing layer scrolls with the text, so it is told how far.
        func watchScrolling(of scroll: NSScrollView) {
            scrollView = scroll
            scroll.contentView.postsBoundsChangedNotifications = true
            scrollObserver = NotificationCenter.default.addObserver(
                forName: NSView.boundsDidChangeNotification, object: scroll.contentView, queue: .main
            ) { [weak self] _ in
                guard let self, let scroll = self.scrollView else { return }
                let offset = scroll.contentView.bounds.origin.y
                self.parent.onScroll?(offset)
                if let tv = scroll.documentView as? NSTextView {
                    self.parent.onTopCell?(MarkdownTextView.cell(atTop: offset, in: tv))
                }
            }
        }

        /// Fold what is closed, and redraw the brackets. Cheap when nothing
        /// has changed, because it is called on every update.
        func applyFolding(force: Bool = false) {
            guard let scroll = scrollView, let tv = scroll.documentView as? NSTextView,
                  let layout = tv.layoutManager as? FoldingLayoutManager, let container = tv.textContainer
            else { return }
            let hidden = NotebookOutline.hiddenRanges(in: tv.string, collapsed: collapsed)
            if force || hidden != lastHidden {
                lastHidden = hidden
                layout.folding.hidden = hidden
                let whole = NSRange(location: 0, length: (tv.string as NSString).length)
                layout.invalidateLayout(forCharacterRange: whole, actualCharacterRange: nil)
                layout.ensureLayout(for: container)
                tv.sizeToFit()
                tv.needsDisplay = true
                snapCaretOutOfHiding(in: tv)
            }
            refreshBrackets(in: tv)
        }

        /// Where each section's bracket goes, measured off the laid-out text.
        func refreshBrackets(in tv: NSTextView) {
            guard let gutter, let layout = tv.layoutManager, let container = tv.textContainer else { return }
            // The frame by hand, every time. At makeNSView the text view is
            // still zero-sized, and an autoresizing mask that starts from
            // nothing has nothing to grow from — which is why the brackets
            // were not there at all (Sean, 2026-09-19: "where's
            // wolfram/jupyter style notebook implementation?").
            let wanted = NSRect(x: tv.bounds.width - NotebookGutter.width, y: 0,
                                width: NotebookGutter.width, height: max(tv.bounds.height, 1))
            if gutter.frame != wanted { gutter.frame = wanted }
            let text = tv.string as NSString
            let origin = tv.textContainerOrigin
            // EVERY cell gets a bracket, and the sections that group them
            // get one further out — Wolfram's own furniture (Sean,
            // 2026-09-19: "i want wolfram/jupyter style notebook brackets").
            let sections = NotebookOutline.sections(in: tv.string)
            let selection = tv.selectedRange()

            // The cell the caret is in — the one the rendered page would be
            // editing — so its bracket is the one drawn heavy.
            let caretCell = selection.length == 0
                ? NotebookCells.block(containing: selection.location, in: tv.string)?.range
                : nil

            func bracket(key: String, depth: Int, range: NSRange, foldable: Bool) -> NotebookGutter.Bracket? {
                let clipped = NSIntersectionRange(range, NSRange(location: 0, length: text.length))
                guard clipped.length > 0 else { return nil }
                let glyphs = layout.glyphRange(forCharacterRange: clipped, actualCharacterRange: nil)
                let box = layout.boundingRect(forGlyphRange: glyphs, in: container)
                guard box.height > 1 else { return nil }
                let picked = NotebookGutter.isPicked(clipped, selection: selection,
                                                     caretCell: foldable ? nil : caretCell)
                return NotebookGutter.Bracket(key: key, depth: depth,
                                              top: box.minY + origin.y, bottom: box.maxY + origin.y,
                                              collapsed: collapsed.contains(key), selected: picked,
                                              range: clipped, foldable: foldable)
            }

            var brackets = sections.compactMap { section -> NotebookGutter.Bracket? in
                let end = min(max(section.contentEnd, NSMaxRange(section.headingRange)), text.length)
                let start = min(section.range.location, text.length)
                guard end > start else { return nil }
                return bracket(key: section.key, depth: section.depth,
                               range: NSRange(location: start, length: end - start), foldable: true)
            }

            // The cells themselves: one per block, drawn inside whichever
            // section holds them.
            for block in MarkdownParser.positioned(from: tv.string) {
                let depth = NotebookOutline.cellDepth(at: block.range.location, in: sections)
                if let cell = bracket(key: "cell:\(block.range.location)", depth: depth,
                                      range: block.range, foldable: false) {
                    brackets.append(cell)
                }
            }
            gutter.brackets = brackets

            if let insertions {
                let wanted = NSRect(origin: .zero, size: NSSize(width: tv.bounds.width,
                                                                height: max(tv.bounds.height, 1)))
                if insertions.frame != wanted { insertions.frame = wanted }
                insertions.gaps = MarkdownTextView.gaps(in: tv)
            }
        }

        /// The caret never sits in a line nobody can see: it steps to the
        /// end of what is folded, or to the start of it when it was coming
        /// backwards.
        func snapCaretOutOfHiding(in tv: NSTextView) {
            let selection = tv.selectedRange()
            let snapped = Self.snap(selection, out: lastHidden, backwards: false)
            if snapped != selection { tv.setSelectedRange(snapped) }
        }

        static func snap(_ range: NSRange, out hidden: [NSRange], backwards: Bool) -> NSRange {
            guard range.length == 0 else { return range }
            for fold in hidden where fold.length > 0
                && range.location > fold.location && range.location < NSMaxRange(fold) {
                return NSRange(location: backwards ? fold.location : NSMaxRange(fold), length: 0)
            }
            return range
        }

        /// Moving the caret INTO a closed section puts it the other side of
        /// it instead.
        func textView(_ textView: NSTextView, willChangeSelectionFromCharacterRange oldRange: NSRange,
                      toCharacterRange newRange: NSRange) -> NSRange {
            Self.snap(newRange, out: lastHidden, backwards: newRange.location < oldRange.location)
        }

        /// And an edit that would reach into one opens it first, rather than
        /// changing text nobody can see.
        func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange,
                      replacementString: String?) -> Bool {
            if !lastHidden.isEmpty {
                let reach = affectedCharRange.length == 0
                    ? NSRange(location: max(0, affectedCharRange.location - 1), length: 1)
                    : affectedCharRange
                if let fold = lastHidden.first(where: { NSIntersectionRange($0, reach).length > 0 }) {
                    // Open whichever section owns that fold and let him try
                    // again, rather than changing text nobody can see.
                    if let section = NotebookOutline.sections(in: textView.string).first(where: {
                        collapsed.contains($0.key)
                            && $0.hiddenRange(in: (textView.string as NSString).length) == fold
                    }) {
                        parent.onToggleSection?(section.key)
                    }
                    return false
                }
            }
            return widenedDelete(textView, range: affectedCharRange, replacement: replacementString)
        }

        /// A delete over hidden markers takes them whole, and takes a pair
        /// together — see `MarkerDeletion`. True means "go ahead as asked",
        /// which is the answer for everything that is not such a delete.
        /// Only while the markers ARE hidden: with the raw markdown
        /// showing, what is selected is what the eye saw, and half a `**`
        /// is then a fair thing to delete.
        private func widenedDelete(_ tv: NSTextView, range: NSRange,
                                   replacement: String?) -> Bool {
            guard hiding.isEnabled, replacement?.isEmpty == true, range.length > 0,
                  let storage = tv.textStorage else { return true }
            let ranges = MarkerDeletion.deletions(for: range, in: tv.string)
            guard ranges != [range] else { return true }
            guard tv.shouldChangeText(inRanges: ranges.map { NSValue(range: $0) },
                                      replacementStrings: ranges.map { _ in "" }) else { return false }
            // Back to front, so an earlier range's location still means
            // what it meant when it was worked out.
            storage.beginEditing()
            for range in ranges { storage.replaceCharacters(in: range, with: "") }
            storage.endEditing()
            tv.didChangeText()
            if let first = ranges.last { tv.setSelectedRange(NSRange(location: first.location, length: 0)) }
            restyle(tv, force: true)
            return false
        }

        func textDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            parent.bridge.endOccurrenceRun()
            scheduleRestyle(tv)
            refreshBrackets(in: tv)
            if parent.text != tv.string { parent.text = tv.string }
            let caret = tv.selectedRange().location
            if MarkdownLinking.justTypedTrigger(in: tv.string, caret: caret) {
                parent.onLinkTrigger?(caret)
            }
        }

        /// Tab and Shift-Tab move a line in and out; Backspace does too, but
        /// only while the caret is still inside the line's prefix — past that
        /// it has to stay an ordinary backspace or the note cannot be edited.
        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertTab(_:)):
                // Inside a fence, Tab is indentation: four spaces, which is
                // what the file should hold (Sean, 2026-09-20).
                if fenceTab(textView, outdent: false) { return true }
                parent.bridge.indent()
                return true
            case #selector(NSResponder.insertBacktab(_:)):
                if fenceTab(textView, outdent: true) { return true }
                parent.bridge.outdent()
                return true
            case #selector(NSResponder.deleteBackward(_:)):
                return parent.bridge.outdentForBackspace()
            case #selector(NSResponder.insertNewline(_:)):
                // Return on a list item carries the list on (Sean, 2026-09-18).
                return parent.bridge.continueList()
            default:
                return false
            }
        }
    }
}

/// The text view itself, with two things NSTextView will not do on its own:
/// a pasted picture goes on the drawing layer instead of being dropped on the
/// floor (a plain-text view ignores images), and a click says so, so the
/// objects on that layer can let go of their selection.
class PasteAwareTextView: NSTextView {
    var onPasteImage: ((NSPasteboard) -> Bool)?
    var onClick: (() -> Void)?
    /// The general pasteboard, except in a test, which brings its own.
    var pasteboard: NSPasteboard = .general
    /// A gap between two cells the caret is sitting in: nothing has been
    /// written there, and the first character typed opens a cell first
    /// (Sean, 2026-09-20: "if i start typing it inserts a cell immediately
    /// after the cursor/line which disappear").
    var armedGap: Int? {
        didSet { if armedGap == nil { onDisarm?() } }
    }
    var onDisarm: (() -> Void)?

    override func insertText(_ string: Any, replacementRange: NSRange) {
        if let offset = armedGap {
            armedGap = nil
            MarkdownTextView.openCell(at: offset, in: self)
        }
        super.insertText(string, replacementRange: replacementRange)
    }

    /// Shown over the text instead of the I-beam while set (the pen's pencil).
    var cursorOverride: NSCursor? {
        didSet {
            guard cursorOverride !== oldValue else { return }
            updateTrackingAreas()
            window?.invalidateCursorRects(for: self)
        }
    }

    /// While the pen is up the text view does not track the mouse at all:
    /// NSTextView's own tracking areas are what hand it the cursorUpdate and
    /// mouseMoved events it answers with the I-beam, and overriding those
    /// handlers still let an I-beam through now and then (Sean, 2026-09-18:
    /// "the text selection cursor keeps popping up randomly"). No tracking
    /// area, no event, no I-beam. They come back with the pen down.
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if cursorOverride != nil {
            trackingAreas.forEach(removeTrackingArea)
        }
    }

    override func resetCursorRects() {
        if let cursorOverride {
            addCursorRect(visibleRect, cursor: cursorOverride)
        } else {
            super.resetCursorRects()
        }
    }

    override func cursorUpdate(with event: NSEvent) {
        if let cursorOverride { cursorOverride.set() } else { super.cursorUpdate(with: event) }
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        if let cursorOverride { cursorOverride.set() }
    }

    /// Paste stays ENABLED when the pasteboard holds a picture. A plain-text
    /// NSTextView tells the Edit menu that Paste is disabled unless there is
    /// text to paste, and a disabled item swallows ⌘V before `paste(_:)` is
    /// ever called — which is why a screenshot could not be pasted while
    /// copied text could (Sean, three times, 2026-09-18; the paste log
    /// showed ⌘V handed to the text view and nothing after it).
    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        if item.action == #selector(NSText.paste(_:)) || item.action == #selector(NSTextView.pasteAsPlainText(_:)),
           onPasteImage != nil, Self.holdsPicture(pasteboard) {
            return true
        }
        return super.validateUserInterfaceItem(item)
    }

    /// Image data, or a file that is an image.
    static func holdsPicture(_ pasteboard: NSPasteboard) -> Bool {
        if pasteboard.availableType(from: [.tiff, .png]) != nil { return true }
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
        return urls.contains { UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image) == true }
    }

    override func paste(_ sender: Any?) {
        let taken = onPasteImage?(pasteboard) == true
        DebugLog.write("paste: in \(type(of: self)) handler=\(onPasteImage == nil ? "nil" : "set") taken=\(taken) types=\((pasteboard.types ?? []).map(\.rawValue).joined(separator: ","))")
        if taken { return }
        super.paste(sender)
    }

    override func pasteAsPlainText(_ sender: Any?) {
        let taken = onPasteImage?(pasteboard) == true
        DebugLog.write("pasteAsPlainText: in \(type(of: self)) handler=\(onPasteImage == nil ? "nil" : "set") taken=\(taken)")
        if taken { return }
        super.pasteAsPlainText(sender)
    }

    override func mouseDown(with event: NSEvent) {
        // A click anywhere in the text puts the insertion bar out.
        armedGap = nil
        onClick?()
        super.mouseDown(with: event)
    }
}
