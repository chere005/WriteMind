import CoreGraphics

/// Which cell a floating thing belongs to after it has been dragged.
///
/// Sean's model (2026-09-19): "if there's a floating element in a cell,
/// ultimately all the floating elements exist in one outermost invisible
/// box the same height as the cell.. moving a floating thing out of that
/// box moves it into another floating cell, or above the next fixed cell".
///
/// So a cell — a paragraph, a heading, a table, or a cell that is nothing
/// but drawings — has ONE box round everything in it, as tall as the cell
/// and everything floating in it together. Drag a picture about inside that
/// box and it still belongs to the same cell. Take it out of the box and it
/// has to land somewhere: in whichever box it is now in, or, if it is in
/// none of them, above the next cell down the page.
enum FloatingHoming {
    /// A cell's box: what it is anchored by, and where it is on the page.
    struct CellBox: Equatable {
        /// The character offset of the cell — what an object anchors to.
        var anchor: Int
        var top: CGFloat
        var bottom: CGFloat
        /// False for a cell that is only floating things: it can be joined,
        /// but it is not what "the next FIXED cell" means.
        var isText = true

        func contains(_ y: CGFloat) -> Bool { y >= top && y <= bottom }
    }

    /// Where `item` belongs now. Nil when there are no cells at all — a
    /// note with no text, where it can only be where it was put.
    static func home(for item: CGRect, in boxes: [CellBox]) -> Int? {
        guard !boxes.isEmpty else { return nil }
        let ordered = boxes.sorted { $0.top < $1.top }
        let middle = item.midY

        // Still inside a box — its own, or the one it was dropped into.
        if let inside = ordered.first(where: { $0.contains(middle) }) { return inside.anchor }
        // Out of every box: it goes above the next fixed cell down.
        if let next = ordered.first(where: { $0.top > middle && $0.isText }) { return next.anchor }
        // Past the last cell: it belongs to the last one there is.
        return ordered.last?.anchor
    }

    /// The boxes, with every floating thing's own box folded into the cell
    /// it is anchored to — the "outermost invisible box" of the model.
    /// `floating` is each item's box and the cell it belongs to.
    static func boxes(cells: [CellBox], floating: [(anchor: Int?, box: CGRect)]) -> [CellBox] {
        var out = cells
        for item in floating {
            guard let anchor = item.anchor,
                  let index = out.firstIndex(where: { $0.anchor == anchor }) else { continue }
            out[index].top = min(out[index].top, item.box.minY)
            out[index].bottom = max(out[index].bottom, item.box.maxY)
        }
        return out
    }
}
