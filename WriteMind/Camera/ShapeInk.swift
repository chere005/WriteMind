import CoreGraphics
import Foundation

/// A blob of ink read as a drawn figure: the shape it is, the straight
/// edges it is made of, and how well an ellipse fits it.
///
/// The method is "fit primitives to the ink": a Hough transform over the
/// component's pixels proposes straight edges, each proposal is kept only
/// if a real run of ink lies along it, and a three-parameter ellipse is
/// fitted to the outline's radius about its centre. What the edges and the
/// ellipse and the enclosed area together say is the shape.
enum ShapeInk {

    // MARK: - What comes out

    enum Kind: String {
        case rectangle, roundedRectangle, oval, diamond, triangle, parallelogram
        case check, cross
        /// A straight stroke: the app's ConnectorItem with no heads.
        case line
        /// A straight stroke with a heavy end: ConnectorItem with endHead.
        case arrow
        /// Not a figure — writing, a scribble, a table, a letter.
        case none

        var isNode: Bool {
            switch self {
            case .rectangle, .roundedRectangle, .oval, .diamond, .triangle, .parallelogram: return true
            default: return false
            }
        }
        var isConnector: Bool { self == .line || self == .arrow }
    }

    /// A straight edge found in the ink: its normal angle, its distance
    /// from the component's centre, and the run of ink along it.
    struct Edge {
        var theta: Double          // radians, the normal's angle
        var rho: Double            // px from the local centre
        var from: Double           // projection of the first supporting pixel
        var to: Double             // ... and of the last
        var support: Int           // supporting pixels
        var continuity: Double     // fraction of 1px bins along the run with ink
        var length: Double { to - from }
    }

    struct Metrics {
        var width = 0
        var height = 0
        var pixels = 0
        /// Ink plus anything it encloses, over the bounding box. 1 for a
        /// rectangle, pi/4 for an oval, 1/2 for a diamond or a triangle.
        var closure = 0.0
        /// Enclosed regions big enough to be a cell rather than a pinhole.
        var holeCount = 0
        var edges: [Edge] = []
        /// Fraction of the ink lying on one of those edges.
        var lineCoverage = 0.0
        /// RMS radial error of the best ellipse, over the mean radius.
        var ellipseResidual = 1.0
        /// How much of the four corner squares the shape fills: 1 sharp,
        /// about pi/4 when the corners are rounded off.
        var cornerOccupancy = 0.0
        /// Angle between the two parallel pairs, degrees (0 if not a quad).
        var pairAngle = 0.0
        /// Edges within 8 degrees of the bounding box's own axes.
        var axisEdges = 0
        /// Widest perpendicular spread over the narrowest, along a stroke.
        var spreadRatio = 1.0
        /// Which end of a stroke carries the heavy end: -1 start, 1 end.
        var headEnd = 0
        /// Where two fitted edges meet, how far the nearest ink is, over
        /// the short side: 0 for a sharp corner, about 0.08 for one
        /// rounded off at a fifth of the box.
        var cornerGap = 0.0
        /// Ink that is NOT on the longest edge, and where along that edge
        /// it sits (0 the start, 1 the end). An arrow's head is a small
        /// mass at one end; a check's second arm is a large mass spread out.
        var offMass = 0.0
        var offCentroid = 0.5
        /// How far that off-spine ink is spread along the edge: an
        /// arrowhead is a tight clump, a check's second arm is not.
        var offSpread = 0.0
        /// The longest edge over the second longest.
        var armRatio = 0.0
        /// How far the off-spine ink reaches sideways, over the spine's
        /// length. An arrowhead's barbs reach about 0.08; a check's second
        /// arm reaches about 0.4.
        var offReach = 0.0
    }

    struct Reading {
        var kind: Kind
        /// In mask pixels, top-left origin, the same frame as Component.
        var box: CGRect
        /// For a line or an arrow: the two ends in mask pixels.
        var start = CGPoint.zero
        var end = CGPoint.zero
        var metrics = Metrics()
    }

    // MARK: - The numbers that decide

    struct Tuning {
        /// Hough accumulator: how many angle bins over 180 degrees, and
        /// how wide a distance bin is in pixels. Measured over the whole
        /// held-out corpus, accuracy is 99.4% at EVERY setting from 45
        /// bins x 1px to 360 bins x 1px — the accumulator only proposes,
        /// and the least-squares fit that follows puts the line where the
        /// ink actually is. So take the cheap one.
        var thetaBins = 90
        var rhoQuantum = 2.0
        /// How far from a proposed line ink still counts as on it: a hand
        /// drawn edge wanders, so this scales with the figure.
        var lineTolerance = 0.035
        var lineToleranceFloor = 2.5
        /// A kept edge has to run this far across the figure, and be this
        /// unbroken along its run.
        var minimumExtent = 0.40
        var minimumExtentPixels = 12.0
        var minimumContinuity = 0.80
        /// A proposal already this well covered by kept edges is the same
        /// edge again.
        var maximumOverlap = 0.70
        var maximumEdges = 6
        /// Accumulator peaks that get a least-squares fit. The fit is the
        /// expensive step, so the list is thinned before it.
        var maximumProposals = 24

        /// The gap a hand leaves at a corner, closed before the inside of
        /// the figure is measured.
        /// Measured: a closing of radius r seals a hole of about r/1.2 in
        /// the outline, so this tolerates a gap of ~6% of the figure.
        var closeRadius = 0.07
        var closeRadiusFloor = 5.0
        /// An enclosed region smaller than this much of the box is a
        /// pinhole where two strokes crossed, not a cell.
        var pinhole = 0.01

        /// Smaller than this much of the page's short side and it is
        /// writing, whatever its geometry.
        var minimumSize = 1.0 / 22.0

        // Class boundaries. Every one of these is a measured gap between
        // the two classes it separates, not a guess — see the table in
        // `probe --stats`.
        var closedFloor = 0.30          // below: an open stroke
        var rectFloor = 0.85            // rect/rounded 0.87-1.00 vs para 0.81
        var curvedBand = 0.64...0.88    // oval 0.78, parallelogram 0.80
        var wedgeBand = 0.40...0.62     // diamond 0.51, triangle 0.51
        /// Rectangle corners measure 0.000-0.004; rounded ones 0.04-0.08.
        var sharpCorner = 0.02
        /// Ovals measure 0.01-0.03; the nearest other shape is a rounded
        /// rectangle at 0.07.
        var ovalResidual = 0.05
        /// A straight-sided figure measures 0.07-0.15; a triangle 0.32-0.36
        /// and a scribble 0.32-0.84.
        var quadResidual = 0.22
        var triangleResidual = 0.25
        var polygonCoverage = 0.85      // ink explained by straight edges
        /// Squareness of the two parallel pairs: rect 87-90, parallelogram
        /// 68-81.
        var squarePair = 84.0
        /// A plain line measures 0.87-1.19, an arrow 3.8-11.3.
        var arrowSpread = 2.0
        /// An arrowhead is under a third of the ink and clumped at one end.
        var arrowHeadMass = 0.35
        var arrowHeadSpread = 0.18
        /// An arrowhead's barbs reach 0.05-0.12 sideways; a check's second
        /// arm reaches 0.30-0.50.
        var arrowHeadReach = 0.20
    }

    // MARK: - Taking a blob apart

    /// On a real page an arrow TOUCHES the box it points at, and the two
    /// arrive as one blob, which is neither a box nor an arrow. So: if a
    /// blob encloses something, the figure is the ink hugging what it
    /// encloses, and whatever else is attached is peeled off and read on
    /// its own.
    ///
    /// Returns the blob unchanged when there is nothing to peel.
    static func parts(_ component: NotebookCapture.Component,
                      tuning: Tuning = Tuning()) -> [NotebookCapture.Component] {
        let w = component.width, h = component.height
        guard w >= 8, h >= 8, component.area >= 40 else { return [component] }
        let long = Double(max(w, h))
        let close = max(Int(tuning.closeRadiusFloor.rounded()), Int((tuning.closeRadius * long).rounded()))
        let pad = close + 2
        let lw = w + 2 * pad, lh = h + 2 * pad
        var ink = [Bool](repeating: false, count: lw * lh)
        for pixel in component.pixels {
            let x = pixel % component.stride - component.minX
            let y = pixel / component.stride - component.minY
            ink[(y + pad) * lw + (x + pad)] = true
        }
        let sealed = closing(ink, width: lw, height: lh, radius: close)
        guard let hole = largestHole(sealed, width: lw, height: lh),
              hole.size >= max(64, w * h / 20) else { return [component] }

        // How far the outline can sit from what it encloses: its own
        // thickness and a little over. Any more and the tail of an arrow
        // stays glued on, which shifts the figure's box and its centre and
        // spoils every measurement taken from them.
        let stroke = max(1.0, Double(component.area) / Double(2 * (w + h)))
        let reach = Int32(3 * max(4, Int((2 * stroke).rounded()) + 3))
        let away = chamfer(hole.mask, width: lw, height: lh)
        var near = [Bool](repeating: false, count: lw * lh)
        for i in 0..<(lw * lh) { near[i] = away[i] <= reach }

        var body: [Int] = [], rest: [Int] = []
        for pixel in component.pixels {
            let x = pixel % component.stride - component.minX
            let y = pixel / component.stride - component.minY
            if near[(y + pad) * lw + (x + pad)] { body.append(pixel) } else { rest.append(pixel) }
        }
        guard rest.count >= max(40, component.area / 20), body.count >= component.area / 3 else {
            return [component]
        }

        var out = [make(body, stride: component.stride)].compactMap { $0 }
        // What was stuck on may be several separate things.
        var grid = [Bool](repeating: false, count: lw * lh)
        for pixel in rest {
            let x = pixel % component.stride - component.minX
            let y = pixel / component.stride - component.minY
            grid[(y + pad) * lw + (x + pad)] = true
        }
        for piece in NotebookCapture.components(in: grid, width: lw, height: lh) where piece.area >= 40 {
            let pixels = piece.pixels.map { index -> Int in
                let x = index % lw - pad + component.minX
                let y = index / lw - pad + component.minY
                return y * component.stride + x
            }
            if let made = make(pixels, stride: component.stride) { out.append(made) }
        }
        return out
    }

    static func make(_ pixels: [Int], stride: Int) -> NotebookCapture.Component? {
        guard !pixels.isEmpty else { return nil }
        var minX = Int.max, maxX = Int.min, minY = Int.max, maxY = Int.min
        for pixel in pixels {
            let x = pixel % stride, y = pixel / stride
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
        }
        return NotebookCapture.Component(stride: stride, minX: minX, minY: minY,
                                         maxX: maxX, maxY: maxY, pixels: pixels)
    }

    static func largestHole(_ mask: [Bool], width: Int, height: Int) -> (mask: [Bool], size: Int)? {
        var outside = [Bool](repeating: false, count: width * height)
        var stack: [Int] = []
        for x in 0..<width {
            for y in [0, height - 1] where !mask[y * width + x] && !outside[y * width + x] {
                outside[y * width + x] = true; stack.append(y * width + x)
            }
        }
        for y in 0..<height {
            for x in [0, width - 1] where !mask[y * width + x] && !outside[y * width + x] {
                outside[y * width + x] = true; stack.append(y * width + x)
            }
        }
        while let index = stack.popLast() {
            let x = index % width, y = index / width
            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let nx = x + dx, ny = y + dy
                guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                let n = ny * width + nx
                if !mask[n], !outside[n] { outside[n] = true; stack.append(n) }
            }
        }
        var seen = [Bool](repeating: false, count: width * height)
        var best: [Int] = []
        for start in 0..<(width * height) where !mask[start] && !outside[start] && !seen[start] {
            var region: [Int] = []
            seen[start] = true
            stack.append(start)
            while let index = stack.popLast() {
                region.append(index)
                let x = index % width, y = index / width
                for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                    let nx = x + dx, ny = y + dy
                    guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                    let n = ny * width + nx
                    if !mask[n], !outside[n], !seen[n] { seen[n] = true; stack.append(n) }
                }
            }
            if region.count > best.count { best = region }
        }
        guard !best.isEmpty else { return nil }
        var out = [Bool](repeating: false, count: width * height)
        for index in best { out[index] = true }
        return (out, best.count)
    }

    // MARK: - Reading one blob

    static func read(_ component: NotebookCapture.Component,
                     shortSide: Int,
                     tuning: Tuning = Tuning()) -> Reading {
        let box = CGRect(x: CGFloat(component.minX), y: CGFloat(component.minY),
                         width: CGFloat(component.width), height: CGFloat(component.height))
        var reading = Reading(kind: .none, box: box)
        let w = component.width, h = component.height
        var m = Metrics(width: w, height: h, pixels: component.area)
        reading.metrics = m

        let long = Double(max(w, h))
        guard long >= Double(shortSide) * tuning.minimumSize else { return reading }
        guard w >= 5, h >= 5, component.area >= 24 else { return reading }

        // The blob on its own little grid, with a margin for the closing.
        let close = max(Int(tuning.closeRadiusFloor.rounded()), Int((tuning.closeRadius * long).rounded()))
        let pad = close + 2
        let lw = w + 2 * pad, lh = h + 2 * pad
        var ink = [Bool](repeating: false, count: lw * lh)
        var xs = [Double](); xs.reserveCapacity(component.area)
        var ys = [Double](); ys.reserveCapacity(component.area)
        let cx = Double(w - 1) / 2, cy = Double(h - 1) / 2
        for pixel in component.pixels {
            let x = pixel % component.stride - component.minX
            let y = pixel / component.stride - component.minY
            ink[(y + pad) * lw + (x + pad)] = true
            xs.append(Double(x) - cx)
            ys.append(Double(y) - cy)
        }

        // What the figure encloses, once a hand's gaps are closed.
        let sealed = closing(ink, width: lw, height: lh, radius: close)
        let (solid, holes) = filled(sealed, width: lw, height: lh)
        var inside = 0
        for y in pad..<(pad + h) {
            for x in pad..<(pad + w) where solid[y * lw + x] { inside += 1 }
        }
        m.closure = Double(inside) / Double(w * h)
        let pinhole = max(9, Int(tuning.pinhole * Double(w * h)))
        m.holeCount = holes.filter { $0 >= pinhole }.count

        // Straight edges.
        m.edges = edges(xs: xs, ys: ys, width: w, height: h, tuning: tuning)
        m.lineCoverage = coverage(xs: xs, ys: ys, edges: m.edges, width: w, height: h, tuning: tuning)

        // The ellipse.
        m.ellipseResidual = ellipseResidual(xs: xs, ys: ys)

        // Corners and pairs.
        m.cornerOccupancy = cornerOccupancy(solid, width: lw, height: lh, pad: pad, w: w, h: h)
        let pairs = parallelPairs(m.edges)
        m.pairAngle = pairs.angle
        m.axisEdges = m.edges.filter { edge in
            let a = abs(edge.theta.truncatingRemainder(dividingBy: .pi / 2))
            return min(a, .pi / 2 - a) <= 8 * .pi / 180
        }.count

        let tol = max(tuning.lineToleranceFloor, tuning.lineTolerance * long)
        m.cornerGap = cornerGap(xs: xs, ys: ys, edges: m.edges, minSide: Double(min(w, h)))

        // A stroke's thickening towards one end, and the ink beside it.
        if let spine = m.edges.first {
            let spread = spreadAlong(xs: xs, ys: ys, edge: spine)
            m.spreadRatio = spread.ratio
            m.headEnd = spread.head
            let off = offSpine(xs: xs, ys: ys, edge: spine, tolerance: tol)
            m.offMass = off.mass
            m.offCentroid = off.centroid
            m.offSpread = off.spread
            m.offReach = off.reach
            if m.edges.count >= 2 { m.armRatio = spine.length / max(1, m.edges[1].length) }
        }

        reading.metrics = m
        reading.kind = decide(m, tuning: tuning)

        if reading.kind.isConnector, let spine = m.edges.first {
            let d = CGPoint(x: -sin(spine.theta), y: cos(spine.theta))
            let n = CGPoint(x: cos(spine.theta), y: sin(spine.theta))
            let ox = CGFloat(component.minX) + CGFloat(cx) + n.x * CGFloat(spine.rho)
            let oy = CGFloat(component.minY) + CGFloat(cy) + n.y * CGFloat(spine.rho)
            var a = CGPoint(x: ox + d.x * CGFloat(spine.from), y: oy + d.y * CGFloat(spine.from))
            var b = CGPoint(x: ox + d.x * CGFloat(spine.to), y: oy + d.y * CGFloat(spine.to))
            // The head is the end the arrow points at.
            if reading.kind == .arrow, m.headEnd < 0 { swap(&a, &b) }
            reading.start = a
            reading.end = b
        }
        return reading
    }

    // MARK: - The decision

    static func decide(_ m: Metrics, tuning: Tuning) -> Kind {
        // A grid of cells is a table, not a box — whatever its outline.
        if m.holeCount >= 3 { return .none }

        if m.closure >= tuning.closedFloor, m.holeCount >= 1 {
            // Round first: the ellipse fit is the sharpest single number
            // on the page, and an oval's edges are unreliable by nature.
            if m.ellipseResidual <= tuning.ovalResidual, tuning.curvedBand.contains(m.closure) {
                return .oval
            }
            // Everything else closed is a polygon, so its ink has to lie
            // on straight edges and its radius must NOT be elliptical.
            guard m.lineCoverage >= tuning.polygonCoverage else { return .none }

            if tuning.wedgeBand.contains(m.closure), m.edges.count == 3 || m.edges.count == 4 {
                // A diamond's radius is nearly elliptical, a triangle's is
                // nowhere near: 0.11-0.15 against 0.32-0.36.
                if m.ellipseResidual <= tuning.quadResidual { return .diamond }
                if m.ellipseResidual >= tuning.triangleResidual, m.edges.count == 3 { return .triangle }
                return .none
            }
            guard m.edges.count == 4, m.ellipseResidual <= tuning.quadResidual else { return .none }
            // Square corners and a nearly full box: a rectangle, and where
            // the fitted edges meet says whether its corners are rounded.
            if m.closure >= tuning.rectFloor, m.pairAngle >= tuning.squarePair {
                return m.cornerGap <= tuning.sharpCorner ? .rectangle : .roundedRectangle
            }
            // Pushed over: two parallel pairs that are not at right angles.
            if tuning.curvedBand.contains(m.closure), m.pairAngle > 40, m.pairAngle < tuning.squarePair {
                return .parallelogram
            }
            return .none
        }

        // Open strokes.
        guard let spine = m.edges.first, m.lineCoverage >= 0.60 else { return .none }
        // A cross is two edges that meet in the middle of both.
        if m.edges.count == 2, crossing(spine, m.edges[1]), angle(spine, m.edges[1]) >= 25 {
            return .cross
        }
        // An arrowhead is a small clump of ink at one end of a long
        // stroke; a check's second arm is half the ink, spread out.
        // An arrowhead is a small clump at one end that does not reach
        // far sideways. A check's second arm clumps at one end too — the
        // sideways reach is what tells them apart.
        let clumped = m.offMass <= tuning.arrowHeadMass
            && m.offSpread <= tuning.arrowHeadSpread
            && m.offReach <= tuning.arrowHeadReach
            && (m.offCentroid <= 0.25 || m.offCentroid >= 0.75)
        if m.spreadRatio >= tuning.arrowSpread, clumped { return .arrow }
        if m.offMass < 0.05, m.spreadRatio < tuning.arrowSpread { return .line }
        // Two arms meeting at a point, one much longer than the other.
        if m.offReach > tuning.arrowHeadReach, m.offMass <= 0.45,
           m.offCentroid <= 0.25 || m.offCentroid >= 0.75 { return .check }
        if m.edges.count == 2, angle(spine, m.edges[1]) >= 25 { return .check }
        return .none
    }

    static func angle(_ a: Edge, _ b: Edge) -> Double {
        var between = abs(a.theta - b.theta) * 180 / .pi
        if between > 90 { between = 180 - between }
        return between
    }

    /// Two edges whose runs overlap in the middle cross; two that meet at a
    /// tip do not.
    static func crossing(_ a: Edge, _ b: Edge) -> Bool {
        // Where the lines meet, in the local frame.
        let det = cos(a.theta) * sin(b.theta) - sin(a.theta) * cos(b.theta)
        guard abs(det) > 1e-6 else { return false }
        let x = (a.rho * sin(b.theta) - b.rho * sin(a.theta)) / det
        let y = (b.rho * cos(a.theta) - a.rho * cos(b.theta)) / det
        func interior(_ e: Edge) -> Bool {
            let t = -sin(e.theta) * x + cos(e.theta) * y
            let at = (t - e.from) / max(1, e.length)
            return at > 0.15 && at < 0.85
        }
        return interior(a) && interior(b)
    }

    // MARK: - Hough

    static func edges(xs: [Double], ys: [Double], width: Int, height: Int, tuning: Tuning) -> [Edge] {
        let count = xs.count
        guard count >= 20 else { return [] }
        let long = Double(max(width, height))
        let tol = max(tuning.lineToleranceFloor, tuning.lineTolerance * long)
        let diag = (Double(width) * Double(width) + Double(height) * Double(height)).squareRoot() / 2
        let rhoBins = Int((2 * diag / tuning.rhoQuantum).rounded(.up)) + 3
        let zero = rhoBins / 2
        let thetas = tuning.thetaBins
        var cosines = [Double](repeating: 0, count: thetas)
        var sines = [Double](repeating: 0, count: thetas)
        for t in 0..<thetas {
            let angle = Double(t) * .pi / Double(thetas)
            cosines[t] = cos(angle); sines[t] = sin(angle)
        }

        var accumulator = [Int32](repeating: 0, count: thetas * rhoBins)
        for i in 0..<count {
            let x = xs[i], y = ys[i]
            for t in 0..<thetas {
                let rho = x * cosines[t] + y * sines[t]
                let bin = zero + Int((rho / tuning.rhoQuantum).rounded())
                if bin >= 0, bin < rhoBins { accumulator[t * rhoBins + bin] += 1 }
            }
        }
        // Blur along rho by a fraction of the wander a hand puts into a
        // straight edge, so one wobbly edge is one peak rather than five.
        // Blurring by the whole tolerance makes a PLATEAU, and the peak
        // then lands anywhere on it — the fit below corrects the rest.
        let blur = max(1, Int((tol / 3 / tuning.rhoQuantum).rounded()))
        var smoothed = [Int32](repeating: 0, count: thetas * rhoBins)
        for t in 0..<thetas {
            var running: Int32 = 0
            let base = t * rhoBins
            for r in 0..<min(blur, rhoBins) { running += accumulator[base + r] }
            for r in 0..<rhoBins {
                smoothed[base + r] = running
                let drop = r - blur, add = r + blur + 1
                if drop >= 0 { running -= accumulator[base + drop] }
                if add < rhoBins { running += accumulator[base + add] }
            }
        }

        // Propose the strongest cells, no two of them the same edge.
        var proposals: [(value: Int32, t: Int, r: Int)] = []
        for t in 0..<thetas {
            for r in 1..<(rhoBins - 1) {
                let v = smoothed[t * rhoBins + r]
                guard v >= 8 else { continue }
                if smoothed[t * rhoBins + r - 1] > v || smoothed[t * rhoBins + r + 1] > v { continue }
                proposals.append((v, t, r))
            }
        }
        proposals.sort { $0.value > $1.value }
        // Only a few peaks are worth the fit. Thin them here — before the
        // expensive part — by suppressing anything close to a peak already
        // on the shortlist, and by dropping the weak tail.
        var shortlist: [(value: Int32, t: Int, r: Int)] = []
        if let best = proposals.first?.value {
            let floor = max(Int32(8), best / 5)
            for proposal in proposals where proposal.value >= floor {
                let line = (theta: Double(proposal.t) * .pi / Double(thetas),
                            rho: Double(proposal.r - zero) * tuning.rhoQuantum)
                var near = false
                for chosen in shortlist {
                    let other = (theta: Double(chosen.t) * .pi / Double(thetas),
                                 rho: Double(chosen.r - zero) * tuning.rhoQuantum)
                    if sameLine(line, other, angle: 9 * .pi / 180,
                                distance: Double(blur * 3) * tuning.rhoQuantum) { near = true; break }
                }
                if near { continue }
                shortlist.append(proposal)
                if shortlist.count >= tuning.maximumProposals { break }
            }
        }
        proposals = shortlist

        var kept: [Edge] = []
        var covered = [Bool](repeating: false, count: count)
        var taken: [(t: Int, r: Int)] = []
        for proposal in proposals {
            guard kept.count < tuning.maximumEdges else { break }
            // The same line as one already kept.
            let proposed = (theta: Double(proposal.t) * .pi / Double(thetas),
                            rho: Double(proposal.r - zero) * tuning.rhoQuantum)
            if kept.contains(where: {
                sameLine(proposed, (theta: $0.theta, rho: $0.rho), angle: 8 * .pi / 180, distance: tol)
            }) { continue }

            // The accumulator only PROPOSES; a total-least-squares fit to
            // the ink near the proposal settles where the edge really is.
            // Without this the line sits up to a blur width off the ink and
            // every measurement taken from it is wrong.
            var theta = Double(proposal.t) * .pi / Double(thetas)
            var rho = Double(proposal.r - zero) * tuning.rhoQuantum
            var support: [Int] = []
            var low = Double.infinity, high = -Double.infinity
            for pass in 0..<3 {
                let ct = cos(theta), st = sin(theta)
                support.removeAll(keepingCapacity: true)
                low = .infinity; high = -.infinity
                for i in 0..<count where abs(xs[i] * ct + ys[i] * st - rho) <= tol {
                    support.append(i)
                    let t = -xs[i] * st + ys[i] * ct
                    low = min(low, t); high = max(high, t)
                }
                guard support.count >= 8 else { break }
                guard pass < 2, let fit = principalAxis(xs: xs, ys: ys, of: support) else { break }
                // Keep the fit on the same side of the figure.
                var turned = abs(fit.theta - theta)
                turned = min(turned, .pi - turned)
                guard turned < 25 * .pi / 180 else { break }
                theta = fit.theta; rho = fit.rho
            }
            let extent = high - low
            let st = sin(theta), ct = cos(theta)
            let span = min(Double(width) * abs(st) + Double(height) * abs(ct),
                           (Double(width) * Double(width) + Double(height) * Double(height)).squareRoot())
            guard extent >= max(tuning.minimumExtentPixels, tuning.minimumExtent * span) else { continue }

            // Unbroken: nearly every 1px step along the run has ink on it.
            let bins = Int(extent.rounded(.up)) + 1
            var hit = [Bool](repeating: false, count: bins)
            for i in support {
                let t = -xs[i] * st + ys[i] * ct
                let bin = Int((t - low).rounded())
                if bin >= 0, bin < bins { hit[bin] = true }
            }
            let continuity = Double(hit.filter { $0 }.count) / Double(bins)
            guard continuity >= tuning.minimumContinuity else { continue }

            let fresh = support.filter { !covered[$0] }.count
            guard Double(support.count - fresh) / Double(support.count) <= tuning.maximumOverlap else { continue }

            for i in support { covered[i] = true }
            taken.append((proposal.t, proposal.r))
            kept.append(Edge(theta: theta, rho: rho, from: low, to: high,
                             support: support.count, continuity: continuity))
        }
        return kept.sorted { $0.length > $1.length }
    }

    /// Whether two (theta, rho) pairs name the SAME line. theta lives on a
    /// half circle, so one line can be written two ways — (0, +125) and
    /// (pi, -125) — and a comparison that misses this silently throws away
    /// one side of every axis-aligned rectangle.
    static func sameLine(_ a: (theta: Double, rho: Double), _ b: (theta: Double, rho: Double),
                         angle angleTolerance: Double, distance distanceTolerance: Double) -> Bool {
        let dot = cos(a.theta) * cos(b.theta) + sin(a.theta) * sin(b.theta)
        let limit = cos(angleTolerance)
        if dot >= limit { return abs(a.rho - b.rho) <= distanceTolerance }
        if -dot >= limit { return abs(a.rho + b.rho) <= distanceTolerance }
        return false
    }

    /// Total least squares through a set of points: the line that minimises
    /// the perpendicular distance, which is what an edge of ink wants.
    static func principalAxis(xs: [Double], ys: [Double], of indices: [Int]) -> (theta: Double, rho: Double)? {
        let n = Double(indices.count)
        guard n >= 8 else { return nil }
        var mx = 0.0, my = 0.0
        for i in indices { mx += xs[i]; my += ys[i] }
        mx /= n; my /= n
        var sxx = 0.0, syy = 0.0, sxy = 0.0
        for i in indices {
            let dx = xs[i] - mx, dy = ys[i] - my
            sxx += dx * dx; syy += dy * dy; sxy += dx * dy
        }
        // The smaller eigenvector of the covariance is the line's normal.
        let normal = 0.5 * atan2(2 * sxy, sxx - syy) + .pi / 2
        var theta = normal.truncatingRemainder(dividingBy: .pi)
        if theta < 0 { theta += .pi }
        return (theta, mx * cos(theta) + my * sin(theta))
    }

    static func coverage(xs: [Double], ys: [Double], edges: [Edge],
                         width: Int, height: Int, tuning: Tuning) -> Double {
        guard !xs.isEmpty else { return 0 }
        guard !edges.isEmpty else { return 0 }
        let tol = max(tuning.lineToleranceFloor, tuning.lineTolerance * Double(max(width, height)))
        var on = 0
        for i in 0..<xs.count {
            for edge in edges {
                let ct = cos(edge.theta), st = sin(edge.theta)
                guard abs(xs[i] * ct + ys[i] * st - edge.rho) <= tol else { continue }
                let t = -xs[i] * st + ys[i] * ct
                if t >= edge.from - tol, t <= edge.to + tol { on += 1; break }
            }
        }
        return Double(on) / Double(xs.count)
    }

    /// The two pairs of parallel edges a quadrilateral makes, and the angle
    /// between them.
    static func parallelPairs(_ edges: [Edge]) -> (pairs: Int, angle: Double) {
        guard edges.count == 4 else { return (0, 0) }
        var used = [Bool](repeating: false, count: 4)
        var directions: [Double] = []
        for i in 0..<4 where !used[i] {
            var best = -1; var bestGap = Double.infinity
            for j in (i + 1)..<4 where !used[j] {
                var gap = abs(edges[i].theta - edges[j].theta)
                if gap > .pi / 2 { gap = .pi - gap }
                if gap < bestGap { bestGap = gap; best = j }
            }
            guard best >= 0, bestGap <= 12 * .pi / 180 else { continue }
            used[i] = true; used[best] = true
            // theta lives on a half circle, so two parallel edges can read
            // as 0.01 and 3.13 radians. Averaging those gives 90 degrees —
            // exactly wrong. Bring the second onto the first's branch.
            let a = edges[i].theta
            var b = edges[best].theta
            if abs(a - b) > .pi / 2 { b += a > b ? .pi : -.pi }
            var mean = (a + b) / 2
            if mean < 0 { mean += .pi }
            if mean >= .pi { mean -= .pi }
            directions.append(mean)
        }
        guard directions.count == 2 else { return (directions.count, 0) }
        var between = abs(directions[0] - directions[1]) * 180 / .pi
        if between > 90 { between = 180 - between }
        return (2, between)
    }

    // MARK: - The ellipse

    /// An ellipse about the figure's centre has 1/r^2 = A + B cos2phi + C
    /// sin2phi, which is a three-parameter least squares. The residual is
    /// the RMS gap between the ink's radius and that ellipse's, over the
    /// mean radius — scale free, so a big oval and a small one score alike.
    static func ellipseResidual(xs: [Double], ys: [Double]) -> Double {
        let count = xs.count
        guard count >= 24 else { return 1 }
        var s = [Double](repeating: 0, count: 9)   // 3x3 normal equations
        var rhs = [Double](repeating: 0, count: 3)
        var radii = [Double](); radii.reserveCapacity(count)
        var phis = [Double](); phis.reserveCapacity(count)
        for i in 0..<count {
            let r = (xs[i] * xs[i] + ys[i] * ys[i]).squareRoot()
            guard r > 1 else { continue }
            let phi = atan2(ys[i], xs[i])
            radii.append(r); phis.append(phi)
            let basis = [1.0, cos(2 * phi), sin(2 * phi)]
            let u = 1 / (r * r)
            for a in 0..<3 {
                rhs[a] += basis[a] * u
                for b in 0..<3 { s[a * 3 + b] += basis[a] * basis[b] }
            }
        }
        guard radii.count >= 24, let p = solve3(s, rhs) else { return 1 }
        var sum = 0.0, mean = 0.0
        for i in 0..<radii.count {
            let u = p[0] + p[1] * cos(2 * phis[i]) + p[2] * sin(2 * phis[i])
            guard u > 1e-9 else { return 1 }
            let fit = 1 / u.squareRoot()
            let d = radii[i] - fit
            sum += d * d
            mean += radii[i]
        }
        mean /= Double(radii.count)
        guard mean > 0 else { return 1 }
        return (sum / Double(radii.count)).squareRoot() / mean
    }

    static func solve3(_ a: [Double], _ b: [Double]) -> [Double]? {
        var m = [[Double]](repeating: [Double](repeating: 0, count: 4), count: 3)
        for i in 0..<3 {
            for j in 0..<3 { m[i][j] = a[i * 3 + j] }
            m[i][3] = b[i]
        }
        for col in 0..<3 {
            var pivot = col
            for row in (col + 1)..<3 where abs(m[row][col]) > abs(m[pivot][col]) { pivot = row }
            guard abs(m[pivot][col]) > 1e-12 else { return nil }
            m.swapAt(col, pivot)
            let d = m[col][col]
            for j in col..<4 { m[col][j] /= d }
            for row in 0..<3 where row != col {
                let f = m[row][col]
                guard f != 0 else { continue }
                for j in col..<4 { m[row][j] -= f * m[col][j] }
            }
        }
        return [m[0][3], m[1][3], m[2][3]]
    }

    // MARK: - Shape of the outline

    /// Dilate then erode, so a hand's gap at a corner does not let the
    /// inside of the figure leak out.
    ///
    /// The structuring element is a DISC, built from a 3-4 chamfer
    /// distance, not a square. A square one is wrong here and quietly so:
    /// eroding a diagonal stroke of width t by a square of side 2r+1 needs
    /// t > (2r+1)·sqrt(2), so a square closing bridges a gap in a
    /// horizontal edge and fails on exactly the same gap in a diagonal
    /// one. Measured: with a square element a 200px ring with an 8px gap
    /// was not sealed at ANY radius up to 30.
    static func closing(_ ink: [Bool], width: Int, height: Int, radius: Int) -> [Bool] {
        guard radius > 0 else { return ink }
        let reach = Int32(3 * radius)
        let outward = chamfer(ink, width: width, height: height)
        var grown = [Bool](repeating: false, count: width * height)
        for i in 0..<(width * height) { grown[i] = outward[i] <= reach }
        var outside = [Bool](repeating: false, count: width * height)
        for i in 0..<(width * height) { outside[i] = !grown[i] }
        let inward = chamfer(outside, width: width, height: height)
        var closed = [Bool](repeating: false, count: width * height)
        // Erode by one pixel LESS than the dilation. The chamfer is only
        // within 8% of Euclidean, and at a large radius that error eats
        // the whole bridge — a bridge is only as thick as the stroke.
        for i in 0..<(width * height) { closed[i] = inward[i] > reach - 3 || ink[i] }
        return closed
    }

    /// Distance from every pixel to the nearest set pixel, in thirds of a
    /// pixel, by the two-pass 3-4 chamfer. Within about 8% of Euclidean,
    /// and the cost does not grow with the radius.
    static func chamfer(_ mask: [Bool], width: Int, height: Int) -> [Int32] {
        let far: Int32 = 1 << 24
        var d = [Int32](repeating: far, count: width * height)
        for i in 0..<(width * height) where mask[i] { d[i] = 0 }
        for y in 0..<height {
            for x in 0..<width {
                let i = y * width + x
                guard d[i] != 0 else { continue }
                var best = d[i]
                if y > 0 {
                    if x > 0 { best = min(best, d[i - width - 1] + 4) }
                    best = min(best, d[i - width] + 3)
                    if x + 1 < width { best = min(best, d[i - width + 1] + 4) }
                }
                if x > 0 { best = min(best, d[i - 1] + 3) }
                d[i] = best
            }
        }
        for y in stride(from: height - 1, through: 0, by: -1) {
            for x in stride(from: width - 1, through: 0, by: -1) {
                let i = y * width + x
                guard d[i] != 0 else { continue }
                var best = d[i]
                if y + 1 < height {
                    if x + 1 < width { best = min(best, d[i + width + 1] + 4) }
                    best = min(best, d[i + width] + 3)
                    if x > 0 { best = min(best, d[i + width - 1] + 4) }
                }
                if x + 1 < width { best = min(best, d[i + 1] + 3) }
                d[i] = best
            }
        }
        return d
    }

    /// The figure with whatever it encloses filled in, and the sizes of the
    /// enclosed regions.
    static func filled(_ mask: [Bool], width: Int, height: Int) -> (solid: [Bool], holes: [Int]) {
        var outside = [Bool](repeating: false, count: width * height)
        var stack: [Int] = []
        for x in 0..<width {
            for y in [0, height - 1] {
                let i = y * width + x
                if !mask[i], !outside[i] { outside[i] = true; stack.append(i) }
            }
        }
        for y in 0..<height {
            for x in [0, width - 1] {
                let i = y * width + x
                if !mask[i], !outside[i] { outside[i] = true; stack.append(i) }
            }
        }
        while let index = stack.popLast() {
            let x = index % width, y = index / width
            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let nx = x + dx, ny = y + dy
                guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                let n = ny * width + nx
                if !mask[n], !outside[n] { outside[n] = true; stack.append(n) }
            }
        }
        var solid = mask
        var holes: [Int] = []
        var seen = [Bool](repeating: false, count: width * height)
        for start in 0..<(width * height) where !mask[start] && !outside[start] && !seen[start] {
            var size = 0
            seen[start] = true
            stack.append(start)
            while let index = stack.popLast() {
                size += 1
                solid[index] = true
                let x = index % width, y = index / width
                for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                    let nx = x + dx, ny = y + dy
                    guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                    let n = ny * width + nx
                    if !mask[n], !outside[n], !seen[n] { seen[n] = true; stack.append(n) }
                }
            }
            holes.append(size)
        }
        return (solid, holes)
    }

    /// How full the four corners of the bounding box are: a sharp corner
    /// fills its square, a rounded one keeps about pi/4 of it.
    static func cornerOccupancy(_ solid: [Bool], width: Int, height: Int,
                                pad: Int, w: Int, h: Int) -> Double {
        let side = max(3, Int((0.20 * Double(min(w, h))).rounded()))
        guard side * 2 < min(w, h) else { return 1 }
        var total = 0, filledCount = 0
        for (ox, oy) in [(0, 0), (w - side, 0), (0, h - side), (w - side, h - side)] {
            for y in 0..<side {
                for x in 0..<side {
                    total += 1
                    if solid[(pad + oy + y) * width + (pad + ox + x)] { filledCount += 1 }
                }
            }
        }
        return total == 0 ? 1 : Double(filledCount) / Double(total)
    }

    /// Where two edges meet is a corner of the figure; how far the nearest
    /// ink is from that meeting point separates a sharp corner from one
    /// rounded off. Scale free: divided by the box's short side.
    static func cornerGap(xs: [Double], ys: [Double], edges: [Edge], minSide: Double) -> Double {
        guard edges.count >= 3, minSide > 0 else { return 0 }
        var gaps: [Double] = []
        for a in 0..<edges.count {
            for b in (a + 1)..<edges.count {
                var between = abs(edges[a].theta - edges[b].theta)
                if between > .pi / 2 { between = .pi - between }
                guard between >= 25 * .pi / 180 else { continue }
                let det = cos(edges[a].theta) * sin(edges[b].theta) - sin(edges[a].theta) * cos(edges[b].theta)
                guard abs(det) > 1e-9 else { continue }
                let px = (edges[a].rho * sin(edges[b].theta) - edges[b].rho * sin(edges[a].theta)) / det
                let py = (edges[b].rho * cos(edges[a].theta) - edges[a].rho * cos(edges[b].theta)) / det
                func atEnd(_ e: Edge) -> Bool {
                    let t = -sin(e.theta) * px + cos(e.theta) * py
                    let at = (t - e.from) / max(1, e.length)
                    return at > -0.25 && at < 1.25 && (at < 0.3 || at > 0.7)
                }
                guard atEnd(edges[a]), atEnd(edges[b]) else { continue }
                var best = Double.infinity
                for i in 0..<xs.count {
                    let d = (xs[i] - px) * (xs[i] - px) + (ys[i] - py) * (ys[i] - py)
                    if d < best { best = d }
                }
                gaps.append(best.squareRoot())
            }
        }
        guard !gaps.isEmpty else { return 0 }
        return gaps.reduce(0, +) / Double(gaps.count) / minSide
    }

    /// The ink that is not on the figure's longest edge: how much of it
    /// there is, and where along the edge it sits.
    static func offSpine(xs: [Double], ys: [Double], edge: Edge,
                         tolerance: Double) -> (mass: Double, centroid: Double, spread: Double, reach: Double) {
        let ct = cos(edge.theta), st = sin(edge.theta)
        let length = max(1, edge.length)
        var off = 0
        let total = xs.count
        var sum = 0.0, square = 0.0, reach = 0.0
        for i in 0..<xs.count {
            let across = abs(xs[i] * ct + ys[i] * st - edge.rho)
            guard across > tolerance else { continue }
            off += 1
            reach = max(reach, across)
            let at = (-xs[i] * st + ys[i] * ct - edge.from) / length
            sum += at
            square += at * at
        }
        guard off > 0, total > 0 else { return (0, 0.5, 0, 0) }
        let mean = sum / Double(off)
        let variance = max(0, square / Double(off) - mean * mean)
        return (Double(off) / Double(total), mean, variance.squareRoot(), reach / length)
    }

    /// Along a stroke, how much wider the ink is at one end than the other.
    static func spreadAlong(xs: [Double], ys: [Double], edge: Edge) -> (ratio: Double, head: Int) {
        let ct = cos(edge.theta), st = sin(edge.theta)
        let slices = 5
        var spread = [Double](repeating: 0, count: slices)
        let length = max(1, edge.length)
        for i in 0..<xs.count {
            let t = -xs[i] * st + ys[i] * ct
            let at = (t - edge.from) / length
            guard at >= 0, at <= 1 else { continue }
            let slice = min(slices - 1, Int(at * Double(slices)))
            let perpendicular = abs(xs[i] * ct + ys[i] * st - edge.rho)
            spread[slice] = max(spread[slice], perpendicular)
        }
        // The two ends against the middle, so a thick pen does not read as
        // a head.
        let middle = max(0.5, spread[2])
        let low = spread[0] / middle, high = spread[4] / middle
        let ratio = max(low, high)
        return (ratio, high >= low ? 1 : -1)
    }
}
