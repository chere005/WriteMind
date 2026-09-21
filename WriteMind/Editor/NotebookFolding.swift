import AppKit

/// What is folded away right now. One object, shared by the typesetter that
/// gives hidden lines no height and the layout manager that declines to draw
/// them (Sean, 2026-09-19: "show the notebook grouping and collapsing on the
/// side").
final class FoldingState {
    var hidden: [NSRange] = []

    /// Whether a run of characters is inside something folded. A line
    /// counts only when the WHOLE of it is hidden, so the heading that owns
    /// a closed section stays visible.
    func hides(_ characters: NSRange) -> Bool {
        guard characters.length > 0, !hidden.isEmpty else { return false }
        return hidden.contains { NSIntersectionRange($0, characters).length == characters.length }
    }
}

/// A line inside a closed section is laid out with no height at all, so the
/// text below it comes straight up. TextKit 1 asks the typesetter for every
/// line fragment's rectangle, which is the one place this can be done
/// without touching a character of the note.
final class FoldingTypesetter: NSATSTypesetter {
    let folding: FoldingState

    init(_ folding: FoldingState) {
        self.folding = folding
        super.init()
    }

    override func willSetLineFragmentRect(_ lineRect: UnsafeMutablePointer<NSRect>,
                                          forGlyphRange glyphRange: NSRange,
                                          usedRect: UnsafeMutablePointer<NSRect>,
                                          baselineOffset: UnsafeMutablePointer<CGFloat>) {
        guard let layoutManager else { return }
        let characters = layoutManager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
        guard folding.hides(characters) else { return }
        lineRect.pointee.size.height = 0
        usedRect.pointee.size.height = 0
        baselineOffset.pointee = 0
    }
}

/// And nothing draws them: a fragment of no height would still paint its
/// glyphs on top of the line that took its place.
final class FoldingLayoutManager: NSLayoutManager {
    let folding = FoldingState()

    override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        guard !folding.hidden.isEmpty else {
            super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin)
            return
        }
        var cursor = glyphsToShow.location
        let end = NSMaxRange(glyphsToShow)
        while cursor < end {
            var fragment = NSRange()
            _ = lineFragmentRect(forGlyphAt: cursor, effectiveRange: &fragment)
            let piece = NSIntersectionRange(fragment, NSRange(location: cursor, length: end - cursor))
            guard piece.length > 0 else { cursor += 1; continue }
            let characters = characterRange(forGlyphRange: piece, actualGlyphRange: nil)
            if !folding.hides(characters) { super.drawGlyphs(forGlyphRange: piece, at: origin) }
            cursor = NSMaxRange(piece)
        }
    }
}

/// The cell brackets down the side of the note — Wolfram's, and Jupyter's
/// idea of a cell: one bracket per heading, nested, and a click on one opens
/// or closes that section.
final class NotebookGutter: NSView {
    /// The sections to draw, where they sit, and whether they are closed.
    struct Bracket: Equatable {
        var key: String
        var depth: Int
        var top: CGFloat
        var bottom: CGFloat
        var collapsed: Bool
        /// The cell is picked: its bracket is drawn heavy, the way a
        /// Wolfram notebook shows a selected cell.
        var selected = false
        /// And whether a real selection is what lights it, rather than the
        /// caret merely sitting in it.
        ///
        /// Two flags because `selected` answers two questions and the
        /// gestures need the narrower one. There is always a caret
        /// somewhere, so there was always exactly one bracket calling
        /// itself selected with nothing selected at all — and a press on
        /// THAT one took the move branch, so a drag meant as a selection
        /// reordered the note and a plain click on it did nothing
        /// (2026-09-20).
        var held = false
        /// What a click on it selects.
        var range = NSRange(location: 0, length: 0)
        /// A group — a heading and everything under it — which a
        /// double-click folds away. A plain cell is not foldable.
        var foldable = false
    }

    static let width: CGFloat = 22
    private static let step: CGFloat = 5
    private static let tick: CGFloat = 5

    /// Whether a bracket is drawn heavy: one of the selected ranges covers
    /// the whole of what it holds, or — for a cell, and only the caret's
    /// own one — the caret is in it. The caret counts because the rendered
    /// page lights the cell being typed in, and the two sides show the same
    /// notebook (Sean, 2026-09-19: "make sure the notebook bars on the side
    /// work properly in markdown and wysiwyg mode"). A section is lit only
    /// by a real selection, or every bracket out to the margin would light
    /// up at once.
    ///
    /// SEVERAL ranges, because NSTextView carries a discontiguous selection
    /// natively and that is what holding several cells IS on this side. Any
    /// ONE of them has to cover the bracket — `CellSelection.covers` says
    /// why it may not be their union.
    static func isPicked(_ range: NSRange, selection: [NSRange], caretCell: NSRange? = nil) -> Bool {
        if CellSelection.covers(range, selection) { return true }
        guard !selection.contains(where: { $0.length > 0 }) else { return false }
        return caretCell == range
    }

    var brackets: [Bracket] = [] { didSet { if brackets != oldValue { needsDisplay = true } } }
    /// A double-click on a group: fold it, or open it again.
    var onToggle: ((String) -> Void)?
    /// A single click: select what that bracket holds.
    var onSelect: ((NSRange) -> Void)?
    /// A drag down the column, a shift-click or a cmd-click: several cells
    /// at once (Sean, 2026-09-20: "fix selecting multiple cells by clicking
    /// and dragging, shift clicking, or cmd clicking").
    var onSelectCells: (([NSRange]) -> Void)?
    /// A click landed on the gutter, so the drawing layer lets go of
    /// whatever it was holding — see `CellInsertions.onClick`.
    var onClick: (() -> Void)?
    /// A bracket dragged up or down: the cell changes places with its
    /// neighbour, the way a cell is moved in a notebook (Sean,
    /// 2026-09-20: "make cells behave like mathematica cells").
    var onMoveCell: ((NSRange, Bool) -> Void)?
    /// How far a bracket has to be dragged before it is a move rather
    /// than a click that wandered.
    static let dragThreshold: CGFloat = 10
    /// What the mouse is in the middle of. WHICH of the two a drag is was
    /// settled at the mouse down, by whether the bracket under it was
    /// already picked: that is the only way both gestures fit on one
    /// column, and it is Mathematica's own rule.
    private enum Gesture {
        /// Taking cells: every bracket the pointer passes, anchored where
        /// it started, live as it moves.
        case picking(anchor: NSRange, cells: [NSRange])
        /// Moving the one that was held.
        case moving(cell: NSRange, from: CGFloat)
    }
    private var gesture: Gesture?
    /// Where a shift-click reaches FROM: the last bracket clicked plainly.
    private var anchor: NSRange?
    private var hovered: String?
    private var tracking: NSTrackingArea?

    override var isFlipped: Bool { true }

    /// The line a bracket is drawn on, measured from the view's right edge.
    private func x(for depth: Int) -> CGFloat {
        bounds.maxX - 6 - CGFloat(depth) * Self.step
    }

    override func draw(_ dirtyRect: NSRect) {
        for bracket in brackets {
            let line = x(for: bracket.depth)
            let colour: NSColor = bracket.selected || bracket.key == hovered
                ? .controlAccentColor
                : NSColor.tertiaryLabelColor
            colour.setStroke()
            let path = NSBezierPath()
            // A group's bracket is heavier than a plain cell's, so the
            // nesting reads at a glance.
            let base: CGFloat = bracket.foldable ? 1.5 : 1.1
            path.lineWidth = bracket.selected ? base + 1.2 : (bracket.key == hovered ? base + 0.6 : base)
            path.lineCapStyle = .round
            path.move(to: CGPoint(x: line - Self.tick, y: bracket.top))
            path.line(to: CGPoint(x: line, y: bracket.top))
            path.line(to: CGPoint(x: line, y: bracket.bottom))
            path.line(to: CGPoint(x: line - Self.tick, y: bracket.bottom))
            path.stroke()

            // A closed section carries a small solid triangle on its
            // bracket, the way a closed cell carries one in Wolfram.
            if bracket.collapsed {
                let middle = (bracket.top + bracket.bottom) / 2
                let mark = NSBezierPath()
                mark.move(to: CGPoint(x: line - 4, y: middle - 3.5))
                mark.line(to: CGPoint(x: line, y: middle))
                mark.line(to: CGPoint(x: line - 4, y: middle + 3.5))
                mark.close()
                colour.setFill()
                mark.fill()
            }
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let key = bracket(at: point)?.key
        if key != hovered { hovered = key; needsDisplay = true }
        (key == nil ? NSCursor.arrow : NSCursor.pointingHand).set()
    }

    override func mouseExited(with event: NSEvent) {
        if hovered != nil { hovered = nil; needsDisplay = true }
    }

    /// One click picks the cell up, two fold it away — Wolfram's own
    /// gesture, and the one Sean asked for (2026-09-19: "i want to select,
    /// hide, etc"). The click count comes from the event, so neither waits
    /// on the other.
    ///
    /// And the three that take several (Sean, 2026-09-20): shift reaches
    /// from the anchor to here, cmd puts this one in or takes it out, and
    /// a plain drag off a bracket that is NOT already picked selects
    /// everything it passes. Off one that IS picked it moves the cell, as
    /// it always has.
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        gesture = nil
        guard let bracket = bracket(at: point) else { return }
        onClick?()
        if event.clickCount >= 2, bracket.foldable {
            onToggle?(bracket.key)
            return
        }
        // A section's bracket stands for the cells under it, never for
        // itself: everything below reaches, extends and toggles those.
        let held = CellSelection.cells(of: bracket.range, in: cellRanges)
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.shift) {
            let from = reachFrom ?? picked.first ?? held.first ?? bracket.range
            onSelectCells?(CellSelection.between(from, held.last ?? bracket.range, in: cellRanges))
            return
        }
        if modifiers.contains(.command) {
            anchor = held.first
            onSelectCells?(held.reduce(picked) { CellSelection.toggling($1, in: $0) })
            return
        }
        // HELD, not lit: the caret's own cell is drawn heavy too, and
        // dragging it would move a cell the user never picked up.
        if bracket.held {
            gesture = .moving(cell: bracket.range, from: point.y)
            return
        }
        // Only a press that picks anchors. A press that moves a cell is
        // not "the last bracket clicked plainly", and the range it would
        // leave behind means nothing the moment the move rewrites the
        // note round it.
        anchor = held.first
        gesture = .picking(anchor: held.first ?? bracket.range, cells: held)
        // One cell goes through `onSelect`, which is what opens it for
        // typing on the rendered page; a section goes through the many,
        // because there is nothing there to open.
        if held.count == 1, NSEqualRanges(held[0], bracket.range) {
            onSelect?(bracket.range)
        } else {
            onSelectCells?(held)
        }
    }

    /// The drag that selects, reported as it goes rather than at the end:
    /// the brackets light one after another under the pointer, which is
    /// the whole of what a drag down a notebook's gutter looks like.
    override func mouseDragged(with event: NSEvent) {
        guard case .picking(let anchor, let reported) = gesture else { return }
        let point = convert(event.locationInWindow, from: nil)
        guard let over = CellSelection.cell(at: point.y, in: cellSpans) else { return }
        let wanted = CellSelection.between(anchor, over, in: cellRanges)
        guard wanted != reported else { return }
        gesture = .picking(anchor: anchor, cells: wanted)
        onSelectCells?(wanted)
    }

    override func mouseUp(with event: NSEvent) {
        defer { gesture = nil }
        guard case .moving(let cell, let from) = gesture else { return }
        let travelled = convert(event.locationInWindow, from: nil).y - from
        guard abs(travelled) >= Self.dragThreshold else { return }
        onMoveCell?(cell, travelled < 0)
    }

    /// The gutter takes the clicks it has a bracket for, and no others.
    ///
    /// It briefly took the whole 22-point column, which is 22 of the text
    /// container's own 24 points of right margin — so a click in that
    /// margin, which has always put the caret at the end of the line,
    /// reached nothing at all. Worse, it never reached
    /// `PasteAwareTextView.mouseDown`, and that is the path that puts an
    /// armed seam out: the bar stayed drawn across the page with no caret
    /// anywhere and no way to get rid of it, against the rule the seam
    /// model is built on (AGENTS.md: "every path that disarms … must go
    /// through that property").
    ///
    /// A drag down the column loses nothing by this: the press lands on a
    /// bracket — that is what starting a drag from one means — and once
    /// this view has the mouse down, every drag and the mouse up come here
    /// whatever is under the pointer.
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden else { return nil }
        let local = convert(point, from: superview)
        guard bounds.contains(local), bracket(at: local) != nil else { return nil }
        return self
    }

    /// The cells' brackets, down the page. A section's is not one of them:
    /// a drag reaches cells, and the section round them lights up by
    /// itself once they are all in.
    private var cellSpans: [CellSelection.Span] {
        brackets.filter { !$0.foldable }
            .sorted { $0.top < $1.top }
            .map { CellSelection.Span(top: $0.top, bottom: $0.bottom, range: $0.range) }
    }

    private var cellRanges: [NSRange] {
        brackets.filter { !$0.foldable }.map(\.range).sorted { $0.location < $1.location }
    }

    /// What is picked right now, as the brackets themselves say. This view
    /// is drawn FROM the pane's selection, so it keeps no second copy of it
    /// to go stale between a click and the next one.
    private var picked: [NSRange] {
        brackets.filter { !$0.foldable && $0.held }
            .map(\.range)
            .sorted { $0.location < $1.location }
    }

    /// Where a shift-click reaches from, if that range still names a
    /// bracket. An anchor outlives the note it was taken in — this view is
    /// built once and shown every note — and `CellSelection.between`
    /// resolves a stale one by raw offset overlap rather than failing.
    private var reachFrom: NSRange? {
        CellSelection.anchor(anchor, in: brackets.map(\.range))
    }

    /// The NEAREST bracket, not the first: the levels are five points
    /// apart, and a tolerance that reaches the next one over would always
    /// answer with whichever was first in the list.
    private func bracket(at point: CGPoint) -> Bracket? {
        brackets
            .filter { point.y >= $0.top - 4 && point.y <= $0.bottom + 4 && abs(point.x - x(for: $0.depth)) <= 4 }
            .min { abs(point.x - x(for: $0.depth)) < abs(point.x - x(for: $1.depth)) }
    }
}
