import AppKit

/// The line between two cells, in the markdown pane — Mathematica's
/// insertion point (Sean, 2026-09-19: "top priority is the horizontal
/// cursor and horizontal lines between cells like in mathematica").
///
/// The rendered page has had one since the cells there are separate views
/// with a strip between them. In the source there are no views to put a
/// strip between, so this is a layer over the text: it knows where the
/// seams are, turns the pointer on its side anywhere inside one, draws the
/// line across the page, and takes the click that arms it. Over a cell it
/// is not in the way at all — the text view gets every event as before.
///
/// The WHOLE seam answers now, edge to edge (Sean, 2026-09-20: "the cursor
/// should be horizontal any space between the two cells.. that's buggy").
/// The three-point strip round a gap's middle that the pointer used to flip
/// in and out of is gone: `CellSeams` says where the spaces are, both panes
/// ask it, and this layer only draws and takes the clicks.
final class CellInsertions: NSView {
    /// The spaces between the cells, from `MarkdownTextView.seams(in:)`.
    var seams: [CellSeams.Seam] = [] {
        didSet {
            guard seams != oldValue else { return }
            needsDisplay = true
            window?.invalidateCursorRects(for: self)
            // And the text view under this layer, which cuts its own
            // cursor rects from these same seams.
            if let superview { window?.invalidateCursorRects(for: superview) }
        }
    }
    /// The seam the bar is sitting in, BY OFFSET, waiting to be typed into.
    /// Nothing is written to the note until something is (Sean, 2026-09-20:
    /// "if i start typing it inserts a cell immediately after the
    /// cursor/line which disappear"), so clicking about the page leaves no
    /// empty cells.
    ///
    /// An offset and not a rectangle, because the rectangle goes stale: the
    /// pane is resized, a section opens, the note is swapped for another
    /// one, and the bar was left painted across a page at a y that meant
    /// nothing. Looking the geometry up in `seams` every time it is drawn
    /// means the bar either moves with its seam or stops being drawn. The
    /// text view's `armedSeam` is what sets this — one writer, so the caret
    /// and the bar cannot disagree about whether a seam is armed.
    var armedOffset: Int? { didSet { if armedOffset != oldValue { needsDisplay = true } } }
    private var armed: CellSeams.Seam? {
        guard let armedOffset else { return nil }
        return seams.first { $0.offset == armedOffset }
    }
    private var hovered: CellSeams.Seam?
    private var tracking: NSTrackingArea?

    /// The caret was put in a seam: whoever owns the keyboard is told, and
    /// the note itself is untouched until something is typed.
    var onArm: ((Int) -> Void)?
    /// The + on the bar was pressed and a kind picked off the menu.
    var onChoose: ((CellTypes.Kind) -> Void)?

    /// What the + last chose for the armed seam, for the tick beside it.
    /// Read off the text view under this layer, where it lives, rather
    /// than kept here as a second answer to one question — the same rule
    /// that sends the text view up here for `pointerSeams`.
    private var chosenType: CellTypes.Kind { (superview as? PasteAwareTextView)?.armedType ?? .text }

    /// The + itself, on the seam's own line, and the patch of page that
    /// counts as pressing it. Wider than the dot is drawn: a ten-point
    /// target on a bar eight points tall is not one anybody hits.
    static func plus(onTheLineAt line: CGFloat) -> NSRect {
        NSRect(x: 4, y: line - 5, width: 10, height: 10)
    }

    static func plusTarget(onTheLineAt line: CGFloat) -> NSRect {
        plus(onTheLineAt: line).insetBy(dx: -4, dy: -4)
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        // The armed bar stays drawn — it IS the cursor; the hovered one is
        // only a hint and goes with the pointer.
        guard let seam = armed ?? hovered else { return }
        let accent = NSColor.controlAccentColor
        accent.withAlphaComponent(0.85).setFill()
        // The line runs the width of the page, the way a cell insertion
        // bar does in a notebook.
        NSBezierPath(rect: NSRect(x: 18, y: seam.line - 1, width: max(0, bounds.width - 40), height: 2)).fill()
        // And the plus, which is a button: it brings up the kinds of cell
        // the next thing typed here can be.
        let dot = Self.plus(onTheLineAt: seam.line)
        NSBezierPath(ovalIn: dot).fill()
        NSColor.white.setStroke()
        let plus = NSBezierPath()
        plus.lineWidth = 1.4
        plus.move(to: CGPoint(x: dot.midX - 2.6, y: dot.midY))
        plus.line(to: CGPoint(x: dot.midX + 2.6, y: dot.midY))
        plus.move(to: CGPoint(x: dot.midX, y: dot.midY - 2.6))
        plus.line(to: CGPoint(x: dot.midX, y: dot.midY + 2.6))
        plus.stroke()
    }

    /// The seams as the POINTER reads them — none at all while the layer
    /// is hidden, because the pen owns the pane then.
    ///
    /// The text view underneath asks for these rather than keeping a
    /// copy: it has to know where the seams are (its own tracking areas
    /// hand it every mouseMoved and cursorUpdate whoever is on top, and
    /// it was putting the I-beam back over the bar), and a second copy
    /// of the geometry is two answers to one question.
    var pointerSeams: [CellSeams.Seam] { isHidden ? [] : seams }

    /// The seam a point is in, if any. Full width of the page EXCEPT the
    /// bracket gutter: a section's bracket runs down the seams between its
    /// cells as well as the cells, and a layer over the whole width would
    /// swallow every click on one.
    func seam(at point: CGPoint) -> CellSeams.Seam? {
        guard !isHidden, point.x < bounds.width - NotebookGutter.width else { return nil }
        return CellSeams.seam(at: point.y, in: seams)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero,
                                  options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow,
                                            .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseMoved(with event: NSEvent) {
        let seam = seam(at: convert(event.locationInWindow, from: nil))
        if seam != hovered { hovered = seam; needsDisplay = true }
        // On its side, because what goes in here goes in BETWEEN two
        // things rather than between two letters. It is set for the whole
        // seam, so the pointer does not flip on the way across one.
        if seam != nil { NSCursor.iBeamCursorForVerticalLayout.set() }
    }

    /// The pointer keeps its shape all the way across a seam, whatever
    /// the text view thinks. A cursor rect is the strongest way to say so
    /// — this layer is above the text view, so its rects win over the
    /// I-beam the text view sets over the whole of itself — and the
    /// cursorUpdate below is the belt to those braces, for the events
    /// AppKit routes by hit testing instead (Sean, 2026-09-20: "cursor is
    /// super buggy").
    override func resetCursorRects() {
        let width = max(0, bounds.width - NotebookGutter.width)
        for seam in seams where seam.bottom > seam.top {
            addCursorRect(NSRect(x: 0, y: seam.top, width: width, height: seam.bottom - seam.top),
                          cursor: .iBeamCursorForVerticalLayout)
        }
    }

    override func cursorUpdate(with event: NSEvent) {
        guard seam(at: convert(event.locationInWindow, from: nil)) != nil else {
            return super.cursorUpdate(with: event)
        }
        NSCursor.iBeamCursorForVerticalLayout.set()
    }

    override func mouseExited(with event: NSEvent) {
        if hovered != nil { hovered = nil; needsDisplay = true }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let seam = seam(at: point) else { return }
        // The text view is told, and it tells this layer back through
        // `armedOffset`. Setting it here as well would be a second writer.
        //
        // The + arms the seam too, and first: the choice belongs to an
        // armed bar, and re-arming the seam that is already armed keeps
        // whatever was chosen for it (the text view's own `armedSeam`
        // only lets go when the bar MOVES).
        onArm?(seam.offset)
        guard Self.plusTarget(onTheLineAt: seam.line).contains(point) else { return }
        CellTypeMenu.popUp(current: chosenType,
                           at: NSPoint(x: 2, y: Self.plusTarget(onTheLineAt: seam.line).maxY),
                           in: self) { [weak self] kind in self?.onChoose?(kind) }
    }

    /// The bar goes out when the caret goes anywhere else.
    func disarm() { armedOffset = nil }

    /// Only a point inside a seam belongs to this layer; every other click
    /// goes to the text underneath. NSView's own hit testing skips a hidden
    /// view and this override does not, so it has to ask: with the pen up
    /// the layer is hidden and the pencil owns the pane.
    override func hitTest(_ point: NSPoint) -> NSView? {
        seam(at: convert(point, from: superview)) == nil ? nil : self
    }
}

/// The list the + on the insertion bar brings up, for both panes.
///
/// An NSMenu, and popped by hand even on the rendered page, which is
/// SwiftUI everywhere else. The mark the + sits on is drawn while its seam
/// is hovered or armed; the moment a menu opens the pointer is over the
/// MENU and not the seam, so the hover ends, and a SwiftUI `Menu` whose
/// label is taken off the page goes with it. Arming the seam first and
/// popping the menu ourselves means the bar stays because it is armed, and
/// the menu outlives the pointer leaving the page.
enum CellTypeMenu {
    /// The menu, with a tick beside what is chosen now.
    static func menu(current: CellTypes.Kind,
                     choose: @escaping (CellTypes.Kind) -> Void) -> NSMenu {
        let chooser = Chooser(choose: choose)
        let menu = TypeMenu(title: "Cell Type")
        // The menu keeps the closure alive. NSMenuItem holds its target
        // weakly and sends the action from inside the menu's own tracking
        // loop, so something has to, and the menu is the thing that
        // outlives exactly as long as the choice can be made.
        menu.chooser = chooser
        menu.autoenablesItems = false
        for (index, group) in CellTypes.groups.enumerated() {
            if index > 0 { menu.addItem(.separator()) }
            for kind in group {
                let item = NSMenuItem(title: kind.name, action: #selector(Chooser.pick(_:)),
                                      keyEquivalent: "")
                item.target = chooser
                item.representedObject = kind
                item.state = kind == current ? .on : .off
                menu.addItem(item)
            }
        }
        return menu
    }

    /// At a point in a view, or — with no view — at a point on the screen,
    /// which is all the rendered page can offer: there is no NSView of its
    /// own behind that +.
    static func popUp(current: CellTypes.Kind, at point: NSPoint, in view: NSView?,
                      choose: @escaping (CellTypes.Kind) -> Void) {
        menu(current: current, choose: choose).popUp(positioning: nil, at: point, in: view)
    }

    private final class TypeMenu: NSMenu {
        var chooser: AnyObject?

        override init(title: String) { super.init(title: title) }
        // Never decoded: this menu is built in code every time it is
        // popped, and nothing in the app archives one.
        required init(coder: NSCoder) { fatalError("CellTypeMenu is not decoded") }
    }

    private final class Chooser: NSObject {
        private let choose: (CellTypes.Kind) -> Void

        init(choose: @escaping (CellTypes.Kind) -> Void) { self.choose = choose }

        @objc func pick(_ sender: NSMenuItem) {
            guard let kind = sender.representedObject as? CellTypes.Kind else { return }
            choose(kind)
        }
    }
}
