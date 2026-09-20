import CoreGraphics

/// The strips of the page the note's text keeps clear of.
///
/// Everything on the layer reserves one, ink as much as a picture (Sean,
/// 2026-09-19: "drawing should be allowed in either wysiwyg and markdown
/// mode… it always ends up being a cell as tall as the drawing"). Objects
/// that overlap, or that all but touch, reserve ONE band between them, so a
/// sketch of forty strokes opens one gap in the text rather than forty — and
/// the gap is as tall as the sketch, not as tall as its tallest stroke.
enum InkBands {
    /// Two objects nearer than this, top to bottom, are one drawing.
    static let gap: CGFloat = 10

    /// The bands for `items`, in the pane's coordinates, top to bottom.
    /// An empty pane (the first layout pass, before the window has a size)
    /// reserves nothing — a band measured against a 0×0 pane is nonsense.
    static func bands(for items: [CanvasItem], in size: CGSize) -> [CGRect] {
        guard size.width > 40, size.height > 40 else { return [] }
        let boxes = items
            .map { $0.bounds(in: size) }
            .filter { $0.height.isFinite && $0.width.isFinite && $0.height > 0 }
            .sorted { $0.minY < $1.minY }

        var bands: [CGRect] = []
        for box in boxes {
            if let last = bands.last, box.minY <= last.maxY + gap {
                bands[bands.count - 1] = last.union(box)
            } else {
                bands.append(box)
            }
        }
        return bands
    }

    /// A band, as a CELL of the notebook: a drawing is a cell in its own
    /// right, as tall as the drawing (Sean, 2026-09-19: "drawings from the
    /// pen tool or that are grabbed from the camera should go in a cell..
    /// the cell is the height of the drawn stuff"), so it gets a bracket
    /// beside it like every other cell.
    ///
    /// It is keyed by where it sits rather than by what is in it: a band is
    /// a group of objects, the group changes as things are drawn and moved,
    /// and the key is only used to tell one bracket from another while the
    /// page is up.
    struct Cell: Equatable {
        var key: String
        var top: CGFloat
        var bottom: CGFloat
        /// Drawn on the same line as the text cells around it.
        var depth: Int
    }

    /// The bands as cells, each at the depth of the text cell above it —
    /// so a drawing inside a section is bracketed inside that section.
    /// `cells` is the text's own cells: their tops, in the same coordinates
    /// the bands are in, and the depth each is drawn at.
    static func cells(for bands: [CGRect], beside cells: [(top: CGFloat, depth: Int)]) -> [Cell] {
        bands.filter { $0.height > 1 }.map { band in
            let above = cells.filter { $0.top <= band.minY + 1 }.max { $0.top < $1.top }
            let depth = above?.depth ?? cells.min { $0.top < $1.top }?.depth ?? 0
            return Cell(key: "ink:\(Int(band.minY.rounded()))", top: band.minY, bottom: band.maxY,
                        depth: depth)
        }
    }
}

/// Keeping the text still while something is dragged over it.
///
/// A band is re-measured on every frame of a drag, and the text is laid out
/// around it — so an object nudged one point across a cell boundary flips
/// the paragraph under it from above to below and back again, which reads
/// as jitter (Sean, 2026-09-19: "when moving contents, when close to an
/// edge things are jittery.. give some padding so moving things is smooth
/// before it jumps above and below the moving object").
///
/// So the layout keeps the band it already has until the object has moved
/// FURTHER than the padding. The object itself follows the pointer exactly
/// the whole time; only the hole in the text waits to be sure.
enum BandSettling {
    /// How far a band has to move before the text is laid out again.
    static let padding: CGFloat = 12

    /// The bands to use now, given the ones wanted and the ones the text is
    /// already laid out around.
    static func settled(_ wanted: [CGRect], previous: [CGRect],
                        padding: CGFloat = padding) -> [CGRect] {
        guard !previous.isEmpty else { return wanted }
        var free = previous
        return wanted.map { band in
            // The band this one is: the nearest one already in use, if it
            // is near enough to be the same band rather than another one.
            guard let index = free.indices.min(by: {
                abs(free[$0].minY - band.minY) < abs(free[$1].minY - band.minY)
            }) else { return band }
            let held = free[index]
            guard abs(held.minY - band.minY) <= padding, abs(held.height - band.height) <= padding
            else { return band }
            free.remove(at: index)
            return held
        }
    }
}

