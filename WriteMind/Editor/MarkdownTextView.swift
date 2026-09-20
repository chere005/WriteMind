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
    /// The boxes pictures and text boxes take up, in the pane's coordinates:
    /// the text runs above and below them and never through (Sean,
    /// 2026-09-18: "don't allow the cursor to be on the same horizontal line
    /// as the image"). Each becomes a full-width band the text container
    /// excludes. In the document's coordinates — the objects scroll with
    /// the text.
    var keepClear: [CGRect] = []
    /// How far the text has scrolled, so the drawing layer can scroll with it.
    var onScroll: ((CGFloat) -> Void)?
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

        // TextKit 1, on purpose: TextKit 2 lays out NOTHING past a
        // full-width exclusion path — the note's text vanished the moment a
        // picture was on the pane (2026-09-18). TextKit 1 steps down past
        // the band as documented, and plain text needs nothing TextKit 2 adds.
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
        tv.addSubview(gutter)
        context.coordinator.gutter = gutter

        context.coordinator.documentID = documentID
        context.coordinator.watchScrolling(of: scroll)
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

        context.coordinator.bands = keepClear
        context.coordinator.applyExclusions()
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

    /// The bands, in the text container's coordinates: down by any scroll
    /// offset (none, now that the objects scroll with the text), up by the
    /// inset, wider than any pane, with a little room above and below so a
    /// line does not touch the picture.
    static func exclusionRects(bands: [CGRect], scrollOffset: CGFloat, inset: CGFloat) -> [CGRect] {
        bands.map { band in
            CGRect(x: -10_000, y: band.minY - 6 + scrollOffset - inset, width: 20_000, height: band.height + 12)
        }
    }

    static let font = NSFont.systemFont(ofSize: 15)
    static let paragraphStyle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 4
        return style
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

        /// The bands to keep clear, in the pane's coordinates, and what they
        /// last became in the container's.
        var bands: [CGRect] = []
        private var lastExclusions: [CGRect] = []
        /// The notebook's closed sections, and what was last folded away.
        var collapsed: Set<String> = []
        private var lastHidden: [NSRange] = []
        weak var gutter: NotebookGutter?
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

        /// The caret moved: the paragraph it left hides its markers again
        /// and the one it arrived in shows them.
        func textViewDidChangeSelection(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            tv.updateHiddenMarkers(hiding)
            refreshBrackets(in: tv)
        }

        /// The drawing layer scrolls with the text, so it is told how far.
        func watchScrolling(of scroll: NSScrollView) {
            scrollView = scroll
            scroll.contentView.postsBoundsChangedNotifications = true
            scrollObserver = NotificationCenter.default.addObserver(
                forName: NSView.boundsDidChangeNotification, object: scroll.contentView, queue: .main
            ) { [weak self] _ in
                guard let self, let scroll = self.scrollView else { return }
                self.parent.onScroll?(scroll.contentView.bounds.origin.y)
            }
        }

        /// The bands are in the document already (the objects scroll with
        /// the text), so nothing here depends on the scroll. The text view
        /// is sized afterwards by hand: a band pushes the text down, and
        /// left to itself the view kept its old height, so the text sat
        /// below its bottom edge where nothing could scroll to it.
        func applyExclusions() {
            guard let scroll = scrollView, let tv = scroll.documentView as? NSTextView,
                  let container = tv.textContainer else { return }
            let rects = MarkdownTextView.exclusionRects(bands: bands, scrollOffset: 0,
                                                        inset: tv.textContainerInset.height)
            guard rects != lastExclusions else { return }
            lastExclusions = rects
            container.exclusionPaths = rects.map { NSBezierPath(rect: $0) }
            tv.layoutManager?.ensureLayout(for: container)
            tv.sizeToFit()
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
            let text = tv.string as NSString
            let origin = tv.textContainerOrigin
            gutter.brackets = NotebookOutline.sections(in: tv.string).compactMap { section in
                let end = min(max(section.contentEnd, NSMaxRange(section.headingRange)), text.length)
                let start = min(section.range.location, text.length)
                guard end > start else { return nil }
                let characters = NSRange(location: start, length: end - start)
                let glyphs = layout.glyphRange(forCharacterRange: characters, actualCharacterRange: nil)
                let box = layout.boundingRect(forGlyphRange: glyphs, in: container)
                guard box.height > 1 else { return nil }
                return NotebookGutter.Bracket(key: section.key, depth: section.depth,
                                              top: box.minY + origin.y, bottom: box.maxY + origin.y,
                                              collapsed: collapsed.contains(section.key))
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
            guard !lastHidden.isEmpty else { return true }
            let reach = affectedCharRange.length == 0
                ? NSRange(location: max(0, affectedCharRange.location - 1), length: 1)
                : affectedCharRange
            guard let fold = lastHidden.first(where: { NSIntersectionRange($0, reach).length > 0 })
            else { return true }
            // Open whichever section owns that fold and let him try again.
            if let section = NotebookOutline.sections(in: textView.string).first(where: {
                collapsed.contains($0.key)
                    && $0.hiddenRange(in: (textView.string as NSString).length) == fold
            }) {
                parent.onToggleSection?(section.key)
            }
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
                parent.bridge.indent()
                return true
            case #selector(NSResponder.insertBacktab(_:)):
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
        onClick?()
        super.mouseDown(with: event)
    }
}
