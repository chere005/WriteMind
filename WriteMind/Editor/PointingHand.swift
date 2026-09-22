import SwiftUI
import AppKit

/// A CONTROL ON THE PAGE TAKES THE POINTING HAND.
///
/// The app's own rule, already true of the + on the insertion bar and of
/// the brackets in the gutter (AGENTS.md: "The + on the bar is a button,
/// so it takes the pointing hand"). The rendered page's own controls —
/// a checklist's box, an evaluation cell's badge — sat inside a cell
/// whose hover paints the I-beam across it, so the pointer over them said
/// "type here" about something a click ticks or pops a menu on.
///
/// Set on every move rather than pushed, and handed back on the way out,
/// for the reason everything else here is: a pushed cursor loses to
/// `cursorUpdate`, and `NSCursor.set()` is global and sticks until
/// something else sets one. The cell under it sets the I-beam on the same
/// move, so the way back is to set that again rather than the arrow —
/// anything else would flash between the two.
struct PointingHand: ViewModifier {
    var enabled = true

    func body(content: Content) -> some View {
        content.onContinuousHover(coordinateSpace: .local) { phase in
            guard enabled else { return }
            switch phase {
            case .active: NSCursor.pointingHand.set()
            case .ended: MarkdownPreview.textCursor.set()
            }
        }
    }
}

extension View {
    func pointingHand(enabled: Bool = true) -> some View {
        modifier(PointingHand(enabled: enabled))
    }
}
