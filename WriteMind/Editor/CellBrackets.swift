import SwiftUI

/// The notebook's cell brackets, drawn beside the rendered page — the same
/// furniture the markdown editor has in its gutter, so the notebook reads
/// the same on both sides (Sean, 2026-09-19: "notebook lines should be
/// visible in markdown and wysiwyg mode").
struct CellBrackets: View {
    struct Bracket: Equatable, Identifiable {
        var key: String
        var depth: Int
        var top: CGFloat
        var bottom: CGFloat
        var collapsed = false
        var selected = false
        /// A heading's group: a double-click folds it.
        var foldable = false
        /// What a click selects, in the markdown.
        var range: NSRange

        var id: String { key }
    }

    static let width: CGFloat = 22
    private static let step: CGFloat = 5
    private static let tick: CGFloat = 5

    let brackets: [Bracket]
    var onSelect: ((NSRange) -> Void)?
    var onToggle: ((String) -> Void)?
    @State private var hovered: String?

    /// The line a bracket is drawn on, from the right-hand edge.
    static func x(for depth: Int, in width: CGFloat) -> CGFloat {
        width - 6 - CGFloat(depth) * step
    }

    /// Which bracket a point lands on: the NEAREST one, not the first.
    /// Nesting levels are five points apart, so a tolerance that reaches
    /// the next level over would always answer with whichever happened to
    /// be first in the list.
    static func bracket(at point: CGPoint, in brackets: [Bracket], width: CGFloat) -> Bracket? {
        brackets
            .filter { bracket in
                point.y >= bracket.top - 4 && point.y <= bracket.bottom + 4
                    && abs(point.x - x(for: bracket.depth, in: width)) <= 4
            }
            .min { abs(point.x - x(for: $0.depth, in: width)) < abs(point.x - x(for: $1.depth, in: width)) }
    }

    var body: some View {
        Canvas { context, size in
            for bracket in brackets {
                let line = Self.x(for: bracket.depth, in: size.width)
                let base: CGFloat = bracket.foldable ? 1.5 : 1.1
                let weight = bracket.selected ? base + 1.2 : (bracket.key == hovered ? base + 0.6 : base)
                let colour: Color = bracket.selected || bracket.key == hovered
                    ? .accentColor
                    : Color.secondary.opacity(0.45)

                var path = Path()
                path.move(to: CGPoint(x: line - Self.tick, y: bracket.top))
                path.addLine(to: CGPoint(x: line, y: bracket.top))
                path.addLine(to: CGPoint(x: line, y: bracket.bottom))
                path.addLine(to: CGPoint(x: line - Self.tick, y: bracket.bottom))
                context.stroke(path, with: .color(colour),
                               style: StrokeStyle(lineWidth: weight, lineCap: .round, lineJoin: .round))

                if bracket.collapsed {
                    let middle = (bracket.top + bracket.bottom) / 2
                    var mark = Path()
                    mark.move(to: CGPoint(x: line - 4, y: middle - 3.5))
                    mark.addLine(to: CGPoint(x: line, y: middle))
                    mark.addLine(to: CGPoint(x: line - 4, y: middle + 3.5))
                    mark.closeSubpath()
                    context.fill(mark, with: .color(colour))
                }
            }
        }
        .frame(width: Self.width)
        .contentShape(Rectangle())
        .onContinuousHover(coordinateSpace: .local) { phase in
            switch phase {
            case .active(let point):
                let key = Self.bracket(at: point, in: brackets, width: Self.width)?.key
                if key != hovered { hovered = key }
                (key == nil ? NSCursor.arrow : NSCursor.pointingHand).set()
            case .ended:
                hovered = nil
            }
        }
        // One gesture, because a tap pair would make the single click wait
        // for the second — the same pause the camera's box had.
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onEnded { value in
                    guard let bracket = Self.bracket(at: value.location, in: brackets,
                                                     width: Self.width) else { return }
                    if (NSApp.currentEvent?.clickCount ?? 1) >= 2, bracket.foldable {
                        onToggle?(bracket.key)
                    } else {
                        onSelect?(bracket.range)
                    }
                }
        )
    }
}
