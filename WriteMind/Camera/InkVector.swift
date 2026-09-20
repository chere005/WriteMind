import AppKit
import CoreGraphics

/// The writing lifted off a photographed page, as a VECTOR graphic (Sean,
/// 2026-09-19: "when getting the drawing, make it a vector graphic so it
/// scales well").
///
/// The ink mask is a grid of pixels, so a capture used to go on the page as
/// a PNG: blow it up with the handles and the strokes went soft. Here the
/// same mask is traced instead. Every boundary between ink and paper is one
/// unit edge of a pixel square; chained end to end those edges close into
/// loops — the outside of a stroke, and the hole inside an "o" or an "A" —
/// and filling all of them EVEN-ODD paints exactly the pixels the mask had,
/// at any size, because the loops are geometry rather than samples.
///
/// The staircase those loops start out as is then thinned by
/// Douglas–Peucker, which drops the points that sit within `tolerance` of
/// the line between their neighbours: a straight pen stroke goes from
/// hundreds of unit steps to a handful of corners, and the file stays small
/// enough to live beside the note.
enum InkVector {
    /// How far a traced outline may stray from the pixels it came from.
    /// Under half a pixel nothing can be dropped (the staircase itself is
    /// half a pixel deep); much over one and round letters go polygonal.
    static let tolerance: CGFloat = 0.75

    // MARK: - Tracing

    /// Every closed outline around the ink inside `box`, in the box's own
    /// pixels with y running down — the same coordinates the raster capture
    /// uses, so a traced capture lands exactly where a raster one did.
    static func outlines(of mask: NotebookCapture.Mask,
                         box: (x: Int, y: Int, width: Int, height: Int),
                         tolerance: CGFloat = tolerance) -> [[CGPoint]] {
        let (x0, y0, width, height) = (box.x, box.y, box.width, box.height)
        guard width > 0, height > 0 else { return [] }
        let stride = width + 1

        func inked(_ x: Int, _ y: Int) -> Bool {
            guard x >= 0, y >= 0, x < width, y < height else { return false }
            let px = x + x0, py = y + y0
            guard px >= 0, py >= 0, px < mask.width, py < mask.height else { return false }
            return mask.ink[py * mask.width + px]
        }
        func node(_ x: Int, _ y: Int) -> Int { y * stride + x }

        // Each edge is walked with the ink on one side, always the same
        // side, so the chaining below never has to ask which way is out.
        var next: [Int: [Int]] = [:]
        var count = 0
        for y in 0..<height {
            for x in 0..<width where inked(x, y) {
                if !inked(x, y - 1) { next[node(x, y), default: []].append(node(x + 1, y)); count += 1 }
                if !inked(x + 1, y) { next[node(x + 1, y), default: []].append(node(x + 1, y + 1)); count += 1 }
                if !inked(x, y + 1) { next[node(x + 1, y + 1), default: []].append(node(x, y + 1)); count += 1 }
                if !inked(x - 1, y) { next[node(x, y + 1), default: []].append(node(x, y)); count += 1 }
            }
        }
        guard count > 0 else { return [] }

        var loops: [[CGPoint]] = []
        for start in next.keys.sorted() {
            while var ends = next[start], !ends.isEmpty {
                var loop = [start]
                var here = ends.removeLast()
                next[start] = ends.isEmpty ? nil : ends
                // A pixel touched only at its corner has two edges leaving
                // the same node; either choice covers the same paper once
                // the loops are filled even-odd, so the first is taken.
                while here != start {
                    loop.append(here)
                    guard var out = next[here], !out.isEmpty else { break }
                    let step = out.removeLast()
                    next[here] = out.isEmpty ? nil : out
                    here = step
                }
                let points = loop.map { CGPoint(x: CGFloat($0 % stride), y: CGFloat($0 / stride)) }
                if let simplified = simplify(closed: points, tolerance: tolerance) { loops.append(simplified) }
            }
        }
        return loops
    }

    /// Douglas–Peucker over a closed ring. The ring is cut at its first
    /// point, thinned as an open line, and closed again.
    static func simplify(closed ring: [CGPoint], tolerance: CGFloat) -> [CGPoint]? {
        guard ring.count > 3 else { return ring.count >= 3 ? ring : nil }
        let line = ring + [ring[0]]
        var kept = simplify(line, tolerance: tolerance)
        if kept.count > 1, kept[0] == kept[kept.count - 1] { kept.removeLast() }
        return kept.count >= 3 ? kept : nil
    }

    /// Douglas–Peucker over an open polyline, iteratively — a stroke can
    /// run to tens of thousands of points, and recursion on that is a
    /// stack overflow waiting for a long page.
    static func simplify(_ points: [CGPoint], tolerance: CGFloat) -> [CGPoint] {
        guard points.count > 2 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        var spans = [(0, points.count - 1)]
        while let (first, last) = spans.popLast() {
            guard last > first + 1 else { continue }
            var worst = 0.0
            var index = first
            for i in (first + 1)..<last {
                let distance = perpendicular(points[i], from: points[first], to: points[last])
                if distance > worst { worst = distance; index = i }
            }
            guard worst > tolerance else { continue }
            keep[index] = true
            spans.append((first, index))
            spans.append((index, last))
        }
        return points.enumerated().filter { keep[$0.offset] }.map(\.element)
    }

    /// How far a point is off the line between two others.
    static func perpendicular(_ point: CGPoint, from a: CGPoint, to b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let length = (dx * dx + dy * dy).squareRoot()
        guard length > 0 else { return hypot(point.x - a.x, point.y - a.y) }
        return abs(dy * (point.x - a.x) - dx * (point.y - a.y)) / length
    }

    // MARK: - The graphic

    static func path(_ loops: [[CGPoint]]) -> CGPath {
        let path = CGMutablePath()
        for loop in loops where loop.count >= 3 {
            path.move(to: loop[0])
            for point in loop.dropFirst() { path.addLine(to: point) }
            path.closeSubpath()
        }
        return path
    }

    /// The loops as a one-page PDF the size of the box they were traced in:
    /// a real vector file on the disk, which Preview and every other app can
    /// scale as well as WriteMind can.
    static func pdf(outlines loops: [[CGPoint]], size: CGSize, colour: NSColor) -> Data? {
        guard !loops.isEmpty, size.width >= 1, size.height >= 1 else { return nil }
        let data = NSMutableData()
        var media = CGRect(origin: .zero, size: size)
        guard let consumer = CGDataConsumer(data: data),
              let context = CGContext(consumer: consumer, mediaBox: &media, nil) else { return nil }
        let rgb = colour.usingColorSpace(.deviceRGB) ?? .black
        context.beginPDFPage(nil)
        // The trace counts y down the page; PDF counts it up.
        context.translateBy(x: 0, y: size.height)
        context.scaleBy(x: 1, y: -1)
        context.setFillColor(red: rgb.redComponent, green: rgb.greenComponent,
                             blue: rgb.blueComponent, alpha: 1)
        context.addPath(path(loops))
        context.fillPath(using: .evenOdd)
        context.endPDFPage()
        context.closePDF()
        return data as Data
    }

    /// The writing inside `box`, traced, as a PDF — nil when there is no ink
    /// to trace, which leaves the caller with the raster it already has.
    static func pdf(of mask: NotebookCapture.Mask,
                    box: (x: Int, y: Int, width: Int, height: Int),
                    colour: NSColor) -> Data? {
        pdf(outlines: outlines(of: mask, box: box),
            size: CGSize(width: box.width, height: box.height), colour: colour)
    }
}
