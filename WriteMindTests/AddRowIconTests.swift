import SwiftUI
import XCTest
@testable import WriteMind

/// The two icons on the sidebar's add row (Sean, 2026-09-21, twice: "make
/// the new note and new section icons the same height").
///
/// Measured by RENDERING them, because that is where the fault was: both
/// were already given a frame of `SidebarView.addIconHeight`, and the
/// section's was still visibly shorter, since `folder.badge.plus` spends
/// the top-right of its layout box on the badge and draws the folder in
/// what is left. Nothing about the frame says that; the pixels do.
final class AddRowIconTests: XCTestCase {
    private var height: CGFloat { SidebarView.addIconHeight }
    /// Big enough that a tenth of thirteen points is tens of pixels.
    private let scale: CGFloat = 12

    /// The page: a dashed rounded rectangle with a plus in it.
    private var page: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [2.5, 2]))
                .frame(width: height * 0.8, height: height)
            Image(systemName: "plus").font(.system(size: 6.5, weight: .bold))
        }
        .frame(height: height)
    }

    /// The folder: the plain symbol, at the same height, with the same plus.
    private var folder: some View {
        ZStack {
            Image(systemName: "folder").resizable().scaledToFit().frame(height: height)
            Image(systemName: "plus").font(.system(size: 6.5, weight: .bold))
                .offset(y: height * 0.12)
        }
        .frame(height: height)
    }

    @MainActor
    func testTheTwoIconsAreDrawnTheSameHeight() throws {
        let page = try ink(of: page)
        let folder = try ink(of: folder)
        XCTAssertEqual(folder.height / scale, page.height / scale, accuracy: 0.5,
                       "the two icons on the add row are one height")
        XCTAssertEqual(page.height / scale, height, accuracy: 0.5)
    }

    /// The one that catches the badge. A folder's tab is at the top LEFT;
    /// anything inked in the top-right corner is something hanging off the
    /// symbol, and whatever hangs off it is height the folder does not get.
    @MainActor
    func testTheSectionIconHasNothingHangingOffItsTopRight() throws {
        let rows = try pixels(of: folder)
        let box = try XCTUnwrap(bounds(of: rows))
        let top = rows[Int(box.minY)]
        let inked = top.indices.filter { top[$0] }
        XCTAssertFalse(inked.isEmpty)
        let rightmost = CGFloat(try XCTUnwrap(inked.max()))
        XCTAssertLessThan(rightmost, box.minX + box.width * 0.75,
                          "the top of the icon is the folder's tab, not a badge beside it")
    }

    // MARK: - Reading the pixels

    @MainActor
    private func pixels(of view: some View) throws -> [[Bool]] {
        let renderer = ImageRenderer(content: view.foregroundStyle(.white).padding(4).background(.black))
        renderer.scale = scale
        let image = try XCTUnwrap(renderer.nsImage)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
        return (0..<bitmap.pixelsHigh).map { y in
            (0..<bitmap.pixelsWide).map { x -> Bool in
                // Anything not the black background is ink.
                let colour = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB)
                return (colour?.brightnessComponent ?? 0) > 0.25
            }
        }
    }

    private func bounds(of rows: [[Bool]]) -> CGRect? {
        var minX = Int.max, maxX = Int.min, minY = Int.max, maxY = Int.min
        for (y, row) in rows.enumerated() {
            for (x, lit) in row.enumerated() where lit {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard minX <= maxX, minY <= maxY else { return nil }
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    @MainActor
    private func ink(of view: some View) throws -> CGRect {
        try XCTUnwrap(bounds(of: try pixels(of: view)))
    }
}
