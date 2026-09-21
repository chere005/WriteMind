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

    /// The cells a bracket holds. A plain cell's bracket holds itself; a
    /// SECTION's holds every cell under its heading, which is what an
    /// outer bracket is for (Sean, 2026-09-21: "an outer selection isn't
    /// always grabbing inner elements").
    ///
    /// Both panes ask this rather than passing the section's own range
    /// around as if it were a cell. It is not one: the rendered page has
    /// no text view to select a span of characters in, so a section range
    /// handed to it opened the whole section as ONE block to type in and
    /// held nothing at all, and in the source pane a section range used as
    /// a drag's anchor collapsed to whichever cell it happened to overlap
    /// first.
    static func cells(of bracket: NSRange, in cells: [NSRange]) -> [NSRange] {
        let inside = cells.filter { NSIntersectionRange(bracket, $0).length == $0.length }
        return inside.isEmpty ? [bracket] : inside
    }

    /// Every cell from one bracket to the other, both ends included —
    /// what a shift-click extends over, and what a drag has passed.
    /// Either way round: a drag upwards reaches the same cells.
    static func between(_ one: NSRange, _ other: NSRange, in cells: [NSRange]) -> [NSRange] {
        guard let second = index(of: other, in: cells) else { return [] }
        guard let first = index(of: one, in: cells) else { return [cells[second]] }
        return Array(cells[min(first, second)...max(first, second)])
    }

    /// A shift-click's anchor, if it still means anything. Both panes
    /// keep the last bracket clicked plainly so shift-click can reach from
    /// it, and an NSRange stops meaning that cell the moment the note
    /// under it changes — or means a quite different one in the next note,
    /// since neither gutter is rebuilt when the document is swapped.
    ///
    /// It has to be asked, because `between` will not fail on a stale one:
    /// `index(of:)` falls back to raw offset overlap, so an anchor from
    /// another note usually lands on SOME cell and the run lights from
    /// there. Better one cell than the wrong six.
    static func anchor(_ anchor: NSRange?, in brackets: [NSRange]) -> NSRange? {
        guard let anchor, brackets.contains(where: { NSEqualRanges($0, anchor) }) else { return nil }
        return anchor
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

    /// The cell a drag that STARTED IN A SEAM is anchored on: the one
    /// below the bar when the drag goes down, the one above it when it
    /// goes up (Sean, 2026-09-21: "clicking and draging a bar up or down
    /// can select cells").
    ///
    /// The bar is between two cells and belongs to neither, so the
    /// direction is the only thing that says which end the drag is
    /// growing from. At the top of the note there is nothing above and at
    /// the bottom nothing below; the nearest cell in the other direction
    /// is the honest answer, because a drag has to select something.
    static func cell(fromSeamAt y: CGFloat, goingDown: Bool, in spans: [Span]) -> NSRange? {
        guard !spans.isEmpty else { return nil }
        let ordered = spans.sorted { $0.top < $1.top }
        if goingDown {
            return (ordered.first { $0.top >= y } ?? ordered.last)?.range
        }
        return (ordered.last { $0.bottom <= y } ?? ordered.first)?.range
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
