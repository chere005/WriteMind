import CoreGraphics

/// Keeping an object beside the cell it was put beside, whichever mode is
/// showing (Sean, 2026-09-19: "positions stay the same in markdown and
/// wysiwyg mode").
///
/// An object's place is stored as a fraction of the pane, which is right
/// for a window that changes size and wrong for a note that is laid out
/// twice: the markdown pane and the rendered page put the same paragraph at
/// different heights, so a picture pinned to a fraction sits beside one
/// paragraph in one mode and another paragraph in the other. So an object
/// also remembers the cell it belongs to, as a character offset, and its y
/// is worked out again from THAT whenever the layout underneath it changes.
enum CanvasAnchors {
    /// The item, moved so its top sits at `y` (document points), keeping
    /// everything else — including how far along the page it is.
    static func placed(_ item: CanvasItem, atTop y: CGFloat, in size: CGSize) -> CanvasItem {
        guard size.height > 1 else { return item }
        let box = item.bounds(in: size)
        guard box.height.isFinite else { return item }
        var moved = item
        // `bounds` counts the transform in; the shift is applied to the
        // transform for the same reason a drag is.
        moved.transform.dy += Double((y + box.height / 2 - box.midY) / size.height)
        return moved
    }

    /// Every anchored object put back beside its cell. `y(of:)` answers
    /// where a cell starts in the pane that is showing; an object whose
    /// cell has gone (the text was deleted) is left exactly where it is.
    static func reanchored(_ items: [CanvasItem], in size: CGSize,
                           y: (Int) -> CGFloat?) -> [CanvasItem] {
        items.map { item in
            guard let anchor = item.anchor, let top = y(anchor) else { return item }
            return placed(item, atTop: top, in: size)
        }
    }

    /// The page as a STACK: everything anchored to a cell sits immediately
    /// under that cell, one gap below it, and keeps its own arrangement
    /// (Sean, 2026-09-20: "all cells should come immediately after the
    /// next one", "there shouldn't be space between these cells").
    ///
    /// Everything sharing an anchor moves together, by one delta, so two
    /// drawings put side by side stay side by side — it is the group that
    /// is a cell, not each stroke.
    static func stacked(_ items: [CanvasItem], in size: CGSize, gap: CGFloat,
                        bottom: (Int) -> CGFloat?) -> [CanvasItem] {
        guard size.height > 1 else { return items }
        var byAnchor: [Int: [Int]] = [:]
        for (index, item) in items.enumerated() {
            guard !item.isHidden, let anchor = item.anchor else { continue }
            byAnchor[anchor, default: []].append(index)
        }
        guard !byAnchor.isEmpty else { return items }

        var out = items
        for (anchor, group) in byAnchor {
            guard let under = bottom(anchor) else { continue }
            var union = out[group[0]].bounds(in: size)
            for index in group.dropFirst() { union = union.union(out[index].bounds(in: size)) }
            let delta = (under + gap) - union.minY
            guard abs(delta) > 0.5 else { continue }
            for index in group {
                out[index].transform.dy += Double(delta / size.height)
            }
        }
        return out
    }

    /// Whether anything actually moved — so a note that is already in the
    /// right place is not marked as changed.
    static func differ(_ before: [CanvasItem], _ after: [CanvasItem]) -> Bool {
        guard before.count == after.count else { return true }
        for (a, b) in zip(before, after) where a != b { return true }
        return false
    }
}
