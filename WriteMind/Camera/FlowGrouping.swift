import CoreGraphics
import Foundation

/// A sketched flow chart lifted off a page: which blob of ink is a box,
/// which words are its label, and which arrow joins which pair of boxes.
///
/// The idea the whole thing turns on: a NODE IS A HOLE. A drawn box, oval
/// or diamond encloses a piece of paper, and that piece of paper is a
/// background region the page's edge cannot reach. Finding nodes as holes
/// rather than as blobs survives the two things that ruin blob analysis on
/// a real page — an arrow that touches the box (the blob merges, the hole
/// does not) and a box drawn in two strokes that do not quite meet (one
/// closing pass and the hole is back).
enum FlowGrouping {

    // MARK: - What comes out

    struct Node {
        var index: Int
        /// The outer edge of the drawn outline, in mask pixels.
        var box: CGRect
        /// The paper it encloses.
        var hole: CGRect
        var kind: String
        /// How far the hole's own edges sit from that shape's, a fraction
        /// of its width. Big means it is not any shape.
        var kindError: Double
        /// How much of its own box the paper inside fills.
        var holeFill: Double
        var skew: Double
        var label: String
        var words: [Int]
        /// The node this one is drawn inside, if any.
        var parent: Int?
        /// Cells of a table are not flow-chart nodes.
        var isTableCell: Bool
        /// A ring drawn round a word to stress it, not a box round a step.
        var isEmphasis: Bool
        /// Set when the hole is no shape at all.
        var isShapeless: Bool
        var isNode: Bool { !isTableCell && !isEmphasis && !isShapeless }
    }

    struct Edge {
        var from: Int?
        var to: Int?
        /// Ends in mask pixels, tail first.
        var tail: CGPoint
        var head: CGPoint
        var headAtEnd: Bool
        var headAtStart: Bool
        /// Why an end is loose, for the report.
        var note: String
    }

    struct Rejected {
        var reason: String
        var box: CGRect
    }

    struct Sheet {
        var width: Int
        var height: Int
        var strokeWidth: Double
        var nodes: [Node]
        var edges: [Edge]
        var tables: [CGRect]
        var freeWords: [Int]
        var rejected: [Rejected]
    }

    struct Word {
        var text: String
        var box: CGRect
    }

    // MARK: - The numbers

    struct Settings {
        /// A hole smaller than this across is a letter's counter, not a box.
        /// shortSide / 22 is 55px on a 1200px page — a hand-drawn box is
        /// never that small and an `o` never that big.
        var minimumHoleSide: Double = 1.0 / 22
        /// …and it has to have some area as well as some width, so a long
        /// thin sliver between two strokes is not a node.
        var minimumHoleArea: Double = 0.4
        /// Closing this much joins up a box whose ends did not meet.
        var closingRadius: Double = 1.0 / 100
        /// A word is a node's label when this much of it is inside.
        var labelCoverage: Double = 0.5
        /// How far an arrow's end may stop short of a box and still count.
        var attachTolerance: Double = 1.0 / 22
        /// Two boxes this close to equally near an end make it ambiguous.
        var ambiguityRatio: Double = 1.3
        /// A stroke shorter than this is not a connector.
        var minimumStrokeLength: Double = 1.0 / 18
        /// End-to-end distance over the length of the line actually drawn.
        /// A connector is near enough straight; a scribble is not.
        var straightness: Double = 0.5
        /// A stroke with this much of itself lying in a box's outline is a
        /// crumb of that outline, not a line.
        var debrisShare: Double = 0.85
        /// One end heavier than the other by this much carries the head.
        /// Only used to describe the confident case; `weakHeadRatio` is
        /// what actually decides.
        var headRatio: Double = 1.35
        /// Both ends this much heavier than the shaft: a two-headed arrow.
        var doubleHeadRatio: Double = 1.5
        /// A line under a word: this much of the word above it…
        var underlineOverlap: Double = 0.55
        /// …and no further below the word's foot than this, in word heights.
        var underlineDrop: Double = 0.55
        /// How far past the paper inside a box the outline is rubbed out,
        /// in stroke widths.
        var outlineGrow: Double = 1.3
        /// Below `headRatio` but above this, the heavier end still carries
        /// the head — a head that landed on a box loses barbs to the
        /// rubbing out, so the evidence is weaker but still evidence.
        var weakHeadRatio: Double = 1.25
        /// With no head to be seen at all, a chart is read down the page
        /// and left to right.
        var readingOrder = true
        /// A hole whose edges are further than this from every shape's is
        /// not a box: a loop in the middle of a scribble, say.
        var shapeError: Double = 0.075
        /// A ring holding a word this tightly, with no arrow on it and
        /// nothing drawn inside it, is emphasis rather than a step.
        var emphasisFill: Double = 0.25
    }

    // MARK: - Entry point

    static func read(ink: [Bool], width: Int, height: Int, words: [Word],
                     settings: Settings = Settings()) -> Sheet {
        let shortSide = Double(min(width, height))
        let stroke = strokeWidth(ink: ink, width: width, height: height)
        let closingRadius = max(2, Int((settings.closingRadius * shortSide).rounded()))
        let closed = closing(ink, width: width, height: height, radius: closingRadius)

        // 1. Nodes are the holes.
        let minSide = max(6.0, settings.minimumHoleSide * shortSide)
        // Letters' counters go now; the slivers a word cuts a box into stay,
        // because two of them put together are still a box.
        let holes = self.holes(closed, width: width, height: height).filter { hole in
            Double(min(hole.box.width, hole.box.height)) >= minSide / 3
                && Double(max(hole.box.width, hole.box.height)) >= minSide
                && Double(hole.area) >= minSide * minSide * settings.minimumHoleArea / 3
        }

        // 2. A word that crosses an outline cuts the paper inside in two.
        //    Where a word straddles the cut, the two pieces are one node.
        let merged = mergeSplitHoles(holes, words: words).filter { hole in
            Double(hole.box.width) >= minSide && Double(hole.box.height) >= minSide
                && Double(hole.area) >= minSide * minSide * settings.minimumHoleArea
        }

        // 3. A ring of boxes joined by arrows encloses a piece of paper
        //    too, and that piece is not a box. It gives itself away by
        //    lying ACROSS the boxes it runs between: one box drawn inside
        //    another is wholly inside it, and two boxes side by side do
        //    not meet at all, so a partial overlap is never a real pair.
        //    The bigger of the two is the loop.
        let kept = withoutLoops(merged)

        // 4. A grid of same-sized holes is a table, not a row of nodes.
        let (tableGroups, tableMembers) = tables(kept, stroke: stroke)

        var nodes: [Node] = []
        for (index, hole) in kept.enumerated() {
            let grown = hole.box.insetBy(dx: -CGFloat(stroke + 2), dy: -CGFloat(stroke + 2))
            let fit = kind(of: hole, stroke: stroke)
            nodes.append(Node(index: index, box: grown, hole: hole.box,
                              kind: fit.name, kindError: fit.error,
                              holeFill: Double(hole.area) / Double(max(1, hole.box.width * hole.box.height)),
                              skew: slide(hole), label: "", words: [],
                              parent: nil, isTableCell: tableMembers.contains(index),
                              isEmphasis: false, isShapeless: fit.error > settings.shapeError))
        }

        // 4. Nesting: the smallest box that holds this one is its parent.
        for i in nodes.indices {
            var best: Int?
            for j in nodes.indices where i != j {
                guard nodes[j].box.contains(nodes[i].box) else { continue }
                if best == nil || nodes[j].box.area < nodes[best!].box.area { best = j }
            }
            nodes[i].parent = best
        }

        // 5. Labels: the innermost box that holds enough of the word.
        var freeWords: [Int] = []
        for (w, word) in words.enumerated() {
            guard word.box.width > 0, word.box.height > 0 else { continue }
            var best: Int?
            for i in nodes.indices where nodes[i].isNode || nodes[i].isTableCell {
                let cover = Double(nodes[i].box.intersection(word.box).area) / Double(word.box.area)
                guard cover >= settings.labelCoverage else { continue }
                if best == nil || nodes[i].box.area < nodes[best!].box.area { best = i }
            }
            if let best { nodes[best].words.append(w) } else { freeWords.append(w) }
        }
        for i in nodes.indices {
            nodes[i].label = nodes[i].words
                .sorted { words[$0].box.minY == words[$1].box.minY
                    ? words[$0].box.minX < words[$1].box.minX
                    : words[$0].box.minY < words[$1].box.minY }
                .map { words[$0].text }.joined(separator: " ")
        }

        // 6. What is left of the ink once the outlines are gone: the strokes.
        // Only the outlines of things that really are boxes come away.
        // Rubbing out the ring round a loop in a scribble would cut the
        // scribble into pieces, and a piece of a scribble looks like a
        // line.
        let outlines = nodes.filter { !$0.isShapeless }.map { hole -> Hole in
            kept[hole.index]
        }
        let strokeMask = withoutOutlines(ink, width: width, height: height,
                                         holes: outlines, stroke: stroke, closing: closingRadius,
                                         grow: settings.outlineGrow)
        let pieces = NotebookCapture.components(in: strokeMask, width: width, height: height)
        var edges: [Edge] = []
        var rejected: [Rejected] = []
        let minLength = settings.minimumStrokeLength * shortSide
        let tolerance = settings.attachTolerance * shortSide

        // An arrow whose head landed ON a box loses the head when the
        // outline is rubbed out: the two barbs come away as their own
        // little blobs. They are kept, because where they lie is the best
        // evidence left of which end the head was.
        var crumbs: [(centre: CGPoint, area: Int)] = []
        for piece in pieces where piece.area >= Int(stroke * 3) {
            guard max(piece.width, piece.height) < Int(minLength) else { continue }
            guard !words.contains(where: {
                $0.box.intersection(CGRect(x: piece.minX, y: piece.minY,
                                           width: piece.width, height: piece.height)).area > 0
            }) else { continue }
            crumbs.append((CGPoint(x: piece.centre.x, y: piece.centre.y), piece.area))
        }
        func barbs(near p: CGPoint, radius: CGFloat) -> Int {
            crumbs.filter { hypot($0.centre.x - p.x, $0.centre.y - p.y) <= radius }
                .map(\.area).reduce(0, +)
        }

        for piece in pieces {
            let box = CGRect(x: piece.minX, y: piece.minY, width: piece.width, height: piece.height)
            // Label text: it sits inside a node, or it is a word Vision read.
            if words.contains(where: { $0.box.intersection(box).area > box.area / 2 }) {
                rejected.append(Rejected(reason: "text", box: box)); continue
            }
            guard let (a, b) = endpoints(of: piece, width: width) else { continue }
            let length = hypot(a.x - b.x, a.y - b.y)
            guard length >= CGFloat(minLength) else {
                rejected.append(Rejected(reason: "short", box: box)); continue
            }
            // Near enough straight: the ink drawn (its area over the pen's
            // width) is not much more than the distance between the ends.
            // A scribble runs to several times that.
            let drawn = Double(piece.area) / stroke
            guard Double(length) / max(drawn, 1) >= settings.straightness else {
                rejected.append(Rejected(reason: "scribble", box: box)); continue
            }
            // A crumb of an outline the rubbing out left behind.
            if debris(piece, holes: outlines, stroke: stroke, closing: closingRadius,
                      grow: settings.outlineGrow) >= settings.debrisShare {
                rejected.append(Rejected(reason: "outline crumb", box: box)); continue
            }

            // Which end carries the barbs: the same quarters rule
            // HandwritingMarks.arrow uses, but along the stroke's OWN axis
            // rather than its box, so a diagonal arrow is read too.
            // A barb is about as long whatever the arrow's length, so the
            // ink is weighed in a window of that size at each end rather
            // than in a quarter of the whole — HandwritingMarks' quarters
            // rule washes a head out on a long arrow.
            let window = min(length * 0.3, CGFloat(max(stroke * 8 + 10, 30)))
            let (atA, atB, shaftDensity) = ends(of: piece, from: a, to: b, length: length,
                                                window: window, width: width)
            let ratio = Double(max(atA, atB)) / Double(max(1, min(atA, atB)))
            var tail = a, head = b
            var headAtEnd = false, headAtStart = false
            var sawBarbs = false
            if ratio >= settings.weakHeadRatio {
                if atA > atB { tail = b; head = a }
                headAtEnd = true
                sawBarbs = true
            } else {
                // No barbs left on the stroke itself: look for the blobs
                // the rubbing out knocked off, by each end.
                let reach = window * 1.4
                let barbsA = barbs(near: a, radius: reach), barbsB = barbs(near: b, radius: reach)
                let floor = Int(stroke * stroke * 4)
                if max(barbsA, barbsB) >= floor,
                   Double(max(barbsA, barbsB)) >= Double(max(1, min(barbsA, barbsB))) * 1.5 {
                    if barbsA > barbsB { tail = b; head = a }
                    headAtEnd = true
                    sawBarbs = true
                } else if settings.readingOrder {
                    // Nothing to choose between the ends: a chart is read
                    // down the page, and left to right where two things
                    // are level.
                    if abs(b.y - a.y) >= abs(b.x - a.x) {
                        if a.y > b.y { tail = b; head = a }
                    } else if a.x > b.x { tail = b; head = a }
                    headAtEnd = true
                }
            }
            // Both ends heavier than the plain shaft between them: two heads.
            let plain = shaftDensity * Double(window)
            if !sawBarbs, plain > 0,
               Double(min(atA, atB)) >= plain * settings.doubleHeadRatio {
                headAtEnd = true; headAtStart = true
            }

            let (fromNode, fromNote) = attach(tail, nodes: nodes, tolerance: tolerance, settings: settings)
            let (toNode, toNote) = attach(head, nodes: nodes, tolerance: tolerance, settings: settings)

            if fromNode == nil, toNode == nil {
                if isUnderline(tail: tail, head: head, stroke: stroke, words: words, settings: settings) {
                    rejected.append(Rejected(reason: "underline", box: box)); continue
                }
                if !sawBarbs {
                    rejected.append(Rejected(reason: "loose line", box: box)); continue
                }
            }
            if let fromNode, fromNode == toNode {
                rejected.append(Rejected(reason: "both ends on one box", box: box)); continue
            }
            edges.append(Edge(from: fromNode, to: toNode, tail: tail, head: head,
                              headAtEnd: headAtEnd, headAtStart: headAtStart,
                              note: ([fromNote, toNote].filter { !$0.isEmpty }
                                     + [String(format: "len%.0f ends %d/%d r%.2f%@", length, atA, atB, ratio,
                                                sawBarbs ? "" : " byorder")])
                                  .joined(separator: " ")))
        }

        // 7. A ring round a word with nothing attached is emphasis.
        for i in nodes.indices {
            guard !nodes[i].words.isEmpty, nodes[i].parent == nil, !nodes[i].isTableCell else { continue }
            guard !nodes.contains(where: { $0.parent == i }) else { continue }
            guard !edges.contains(where: { $0.from == i || $0.to == i }) else { continue }
            // A box has room round its label; a ring drawn to stress a word
            // hugs it.
            let covered = nodes[i].words
                .map { Double(words[$0].box.area) }.reduce(0, +) / Double(nodes[i].hole.area)
            if covered >= settings.emphasisFill { nodes[i].isEmphasis = true }
        }

        return Sheet(width: width, height: height, strokeWidth: stroke, nodes: nodes, edges: edges,
                     tables: tableGroups, freeWords: freeWords, rejected: rejected)
    }

    // MARK: - Which box an end belongs to

    /// The box nearest an arrow's end, when one is near enough and no other
    /// is nearly as near. Inside a box beats near one; when an end is
    /// inside two nested boxes it belongs to the OUTER one, because the
    /// arrow came from outside and that is the edge it crossed.
    static func attach(_ point: CGPoint, nodes: [Node], tolerance: Double,
                       settings: Settings) -> (Int?, String) {
        var inside: [Int] = []
        var near: [(index: Int, distance: Double)] = []
        for (i, node) in nodes.enumerated() where node.isNode {
            let d = distance(from: point, to: node.box)
            if d == 0 { inside.append(i) } else if d <= tolerance { near.append((i, d)) }
        }
        if !inside.isEmpty {
            // The outermost of the boxes it is inside.
            let outer = inside.max { nodes[$0].box.area < nodes[$1].box.area }!
            return (outer, "")
        }
        guard !near.isEmpty else { return (nil, "free end") }
        near.sort { $0.distance < $1.distance }
        if near.count >= 2, near[1].distance <= near[0].distance * settings.ambiguityRatio {
            return (near[0].index, "ambiguous end")
        }
        return (near[0].index, "")
    }

    static func distance(from point: CGPoint, to box: CGRect) -> Double {
        let dx = max(box.minX - point.x, 0, point.x - box.maxX)
        let dy = max(box.minY - point.y, 0, point.y - box.maxY)
        return Double(hypot(dx, dy))
    }

    // MARK: - A line under a word

    static func isUnderline(tail: CGPoint, head: CGPoint, stroke: Double,
                            words: [Word], settings: Settings) -> Bool {
        let dy = abs(tail.y - head.y), dx = abs(tail.x - head.x)
        guard dx > 0, dy <= CGFloat(stroke) * 2.5 else { return false }
        let x0 = min(tail.x, head.x), x1 = max(tail.x, head.x)
        let y = (tail.y + head.y) / 2
        for word in words where word.box.width > 0 {
            let overlap = min(x1, word.box.maxX) - max(x0, word.box.minX)
            guard overlap >= word.box.width * CGFloat(settings.underlineOverlap) else { continue }
            let foot = word.box.maxY
            if y >= foot - word.box.height * 0.2, y <= foot + word.box.height * CGFloat(settings.underlineDrop) {
                return true
            }
        }
        return false
    }

    // MARK: - Tables

    /// Holes that touch side by side in rows and columns, all much the same
    /// size, are the cells of a table. Two pieces of one node are not: they
    /// are different sizes and there are only two of them.
    static func tables(_ holes: [Hole], stroke: Double) -> ([CGRect], Set<Int>) {
        let gap = CGFloat(stroke * 4 + 6)
        var parent = Array(holes.indices)
        func root(_ i: Int) -> Int { parent[i] == i ? i : { let r = root(parent[i]); parent[i] = r; return r }() }
        for i in holes.indices {
            for j in holes.indices where j > i {
                let a = holes[i].box, b = holes[j].box
                let xOverlap = min(a.maxX, b.maxX) - max(a.minX, b.minX)
                let yOverlap = min(a.maxY, b.maxY) - max(a.minY, b.minY)
                let xGap = max(a.minX - b.maxX, b.minX - a.maxX)
                let yGap = max(a.minY - b.maxY, b.minY - a.maxY)
                let sideBySide = xGap <= gap && yOverlap >= min(a.height, b.height) * 0.6
                let stacked = yGap <= gap && xOverlap >= min(a.width, b.width) * 0.6
                if sideBySide || stacked { parent[root(i)] = root(j) }
            }
        }
        var groups: [Int: [Int]] = [:]
        for i in holes.indices { groups[root(i), default: []].append(i) }

        var boxes: [CGRect] = []
        var members = Set<Int>()
        for (_, group) in groups where group.count >= 3 {
            let widths = group.map { holes[$0].box.width }, heights = group.map { holes[$0].box.height }
            let regular = widths.max()! <= widths.min()! * 1.3 && heights.max()! <= heights.min()! * 1.3
            guard regular else { continue }
            let rows = Set(group.map { Int((holes[$0].box.midY / max(1, heights.min()!)).rounded()) })
            let columns = Set(group.map { Int((holes[$0].box.midX / max(1, widths.min()!)).rounded()) })
            guard rows.count >= 2 || columns.count >= 3 else { continue }
            var union = holes[group[0]].box
            for i in group.dropFirst() { union = union.union(holes[i].box) }
            boxes.append(union)
            members.formUnion(group)
        }
        return (boxes, members)
    }

    /// A word that crosses an outline splits the paper inside it in two.
    /// The evidence for that, rather than for two boxes side by side, is a
    /// word lying ACROSS the gap between them: reaching from inside one
    /// into the other. Table cells are divided by a ruled line with no word
    /// over it, so they are left alone.
    static func mergeSplitHoles(_ holes: [Hole], words: [Word]) -> [Hole] {
        var parent = Array(holes.indices)
        func root(_ i: Int) -> Int { parent[i] == i ? i : { let r = root(parent[i]); parent[i] = r; return r }() }
        for i in holes.indices {
            for j in holes.indices where j > i {
                let a = holes[i].box, b = holes[j].box
                guard straddled(a, b, by: words) else { continue }
                parent[root(i)] = root(j)
            }
        }
        var groups: [Int: [Int]] = [:]
        for i in holes.indices { groups[root(i), default: []].append(i) }
        return groups.values.map { group -> Hole in
            var box = holes[group[0]].box
            var area = 0
            var rows: [Int: (Int, Int, Int)] = [:]
            for i in group {
                box = box.union(holes[i].box)
                area += holes[i].area
                for (y, run) in holes[i].rows {
                    if let had = rows[y] { rows[y] = (min(had.0, run.0), max(had.1, run.1), had.2 + run.2) }
                    else { rows[y] = run }
                }
            }
            return Hole(box: box, area: area, rows: rows)
        }.sorted { $0.box.minY == $1.box.minY ? $0.box.minX < $1.box.minX : $0.box.minY < $1.box.minY }
    }

    /// Holes that half-overlap another hole are the paper caught inside a
    /// ring of boxes and arrows, not boxes. The bigger one goes.
    static func withoutLoops(_ holes: [Hole]) -> [Hole] {
        var drop = Set<Int>()
        for i in holes.indices {
            for j in holes.indices where j > i {
                let a = holes[i].box, b = holes[j].box
                guard a.intersects(b), !a.contains(b), !b.contains(a) else { continue }
                drop.insert(a.area >= b.area ? i : j)
            }
        }
        return holes.enumerated().filter { !drop.contains($0.offset) }.map(\.element)
    }

    static func straddled(_ a: CGRect, _ b: CGRect, by words: [Word]) -> Bool {
        // One box drawn inside another is not one box cut in two.
        guard !a.intersects(b) else { return false }
        for word in words where word.box.width > 0 {
            // Stacked: the word reaches from inside the upper into the lower.
            let (top, bottom) = a.midY <= b.midY ? (a, b) : (b, a)
            if bottom.minY >= top.maxY, bottom.minY - top.maxY <= word.box.height * 1.5,
               word.box.minY <= top.maxY, word.box.maxY >= bottom.minY {
                let over = min(min(word.box.maxX, top.maxX) - max(word.box.minX, top.minX),
                               min(word.box.maxX, bottom.maxX) - max(word.box.minX, bottom.minX))
                if over >= min(top.width, bottom.width) * 0.2 { return true }
            }
            // Side by side.
            let (left, right) = a.midX <= b.midX ? (a, b) : (b, a)
            if right.minX >= left.maxX, right.minX - left.maxX <= word.box.width,
               word.box.minX <= left.maxX, word.box.maxX >= right.minX {
                let over = min(min(word.box.maxY, left.maxY) - max(word.box.minY, left.minY),
                               min(word.box.maxY, right.maxY) - max(word.box.minY, right.minY))
                if over >= min(left.height, right.height) * 0.2 { return true }
            }
        }
        return false
    }

    // MARK: - What kind of box

    /// Which outline the paper inside is the shape of: every candidate
    /// drawn as a pair of edges down a unit square, and the one whose
    /// edges sit closest to the hole's own wins. The winner's error is
    /// kept, because a hole that fits NOTHING well — the loop in the
    /// middle of a scribble — is not a box at all.
    static let shapeTemplates = ["rectangle", "roundedRectangle", "oval", "diamond",
                                 "triangle", "triangleDown", "parallelogram", "parallelogramBack"]

    static func kind(of hole: Hole, stroke: Double) -> (name: String, error: Double) {
        var best = (name: "other", error: Double.infinity)
        for name in shapeTemplates {
            let error = profileError(hole, template: name)
            if error < best.error { best = (name, error) }
        }
        if best.name == "triangleDown" { best.name = "triangle" }
        if best.name == "parallelogramBack" { best.name = "parallelogram" }
        return best
    }

    /// Where a template's two edges sit, a fraction of the way across, at
    /// height `u` down it.
    static func templateEdges(_ name: String, at u: Double, aspect: Double) -> (Double, Double) {
        switch name {
        case "rectangle": return (0, 1)
        case "roundedRectangle":
            let rx = 0.18, ry = min(0.45, rx * aspect)
            let into = u < ry ? (ry - u) / ry : (u > 1 - ry ? (u - (1 - ry)) / ry : 0)
            let dx = rx * (1 - (1 - into * into).squareRoot())
            return (dx, 1 - dx)
        case "oval":
            let h = (max(0, 0.25 - (u - 0.5) * (u - 0.5))).squareRoot()
            return (0.5 - h, 0.5 + h)
        case "diamond":
            let d = abs(u - 0.5)
            return (d, 1 - d)
        case "triangle":                       // point at the top
            return ((1 - u) / 2, 1 - (1 - u) / 2)
        case "triangleDown":
            return (u / 2, 1 - u / 2)
        case "parallelogram":                  // leans right, as the app draws it
            let s = 0.20
            return (s * (1 - u), 1 - s * u)
        default:                               // leans the other way
            let s = 0.20
            return (s * u, 1 - s * (1 - u))
        }
    }

    /// How far the hole's edges are from a template's, as a fraction of its
    /// width, averaged down it. The top and bottom twelfth are left out:
    /// that is where a pen overshoots a corner and where the closing bites.
    static func profileError(_ hole: Hole, template: String) -> Double {
        let ys = hole.rows.keys.sorted()
        guard ys.count >= 8 else { return .infinity }
        let w = Double(hole.box.width), h = Double(hole.box.height)
        let aspect = w / max(1, h)
        let x0 = Double(hole.box.minX), y0 = Double(hole.box.minY)
        let skip = max(1, ys.count / 12)
        var total = 0.0, count = 0.0
        for y in ys[skip..<(ys.count - skip)] {
            guard let row = hole.rows[y] else { continue }
            let u = (Double(y) - y0) / max(1, h - 1)
            let left = (Double(row.0) - x0) / w, right = (Double(row.1) + 1 - x0) / w
            let (idealLeft, idealRight) = templateEdges(template, at: u, aspect: aspect)
            total += abs(left - idealLeft) + abs(right - idealRight)
            count += 2
        }
        return count > 0 ? total / count : .infinity
    }

    /// How far the rows slide sideways down the shape: 0 for anything
    /// upright, a fifth of the width or so for a parallelogram.
    static func slide(_ hole: Hole) -> Double {
        let ys = hole.rows.keys.sorted()
        guard ys.count >= 8 else { return 0 }
        let n = ys.count
        func mean(_ r: Range<Int>) -> Double {
            let v = ys[r].map { Double(hole.rows[$0]!.0) }
            return v.reduce(0, +) / Double(max(1, v.count))
        }
        return (mean((n / 5)..<(2 * n / 5)) - mean((3 * n / 5)..<(4 * n / 5))) / Double(hole.box.width)
    }


    // MARK: - Holes

    struct Hole {
        var box: CGRect
        var area: Int
        /// y → (first x, last x, count) — enough to tell a diamond from a
        /// triangle without keeping every pixel.
        var rows: [Int: (Int, Int, Int)]
    }

    /// Background the page's edge cannot reach, 4-connected so a diagonal
    /// touch of ink still seals a box.
    static func holes(_ ink: [Bool], width: Int, height: Int) -> [Hole] {
        var label = [Int32](repeating: -1, count: width * height)
        var out: [Hole] = []
        var stack: [Int] = []
        var next: Int32 = 0
        for start in 0..<(width * height) where !ink[start] && label[start] == -1 {
            var area = 0
            var minX = width, maxX = -1, minY = height, maxY = -1
            var rows: [Int: (Int, Int, Int)] = [:]
            var open = false
            label[start] = next
            stack.append(start)
            while let index = stack.popLast() {
                let x = index % width, y = index / width
                area += 1
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
                if let had = rows[y] { rows[y] = (min(had.0, x), max(had.1, x), had.2 + 1) }
                else { rows[y] = (x, x, 1) }
                if x == 0 || y == 0 || x == width - 1 || y == height - 1 { open = true }
                for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                    let nx = x + dx, ny = y + dy
                    guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                    let n = ny * width + nx
                    if !ink[n], label[n] == -1 { label[n] = next; stack.append(n) }
                }
            }
            next += 1
            guard !open else { continue }
            out.append(Hole(box: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1),
                            area: area, rows: rows))
        }
        return out
    }

    /// The ink with every node's outline rubbed out, so what is left is the
    /// arrows and the loose lines. Growing the hole by the stroke and a bit
    /// covers the outline itself and nothing else: the label inside the box
    /// is further in than that.
    static func withoutOutlines(_ ink: [Bool], width: Int, height: Int,
                                holes: [Hole], stroke: Double, closing: Int, grow factor: Double) -> [Bool] {
        var out = ink
        _ = closing
        let grow = max(2, Int((stroke * factor).rounded()) + 1)
        for hole in holes {
            let x0 = max(0, Int(hole.box.minX) - grow), x1 = min(width - 1, Int(hole.box.maxX) + grow)
            let y0 = max(0, Int(hole.box.minY) - grow), y1 = min(height - 1, Int(hole.box.maxY) + grow)
            let inner = hole.box.insetBy(dx: CGFloat(grow), dy: CGFloat(grow))
            for y in y0...y1 {
                for x in x0...x1 {
                    // Only the ring: keep whatever is well inside the box.
                    if inner.contains(CGPoint(x: x, y: y)) { continue }
                    let row = hole.rows[y]
                    let nearRow = row.map { x >= $0.0 - grow && x <= $0.1 + grow } ?? false
                    let inBand = hole.box.insetBy(dx: CGFloat(-grow), dy: CGFloat(-grow))
                        .contains(CGPoint(x: x, y: y))
                    if nearRow || (inBand && rowNear(hole, y: y, grow: grow, x: x)) {
                        out[y * width + x] = false
                    }
                }
            }
        }
        return out
    }

    /// How much of a stroke lies in the band a box's outline occupies.
    static func debris(_ piece: NotebookCapture.Component, holes: [Hole], stroke: Double,
                       closing: Int, grow factor: Double) -> Double {
        let band = CGFloat(max(2, Int((stroke * factor).rounded()) + 1) * 2 + Int(stroke))
        var inside = 0
        for index in piece.pixels {
            let p = CGPoint(x: index % piece.stride, y: index / piece.stride)
            for hole in holes where hole.box.insetBy(dx: -band, dy: -band).contains(p) {
                if !hole.box.insetBy(dx: band, dy: band).contains(p) { inside += 1; break }
            }
        }
        return Double(inside) / Double(max(1, piece.area))
    }

    static func rowNear(_ hole: Hole, y: Int, grow: Int, x: Int) -> Bool {
        for dy in -grow...grow {
            if let row = hole.rows[y + dy], x >= row.0 - grow, x <= row.1 + grow { return true }
        }
        return false
    }

    // MARK: - Strokes

    /// The two ends of a stroke: furthest from the middle, then furthest
    /// from that.
    static func endpoints(of piece: NotebookCapture.Component, width: Int) -> (CGPoint, CGPoint)? {
        guard !piece.pixels.isEmpty else { return nil }
        func point(_ index: Int) -> CGPoint { CGPoint(x: index % width, y: index / width) }
        let centre = CGPoint(x: piece.centre.x, y: piece.centre.y)
        func furthest(from p: CGPoint) -> CGPoint {
            var best = point(piece.pixels[0]), bestD = -1.0
            for index in piece.pixels {
                let q = point(index)
                let d = Double(hypot(q.x - p.x, q.y - p.y))
                if d > bestD { bestD = d; best = q }
            }
            return best
        }
        let a = furthest(from: centre)
        let b = furthest(from: a)
        return (a, b)
    }

    /// Ink within `window` of each end, measured along the line from `a`
    /// to `b`, and how much ink a unit of plain shaft carries.
    static func ends(of piece: NotebookCapture.Component, from a: CGPoint, to b: CGPoint,
                     length: CGFloat, window: CGFloat, width: Int) -> (Int, Int, Double) {
        guard length > 0, window > 0 else { return (0, 0, 0) }
        let ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
        var first = 0, last = 0, middle = 0
        for index in piece.pixels {
            let px = CGFloat(index % width) - a.x, py = CGFloat(index / width) - a.y
            let t = px * ux + py * uy
            if t <= window { first += 1 } else if t >= length - window { last += 1 } else { middle += 1 }
        }
        let span = Double(length - 2 * window)
        return (first, last, span > 1 ? Double(middle) / span : 0)
    }


    /// How thick the pen was: the median of the narrower of the two runs
    /// through every ink pixel.
    static func strokeWidth(ink: [Bool], width: Int, height: Int) -> Double {
        var horizontal = [Int](repeating: 0, count: width * height)
        for y in 0..<height {
            var x = 0
            while x < width {
                guard ink[y * width + x] else { x += 1; continue }
                var end = x
                while end < width, ink[y * width + end] { end += 1 }
                for i in x..<end { horizontal[y * width + i] = end - x }
                x = end
            }
        }
        var samples: [Int] = []
        samples.reserveCapacity(4096)
        for x in 0..<width {
            var y = 0
            while y < height {
                guard ink[y * width + x] else { y += 1; continue }
                var end = y
                while end < height, ink[end * width + x] { end += 1 }
                for i in y..<end { samples.append(min(end - y, horizontal[i * width + x])) }
                y = end
            }
        }
        guard !samples.isEmpty else { return 2 }
        samples.sort()
        return max(1.0, Double(samples[samples.count / 2]))
    }

    // MARK: - Morphology

    static func dilate(_ mask: [Bool], width: Int, height: Int, radius: Int) -> [Bool] {
        var rows = [Bool](repeating: false, count: width * height)
        for y in 0..<height {
            for x in 0..<width where mask[y * width + x] {
                let lo = max(0, x - radius), hi = min(width - 1, x + radius)
                for i in lo...hi { rows[y * width + i] = true }
            }
        }
        var out = [Bool](repeating: false, count: width * height)
        for y in 0..<height {
            for x in 0..<width where rows[y * width + x] {
                let lo = max(0, y - radius), hi = min(height - 1, y + radius)
                for i in lo...hi { out[i * width + x] = true }
            }
        }
        return out
    }

    static func closing(_ mask: [Bool], width: Int, height: Int, radius: Int) -> [Bool] {
        let grown = dilate(mask, width: width, height: height, radius: radius)
        let inverted = grown.map { !$0 }
        let shrunk = dilate(inverted, width: width, height: height, radius: radius)
        return shrunk.map { !$0 }
    }
}

extension CGRect {
    var area: CGFloat { isNull ? 0 : width * height }
}

// MARK: - Putting the sheet on the canvas

extension FlowGrouping {
    /// The page laid into the drawing pane: as big as it goes with a margin
    /// round it, the same scale both ways so nothing is stretched, and
    /// centred. Everything the app stores is a fraction of the pane, and
    /// `ShapeItem`'s width is a fraction of the pane's WIDTH while its
    /// centre's y is a fraction of the pane's HEIGHT, so the two need
    /// different divisors — but `aspect` is height over width in POINTS,
    /// and since the scale is the same both ways that is just the box's
    /// shape in mask pixels.
    struct Placement {
        var pane: CGSize
        var page: CGSize
        var margin: Double = 0.06

        var scale: CGFloat {
            min(pane.width / max(page.width, 1), pane.height / max(page.height, 1))
                * CGFloat(1 - margin * 2)
        }
        var origin: CGPoint {
            CGPoint(x: (pane.width - page.width * scale) / 2,
                    y: (pane.height - page.height * scale) / 2)
        }
        /// A point in mask pixels as a fraction of the pane.
        func fraction(_ p: CGPoint) -> CGPoint {
            CGPoint(x: (origin.x + p.x * scale) / pane.width,
                    y: (origin.y + p.y * scale) / pane.height)
        }
        /// A width in mask pixels as a fraction of the pane's width.
        func width(_ w: CGFloat) -> Double { Double(w * scale / pane.width) }
    }

    /// What the app should make: one entry per node, one per connector.
    struct Placed {
        struct Shape {
            var id = UUID()
            var kind: String
            var center: CGPoint
            var width: Double
            var aspect: Double
            var label: String
        }
        struct Connector {
            var start: CGPoint
            var end: CGPoint
            var startNode: UUID?
            var endNode: UUID?
            var startHead: Bool
            var endHead: Bool
        }
        var shapes: [Shape]
        var connectors: [Connector]
    }

    static func place(_ sheet: Sheet, in pane: CGSize, margin: Double = 0.06) -> Placed {
        let placement = Placement(pane: pane,
                                  page: CGSize(width: sheet.width, height: sheet.height),
                                  margin: margin)
        var ids: [Int: UUID] = [:]
        var shapes: [Placed.Shape] = []
        for (index, node) in sheet.nodes.enumerated() where node.isNode {
            let id = UUID()
            ids[index] = id
            shapes.append(Placed.Shape(
                id: id, kind: node.kind,
                center: placement.fraction(CGPoint(x: node.box.midX, y: node.box.midY)),
                width: placement.width(node.box.width),
                aspect: Double(node.box.height / max(node.box.width, 1)),
                label: node.label))
        }
        let connectors = sheet.edges.map { edge in
            Placed.Connector(start: placement.fraction(edge.tail),
                             end: placement.fraction(edge.head),
                             startNode: edge.from.flatMap { ids[$0] },
                             endNode: edge.to.flatMap { ids[$0] },
                             startHead: edge.headAtStart, endHead: edge.headAtEnd)
        }
        return Placed(shapes: shapes, connectors: connectors)
    }
}
