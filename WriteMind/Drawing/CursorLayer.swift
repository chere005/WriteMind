import AppKit
import SwiftUI

/// Puts a cursor over the editor without taking any of its clicks.
///
/// The obvious SwiftUI way — push the cursor `onHover` — loses: the text view
/// underneath sets the I-beam from its own tracking area on every mouse move,
/// and whichever ran last wins, so the pen's cursor flickered back to a text
/// cursor (Sean, 2026-09-18: "in drawing mode, the cursor should become a
/// pencil"). A view with a real cursor rect, above the text view, wins the
/// same argument every time; the tracking area is the belt to that braces.
struct CursorLayer: NSViewRepresentable {
    /// Nil means "leave the cursor alone" — the text view keeps its I-beam.
    var cursor: NSCursor?

    func makeNSView(context: Context) -> CursorRectView {
        let view = CursorRectView()
        view.cursor = cursor
        return view
    }

    func updateNSView(_ view: CursorRectView, context: Context) {
        view.cursor = cursor
    }

    final class CursorRectView: NSView {
        var cursor: NSCursor? {
            didSet {
                guard cursor !== oldValue else { return }
                window?.invalidateCursorRects(for: self)
                if let cursor, isMouseInside { cursor.set() }
                else if cursor == nil, isMouseInside { NSCursor.arrow.set() }
            }
        }
        private var isMouseInside = false
        private var monitor: Any?

        /// The argument with the text view is settled here, not in the view
        /// hierarchy: a cursorUpdate event is how AppKit hands a view its turn
        /// to set the cursor (the text view's I-beam, the window's arrow), so
        /// while there is a cursor to show and the pointer is over this
        /// layer, those events are swallowed before anyone gets them, and
        /// every move sets the cursor again (Sean, 2026-09-18: "the highlight
        /// cursor keeps coming up").
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window == nil {
                if let monitor { NSEvent.removeMonitor(monitor) }
                monitor = nil
                return
            }
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(
                matching: [.cursorUpdate, .mouseMoved, .leftMouseDragged, .mouseEntered, .mouseExited]) { [weak self] event in
                guard let self, let cursor = self.cursor, let window = self.window, event.window === window,
                      !self.isHiddenOrHasHiddenAncestor
                else { return event }
                let point = self.convert(event.locationInWindow, from: nil)
                guard self.visibleRect.contains(point) else { return event }
                cursor.set()
                // A monitor runs BEFORE the event is dispatched, so anything
                // the dispatch sets wins over this. Setting it again on the
                // next turn of the run loop runs after all of that.
                DispatchQueue.main.async { [weak self] in
                    guard let self, let cursor = self.cursor, let window = self.window else { return }
                    let now = self.convert(window.mouseLocationOutsideOfEventStream, from: nil)
                    if self.visibleRect.contains(now) { cursor.set() }
                }
                return event.type == .cursorUpdate ? nil : event
            }
        }

        deinit {
            if let monitor { NSEvent.removeMonitor(monitor) }
        }

        override func resetCursorRects() {
            super.resetCursorRects()
            if let cursor { addCursorRect(bounds, cursor: cursor) }
        }

        /// Never in the way of a click — the drawing canvas and the text view
        /// below it get every event.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override var acceptsFirstResponder: Bool { false }

        override func updateTrackingAreas() {
            super.updateTrackingAreas()
            trackingAreas.forEach(removeTrackingArea)
            addTrackingArea(NSTrackingArea(
                rect: .zero,
                options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved, .cursorUpdate],
                owner: self))
        }

        override func mouseEntered(with event: NSEvent) { isMouseInside = true; cursor?.set() }
        override func mouseExited(with event: NSEvent) { isMouseInside = false }
        override func mouseMoved(with event: NSEvent) { cursor?.set() }

        override func cursorUpdate(with event: NSEvent) {
            if let cursor { cursor.set() } else { super.cursorUpdate(with: event) }
        }
    }
}

/// The cursors the drawing layer uses.
enum DrawingCursors {
    /// A pencil while the pen is up, pointed at the spot it will draw — the
    /// hotspot is the tip, bottom-left, not the image's centre. Black with a
    /// white halo, big enough to see: the first one was a thin white glyph
    /// that vanished on the page (Sean, 2026-09-18: "isn't very visible").
    static let pencil: NSCursor = {
        let size = NSSize(width: 28, height: 28)
        let base = NSImage.SymbolConfiguration(pointSize: 22, weight: .heavy)
        guard let symbol = NSImage(systemSymbolName: "pencil", accessibilityDescription: "Pen"),
              let halo = symbol.withSymbolConfiguration(
                  base.applying(NSImage.SymbolConfiguration(paletteColors: [.white]))),
              let lead = symbol.withSymbolConfiguration(
                  base.applying(NSImage.SymbolConfiguration(paletteColors: [.black])))
        else { return .crosshair }

        let image = NSImage(size: size, flipped: false) { rect in
            let box = rect.insetBy(dx: 3, dy: 3)
            for dx in [-1.5, 0, 1.5] as [CGFloat] {
                for dy in [-1.5, 0, 1.5] as [CGFloat] where dx != 0 || dy != 0 {
                    halo.draw(in: box.offsetBy(dx: dx, dy: dy), from: .zero, operation: .sourceOver, fraction: 1)
                }
            }
            lead.draw(in: box, from: .zero, operation: .sourceOver, fraction: 1)
            return true
        }
        image.isTemplate = false
        // The hot spot is given top-left up; the tip is at the bottom left.
        return NSCursor(image: image, hotSpot: NSPoint(x: 4, y: size.height - 4))
    }()
}
