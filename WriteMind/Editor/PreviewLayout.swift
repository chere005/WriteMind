import CoreGraphics

/// Where the preview's blocks sit once the pictures have had their say.
///
/// The source editor keeps its text clear of a picture with the text
/// container's exclusion paths; the preview is a stack of views and has no
/// such thing, so the gap is worked out here and applied as padding (Sean,
/// 2026-09-19: "cells are not obeying the placement below or above images /
/// text grabs rules"). Pure, and over HEIGHTS rather than positions —
/// a block's height does not change when it is pushed down, so this
/// settles in one pass instead of oscillating.
enum PreviewLayout {
    /// The air round a drawing's band — the SAME gap that sits between two
    /// cells, so a cell full of ink is spaced like every other cell (Sean,
    /// 2026-09-20: "cells… don't seem to be sized correctly for free form
    /// vs fixed objects and equidistant apart").
    static var margin: CGFloat { MarkdownPreview.gapHeight }

    /// Where every block ends up, in the scroll content's own coordinates —
    /// what the cell brackets are drawn from.
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

    static func positions(rows: [(id: Int, height: CGFloat)], spacing: CGFloat, top: CGFloat,
                          bands: [CGRect]) -> [Int: (top: CGFloat, bottom: CGFloat)] {
        let pushes = padding(rows: rows, spacing: spacing, top: top, bands: bands)
        var out: [Int: (top: CGFloat, bottom: CGFloat)] = [:]
        var y = top
        for row in rows {
            y += pushes[row.id] ?? 0
            out[row.id] = (y, y + row.height)
            y += row.height + spacing
        }
        return out
    }

    /// How much each block has to be pushed down, by its id. Blocks that do
    /// not move are not in the result.
    static func padding(rows: [(id: Int, height: CGFloat)], spacing: CGFloat, top: CGFloat,
                        bands: [CGRect]) -> [Int: CGFloat] {
        guard !bands.isEmpty, !rows.isEmpty else { return [:] }
        let ordered = bands
            .filter { $0.height > 0 }
            .map { CGRect(x: 0, y: $0.minY - margin, width: 1, height: $0.height + margin * 2) }
            .sorted { $0.minY < $1.minY }

        var result: [Int: CGFloat] = [:]
        var y = top
        for row in rows {
            let natural = y
            var placed = y
            // A block that would straddle a picture goes under it. Pushing
            // it can land it on the NEXT picture, so this repeats — over a
            // sorted list, so it is one sweep.
            var moved = true
            while moved {
                moved = false
                for band in ordered where placed < band.maxY && placed + row.height > band.minY {
                    placed = band.maxY
                    moved = true
                }
            }
            if placed > natural { result[row.id] = placed - natural }
            y = placed + row.height + spacing
        }
        return result
    }
}
