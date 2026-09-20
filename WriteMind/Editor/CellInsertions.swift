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
    /// Written through `measure` and nowhere else, so there is one place
    /// that decides whether anything has actually changed.
    private(set) var seams: [CellSeams.Seam] = []

    /// A fresh measurement off the text layout, TAKEN only when a seam
    /// has really moved.
    ///
    /// `refreshBrackets` hands one of these over on every keystroke,
    /// every caret move, every restyle and every scroll, and each of
    /// them tore the cursor rects down and built them again — the
    /// pointer over a bar goes back to the text view's upright I-beam
    /// for the moment in between (Sean, 2026-09-20: "it does flicker
    /// sometimes back to a cursor"). An idle re-measure of the same
    /// layout now changes nothing at all: the old seams stand, so the
    /// rects under the pointer are never torn down while the page is
    /// sitting still.
    func measure(_ fresh: [CellSeams.Seam]) {
        guard CellSeams.moved(fresh, from: seams) else { return }
        seams = fresh
        markChanged()
    }

    /// The bar, the + on it and the pointer over them have moved. Both
    /// views' cursor rects go: the text view underneath cuts its own out
    /// of these same seams and out of the same + (`pointerPlus`).
    private func markChanged() {
        needsDisplay = true
        window?.invalidateCursorRects(for: self)
        if let superview { window?.invalidateCursorRects(for: superview) }
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
    var armedOffset: Int? { didSet { if armedOffset != oldValue { markChanged() } } }
    private var armed: CellSeams.Seam? {
        guard let armedOffset else { return nil }
        return seams.first { $0.offset == armedOffset }
    }
    /// Which seam the pointer is in, for the mark that follows it.
    /// It moves the + as well as the bar, so the cursor rects go with it.
    private var hovered: CellSeams.Seam? { didSet { if hovered != oldValue { markChanged() } } }
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

    /// Where this pane's left margin is. The only part of the + the two
    /// panes do not share: here it sits outside the text container's
    /// inset, on the rendered page inside its own margin. How big it is,
    /// where on the seam it sits and how much slack it answers for are
    /// `CellSeams`', beside the line it is drawn on.
    static let plusLeading: CGFloat = 4

    /// The + itself, on the seam's own line.
    static func plus(onTheLineAt line: CGFloat) -> NSRect {
        CellSeams.plus(onTheLineAt: line, leading: plusLeading)
    }

    /// The seam the bar and its + are DRAWN on: the armed one, or the
    /// hovered one when nothing is armed. One reading, for the drawing
    /// and for the click — the two used to disagree. `draw` painted the
    /// armed seam and `mouseDown` measured the + against whichever seam
    /// was clicked, so with a bar already up the left eighteen points of
    /// every OTHER seam popped the cell-type menu with no + drawn there
    /// at all (2026-09-20). The rendered page never had the hole: its +
    /// is a real Button that is not in the view tree unless the seam is
    /// hovered or armed.
    private var marked: CellSeams.Seam? { armed ?? hovered }

    /// Whether a click is a press of the +. Only where the + is drawn:
    /// the target is nine points either side of the bar, which on an
    /// ordinary eight-point seam is the whole height of it.
    static func pressesPlus(at point: CGPoint, in seam: CellSeams.Seam,
                            drawnOn marked: CellSeams.Seam?) -> Bool {
        marked == seam && CellSeams.onPlus(point, of: seam, leading: plusLeading)
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        // The armed bar stays drawn — it IS the cursor; the hovered one is
        // only a hint and goes with the pointer.
        guard let seam = marked else { return }
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

    /// The + as the POINTER reads it: where a + is actually drawn, and
    /// nothing at all when none is or the pen has the pane. The text
    /// view underneath asks for this the way it asks for `pointerSeams`
    /// — the + is a button and takes the hand, and a hand of ours laid
    /// over an I-beam of the text view's is the argument the text view
    /// wins.
    var pointerPlus: NSRect? {
        guard !isHidden, let marked else { return nil }
        let target = CellSeams.plusTarget(in: marked, leading: Self.plusLeading)
        return target.isEmpty ? nil : target
    }

    /// What the pointer should be at a point of this layer: the hand the
    /// gutter's brackets already use over the + because the + is a
    /// button (Sean, 2026-09-20: "it should be a pointer over the +
    /// button"), the I-beam on its side over the rest of a seam, and
    /// nothing at all over a cell, where the words are the text view's
    /// business.
    ///
    /// ONE answer, read by this layer's `cursorUpdate`, by its cursor
    /// rects and by the text view underneath — a cursorUpdate reaches
    /// both views and whichever runs last wins, so two views deciding
    /// separately is a disagreement one event wide, which is a flicker.
    func cursor(at point: CGPoint) -> NSCursor? {
        guard let seam = seam(at: point) else { return nil }
        // `armed ?? seam` rather than `marked`: `hovered` is set by the
        // move that arrives with the pointer and a cursorUpdate can
        // arrive before it, so reading the point itself is the one
        // answer that cannot be a move behind. Where a bar is already
        // armed somewhere else nothing is drawn on this seam, and the
        // pointer says so, exactly as `pressesPlus` does.
        return Self.pressesPlus(at: point, in: seam, drawnOn: armed ?? seam)
            ? .pointingHand : .iBeamCursorForVerticalLayout
    }

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
        // `.cursorUpdate` is the one that matters: cursor RECTS are torn
        // down and rebuilt every time the note reflows, and a tracking
        // area is not. It is what keeps the pointer on its side across
        // the rebuild, with the rects as the belt to those braces rather
        // than the other way about (Sean, 2026-09-20: "make it less
        // prone to flickering").
        let area = NSTrackingArea(rect: .zero,
                                  options: [.mouseMoved, .mouseEnteredAndExited, .cursorUpdate,
                                            .activeInKeyWindow, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        hovered = seam(at: point)
        // On its side over the seam, because what goes in here goes in
        // BETWEEN two things rather than between two letters, and a hand
        // over the +, because that is a button. Set for the whole of
        // each, so the pointer does not flip on the way across one.
        cursor(at: point)?.set()
    }

    /// The move that arrives with the pointer is not the only way in:
    /// AppKit hands a view a mouseEntered when its tracking areas are
    /// rebuilt under a pointer that has not moved, and nothing else
    /// follows it.
    override func mouseEntered(with event: NSEvent) {
        mouseMoved(with: event)
    }

    /// The pointer keeps its shape all the way across a seam, whatever
    /// the text view thinks (Sean, 2026-09-20: "cursor is super buggy").
    ///
    /// These are the BELT now and the tracking area above is the braces,
    /// which is the way round it should always have been: a rect is torn
    /// down and built again every time the note reflows, and there is no
    /// rect of ours under the pointer in between.
    override func resetCursorRects() {
        let width = max(0, bounds.width - NotebookGutter.width)
        let plus = pointerPlus ?? .null
        for seam in seams where seam.bottom > seam.top {
            let strip = NSRect(x: 0, y: seam.top, width: width, height: seam.bottom - seam.top)
            // Cut round the +, never laid under it: two rects over one
            // point and AppKit picks, and the one it picks is not ours.
            for piece in CellSeams.cut(strip, around: plus) {
                addCursorRect(piece, cursor: .iBeamCursorForVerticalLayout)
            }
        }
        if let plus = pointerPlus { addCursorRect(plus, cursor: .pointingHand) }
    }

    override func cursorUpdate(with event: NSEvent) {
        guard let cursor = cursor(at: convert(event.locationInWindow, from: nil)) else {
            return super.cursorUpdate(with: event)
        }
        cursor.set()
    }

    override func mouseExited(with event: NSEvent) {
        hovered = nil
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
        // Read before the arming, which moves the mark to this seam: what
        // matters is whether there was a + under the pointer when it went
        // down.
        let drawn = marked
        onArm?(seam.offset)
        guard Self.pressesPlus(at: point, in: seam, drawnOn: drawn) else { return }
        let target = CellSeams.plusTarget(in: seam, leading: Self.plusLeading)
        CellTypeMenu.popUp(current: chosenType, at: NSPoint(x: 2, y: target.maxY),
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
