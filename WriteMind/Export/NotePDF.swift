import CoreGraphics
import Foundation

/// The seam between "what is on the page" and "what the file says".
///
/// A caller hands over the pieces of a document — where each one sits, in
/// the document's own points with y running down, and how to paint it —
/// and gets back PDF bytes. `PagePlan` decides the breaks; this puts the
/// transform on the context so a piece can be drawn in the coordinates it
/// was measured in, whichever sheet it landed on.
///
/// The document is laid out at whatever width the editor's pane had and
/// then SHRUNK to the paper's width, rather than re-flowed at the paper's
/// width: the drawing's objects are placed as fractions of that pane, so
/// re-flowing the text would slide every line out from under the picture
/// it was put beside. What comes out is the pane, photographed onto paper.
enum NotePDF {
    /// One thing on the paper. `draw` is called with the context already in
    /// document coordinates — y down, origin at the document's top left —
    /// and with its state saved and restored round it.
    struct Piece {
        var frame: CGRect
        var draw: (CGContext) -> Void

        init(frame: CGRect, draw: @escaping (CGContext) -> Void) {
            self.frame = frame
            self.draw = draw
        }
    }

    static func data(_ pieces: [Piece], documentWidth: CGFloat,
                     paper: CGSize = PagePlan.paper, margin: CGFloat = PagePlan.margin) -> Data? {
        guard documentWidth > 0, paper.width > margin * 2, paper.height > margin * 2 else { return nil }
        let content = PagePlan.content(paper: paper, margin: margin)
        let fit = content.width / documentWidth
        let plan = PagePlan.pages(for: pieces.enumerated().map { PagePlan.Piece(id: $0.offset, frame: $0.element.frame) },
                                  pageHeight: content.height / fit)

        let file = NSMutableData()
        var box = CGRect(origin: .zero, size: paper)
        guard let consumer = CGDataConsumer(data: file),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { return nil }

        for page in plan {
            context.beginPDFPage(nil)
            let scale = fit * page.scale
            // A page that had to be shrunk is centred on the sheet rather
            // than left hanging off the left margin.
            let indent = max(0, (content.width - documentWidth * scale) / 2)
            context.saveGState()
            context.translateBy(x: margin + indent, y: paper.height - margin)
            // Down the page from the top margin, in document points.
            context.scaleBy(x: scale, y: -scale)
            context.translateBy(x: 0, y: -page.top)
            // Back into the order they were given in, so the drawing layer
            // is still over the text it was handed after.
            for id in page.pieces.sorted() where pieces.indices.contains(id) {
                context.saveGState()
                pieces[id].draw(context)
                context.restoreGState()
            }
            context.restoreGState()
            context.endPDFPage()
        }
        context.closePDF()
        return file as Data
    }
}
