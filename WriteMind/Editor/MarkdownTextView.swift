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
    /// False while the pen, the arrow tool or a placement is up: the
    /// pencil owns the note pane then (Sean, 2026-09-20: "cursor only
    /// becomes a pen in the notes pane in drawing mode!!!!!"), so the
    /// pointer is never horizontal and no seam can be armed.
    var seamsEnabled: Bool = true

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
        // What the caret goes back to: it is hidden while a seam is armed,
        // because the line across the page IS the cursor then.
        tv.caretColour = tv.insertionPointColor
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
            coordinator.select([range], in: tv)
        }
        // And several of them — a drag down the column, a shift-click or a
        // cmd-click. NSTextView carries a discontiguous selection natively,
        // so holding three cells here IS three selected ranges: typing
        // replaces all three, and the brackets light from the same list.
        gutter.onSelectCells = { [weak coordinator = context.coordinator, weak tv] ranges in
            guard let coordinator, let tv else { return }
            coordinator.select(ranges, in: tv)
        }
        // Every cell that is HELD moves, and not only the one under the
        // pointer: a bracket drag is the same command as ⌃⇧↑/⌃⇧↓, and
        // dragging one cell out of a run of three that were picked up
        // together is nobody's idea of moving them.
        gutter.onMoveCell = { [weak coordinator = context.coordinator, weak tv] range, up in
            guard let coordinator, let tv else { return }
            let held = CellSelection.picked(cells: MarkdownParser.positioned(from: tv.string).map(\.range),
                                            selection: tv.selectedRanges.map(\.rangeValue))
            let cells = held.contains { NSEqualRanges($0, range) } ? held : [range]
            coordinator.apply(CellCommands.moving(cells, up: up, in: tv.string), in: tv)
        }
        tv.addSubview(gutter)
        context.coordinator.gutter = gutter

        // The insertion line between two cells, over the text and out of
        // the way of every click that is not in a seam.
        let insertions = CellInsertions(frame: tv.bounds)
        insertions.autoresizingMask = [.width, .height]
        insertions.onArm = { [weak tv] offset in
            guard let tv = tv as? PasteAwareTextView else { return }
            tv.armedSeam = offset
            tv.setSelectedRange(NSRange(location: min(offset, (tv.string as NSString).length),
                                        length: 0))
            tv.window?.makeFirstResponder(tv)
        }
        // The text view's `armedSeam` is the one truth about whether a
        // seam is armed; this is how the layer hears it, whoever set it —
        // a click, an arrow key, a note switch, the pen going up.
        tv.onArmChanged = { [weak insertions] offset in insertions?.armedOffset = offset }
        // And the + hands its choice back to the same one truth.
        insertions.onChoose = { [weak tv] kind in
            (tv as? PasteAwareTextView)?.armedType = kind
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

        context.coordinator.setSeams(enabled: seamsEnabled)
        context.coordinator.collapsed = collapsed
        context.coordinator.applyFolding()
        if context.coordinator.hiding.isEnabled == showMarkers {
            context.coordinator.hiding.isEnabled = !showMarkers
            context.coordinator.restyle(tv, force: true)
        }

        if context.coordinator.documentID != documentID {
            context.coordinator.documentID = documentID
            // The bar belongs to the note it was armed in. This pane is
            // NOT rebuilt on a switch — only the rendered page carries
            // `.id(note.id)` — so an armed seam that is not put out here
            // arrives in the next note with a stale offset, no caret at
            // all (the colour comes back through this property and no
            // other), and a bar painted across a page at a y that means
            // nothing.
            (tv as? PasteAwareTextView)?.armedSeam = nil
            tv.string = text
            tv.undoManager?.removeAllActions()
            tv.setSelectedRange(NSRange(location: 0, length: 0))
            tv.scroll(.zero)
            context.coordinator.restyle(tv, force: true)
            return
        }
        if tv.string != text {
            // The same for an edit that arrived from outside — the folder
            // watch picking up another app's save, or undo from the menu.
            // Neither goes through `mouseDown` or `doCommand`.
            (tv as? PasteAwareTextView)?.armedSeam = nil
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

    /// Where each cell is down the page, in the text view's own
    /// coordinates: the top and bottom of the lines its block is laid out
    /// on, and the character offset it begins at.
    ///
    /// Measured over WHOLE LINES rather than over the block's glyph range.
    /// A `.blank` cell's range stops one line short of the lines it stands
    /// for — its last character is the newline that ends the line before
    /// the last — and measuring the range alone put 22 pt of the cell's
    /// own body into the seam under it. Widening to the lines the range
    /// touches is a no-op for a paragraph, a heading or a list, whose last
    /// character is on the last line they occupy.
    static func cellBoxes(in tv: NSTextView) -> [CellSeams.Box] {
        guard let layout = tv.layoutManager, let container = tv.textContainer else { return [] }
        let text = tv.string as NSString
        guard text.length > 0 else { return [] }
        layout.ensureLayout(for: container)
        let origin = tv.textContainerOrigin
        var boxes: [CellSeams.Box] = []
        for block in MarkdownParser.positioned(from: tv.string) {
            let start = min(max(block.range.location, 0), text.length - 1)
            let end = min(max(NSMaxRange(block.range), start), text.length - 1)
            let lines = NSUnionRange(text.lineRange(for: NSRange(location: start, length: 0)),
                                     text.lineRange(for: NSRange(location: end, length: 0)))
            let glyphs = layout.glyphRange(forCharacterRange: lines, actualCharacterRange: nil)
            let rect = layout.boundingRect(forGlyphRange: glyphs, in: container)
            // A block inside a closed section is laid out with no height
            // at all (`FoldingTypesetter`) and is not on the page: it is
            // still parsed, so leaving it in piled a seam per hidden block
            // on the fold, each widened to the 8 pt minimum about the same
            // point, over the top of the text below. `refreshBrackets`
            // has always made the same check, which is why the brackets
            // looked right while the pointer did not.
            guard rect.height > 1 else { continue }
            boxes.append(CellSeams.Box(top: rect.minY + origin.y, bottom: rect.maxY + origin.y,
                                       offset: block.range.location))
        }
        return boxes
    }

    /// The spaces between those cells: where the pointer is horizontal and
    /// where a click opens a new cell (Sean, 2026-09-20: "the cursor
    /// should be horizontal any space between the two cells").
    ///
    /// The page runs from the top of the text view to the bottom of the
    /// text laid out in it — `usedRect` is in the CONTAINER's coordinates,
    /// so it takes the origin too, or the tail seam starts an inset too
    /// high — or to the bottom of the view when the note is shorter than
    /// the window, so the empty space under the last cell is all seam.
    static func seams(in tv: NSTextView) -> [CellSeams.Seam] {
        guard let layout = tv.layoutManager, let container = tv.textContainer else { return [] }
        let bottom = layout.usedRect(for: container).maxY + tv.textContainerOrigin.y
        return CellSeams.seams(cells: cellBoxes(in: tv), pageTop: 0,
                               pageBottom: max(tv.bounds.height, bottom),
                               noteLength: (tv.string as NSString).length,
                               // On a note with no cells at all there is
                               // nothing to put the bar against, and the
                               // text container's inset is where the first
                               // line will come out.
                               firstCellTop: tv.textContainerOrigin.y)
    }

    /// Open a cell at an armed seam: the blank lines that make what is
    /// typed next a block of its own, the marker for whatever kind the +
    /// chose, and the caret where the words go.
    ///
    /// `CellTypes.open` decides all of that — one rule for both panes —
    /// and only what it ADDS is typed in, at the seam, rather than the
    /// whole note being replaced by its answer: undo then takes the
    /// opening in one step and the restyle does not re-run over every
    /// character of a long note. That holds with a kind chosen too,
    /// because the command it runs only ever touches the line the caret
    /// was left on, which is inside what the opening just added.
    static func openSeam(at offset: Int, as type: CellTypes.Kind = .text, in tv: NSTextView) {
        let text = tv.string as NSString
        let place = min(max(offset, 0), text.length)
        let (updated, _, caret) = CellTypes.open(type, in: tv.string, at: place)
        let added = (updated as NSString).length - text.length
        guard added >= 0 else { return }
        if added > 0 {
            let opening = (updated as NSString).substring(with: NSRange(location: place, length: added))
            let range = NSRange(location: place, length: 0)
            guard tv.shouldChangeText(in: range, replacementString: opening) else { return }
            tv.insertText(opening, replacementRange: range)
            tv.didChangeText()
        }
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

        /// The seams come and go with the pen: with it up the whole note
        /// pane belongs to the pencil, so the layer is hidden — which is
        /// also what stops it hit testing — and anything armed goes out.
        func setSeams(enabled: Bool) {
            guard let insertions else { return }
            let away = !enabled
            guard insertions.isHidden != away else { return }
            insertions.isHidden = away
            // The text view cuts its cursor rects from the layer's seams
            // and a hidden layer hands over none, so it has to be asked
            // again — or the pointer stays on its side over a pane the
            // pencil has just taken.
            if let tv = insertions.superview { tv.window?.invalidateCursorRects(for: tv) }
            guard away else { return }
            (insertions.superview as? PasteAwareTextView)?.armedSeam = nil
            insertions.disarm()
        }

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

        /// Several edits at once, in the order `CellCommands.edits` made
        /// them — back to front, so an earlier one cannot move the
        /// characters a later one names. One undo step, because taking or
        /// moving three cells was one gesture.
        func apply(_ edits: [MarkdownFormatting.Edit], in tv: NSTextView) {
            guard let storage = tv.textStorage, !edits.isEmpty,
                  tv.shouldChangeText(inRanges: edits.map { NSValue(range: $0.range) },
                                      replacementStrings: edits.map(\.replacement)) else { return }
            storage.beginEditing()
            for edit in edits { storage.replaceCharacters(in: edit.range, with: edit.replacement) }
            storage.endEditing()
            tv.didChangeText()
            // The LAST of them is the front-most edit, so its selection is
            // the one nothing that came after has moved.
            if let landing = edits.last?.selection {
                tv.setSelectedRange(MarkdownFormatting.clamp(landing, to: (tv.string as NSString).length))
                tv.scrollRangeToVisible(tv.selectedRange())
            }
            restyle(tv, force: true)
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

        /// What the brackets hold, selected — one cell, or as many as the
        /// gesture reached.
        ///
        /// Through `normalise` because AppKit DROPS THE WHOLE SELECTION if
        /// the ranges are out of order, overlapping or duplicated, and the
        /// only sign of it is a single caret where three cells should be.
        ///
        /// Only ONE cell is scrolled to. A drag down the gutter arrives
        /// here on every move, and scrolling under a drag moves the
        /// brackets out from under the pointer — which reads as the next
        /// cell, which scrolls again. A click has nothing to fight with.
        func select(_ wanted: [NSRange], in tv: NSTextView) {
            let ranges = MarkdownFormatting.normalise(wanted, in: tv.string as NSString)
                .filter { $0.length > 0 }
            tv.window?.makeFirstResponder(tv)
            guard !ranges.isEmpty else {
                // Cmd-clicking the last held cell out of the selection:
                // what is left is a caret where it began, not the cells
                // still lit because nothing was handed over to replace
                // them.
                tv.setSelectedRange(NSRange(location: tv.selectedRange().location, length: 0))
                refreshBrackets(in: tv)
                return
            }
            tv.selectedRanges = ranges.map { NSValue(range: $0) }
            if ranges.count == 1 { tv.scrollRangeToVisible(ranges[0]) }
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
            // Where the caret IS says whether a seam is armed (the plan's
            // step 3, from Sean, 2026-09-20: "the mouse cursor and text
            // cursor should both become horizontal between cells"). Only
            // a click used to arm one, so ↓ onto the blank line between
            // two cells and a character merged them into one paragraph —
            // and everything that moves the selection without a mouse
            // down (a bracket click, ⌘A, a toolbar command, `/link`) left
            // the bar armed behind it, ready to throw the selection away.
            if let tv = tv as? PasteAwareTextView {
                let wanted = parent.seamsEnabled
                    ? CellSeams.arm(caret: tv.selectedRange(), in: tv.string, current: tv.armedSeam)
                    : nil
                // Only a seam the PAGE has. A caret on the blank line
                // beside a closed section reads as a separator in the
                // text and is not one on the page — the cells inside the
                // fold are not laid out — and arming it would turn the
                // caret off with no bar drawn in its place.
                tv.armedSeam = wanted.flatMap { offset in
                    insertions?.seams.contains { $0.offset == offset } == true ? offset : nil
                }
            }
            // AFTER the arming, never before it: whether a paragraph
            // shows its markers is read off `armedSeam` too, and asking
            // first got the answer for the move before this one — the
            // cell left behind stayed revealed and the one arrived in
            // stayed hidden, each for one keystroke.
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
            // Every range, not the first one: several cells held at once
            // are several selected ranges, and reading only `selectedRange`
            // lit the last of them alone.
            let selection = tv.selectedRanges.map(\.rangeValue)

            // The cell the caret is in — the one the rendered page would be
            // editing — so its bracket is the one drawn heavy. Unless the
            // bar between two cells is the cursor: arming parks the caret
            // at the separator, which `NotebookCells.block(containing:)`
            // reads as the start of the cell BELOW, and that cell was
            // then drawn heavy under a bar that was not in it (Sean,
            // 2026-09-20: "the next section shouldn't be highlighted when
            // the input cursor is currently that horizontal bar"). While
            // a seam is armed the caret is in no cell at all. A real
            // selection is untouched — it is not the caret.
            let armed = (tv as? PasteAwareTextView)?.armedSeam != nil
            let caret = !armed && selection.count == 1 ? selection[0] : nil
            let caretCell = caret?.length == 0
                ? NotebookCells.block(containing: caret?.location ?? 0, in: tv.string)?.range
                : nil

            func bracket(key: String, depth: Int, range: NSRange, foldable: Bool) -> NotebookGutter.Bracket? {
                let clipped = NSIntersectionRange(range, NSRange(location: 0, length: text.length))
                guard clipped.length > 0 else { return nil }
                let glyphs = layout.glyphRange(forCharacterRange: clipped, actualCharacterRange: nil)
                let box = layout.boundingRect(forGlyphRange: glyphs, in: container)
                guard box.height > 1 else { return nil }
                let picked = NotebookGutter.isPicked(clipped, selection: selection,
                                                     caretCell: foldable ? nil : caretCell)
                // Lit and HELD are not the same thing: the caret's own
                // cell is drawn heavy with nothing selected, and the
                // gestures may not read that as a cell the user is
                // holding (2026-09-20).
                let held = CellSelection.covers(clipped, selection)
                return NotebookGutter.Bracket(key: key, depth: depth,
                                              top: box.minY + origin.y, bottom: box.maxY + origin.y,
                                              collapsed: collapsed.contains(key), selected: picked,
                                              held: held, range: clipped, foldable: foldable)
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
                insertions.measure(MarkdownTextView.seams(in: tv))
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

        /// The same for a selection of SEVERAL ranges — and THIS is what
        /// lets there be one.
        ///
        /// A delegate that answers only the singular method above gets
        /// asked only that one, and AppKit then collapses every multiple
        /// selection down to a single range on its way in. The gutter's
        /// drag handed five cells over, `selectedRanges` took one, and one
        /// bracket lit (2026-09-20, with the offsets logged either side of
        /// the assignment to prove where they went). Nothing to do with
        /// the ranges being out of order, which is what the same symptom
        /// looked like when ⌘D's run first hit it.
        func textView(_ textView: NSTextView, willChangeSelectionFromCharacterRanges oldRanges: [NSValue],
                      toCharacterRanges newRanges: [NSValue]) -> [NSValue] {
            guard !lastHidden.isEmpty else { return newRanges }
            let backwards = (newRanges.first?.rangeValue.location ?? 0)
                < (oldRanges.first?.rangeValue.location ?? 0)
            return newRanges.map { NSValue(range: Self.snap($0.rangeValue, out: lastHidden, backwards: backwards)) }
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
    /// The seam between two cells the caret is sitting in: nothing has
    /// been written there, and the first character typed opens a cell
    /// first (Sean, 2026-09-20: "if i start typing it inserts a cell
    /// immediately after the cursor/line which disappear").
    var armedSeam: Int? {
        didSet {
            guard armedSeam != oldValue else { return }
            // The line drawn across the page IS the cursor while a seam
            // is armed (Sean, 2026-09-20: "the horizontal line appears
            // and that is where the cursor is"), so the caret is not
            // drawn as well — two cursors is what he was looking at.
            insertionPointColor = armedSeam == nil ? caretColour : .clear
            // A seam armed afresh is plain text, always (Sean,
            // 2026-09-19: "default is always just text"). The choice is
            // the bar's, so it goes when the bar moves or goes out, and
            // the + sets it again afterwards.
            armedType = .text
            onArmChanged?(armedSeam)
        }
    }
    /// What the + on the bar chose: the kind of cell the next thing typed
    /// into this seam becomes (Sean, 2026-09-20: "pressing the + button on
    /// that bar should bring up the list of style types that the next
    /// input will create a cell the type of").
    var armedType: CellTypes.Kind = .text
    /// The caret's own colour, read once when the editor is built, so it
    /// can come back when the seam goes.
    var caretColour: NSColor = .textColor
    /// The layer that draws the bar, told of every change and not only of
    /// the disarms: the caret arms a seam too now, and a bar the layer was
    /// never told about would be a cursor nobody can see.
    var onArmChanged: ((Int?) -> Void)?

    /// Open the cell an armed seam stands for, if one is armed. The offset
    /// is taken and the bar put out BEFORE the note is touched, so the
    /// insertion that opens the cell is not read as a second arming.
    @discardableResult
    private func openArmedSeam() -> Bool {
        guard let offset = armedSeam else { return false }
        // Both are read before the bar goes out: letting go of the seam is
        // what puts the kind back to plain text.
        let type = armedType
        armedSeam = nil
        MarkdownTextView.openSeam(at: offset, as: type, in: self)
        return true
    }

    override func insertText(_ string: Any, replacementRange: NSRange) {
        // A range the caller NAMED means that range. Typing arrives with
        // {NSNotFound, 0} — AppKit's way of saying "wherever the caret is"
        // — and where the caret is, is the seam; but this is the same
        // funnel `EditorBridge.insert(_:belowDocumentY:)` puts the words
        // read off a picture through, and those go under the picture, not
        // at a bar somebody armed at the top of the note ten minutes ago.
        // The bar goes out, because the offset it held has just moved.
        guard replacementRange.location == NSNotFound else {
            armedSeam = nil
            return super.insertText(string, replacementRange: replacementRange)
        }
        guard openArmedSeam() else {
            return super.insertText(string, replacementRange: replacementRange)
        }
        // Opening the cell moved everything after the seam along, so the
        // range the event arrived with means nothing now: what was typed
        // goes where the caret was left, between the new blank lines.
        super.insertText(string, replacementRange: NSRange(location: NSNotFound, length: 0))
    }

    /// A key while a seam is armed. Return opens the empty cell there;
    /// everything else — an arrow, Escape, a delete — puts the bar out and
    /// leaves the note exactly as it was, because clicking about the page
    /// must never leave an empty cell behind.
    override func doCommand(by selector: Selector) {
        guard let offset = armedSeam else { return super.doCommand(by: selector) }
        let type = armedType
        armedSeam = nil
        guard selector == #selector(NSResponder.insertNewline(_:)) else {
            return super.doCommand(by: selector)
        }
        MarkdownTextView.openSeam(at: offset, as: type, in: self)
    }

    /// The layer that knows where the seams are. It is this view's own
    /// subview, so there is nothing to keep in step: the text view asks
    /// it rather than holding a second copy of the geometry.
    private var seamLayer: CellInsertions? { subviews.compactMap { $0 as? CellInsertions }.first }

    /// What the seam layer wants the pointer to be at a point of this
    /// view, and nil where it wants nothing and the words have it —
    /// which is everywhere, while the pen is up and the layer is
    /// hidden.
    ///
    /// ASKED rather than worked out here. This view used to decide for
    /// itself that a seam means the I-beam on its side, which was the
    /// same answer as the layer's right up until the + wanted a hand;
    /// two views answering one point separately is a disagreement one
    /// event wide, and the event that arrives last is the one the
    /// pointer gets.
    private func seamCursor(at point: NSPoint) -> NSCursor? {
        guard let seamLayer else { return nil }
        return seamLayer.cursor(at: convert(point, to: seamLayer))
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
            return
        }
        // Rebuilding them is itself one of the moments the I-beam comes
        // back: NSTextView makes its tracking areas again on every
        // scroll and every relayout, and the pointer has not moved, so
        // nothing else will put the bar's cursor back until it does
        // (Sean, 2026-09-20: "it does flicker sometimes back to a
        // cursor").
        guard let window else { return }
        seamCursor(at: convert(window.mouseLocationOutsideOfEventStream, from: nil))?.set()
    }

    /// The pointer over the text — and over the spaces between the cells,
    /// where it lies on its side.
    ///
    /// NOT super's one I-beam over the whole view with the seam layer's
    /// rects laid on top of it: two rects over one point and AppKit
    /// picks which of them wins, and it kept picking the I-beam (Sean,
    /// 2026-09-20: "the mouse cursor should reliably be horizontal
    /// between the cells"). The view is cut into bands instead — a
    /// cell's stretch takes the upright I-beam, a seam's the one on its
    /// side — so no rect of this view's ever claims a seam. The bracket
    /// column keeps the upright one, as it always had, because the seams
    /// stop short of it.
    override func resetCursorRects() {
        if let cursorOverride {
            addCursorRect(visibleRect, cursor: cursorOverride)
            return
        }
        let seams = seamLayer?.pointerSeams ?? []
        guard !seams.isEmpty else { return super.resetCursorRects() }
        let page = max(0, bounds.width - NotebookGutter.width)
        // And the + is a button, so its patch of the bar is the hand —
        // cut out of the seam's own rect and not laid over it, because
        // this view and the layer above it disagreeing over one point
        // is AppKit's choice to make and it does not make ours.
        let plus = seamLayer?.pointerPlus ?? .null
        for band in CellSeams.bands(seams: seams, pageTop: bounds.minY, pageBottom: bounds.maxY) {
            let height = band.bottom - band.top
            guard band.horizontal else {
                addCursorRect(NSRect(x: bounds.minX, y: band.top, width: bounds.width, height: height),
                              cursor: .iBeam)
                continue
            }
            let strip = NSRect(x: bounds.minX, y: band.top, width: page, height: height)
            for piece in CellSeams.cut(strip, around: plus) {
                addCursorRect(piece, cursor: .iBeamCursorForVerticalLayout)
            }
            let onPlus = plus.intersection(strip)
            if !onPlus.isNull, !onPlus.isEmpty { addCursorRect(onPlus, cursor: .pointingHand) }
            if page < bounds.width {
                addCursorRect(NSRect(x: bounds.minX + page, y: band.top,
                                     width: bounds.width - page, height: height), cursor: .iBeam)
            }
        }
    }

    /// The same answer for the events that come by tracking area rather
    /// than by cursor rect.
    ///
    /// This view's OWN tracking areas hand it cursorUpdate and mouseMoved
    /// wherever the pointer is in it — over the seam layer above it as
    /// much as over the words — and answering them with the I-beam put
    /// the upright cursor back a moment after the layer had set the
    /// bar's. The pencil beat this by taking the tracking areas away
    /// (AGENTS.md: "The pencil cursor wins by swallowing cursorUpdate
    /// events"), which a seam cannot do because the text either side of
    /// it still wants its I-beam. So the text view knows about the
    /// seams instead, and does not put the I-beam back over one — it
    /// asks the layer what the pointer should be and says the same
    /// thing.
    override func cursorUpdate(with event: NSEvent) {
        if let cursorOverride { return cursorOverride.set() }
        guard let cursor = seamCursor(at: convert(event.locationInWindow, from: nil)) else {
            return super.cursorUpdate(with: event)
        }
        cursor.set()
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        if let cursorOverride { return cursorOverride.set() }
        seamCursor(at: convert(event.locationInWindow, from: nil))?.set()
    }

    /// NSTextView answers a mouseEntered with the I-beam as well, and
    /// AppKit synthesises one whenever the tracking areas are rebuilt
    /// under a pointer that never moved — so the bar was left with an
    /// upright cursor on it until it was nudged.
    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        if let cursorOverride { return cursorOverride.set() }
        seamCursor(at: convert(event.locationInWindow, from: nil))?.set()
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
        // Text pasted into an armed seam is a new cell, the same as a
        // character typed there. A picture is not — it floats over the
        // note, and opening a cell for it would leave an empty one.
        openArmedSeam()
        super.paste(sender)
    }

    override func pasteAsPlainText(_ sender: Any?) {
        let taken = onPasteImage?(pasteboard) == true
        DebugLog.write("pasteAsPlainText: in \(type(of: self)) handler=\(onPasteImage == nil ? "nil" : "set") taken=\(taken)")
        if taken { return }
        openArmedSeam()
        super.pasteAsPlainText(sender)
    }

    override func mouseDown(with event: NSEvent) {
        // A click anywhere in the text puts the insertion bar out.
        armedSeam = nil
        onClick?()
        super.mouseDown(with: event)
    }
}
