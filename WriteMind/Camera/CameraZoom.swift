import CoreGraphics

/// Zooming the video pane into a box that was dragged on it (Sean,
/// 2026-09-19: "drag a square to resize camera"). The box is kept in PANE
/// fractions of the unzoomed picture, so it survives the pane being
/// resized, and everything else — what the capture button brings in, where
/// a section drawn on the zoomed picture really is — comes from these two
/// functions and their inverse.
enum CameraZoom {
    /// Nothing smaller than this can be zoomed into: a stray click is not a box.
    static let minimumSide: CGFloat = 0.04

    static func isUsable(_ box: CGRect) -> Bool {
        box.width >= minimumSide && box.height >= minimumSide
            && box.width <= 1 && box.height <= 1
    }

    /// The box in the pane's own points.
    static func rect(_ box: CGRect, in pane: CGSize) -> CGRect {
        CGRect(x: box.minX * pane.width, y: box.minY * pane.height,
               width: box.width * pane.width, height: box.height * pane.height)
    }

    /// How much the picture grows so the box fills the pane.
    static func scale(of box: CGRect, in pane: CGSize) -> CGFloat {
        let area = rect(box, in: pane)
        guard area.width > 1, area.height > 1, pane.width > 1, pane.height > 1 else { return 1 }
        return min(pane.width / area.width, pane.height / area.height)
    }

    /// Where the picture moves to, scaled about the pane's centre, so the
    /// box ends up in the middle.
    static func offset(of box: CGRect, in pane: CGSize) -> CGSize {
        let area = rect(box, in: pane)
        let factor = scale(of: box, in: pane)
        return CGSize(width: (pane.width / 2 - area.midX) * factor,
                      height: (pane.height / 2 - area.midY) * factor)
    }

    /// A point on the ZOOMED pane, where it is on the unzoomed picture.
    static func unzoomed(_ point: CGPoint, box: CGRect, in pane: CGSize) -> CGPoint {
        let area = rect(box, in: pane)
        let factor = scale(of: box, in: pane)
        guard factor > 0 else { return point }
        return CGPoint(x: area.midX + (point.x - pane.width / 2) / factor,
                       y: area.midY + (point.y - pane.height / 2) / factor)
    }

    /// The same for a box dragged on the zoomed picture.
    static func unzoomed(_ rect: CGRect, box: CGRect, in pane: CGSize) -> CGRect {
        let a = unzoomed(CGPoint(x: rect.minX, y: rect.minY), box: box, in: pane)
        let b = unzoomed(CGPoint(x: rect.maxX, y: rect.maxY), box: box, in: pane)
        return CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
    }

    /// The other way: a point on the UNZOOMED picture, where it is drawn on
    /// the zoomed pane. The exact inverse of `unzoomed`, and the direction
    /// needed to put a box round something whose place is known on the real
    /// picture — the whole picture itself, say.
    static func zoomed(_ point: CGPoint, box: CGRect, in pane: CGSize) -> CGPoint {
        let area = rect(box, in: pane)
        let factor = scale(of: box, in: pane)
        return CGPoint(x: pane.width / 2 + (point.x - area.midX) * factor,
                       y: pane.height / 2 + (point.y - area.midY) * factor)
    }

    /// The same for a rectangle.
    static func zoomed(_ rect: CGRect, box: CGRect, in pane: CGSize) -> CGRect {
        let a = zoomed(CGPoint(x: rect.minX, y: rect.minY), box: box, in: pane)
        let b = zoomed(CGPoint(x: rect.maxX, y: rect.maxY), box: box, in: pane)
        return CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
    }

    /// A new box dragged while already zoomed in, as a fraction of the
    /// WHOLE picture — so zooming twice keeps working.
    static func compose(_ dragged: CGRect, over current: CGRect?, in pane: CGSize) -> CGRect? {
        guard pane.width > 1, pane.height > 1 else { return nil }
        let inPane = current.map { unzoomed(dragged, box: $0, in: pane) } ?? dragged
        let box = CGRect(x: inPane.minX / pane.width, y: inPane.minY / pane.height,
                         width: inPane.width / pane.width, height: inPane.height / pane.height)
        let clamped = box.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !clamped.isNull, isUsable(clamped) else { return nil }
        return clamped
    }
}
