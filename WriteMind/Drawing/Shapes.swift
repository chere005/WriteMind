import AppKit
import SwiftUI

/// A drawn figure: a flow-chart node — rectangle, oval, diamond, triangle —
/// or one of the marks people draw all the time, a check, a cross, a star
/// (Sean, 2026-09-18). The outline is drawn in a unit square and scaled into
/// the item's box, so a diamond and a check mark are the same kind of thing,
/// and the box is what the handles hold.
struct ShapeItem: Codable, Equatable, Identifiable {
    enum Kind: String, Codable, CaseIterable, Identifiable {
        case rectangle, roundedRectangle, oval, diamond, triangle, parallelogram
        case check, cross, star
        /// A box of text with no outline of its own (Sean, 2026-09-18:
        /// "a free floating text box"): a node for every other purpose —
        /// arrows land on it, the text runs round it like a picture.
        case text

        var id: String { rawValue }

        /// Nodes carry a label and are what arrows land on; marks are marks.
        var isNode: Bool {
            switch self {
            case .rectangle, .roundedRectangle, .oval, .diamond, .triangle, .parallelogram, .text: return true
            case .check, .cross, .star: return false
            }
        }

        /// A closed outline is hit anywhere inside it; an open one only on
        /// the line itself.
        var isClosed: Bool {
            switch self {
            case .check, .cross: return false
            default: return true
            }
        }

        var title: String {
            switch self {
            case .rectangle: return "Rectangle"
            case .roundedRectangle: return "Rounded Rectangle"
            case .oval: return "Oval"
            case .diamond: return "Diamond"
            case .triangle: return "Triangle"
            case .parallelogram: return "Parallelogram"
            case .check: return "Check Mark"
            case .cross: return "Cross"
            case .star: return "Star"
            case .text: return "Text Box"
            }
        }

        /// The SF Symbol that stands for it on a button.
        var symbol: String {
            switch self {
            case .rectangle: return "rectangle"
            case .roundedRectangle: return "rectangle.roundedtop"
            case .oval: return "oval"
            case .diamond: return "diamond"
            case .triangle: return "triangle"
            // "parallelogram" is an SF Symbol macOS 15 has and 14 does not,
            // and a missing symbol draws NOTHING — a blank button in the
            // palette (2026-09-19). "skew" is the same idea and is there.
            case .parallelogram: return "skew"
            case .check: return "checkmark"
            case .cross: return "xmark"
            case .star: return "star"
            case .text: return "character.textbox"
            }
        }

        /// Height over width when the shape is first put down.
        var defaultAspect: Double {
            switch self {
            case .rectangle, .roundedRectangle, .parallelogram: return 0.55
            case .oval: return 0.6
            case .diamond: return 0.7
            case .triangle: return 0.8
            case .check, .cross, .star: return 1
            case .text: return 0.3
            }
        }

        /// The outline in a unit square, y down as on screen — several
        /// polylines for a mark drawn in more than one stroke (the cross).
        var unitPolylines: [[CGPoint]] {
            switch self {
            case .rectangle, .roundedRectangle, .text:
                return [[CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1)]]
            case .oval:
                return [(0..<32).map { step in
                    let angle = Double(step) / 32 * 2 * .pi
                    return CGPoint(x: 0.5 + 0.5 * cos(angle), y: 0.5 + 0.5 * sin(angle))
                }]
            case .diamond:
                return [[CGPoint(x: 0.5, y: 0), CGPoint(x: 1, y: 0.5), CGPoint(x: 0.5, y: 1), CGPoint(x: 0, y: 0.5)]]
            case .triangle:
                return [[CGPoint(x: 0.5, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1)]]
            case .parallelogram:
                return [[CGPoint(x: 0.2, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 0.8, y: 1), CGPoint(x: 0, y: 1)]]

            // The three MARKS are drawn to look like the thing, not like
            // a polyline that happens to be near it (Sean, 2026-09-21:
            // "all the assets look like shit, fix them"). Each is inset
            // from the unit square so a round cap does not hang out of
            // the box the handles are drawn round.
            case .check:
                // A tick's short arm is about two fifths of its long one
                // and the two meet low and left of centre. The old one
                // came off a corner at 0.08 and knocked its knee into the
                // bottom edge at 0.86.
                return [[CGPoint(x: 0.12, y: 0.52), CGPoint(x: 0.40, y: 0.80), CGPoint(x: 0.88, y: 0.16)]]
            case .cross:
                // Square and centred, inset enough for the caps.
                return [[CGPoint(x: 0.16, y: 0.16), CGPoint(x: 0.84, y: 0.84)],
                        [CGPoint(x: 0.84, y: 0.16), CGPoint(x: 0.16, y: 0.84)]]
            case .star:
                // A five-pointed star's inner radius is the outer one
                // over phi squared — 0.382 — and anything much under it
                // is a spider, which is what 0.2 gave. Inset to 0.46 so
                // the points do not sit on the edge of the box.
                let outer = 0.45, inner = outer * 0.382
                return [(0..<10).map { step in
                    let angle = -Double.pi / 2 + Double(step) * .pi / 5
                    let radius = step.isMultiple(of: 2) ? outer : inner
                    return CGPoint(x: 0.5 + radius * cos(angle), y: 0.5 + radius * sin(angle))
                }]
            }
        }

        /// The polylines scaled into a box.
        func polylines(in box: CGRect) -> [[CGPoint]] {
            unitPolylines.map { line in
                line.map { CGPoint(x: box.minX + $0.x * box.width, y: box.minY + $0.y * box.height) }
            }
        }

        /// What is drawn — the true curves where the polylines above are an
        /// approximation, for hitting and for arrows to land on.
        func path(in box: CGRect) -> Path {
            switch self {
            case .roundedRectangle:
                return Path(roundedRect: box, cornerRadius: min(box.width, box.height) * 0.2)
            case .oval:
                return Path(ellipseIn: box)
            default:
                var path = Path()
                for line in polylines(in: box) {
                    guard let first = line.first else { continue }
                    path.move(to: first)
                    for point in line.dropFirst() { path.addLine(to: point) }
                    if isClosed { path.closeSubpath() }
                }
                return path
            }
        }
    }

    /// How tall a text box has to be, as height over width, to hold its
    /// text at this width in points. The measuring itself lives in
    /// `TextBoxStyle`, with the font and padding it measures against.
    static func textAspect(for label: String, boxWidth: CGFloat) -> Double {
        TextBoxStyle.aspect(for: label, boxWidth: boxWidth)
    }

    var id = UUID()
    var kind: Kind
    /// The centre, as a fraction of the pane, before the transform moves it.
    var center: CGPoint
    /// Width as a fraction of the pane's width; the height follows `aspect`.
    var width: Double
    var aspect: Double
    var colorHex: String
    var lineWidth: Double
    /// Nil is see-through.
    var fillHex: String?
    /// What a node says. Marks have none.
    var label: String
    var transform = ItemTransform()
    /// The group this belongs to, if it has been put in one (Sean,
    /// 2026-09-20: "select drawn (or captured) stuff for grouping,
    /// deleting, ungrouping"). Picking any member picks them all; the
    /// objects are otherwise untouched by it, so ungrouping moves nothing.
    var group: UUID?

    private enum CodingKeys: String, CodingKey {
        case id, kind, center, width, aspect, colorHex, lineWidth, fillHex, label, transform, group
    }

    init(id: UUID = UUID(), kind: Kind, center: CGPoint = CGPoint(x: 0.5, y: 0.5), width: Double = 0.18,
         aspect: Double? = nil, colorHex: String, lineWidth: Double = 2, fillHex: String? = nil,
         label: String = "", transform: ItemTransform = ItemTransform(), group: UUID? = nil) {
        self.id = id
        self.kind = kind
        self.center = center
        self.width = width
        self.aspect = aspect ?? kind.defaultAspect
        self.colorHex = colorHex
        self.lineWidth = lineWidth
        self.fillHex = fillHex
        self.label = label
        self.transform = transform
        self.group = group
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        kind = try container.decode(Kind.self, forKey: .kind)
        center = try container.decodeIfPresent(CGPoint.self, forKey: .center) ?? CGPoint(x: 0.5, y: 0.5)
        width = try container.decodeIfPresent(Double.self, forKey: .width) ?? 0.18
        aspect = try container.decodeIfPresent(Double.self, forKey: .aspect) ?? kind.defaultAspect
        colorHex = try container.decodeIfPresent(String.self, forKey: .colorHex) ?? "#000000"
        lineWidth = try container.decodeIfPresent(Double.self, forKey: .lineWidth) ?? 2
        fillHex = try container.decodeIfPresent(String.self, forKey: .fillHex)
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? ""
        transform = try container.decodeIfPresent(ItemTransform.self, forKey: .transform) ?? ItemTransform()
        group = try container.decodeIfPresent(UUID.self, forKey: .group)
    }
}

/// A line from one thing to another — a flow chart's arrow. Either end can
/// be attached to a node (or a picture), and then follows it and lands on
/// its edge; a free end is just a point. The heads and the line's style come
/// from the bar that appears once it is drawn, as in draw.io.
struct ConnectorItem: Codable, Equatable, Identifiable {
    enum LineStyle: String, Codable, CaseIterable, Identifiable {
        case solid, dashed, dotted
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    enum Head: String, Codable, CaseIterable, Identifiable {
        case none, arrow
        var id: String { rawValue }
    }

    var id = UUID()
    /// The ends, as fractions of the pane. An attached end is kept up to
    /// date by `Drawing.reconnect`.
    var start: CGPoint
    var end: CGPoint
    var startNode: UUID?
    var endNode: UUID?
    var startHead: Head
    var endHead: Head
    var line: LineStyle
    var colorHex: String
    var lineWidth: Double
    /// Kept so a connector moves like everything else; `Drawing.reconnect`
    /// bakes it back into the points straight after.
    var transform = ItemTransform()
    /// The corners between the ends, in pane fractions — worked out by
    /// `Drawing.reconnect` for a line that is attached to a node, so a
    /// flow-chart line turns right angles instead of cutting across (Sean,
    /// 2026-09-19: "lines are always straight with corners"). Empty for a
    /// line drawn from the palette, which stays straight.
    var bends: [CGPoint] = []
    /// The segments that were dragged by hand, and where they were put.
    /// They win over the routing: "its final drag is where it goes".
    var overrides: [SegmentOverride] = []

    /// One segment moved by hand: which one, which way it ran, and the
    /// coordinate it was left at, as a fraction of the pane.
    struct SegmentOverride: Codable, Equatable {
        var index: Int
        /// True when the segment ran up and down, so `value` is an x.
        var vertical: Bool
        var value: Double
    }

    /// A line with an end on a node is routed; one floating free is not.
    var isRouted: Bool { startNode != nil || endNode != nil }

    /// The whole line in pane fractions, ends included.
    var route: [CGPoint] { [start] + bends + [end] }

    private enum CodingKeys: String, CodingKey {
        case id, start, end, startNode, endNode, startHead, endHead, line, colorHex, lineWidth, transform
        case bends, overrides
    }

    init(id: UUID = UUID(), start: CGPoint, end: CGPoint, startNode: UUID? = nil, endNode: UUID? = nil,
         startHead: Head = .none, endHead: Head = .arrow, line: LineStyle = .solid,
         colorHex: String, lineWidth: Double = 2, transform: ItemTransform = ItemTransform(),
         bends: [CGPoint] = [], overrides: [SegmentOverride] = []) {
        self.id = id
        self.start = start
        self.end = end
        self.startNode = startNode
        self.endNode = endNode
        self.startHead = startHead
        self.endHead = endHead
        self.line = line
        self.colorHex = colorHex
        self.lineWidth = lineWidth
        self.transform = transform
        self.bends = bends
        self.overrides = overrides
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        start = try container.decode(CGPoint.self, forKey: .start)
        end = try container.decode(CGPoint.self, forKey: .end)
        startNode = try container.decodeIfPresent(UUID.self, forKey: .startNode)
        endNode = try container.decodeIfPresent(UUID.self, forKey: .endNode)
        startHead = try container.decodeIfPresent(Head.self, forKey: .startHead) ?? .none
        endHead = try container.decodeIfPresent(Head.self, forKey: .endHead) ?? .arrow
        line = try container.decodeIfPresent(LineStyle.self, forKey: .line) ?? .solid
        colorHex = try container.decodeIfPresent(String.self, forKey: .colorHex) ?? "#000000"
        lineWidth = try container.decodeIfPresent(Double.self, forKey: .lineWidth) ?? 2
        transform = try container.decodeIfPresent(ItemTransform.self, forKey: .transform) ?? ItemTransform()
        // A drawing saved before lines turned corners has neither, and is
        // routed again the moment it is opened.
        bends = try container.decodeIfPresent([CGPoint].self, forKey: .bends) ?? []
        overrides = try container.decodeIfPresent([SegmentOverride].self, forKey: .overrides) ?? []
    }

    /// How long the head is, for a line this wide.
    static func headLength(for lineWidth: Double) -> CGFloat { 7 + 2.5 * lineWidth }

    /// An arrowhead: a filled triangle with its tip at `tip`, pointing away
    /// from `from`.
    static func head(tip: CGPoint, from: CGPoint, lineWidth: Double) -> Path {
        let length = headLength(for: lineWidth)
        let dx = tip.x - from.x, dy = tip.y - from.y
        let distance = max(hypot(dx, dy), 0.001)
        let ux = dx / distance, uy = dy / distance
        let base = CGPoint(x: tip.x - ux * length, y: tip.y - uy * length)
        let half = length * 0.45
        var path = Path()
        path.move(to: tip)
        path.addLine(to: CGPoint(x: base.x - uy * half, y: base.y + ux * half))
        path.addLine(to: CGPoint(x: base.x + uy * half, y: base.y - ux * half))
        path.closeSubpath()
        return path
    }

    /// Where the line stops short of a head, so the tip is the point.
    static func shortened(_ tip: CGPoint, from: CGPoint, by length: CGFloat) -> CGPoint {
        let dx = tip.x - from.x, dy = tip.y - from.y
        let distance = hypot(dx, dy)
        guard distance > length else { return from }
        return CGPoint(x: tip.x - dx / distance * length, y: tip.y - dy / distance * length)
    }

    /// The dash pattern for the line, in points.
    func dash() -> [CGFloat] {
        switch line {
        case .solid: return []
        case .dashed: return [lineWidth * 4, lineWidth * 3]
        case .dotted: return [0.1, lineWidth * 2.2]
        }
    }
}
