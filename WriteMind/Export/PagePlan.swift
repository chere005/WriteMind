import CoreGraphics

/// Where a note is cut into sheets of paper.
///
/// A note is a column of cells with the drawing's objects in the gaps
/// between them; paper is a fixed height. This is the one function that
/// decides which of them share a sheet, and it is written over MEASURED
/// HEIGHTS and nothing else — no views, no window, no context — so the
/// decision can be read, argued with and tested on its own.
///
/// Two rules, both Sean's (2026-09-19, "export as pdf"):
///
/// - **A break goes BETWEEN cells, never through one**, so no line of text
///   is ever cut in half. A cell is atomic here; so is a drawing.
/// - **Anything taller than the paper gets a sheet to itself**, shrunk
///   until it fits, because the alternative is losing the bottom of it.
///
/// Pieces that OVERLAP cannot be parted — a picture with a sketch drawn
/// over it is one thing — so they are welded into one unit first. A gap
/// between two pieces, however small, is a place a break may go.
enum PagePlan {
    /// US Letter, portrait, with three quarters of an inch of paper round
    /// the edge.
    static let paper = CGSize(width: 612, height: 792)
    static let margin: CGFloat = 54

    /// What is left of a sheet once the margin has had its say.
    static func content(paper: CGSize = PagePlan.paper, margin: CGFloat = PagePlan.margin) -> CGSize {
        CGSize(width: max(1, paper.width - margin * 2), height: max(1, paper.height - margin * 2))
    }

    /// One thing that must not be broken: a cell, or a drawing. `top` and
    /// `bottom` are in the document's own points, measured down from its
    /// first line.
    struct Piece: Equatable {
        var id: Int
        var top: CGFloat
        var bottom: CGFloat

        init(id: Int, top: CGFloat, bottom: CGFloat) {
            self.id = id
            self.top = top
            self.bottom = bottom
        }

        init(id: Int, frame: CGRect) {
            self.init(id: id, top: frame.minY, bottom: frame.maxY)
        }

        var height: CGFloat { max(0, bottom - top) }
    }

    /// One sheet: where in the document it starts, what it had to be shrunk
    /// by (1 unless a single piece was too tall for a whole page), and which
    /// pieces go on it, in the order they were handed over.
    struct Page: Equatable {
        var top: CGFloat
        var scale: CGFloat
        var pieces: [Int]
    }

    /// The sheets, in order. `pageHeight` is the room on one of them, in
    /// the document's points — the caller has already worked out what the
    /// whole document is shrunk by to fit the paper's width.
    ///
    /// Always at least one page: a note with nothing in it is a blank
    /// sheet, not a file with no pages in it (which is not a PDF at all).
    static func pages(for pieces: [Piece], pageHeight: CGFloat) -> [Page] {
        let ordered = pieces.filter { $0.height > 0 }.sorted { $0.top < $1.top }
        guard !ordered.isEmpty, pageHeight > 0 else { return [Page(top: 0, scale: 1, pieces: [])] }

        var units: [(top: CGFloat, bottom: CGFloat, ids: [Int])] = []
        for piece in ordered {
            if var last = units.last, piece.top < last.bottom {
                last.bottom = max(last.bottom, piece.bottom)
                last.ids.append(piece.id)
                units[units.count - 1] = last
            } else {
                units.append((piece.top, piece.bottom, [piece.id]))
            }
        }

        var pages: [Page] = []
        var open: Page?
        for unit in units {
            let height = unit.bottom - unit.top
            // Too tall for any sheet: its own, shrunk to fit. Nothing else
            // goes on it — a half-size diagram with a paragraph beside it
            // reads as a mistake.
            if height > pageHeight {
                if let page = open { pages.append(page) }
                open = nil
                pages.append(Page(top: unit.top, scale: pageHeight / height, pieces: unit.ids))
                continue
            }
            // A sheet starts at the top of the first piece on it, so the
            // page break itself never leaves a band of blank paper.
            if var page = open, unit.bottom - page.top <= pageHeight {
                page.pieces.append(contentsOf: unit.ids)
                open = page
            } else {
                if let page = open { pages.append(page) }
                open = Page(top: unit.top, scale: 1, pieces: unit.ids)
            }
        }
        if let page = open { pages.append(page) }
        return pages
    }
}
