import CoreGraphics
import Foundation

/// Several cells held at once (Sean, 2026-09-20: "fix selecting multiple
/// cells by clicking and dragging, shift clicking, or cmd clicking").
///
/// A drag down the gutter takes every bracket it passes, shift-click
/// reaches from the anchor to the bracket clicked, and cmd-click puts one
/// in or takes it out — Mathematica's own three, and Finder's before it.
///
/// The arithmetic is here, pure, because the two panes hold a selection in
/// quite different things: the markdown pane in `tv.selectedRanges`, which
/// NSTextView carries natively and types into, and the rendered page in a
/// list of its own beside whichever cell is open for typing. What lights a
/// bracket, what a drag reaches and what a cmd-click does must not be able
/// to differ between the two, so neither of them works it out.
enum CellSelection {
    /// Whether a cell is picked: ONE of the selected ranges covers the
    /// whole of it.
    ///
    /// One of them, and never their union. Two adjacent cells selected
    /// separately are two picked cells, not the section around them — the
    /// union would swallow the blank line between them and light every
    /// bracket out to the margin.
    static func covers(_ cell: NSRange, _ selection: [NSRange]) -> Bool {
        guard cell.length > 0 else { return false }
        return selection.contains { NSIntersectionRange($0, cell).length == cell.length }
    }

    /// The picked cells, in the order the note has them — which is exactly
    /// the cells whose brackets are drawn heavy, so a command over "the
    /// selection" takes what the eye says it will.
    static func picked(cells: [NSRange], selection: [NSRange]) -> [NSRange] {
        cells.filter { covers($0, selection) }
    }

    /// Every cell from one bracket to the other, both ends included —
    /// what a shift-click extends over, and what a drag has passed.
    /// Either way round: a drag upwards reaches the same cells.
    static func between(_ one: NSRange, _ other: NSRange, in cells: [NSRange]) -> [NSRange] {
        guard let second = index(of: other, in: cells) else { return [] }
        guard let first = index(of: one, in: cells) else { return [cells[second]] }
        return Array(cells[min(first, second)...max(first, second)])
    }

    /// Cmd-click: the cell goes in if it was out, and out if it was in —
    /// which is the only way to leave a hole in the middle of a run.
    static func toggling(_ cell: NSRange, in selection: [NSRange]) -> [NSRange] {
        if let at = selection.firstIndex(where: { NSEqualRanges($0, cell) }) {
            var out = selection
            out.remove(at: at)
            return out
        }
        return (selection + [cell]).sorted { $0.location < $1.location }
    }

    /// A bracket as either pane draws it: where it runs down the page, and
    /// what it holds.
    typealias Span = (top: CGFloat, bottom: CGFloat, range: NSRange)

    /// The cell a drag is over. The bracket whose span holds that y, and
    /// otherwise the NEAREST one: the pointer spends half a drag in the
    /// seams between the cells, and a drag that selected nothing while it
    /// crossed one would flicker the whole way down.
    static func cell(at y: CGFloat, in spans: [Span]) -> NSRange? {
        if let inside = spans.first(where: { y >= $0.top && y <= $0.bottom }) { return inside.range }
        return spans.min { reach(from: y, to: $0) < reach(from: y, to: $1) }?.range
    }

    private static func reach(from y: CGFloat, to span: Span) -> CGFloat {
        y < span.top ? span.top - y : y - span.bottom
    }

    /// Which cell a range IS: itself first, and then whatever it overlaps —
    /// a section's bracket holds several cells and answers with the first
    /// of them, so shift-clicking from one still reaches somewhere.
    private static func index(of range: NSRange, in cells: [NSRange]) -> Int? {
        cells.firstIndex { NSEqualRanges($0, range) }
            ?? cells.firstIndex { NSIntersectionRange($0, range).length > 0 }
    }
}
