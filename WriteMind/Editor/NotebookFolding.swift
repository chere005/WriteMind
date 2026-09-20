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
        /// What a click on it selects.
        var range = NSRange(location: 0, length: 0)
        /// A group — a heading and everything under it — which a
        /// double-click folds away. A plain cell is not foldable.
        var foldable = false
    }

    static let width: CGFloat = 22
    private static let step: CGFloat = 5
    private static let tick: CGFloat = 5

    /// Whether a bracket is drawn heavy: the selection covers the whole of
    /// what it holds, or — for a cell, and only the caret's own one — the
    /// caret is in it. The caret counts because the rendered page lights
    /// the cell being typed in, and the two sides show the same notebook
    /// (Sean, 2026-09-19: "make sure the notebook bars on the side work
    /// properly in markdown and wysiwyg mode"). A section is lit only by a
    /// real selection, or every bracket out to the margin would light up
    /// at once.
    static func isPicked(_ range: NSRange, selection: NSRange, caretCell: NSRange? = nil) -> Bool {
        if selection.length > 0 {
            return NSIntersectionRange(selection, range).length == range.length
        }
        return caretCell == range
    }

    var brackets: [Bracket] = [] { didSet { if brackets != oldValue { needsDisplay = true } } }
    /// A double-click on a group: fold it, or open it again.
    var onToggle: ((String) -> Void)?
    /// A single click: select what that bracket holds.
    var onSelect: ((NSRange) -> Void)?
    /// A bracket dragged up or down: the cell changes places with its
    /// neighbour, the way a cell is moved in a notebook (Sean,
    /// 2026-09-20: "make cells behave like mathematica cells").
    var onMoveCell: ((NSRange, Bool) -> Void)?
    /// How far a bracket has to be dragged before it is a move rather
    /// than a click that wandered.
    static let dragThreshold: CGFloat = 10
    private var dragging: (bracket: Bracket, from: CGFloat)?
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
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let bracket = bracket(at: point) else { return }
        dragging = (bracket, point.y)
        if event.clickCount >= 2, bracket.foldable {
            onToggle?(bracket.key)
        } else {
            onSelect?(bracket.range)
        }
    }

    override func mouseUp(with event: NSEvent) {
        defer { dragging = nil }
        guard let dragging else { return }
        let travelled = convert(event.locationInWindow, from: nil).y - dragging.from
        guard abs(travelled) >= Self.dragThreshold else { return }
        onMoveCell?(dragging.bracket.range, travelled < 0)
    }

    /// Only a click ON a bracket counts; everywhere else the gutter is not
    /// there at all, so a drag through it does not select anything.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return bracket(at: local) == nil ? nil : self
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
