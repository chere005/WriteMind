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
    /// A little air between a picture and the block under it.
    static let margin: CGFloat = 6

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
