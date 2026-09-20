import SwiftUI

/// The SHAPE of what the pen and the arrow tool leave behind, with no
/// context to draw it into.
///
/// The layer on screen is a SwiftUI `Canvas` and paper is a `CGContext`;
/// they can only be the same lines if the lines themselves live in one
/// place. Everything geometric about a stroke and a connector is here, so
/// `DrawingCanvas` and `DrawingInk` differ only in what they hand the path
/// to.
///
/// `DrawingCanvas.draw(_ stroke:…)` and `draw(_ connector:…)` each carried
/// their own copy of this until 2026-09-19; they are now a call apiece, so
/// a change to how a stroke is smoothed lands on the screen and on paper
/// at the same time.
enum InkPaths {
    /// A stroke: the smoothed line through its samples, or a dot when the
    /// pen went down and did not move. `filled` says which of the two it
    /// is — a dot is filled, a line is stroked.
    ///
    /// The curve is quadratics through the MIDPOINTS of the samples, which
    /// is what takes the corners off a raw mouse trail.
    static func path(for stroke: Stroke, points: [CGPoint]) -> (path: Path, filled: Bool) {
        guard let first = points.first else { return (Path(), false) }
        if points.count == 1 {
            let dot = CGRect(x: first.x - stroke.width / 2, y: first.y - stroke.width / 2,
                             width: stroke.width, height: stroke.width)
            return (Path(ellipseIn: dot), true)
        }
        var path = Path()
        path.move(to: first)
        if points.count == 2 {
            path.addLine(to: points[1])
        } else {
            for index in 1..<(points.count - 1) {
                let mid = CGPoint(x: (points[index].x + points[index + 1].x) / 2,
                                  y: (points[index].y + points[index + 1].y) / 2)
                path.addQuadCurve(to: mid, control: points[index])
            }
            path.addLine(to: points[points.count - 1])
        }
        return (path, false)
    }

    /// A connector: the line, with each end that carries a head pulled back
    /// along its own last segment so the head's TIP is the point, and the
    /// heads themselves as filled triangles.
    static func paths(for connector: ConnectorItem, points: [CGPoint]) -> (line: Path, heads: [Path]) {
        guard points.count >= 2 else { return (Path(), []) }
        let head = ConnectorItem.headLength(for: connector.lineWidth)
        var drawn = points
        if connector.startHead != .none {
            drawn[0] = ConnectorItem.shortened(points[0], from: points[1], by: head * 0.8)
        }
        let last = drawn.count - 1
        if connector.endHead != .none {
            drawn[last] = ConnectorItem.shortened(points[last], from: points[last - 1], by: head * 0.8)
        }
        var line = Path()
        line.move(to: drawn[0])
        for point in drawn.dropFirst() { line.addLine(to: point) }

        var heads: [Path] = []
        if connector.startHead == .arrow {
            heads.append(ConnectorItem.head(tip: points[0], from: points[1], lineWidth: connector.lineWidth))
        }
        if connector.endHead == .arrow {
            heads.append(ConnectorItem.head(tip: points[last], from: points[last - 1],
                                            lineWidth: connector.lineWidth))
        }
        return (line, heads)
    }
}
