import CoreGraphics

/// Where the preview's blocks sit: a plain stack, cell then seam then cell.
///
/// Nothing on the drawing layer is in it. Objects float over the note and
/// never move it (Sean, 2026-09-20: "all drawing, captured or drawn with
/// the pen tool, are now free floating and don't belong to cells whatsoever
/// and so don't push other cells around"), so there is one gap between two
/// cells and no block ever carries a push of its own. Pure, and over
/// HEIGHTS rather than positions.
enum PreviewLayout {
    /// Which row is at the top of the window, given how far the page has
    /// scrolled: the last one that starts at or above the fold. It is what
    /// the two modes agree on when you switch between them (Sean,
    /// 2026-09-19: "positions stay the same in markdown and wysiwyg mode")
    /// — the same cell is put back at the top, whatever height the other
    /// side happens to lay the note out at.
    static func topRow(positions: [Int: (top: CGFloat, bottom: CGFloat)],
                       scroll: CGFloat) -> Int? {
        let ordered = positions.sorted { $0.value.top < $1.value.top }
        guard let first = ordered.first else { return nil }
        // A tolerance of a line, so a page scrolled a hair past a cell's
        // top still counts as being on that cell rather than the one before.
        let fold = scroll + 8
        return ordered.last { $0.value.top <= fold }?.key ?? first.key
    }

    /// Where every block ends up, in the scroll content's own coordinates —
    /// what the cell brackets are drawn from.
    static func positions(rows: [(id: Int, height: CGFloat)], spacing: CGFloat,
                          top: CGFloat) -> [Int: (top: CGFloat, bottom: CGFloat)] {
        var out: [Int: (top: CGFloat, bottom: CGFloat)] = [:]
        var y = top
        for row in rows {
            out[row.id] = (y, y + row.height)
            y += row.height + spacing
        }
        return out
    }
}
