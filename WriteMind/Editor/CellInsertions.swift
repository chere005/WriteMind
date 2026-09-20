import AppKit

/// The line between two cells, in the markdown pane — Mathematica's
/// insertion point (Sean, 2026-09-19: "top priority is the horizontal
/// cursor and horizontal lines between cells like in mathematica").
///
/// The rendered page has had one since the cells there are separate views
/// with a strip between them. In the source there are no views to put a
/// strip between, so this is a layer over the text: it knows where the gap
/// between two blocks is, turns the pointer on its side when it is in one,
/// draws the line across the page, and takes the click that opens a cell
/// there. Everywhere else it is not in the way at all — the text view gets
/// every event as before.
final class CellInsertions: NSView {
    /// A place a new cell can go: the middle of the gap between two blocks,
    /// and the character offset a blank line would be typed at.
    struct Gap: Equatable {
        var y: CGFloat
        var offset: Int
        /// How far either side of `y` still counts as being in this gap.
        var reach: CGFloat
    }

    /// How far either side of a gap's middle the layer answers. SMALL on
    /// purpose: it sits over the whole text view, and a reach that spilled
    /// onto the lines either side took clicks meant for the words (Sean,
    /// 2026-09-20: "cursor is super buggy").
    static let minimumReach: CGFloat = 3

    var gaps: [Gap] = [] { didSet { if gaps != oldValue { needsDisplay = true } } }
    /// A click in a gap: open a cell at that offset.
    var onInsert: ((Int) -> Void)?
    private var hovered: Gap?
    private var tracking: NSTrackingArea?

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let gap = hovered else { return }
        let accent = NSColor.controlAccentColor
        accent.withAlphaComponent(0.85).setFill()
        // The line runs the width of the page, the way a cell insertion
        // bar does in a notebook.
        NSBezierPath(rect: NSRect(x: 18, y: gap.y - 1, width: max(0, bounds.width - 40), height: 2)).fill()
        // And the plus that says what clicking it does.
        let dot = NSRect(x: 4, y: gap.y - 5, width: 10, height: 10)
        NSBezierPath(ovalIn: dot).fill()
        NSColor.white.setStroke()
        let plus = NSBezierPath()
        plus.lineWidth = 1.4
        plus.move(to: CGPoint(x: dot.midX - 2.6, y: dot.midY))
        plus.line(to: CGPoint(x: dot.midX + 2.6, y: dot.midY))
        plus.move(to: CGPoint(x: dot.midX, y: dot.midY - 2.6))
        plus.line(to: CGPoint(x: dot.midX, y: dot.midY + 2.6))
        plus.stroke()
    }

    /// The gap a point is in, if any — the nearest one within its reach.
    static func gap(at point: CGPoint, in gaps: [Gap]) -> Gap? {
        gaps
            // Never wider than the gap itself: the lines either side of it
            // belong to the text view.
            .filter { abs(point.y - $0.y) <= min(max($0.reach, minimumReach), 6) }
            .min { abs(point.y - $0.y) < abs(point.y - $1.y) }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero,
                                  options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow,
                                            .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let gap = Self.gap(at: point, in: gaps)
        if gap != hovered { hovered = gap; needsDisplay = true }
        // On its side, because what goes in here goes in BETWEEN two
        // things rather than between two letters.
        if gap != nil { NSCursor.iBeamCursorForVerticalLayout.set() }
    }

    override func mouseExited(with event: NSEvent) {
        if hovered != nil { hovered = nil; needsDisplay = true }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let gap = Self.gap(at: point, in: gaps) else { return }
        onInsert?(gap.offset)
    }

    /// Only a point inside a gap belongs to this layer; every other click
    /// goes to the text underneath, which is most of them.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return Self.gap(at: local, in: gaps) == nil ? nil : self
    }
}
