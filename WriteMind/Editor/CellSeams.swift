import CoreGraphics
import Foundation

/// The spaces between the cells: where the horizontal cursor lives and
/// where a new cell is born.
///
/// Sean, 2026-09-20: "the cursor should be horizontal any space between the
/// two cells… when clicking in between, the horizontal line appears and that
/// is where the cursor is.. typing from here would insert a new cell below
/// that line". ANY space between them — with N cells the page is N + 1
/// seams: one from the top of the page down to the first cell, one between
/// each pair, and one from the last cell to the bottom. What is not a seam
/// is a cell, and there is nothing else on the page.
///
/// That is what replaces the three-point strip round the middle of a gap
/// (`CellInsertions.Gap`) the pointer used to flip in and out of across one
/// space (Sean, 2026-09-20: "cursor is super buggy").
///
/// Pure geometry, so the two panes cannot drift apart: the markdown pane
/// measures its cells off the layout manager and the rendered page off
/// `PreviewLayout.positions`, and neither of those is in this file. Both
/// hand in boxes and get back the same seams.
enum CellSeams {
    struct Seam: Equatable {
        /// Document points, the coordinates the cells were handed in.
        var top: CGFloat
        var bottom: CGFloat
        /// The character offset a new cell is opened at: the next cell's
        /// range.location, or the note's length under the last cell.
        var offset: Int
        /// Where the bar that IS the cursor is drawn — which is NOT the
        /// middle of the seam, because two of the seams on every page are
        /// as tall as the empty page round the note (Sean, 2026-09-20:
        /// "when i select somewhere below the cell, the bar should go
        /// immediately after the last cell, not the random spot below
        /// it's currently at"). The hit area is the whole seam and the
        /// bar is against the cell it belongs to; worked out once, here,
        /// so the two panes draw it in the same place.
        var line: CGFloat
        func contains(_ y: CGFloat) -> Bool { y >= top && y <= bottom }
    }

    /// A cell as the panes measure it: where its block starts and ends down
    /// the page, and the character offset the block begins at.
    typealias Box = (top: CGFloat, bottom: CGFloat, offset: Int)

    /// The seams of a page.
    ///
    /// `cells` are the blocks' boxes. They are sorted here rather than
    /// trusted, and a box handed in upside down is turned the right way up,
    /// because the two panes measure them in quite different ways and a
    /// seam folded inside out would be a hole in the page. `pageTop` and
    /// `pageBottom` are the ends of the scrollable page; `noteLength` is
    /// what the seam under the last cell opens at.
    ///
    /// A seam thinner than `minimum` is widened to it about its middle: the
    /// strip has to be hittable, so the neighbouring cells' edges give way.
    /// At the two ends of the page it is the cell that gives way alone and
    /// the page's edge that holds, because the first seam starts at the top
    /// of the page and the last runs to the bottom of it whatever the note
    /// does in between.
    static func seams(cells: [Box], pageTop: CGFloat, pageBottom: CGFloat, noteLength: Int,
                      minimum: CGFloat = MarkdownPreview.gapHeight) -> [Seam] {
        // Spelled out rather than chained: one map-and-sort over labelled
        // tuples put the type checker past its budget and the file would
        // not compile at all.
        var boxes: [Box] = cells.map { cell in
            Box(top: min(cell.top, cell.bottom), bottom: max(cell.top, cell.bottom), offset: cell.offset)
        }
        boxes.sort { left, right in
            left.top == right.top ? left.bottom < right.bottom : left.top < right.top
        }
        // The page is at least as tall as the note laid out on it: a cell
        // past the end of what the caller called the page would otherwise
        // turn the tail seam inside out.
        let head = min(pageTop, boxes.first?.top ?? pageTop)
        let foot = max(pageBottom, boxes.last?.bottom ?? pageBottom, head)

        guard !boxes.isEmpty else {
            // Nothing written yet: the whole page is one seam, and what is
            // typed in it goes at the end of the note — offset 0 when the
            // note is empty, which is the usual way to meet this.
            // The bar goes at the top, where the first thing typed will
            // appear: there is no cell for it to sit against.
            return [Seam(top: head, bottom: foot, offset: noteLength, line: head + minimum / 2)]
        }

        var seams: [Seam] = []
        // How far down the page the cells have reached. Cells that overlap
        // (never, but be safe) leave a seam of no height on the edge they
        // share rather than one that runs backwards.
        var reached = head
        for box in boxes {
            seams.append(fitted(top: reached, bottom: max(reached, box.top), offset: box.offset,
                                minimum: minimum, holding: seams.isEmpty ? .top : .middle))
            reached = max(reached, box.bottom)
        }
        seams.append(fitted(top: reached, bottom: max(reached, foot), offset: noteLength,
                            minimum: minimum, holding: .bottom))
        return seams
    }

    /// The seam a point is in. Containment, not "the nearest one within
    /// reach": every point between two cells is in the seam there, and a
    /// point on a cell is in no seam at all.
    static func seam(at y: CGFloat, in seams: [Seam]) -> Seam? {
        // Widening can make two seams overlap when the cell between them is
        // shorter than the minimum. The upper one answers; either is a fair
        // reading of a point that is inside both.
        seams.first { $0.contains(y) }
    }

    /// The seam an empty selection is sitting IN, as the offset a cell
    /// would be opened at — nil when the caret is in a cell and the
    /// ordinary caret belongs there.
    ///
    /// Arming is what the caret's POSITION means, not a mode a click turns
    /// on (Sean, 2026-09-20: "the mouse cursor and text cursor should both
    /// become horizontal between cells"). So ↓ out of the bottom of a cell
    /// lands on the bar, ↓ again enters the next cell, and ⌃D leaves the
    /// bar between the two halves it just made. Without this, arrowing onto
    /// the blank line between two cells and typing merged them: the
    /// character went in on a line of its own and the parser joined all
    /// three into one paragraph.
    ///
    /// `current` is what is armed already, and it stands while the caret is
    /// still where the arming put it. That covers the two places the offset
    /// alone cannot speak for: offset 0 is both the seam above the first
    /// cell and the first character of it, and the note's length is both
    /// the tail seam and the end of the last cell. It also covers an
    /// ordinary click in a seam, which leaves the caret at the first
    /// character of the cell BELOW.
    static func arm(caret: NSRange, in markdown: String, current: Int?) -> Int? {
        // A selection of anything at all is not a caret in a seam — ⌘A and
        // a bracket click both used to leave the bar armed behind them,
        // and the next character typed threw the selection away.
        guard caret.length == 0 else { return nil }
        let offset = caret.location
        if let current, current == offset { return current }
        let ns = markdown as NSString
        guard offset > 0, offset < ns.length else { return nil }
        // Cheap first. This runs on every caret move, which means on every
        // keystroke, and parsing the whole note for each of them would sit
        // on the typing. Only a caret on a blank line can be in a seam.
        let line = ns.lineRange(for: NSRange(location: offset, length: 0))
        guard offset < NSMaxRange(line),
              ns.substring(with: line).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        // And only the first and last blank line of a run separate two
        // cells; the ones between them are a `.blank` cell — the note's own
        // content, where an ordinary caret belongs.
        guard MarkdownSourceStyle.structuralLines(in: markdown)
            .contains(where: { NSLocationInRange(offset, $0) }) else { return nil }
        let blocks = MarkdownParser.positioned(from: markdown)
        // And a blank line INSIDE a cell is not a space between two.
        // `structuralLines` reads the note line by line and a fenced block
        // is the one cell that can hold an empty line of its own, so an
        // empty code cell — the very thing the + now opens — armed a bar
        // over the caret sitting between its fences.
        guard !blocks.contains(where: { $0.range.location < offset && offset < NSMaxRange($0.range) })
        else { return nil }
        return blocks.first { $0.range.location >= offset }?.range.location ?? ns.length
    }

    /// A stretch of the page as the POINTER reads it: a seam, where the
    /// I-beam lies on its side, or everything else, where it stands up.
    struct Band: Equatable {
        var top: CGFloat
        var bottom: CGFloat
        var horizontal: Bool
    }

    /// The page cut into those stretches, top to bottom, touching and
    /// never overlapping.
    ///
    /// For the markdown pane's text view, which hands them to AppKit as
    /// its cursor rects. It cannot hand over "the I-beam everywhere
    /// except the seams" in one rect, and its own I-beam over the whole
    /// of itself with the seam layer's rects laid on top is two rects
    /// over one point — AppKit picks between them, and it picked the
    /// I-beam (Sean, 2026-09-20: "the mouse cursor should reliably be
    /// horizontal between the cells"). Cut this way, nothing the text
    /// view says claims a seam in the first place.
    static func bands(seams: [Seam], pageTop: CGFloat, pageBottom: CGFloat) -> [Band] {
        guard pageBottom > pageTop else { return [] }
        var out: [Band] = []
        // How far down the page the bands have reached. Widening can
        // leave two seams overlapping, and a band that ran backwards is
        // a cursor rect AppKit throws away — with it the I-beam is back.
        var reached = pageTop
        for seam in seams.sorted(by: { $0.top < $1.top }) {
            let top = min(max(seam.top, reached), pageBottom)
            let bottom = min(max(seam.bottom, top), pageBottom)
            if top > reached { out.append(Band(top: reached, bottom: top, horizontal: false)) }
            if bottom > top { out.append(Band(top: top, bottom: bottom, horizontal: true)) }
            reached = max(reached, bottom)
        }
        if reached < pageBottom { out.append(Band(top: reached, bottom: pageBottom, horizontal: false)) }
        return out
    }

    /// Which edge of a seam stays put when it is too thin to be hit.
    private enum Edge { case top, middle, bottom }

    private static func fitted(top: CGFloat, bottom: CGFloat, offset: Int,
                               minimum: CGFloat, holding edge: Edge) -> Seam {
        // Where the bar goes, before any widening: half a gap under the
        // cell above it, or — for the seam at the top of the page, which
        // has no cell above it — half a gap above the cell below. On the
        // eight points between two ordinary cells the two readings meet
        // in the middle, which is where the bar has always been drawn;
        // on the tall seams at the two ends of the page they are the
        // difference between a bar against the note and a bar adrift in
        // the empty page.
        let line: CGFloat
        switch edge {
        case .top: line = bottom - minimum / 2
        case .middle, .bottom: line = top + minimum / 2
        }
        guard bottom - top < minimum else {
            return Seam(top: top, bottom: bottom, offset: offset, line: line)
        }
        // Too thin to hit: the seam is widened and the bar goes back to
        // the middle of it, because that is where the eye already put it
        // — between the two cells that are nearly touching.
        switch edge {
        case .top: return Seam(top: top, bottom: top + minimum, offset: offset, line: top + minimum / 2)
        case .bottom: return Seam(top: bottom - minimum, bottom: bottom, offset: offset, line: bottom - minimum / 2)
        case .middle:
            let middle = (top + bottom) / 2
            return Seam(top: middle - minimum / 2, bottom: middle + minimum / 2, offset: offset, line: middle)
        }
    }
}
