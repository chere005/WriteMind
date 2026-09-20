import CoreGraphics
import Foundation

/// How a flow-chart line gets from one node to another: straight where it
/// can be, otherwise right angles and as few of them as possible, round
/// anything in the way, and in its own lane where another line already has
/// one (Sean, 2026-09-19: "lines are always straight with corners, minimal
/// paths, and never overlap unless they must"). Pure geometry — the view
/// draws what this returns, and the drag of a segment is applied here too.
enum ConnectorRouting {
    /// Centres this close count as lined up, and the line is drawn straight.
    static let tolerance: CGFloat = 8
    /// How far apart two lines are put when they would share a corridor.
    static let channelStep: CGFloat = 8
    /// A corner has to clear a box by this much to count as going round it.
    static let clearance: CGFloat = 4

    enum Side { case left, right, top, bottom }

    /// Which way a line leaves `a` on its way to `b`: out of the side that
    /// faces the other box, and out of the top or bottom when the two are
    /// stacked rather than side by side.
    static func sides(from a: CGRect, to b: CGRect) -> (Side, Side) {
        let horizontal = max(a.minX - b.maxX, b.minX - a.maxX)
        let vertical = max(a.minY - b.maxY, b.minY - a.maxY)
        if horizontal >= vertical {
            return b.midX >= a.midX ? (.right, .left) : (.left, .right)
        }
        return b.midY >= a.midY ? (.bottom, .top) : (.top, .bottom)
    }

    static func point(on box: CGRect, side: Side) -> CGPoint {
        switch side {
        case .left: return CGPoint(x: box.minX, y: box.midY)
        case .right: return CGPoint(x: box.maxX, y: box.midY)
        case .top: return CGPoint(x: box.midX, y: box.minY)
        case .bottom: return CGPoint(x: box.midX, y: box.maxY)
        }
    }

    static func isVertical(_ side: Side) -> Bool { side == .top || side == .bottom }

    static let allSides: [Side] = [.right, .left, .bottom, .top]

    /// The whole line, corner by corner, ends included. `obstacles` are the
    /// other nodes; the two being joined are added to them, so a line never
    /// cuts through either end's own box.
    ///
    /// Every way out of one box into the other is tried — four sides by four
    /// sides — and the one with the fewest corners wins, the shortest of
    /// those if there is a tie. That is what "minimal" means here, and it is
    /// also what routes round whatever is in the way: a path that crosses
    /// something is simply not a candidate.
    static func path(from a: CGRect, to b: CGRect, obstacles: [CGRect] = [], channel: Int = 0) -> [CGPoint] {
        let boxes = obstacles + [a, b]
        var best: (score: CGFloat, path: [CGPoint])?
        func consider(_ candidate: [CGPoint]?) {
            guard let candidate, clear(candidate, of: boxes) else { return }
            let score = CGFloat(candidate.count) * 10_000 + length(candidate)
            if best == nil || score < best!.score { best = (score, candidate) }
        }
        for exit in allSides {
            for entry in allSides {
                consider(candidate(from: a, exit: exit, to: b, entry: entry, channel: channel))
            }
        }
        // Nothing direct is clear, so the line goes round the outside of
        // everything — over the top, under the bottom, or out to one side.
        if best == nil {
            for exit in allSides {
                for entry in allSides {
                    for detour in detours(from: a, exit: exit, to: b, entry: entry,
                                          boxes: boxes, channel: channel) {
                        consider(detour)
                    }
                }
            }
        }
        if let best { return best.path }
        // Boxed in even then (two nodes on top of each other): a plain
        // corner, which at least joins them and still turns a right angle.
        let (exit, entry) = sides(from: a, to: b)
        let from = point(on: a, side: exit), to = point(on: b, side: entry)
        return simplified(isVertical(exit) ? [from, CGPoint(x: from.x, y: to.y), to]
                                           : [from, CGPoint(x: to.x, y: from.y), to])
    }

    /// The long ways round: out of one box, past everything in the way, and
    /// back in. Four bends, so they only ever win when nothing shorter is
    /// clear.
    static func detours(from a: CGRect, exit: Side, to b: CGRect, entry: Side,
                        boxes: [CGRect], channel: Int = 0) -> [[CGPoint]] {
        let from = point(on: a, side: exit), to = point(on: b, side: entry)
        let bounds = boxes.reduce(a.union(b)) { $0.union($1) }
        let shift = CGFloat(channel) * channelStep
        let step: CGFloat = 16
        var out: [[CGPoint]] = []

        if !isVertical(exit), !isVertical(entry) {
            let outX = from.x + (exit == .right ? step : -step)
            let inX = to.x + (entry == .left ? -step : step)
            for y in [bounds.minY - step - shift, bounds.maxY + step + shift] {
                out.append(simplified([from, CGPoint(x: outX, y: from.y), CGPoint(x: outX, y: y),
                                       CGPoint(x: inX, y: y), CGPoint(x: inX, y: to.y), to]))
            }
        }
        if isVertical(exit), isVertical(entry) {
            let outY = from.y + (exit == .bottom ? step : -step)
            let inY = to.y + (entry == .top ? -step : step)
            for x in [bounds.minX - step - shift, bounds.maxX + step + shift] {
                out.append(simplified([from, CGPoint(x: from.x, y: outY), CGPoint(x: x, y: outY),
                                       CGPoint(x: x, y: inY), CGPoint(x: to.x, y: inY), to]))
            }
        }
        return out.filter { $0.count >= 2 && leaves($0, side: exit) && enters($0, side: entry) }
    }

    /// One way out and one way in: straight if the two line up, one corner
    /// if the line changes direction once, otherwise out, across and in.
    static func candidate(from a: CGRect, exit: Side, to b: CGRect, entry: Side, channel: Int = 0) -> [CGPoint]? {
        let from = point(on: a, side: exit)
        let to = point(on: b, side: entry)
        let shift = CGFloat(channel) * channelStep
        var path: [CGPoint]

        switch (isVertical(exit), isVertical(entry)) {
        case (false, false):
            if abs(from.y - to.y) <= tolerance {
                let y = (from.y + to.y) / 2
                path = [CGPoint(x: from.x, y: y), CGPoint(x: to.x, y: y)]
            } else {
                let x = (from.x + to.x) / 2 + shift
                path = [from, CGPoint(x: x, y: from.y), CGPoint(x: x, y: to.y), to]
            }
        case (true, true):
            if abs(from.x - to.x) <= tolerance {
                let x = (from.x + to.x) / 2
                path = [CGPoint(x: x, y: from.y), CGPoint(x: x, y: to.y)]
            } else {
                let y = (from.y + to.y) / 2 + shift
                path = [from, CGPoint(x: from.x, y: y), CGPoint(x: to.x, y: y), to]
            }
        case (false, true):
            path = [from, CGPoint(x: to.x, y: from.y), to]
        case (true, false):
            path = [from, CGPoint(x: from.x, y: to.y), to]
        }

        path = simplified(path)
        guard path.count >= 2, leaves(path, side: exit), enters(path, side: entry) else { return nil }
        return path
    }

    /// Corners that are not corners: a zero-length step, or a point in the
    /// middle of a straight run.
    static func simplified(_ path: [CGPoint]) -> [CGPoint] {
        var out: [CGPoint] = []
        for point in path {
            if let last = out.last, abs(last.x - point.x) < 0.001, abs(last.y - point.y) < 0.001 { continue }
            out.append(point)
        }
        guard out.count > 2 else { return out }
        var trimmed = [out[0]]
        for index in 1..<(out.count - 1) {
            let before = trimmed[trimmed.count - 1], here = out[index], after = out[index + 1]
            let straightX = abs(before.x - here.x) < 0.001 && abs(here.x - after.x) < 0.001
            let straightY = abs(before.y - here.y) < 0.001 && abs(here.y - after.y) < 0.001
            if straightX || straightY { continue }
            trimmed.append(here)
        }
        trimmed.append(out[out.count - 1])
        return trimmed
    }

    /// The line has to actually leave the box by the side it says it does —
    /// otherwise it starts by running back across its own node.
    static func leaves(_ path: [CGPoint], side: Side) -> Bool {
        guard path.count >= 2 else { return false }
        return goes(from: path[0], to: path[1], towards: side)
    }

    /// And arrive at the other from outside it: coming in through the left
    /// side means the last step travels to the right.
    static func enters(_ path: [CGPoint], side: Side) -> Bool {
        guard path.count >= 2 else { return false }
        let last = path[path.count - 1], before = path[path.count - 2]
        return goes(from: before, to: last, towards: opposite(side))
    }

    static func goes(from: CGPoint, to: CGPoint, towards side: Side) -> Bool {
        switch side {
        case .right: return to.x > from.x + 0.001
        case .left: return to.x < from.x - 0.001
        case .bottom: return to.y > from.y + 0.001
        case .top: return to.y < from.y - 0.001
        }
    }

    static func opposite(_ side: Side) -> Side {
        switch side {
        case .left: return .right
        case .right: return .left
        case .top: return .bottom
        case .bottom: return .top
        }
    }

    static func length(_ path: [CGPoint]) -> CGFloat {
        guard path.count >= 2 else { return 0 }
        var total: CGFloat = 0
        for index in 0..<(path.count - 1) {
            let dx: CGFloat = abs(path[index + 1].x - path[index].x)
            let dy: CGFloat = abs(path[index + 1].y - path[index].y)
            total += dx + dy
        }
        return total
    }

    /// Whether a path misses every box in `boxes`.
    static func clear(_ path: [CGPoint], of boxes: [CGRect]) -> Bool {
        guard path.count >= 2 else { return true }
        for box in boxes {
            let shrunk = box.insetBy(dx: 0.5, dy: 0.5)
            guard shrunk.width > 0, shrunk.height > 0 else { continue }
            for index in 0..<(path.count - 1) where crosses(path[index], path[index + 1], shrunk) {
                return false
            }
        }
        return true
    }

    /// A horizontal or vertical segment against a box.
    static func crosses(_ a: CGPoint, _ b: CGPoint, _ box: CGRect) -> Bool {
        let minX = min(a.x, b.x), maxX = max(a.x, b.x)
        let minY = min(a.y, b.y), maxY = max(a.y, b.y)
        return maxX > box.minX && minX < box.maxX && maxY > box.minY && minY < box.maxY
    }

    // MARK: - Segments the hand can move

    /// The middle of every segment, with which way it runs — where the
    /// circles go (Sean, 2026-09-19: "a small circle at the middle of any
    /// line segment where it can be dragged to move").
    static func midpoints(of path: [CGPoint]) -> [(index: Int, point: CGPoint, vertical: Bool)] {
        guard path.count >= 2 else { return [] }
        return (0..<(path.count - 1)).map { index in
            let a = path[index], b = path[index + 1]
            return (index, CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2), abs(a.x - b.x) < abs(a.y - b.y))
        }
    }

    /// One segment moved sideways, with the segments either side of it
    /// stretching to follow. `value` is the new x of a vertical segment or
    /// the new y of a horizontal one.
    static func moved(_ path: [CGPoint], segment: Int, to value: CGFloat) -> [CGPoint] {
        guard path.count >= 2, path.indices.contains(segment), path.indices.contains(segment + 1) else {
            return path
        }
        var out = path
        let vertical = abs(path[segment].x - path[segment + 1].x) < abs(path[segment].y - path[segment + 1].y)
        if vertical {
            out[segment].x = value
            out[segment + 1].x = value
        } else {
            out[segment].y = value
            out[segment + 1].y = value
        }
        return out
    }

    /// Where a dragged segment sits now, in the coordinate its override
    /// remembers.
    static func value(of path: [CGPoint], segment: Int) -> CGFloat? {
        guard path.indices.contains(segment), path.indices.contains(segment + 1) else { return nil }
        let a = path[segment], b = path[segment + 1]
        return abs(a.x - b.x) < abs(a.y - b.y) ? a.x : a.y
    }

    /// The path with every remembered drag put back — and the ends kept on
    /// their boxes, so a line that was dragged along a node's edge stays
    /// attached to it.
    static func applying(_ overrides: [ConnectorItem.SegmentOverride], to path: [CGPoint],
                         start: CGRect?, end: CGRect?, in size: CGSize) -> [CGPoint] {
        guard path.count >= 2 else { return path }
        var out = path
        for override in overrides {
            guard out.indices.contains(override.index), out.indices.contains(override.index + 1) else { continue }
            let a = out[override.index], b = out[override.index + 1]
            let vertical = abs(a.x - b.x) < abs(a.y - b.y)
            guard vertical == override.vertical else { continue }   // the line has changed shape
            out = moved(out, segment: override.index,
                        to: CGFloat(override.value) * (vertical ? size.width : size.height))
        }
        if let start { out[0] = clamped(out[0], to: start) }
        if let end { out[out.count - 1] = clamped(out[out.count - 1], to: end) }
        return out
    }

    /// An endpoint kept on its box's edge.
    static func clamped(_ point: CGPoint, to box: CGRect) -> CGPoint {
        let inside = CGPoint(x: min(max(point.x, box.minX), box.maxX),
                             y: min(max(point.y, box.minY), box.maxY))
        // Whichever edge it is nearest is the one it sits on.
        let distances = [inside.x - box.minX, box.maxX - inside.x, inside.y - box.minY, box.maxY - inside.y]
        guard let nearest = distances.enumerated().min(by: { $0.element < $1.element })?.offset else {
            return inside
        }
        switch nearest {
        case 0: return CGPoint(x: box.minX, y: inside.y)
        case 1: return CGPoint(x: box.maxX, y: inside.y)
        case 2: return CGPoint(x: inside.x, y: box.minY)
        default: return CGPoint(x: inside.x, y: box.maxY)
        }
    }

    /// Which lane each line takes, so two that would run down the same
    /// corridor do not sit on top of each other. Lines whose middle segment
    /// was dragged by hand keep exactly where they were put.
    static func channels(for paths: [[CGPoint]], fixed: Set<Int>) -> [Int] {
        var lanes = [Int](repeating: 0, count: paths.count)
        var used: [String: [Int]] = [:]
        for (index, path) in paths.enumerated() where path.count == 4 && !fixed.contains(index) {
            let a = path[1], b = path[2]
            let vertical = abs(a.x - b.x) < abs(a.y - b.y)
            let coordinate = vertical ? a.x : a.y
            let key = "\(vertical ? "v" : "h")-\(Int((coordinate / channelStep).rounded()))"
            used[key, default: []].append(index)
        }
        for (_, group) in used where group.count > 1 {
            for (offset, index) in group.enumerated() {
                lanes[index] = offset - (group.count - 1) / 2
            }
        }
        return lanes
    }
}
