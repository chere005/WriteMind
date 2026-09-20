import CoreGraphics
import Foundation

/// A flow chart sketched on paper, read off the page as real nodes and
/// arrows (Sean, 2026-09-19: "have ocr also grab shapes and flow charts").
///
/// Two readings are put together here, because each is better at half the
/// job. `FlowGrouping` finds the nodes as HOLES — the paper a drawn box
/// encloses — which is the only way that survives an arrow touching the
/// box it points at, and it works out which words are whose label and
/// which arrow joins which pair. `ShapeInk` then names each one and, more
/// importantly, REFUSES the ones that are not shapes: over twelve pages of
/// ordinary notes it found nothing at all, which is the behaviour this
/// feature has to have. A sketch that comes in as the wrong shapes is
/// worse than one that comes in as ink.
enum FlowChartReading {
    /// The kinds allowed onto the page. A triangle reads perfectly and is
    /// also where scribbles go; nobody draws one in a flow chart. A
    /// parallelogram costs the rectangle — the class that must not break.
    /// A tick, a cross and a star are marks in a note, not objects.
    static let shipped: Set<ShapeItem.Kind> = [.rectangle, .roundedRectangle, .oval, .diamond]

    /// Above this it is a printed diagram or a screenshot, not a sketch.
    static let maximumNodes = 12

    /// A drawn rectangle stood on its point IS a diamond, so the lean is
    /// the only thing between them — and hand wobble moves a corner by
    /// several degrees. Under 8° it is a rectangle, over 25° a diamond,
    /// and in between nothing is emitted at all.
    static let rectangleLean = 8.0
    static let diamondLean = 25.0

    /// The chart on a page, or nothing at all. `ink` is the writing mask,
    /// `words` what Vision read, and `pane` the page the objects land on.
    static func items(ink: [Bool], width: Int, height: Int, words: [HandwritingMarks.Word],
                      in pane: CGSize, colorHex: String, lineWidth: Double) -> [CanvasItem] {
        guard width > 8, height > 8, ink.count == width * height,
              pane.width > 1, pane.height > 1 else { return [] }

        let sheet = FlowGrouping.read(ink: ink, width: width, height: height,
                                      words: words.map { FlowGrouping.Word(text: $0.text, box: $0.box) })
        let shortSide = min(width, height)

        // Every candidate is named again by the classifier, over the ink
        // inside its outline. Anything it will not name is dropped.
        var kinds: [Int: ShapeItem.Kind] = [:]
        for (index, node) in sheet.nodes.enumerated() where node.isNode {
            guard let blob = component(of: node.box, ink: ink, width: width, height: height),
                  let kind = named(blob, shortSide: shortSide, lean: node.skew)
            else { continue }
            kinds[index] = kind
        }
        guard !kinds.isEmpty, kinds.count <= maximumNodes else { return [] }

        let placement = FlowGrouping.Placement(pane: pane,
                                               page: CGSize(width: width, height: height))
        var ids: [Int: UUID] = [:]
        var nodes: [CanvasItem] = []
        for (index, kind) in kinds.sorted(by: { $0.key < $1.key }) {
            let node = sheet.nodes[index]
            let id = UUID()
            ids[index] = id
            nodes.append(.shape(ShapeItem(
                id: id, kind: kind,
                center: placement.fraction(CGPoint(x: node.box.midX, y: node.box.midY)),
                width: placement.width(node.box.width),
                aspect: Double(node.box.height / max(node.box.width, 1)),
                colorHex: colorHex, lineWidth: lineWidth, label: node.label)))
        }

        // A line with nothing at either end is an underline or a rule, not
        // a connector: twenty-seven of those were measured over twelve
        // pages of notes, and none once the rule was applied.
        var edges: [CanvasItem] = []
        for edge in sheet.edges {
            guard let from = edge.from, let to = edge.to,
                  let startID = ids[from], let endID = ids[to], startID != endID
            else { continue }
            // A head is only drawn where the barb was actually seen. A
            // guessed direction silently inverts what the chart means.
            edges.append(.connector(ConnectorItem(
                start: placement.fraction(edge.tail), end: placement.fraction(edge.head),
                startNode: startID, endNode: endID,
                startHead: edge.headAtStart ? .arrow : .none,
                endHead: edge.headAtEnd ? .arrow : .none,
                colorHex: colorHex, lineWidth: min(max(lineWidth, 1.5), 6))))
        }

        // A single ring on a page of prose is a doodle or a word circled
        // for emphasis — which `HandwritingMarks` already reads as bold.
        // A chart is two boxes, or one box with an arrow on it.
        guard nodes.count >= 2 || (nodes.count == 1 && !edges.isEmpty) else { return [] }
        return nodes + edges
    }

    /// The same objects, moved and scaled into one box of the pane — a
    /// chart read off a picture lands under that picture, not across the
    /// whole page.
    static func placed(_ items: [CanvasItem], into box: CGRect, pane: CGSize) -> [CanvasItem] {
        guard pane.width > 1, pane.height > 1, box.width > 1, box.height > 1 else { return items }
        let scaleX = box.width / pane.width, scaleY = box.height / pane.height
        let originX = box.minX / pane.width, originY = box.minY / pane.height
        func moved(_ point: CGPoint) -> CGPoint {
            CGPoint(x: originX + point.x * scaleX, y: originY + point.y * scaleY)
        }
        return items.map { item in
            switch item {
            case .shape(var shape):
                shape.center = moved(shape.center)
                shape.width *= scaleX
                // The box changes shape as well as size, so the aspect has
                // to be corrected or every node comes out stretched.
                shape.aspect *= scaleY / max(scaleX, 0.0001)
                return .shape(shape)
            case .connector(var connector):
                connector.start = moved(connector.start)
                connector.end = moved(connector.end)
                connector.bends = connector.bends.map(moved)
                return .connector(connector)
            default:
                return item
            }
        }
    }

    /// The classifier's verdict, or nil when it will not name it.
    static func named(_ blob: NotebookCapture.Component, shortSide: Int, lean: Double) -> ShapeItem.Kind? {
        let reading = ShapeInk.read(blob, shortSide: shortSide)
        guard let kind = ShapeItem.Kind(rawValue: reading.kind.rawValue), shipped.contains(kind) else {
            return nil
        }
        let tilt = abs(lean)
        switch kind {
        case .diamond: return tilt >= diamondLean ? .diamond : nil
        case .rectangle, .roundedRectangle: return tilt <= rectangleLean ? kind : nil
        default: return kind
        }
    }

    /// The ink inside a box, as one component for the classifier to read.
    static func component(of box: CGRect, ink: [Bool], width: Int, height: Int) -> NotebookCapture.Component? {
        let x0 = max(0, Int(box.minX)), x1 = min(width, Int(box.maxX.rounded(.up)))
        let y0 = max(0, Int(box.minY)), y1 = min(height, Int(box.maxY.rounded(.up)))
        guard x1 > x0, y1 > y0 else { return nil }
        var pixels: [Int] = []
        var minX = width, minY = height, maxX = -1, maxY = -1
        for y in y0..<y1 {
            for x in x0..<x1 where ink[y * width + x] {
                pixels.append(y * width + x)
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX >= 0, !pixels.isEmpty else { return nil }
        return NotebookCapture.Component(stride: width, minX: minX, minY: minY,
                                         maxX: maxX, maxY: maxY, pixels: pixels)
    }
}
