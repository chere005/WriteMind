import AppKit
import XCTest
@testable import WriteMind

/// One description of a text box, used by the card and by the field over it
/// (Sean, 2026-09-19: "text boxes look like shit… just start over and do
/// better").
final class TextBoxStyleTests: XCTestCase {
    func testAnEmptyBoxIsStillALineTall() {
        // It used to measure an empty string as nothing and collapse to a
        // sliver with a caret hanging out of it.
        let height = TextBoxStyle.height(for: "", width: 200)
        XCTAssertGreaterThan(height, TextBoxStyle.padding.height * 2 + 10)
        XCTAssertLessThan(height, 44)
    }

    func testTheBoxGrowsWithTheWords() {
        let one = TextBoxStyle.height(for: "One line", width: 200)
        let many = TextBoxStyle.height(for: String(repeating: "words and more words ", count: 8), width: 200)
        XCTAssertGreaterThan(many, one * 2)
    }

    func testTheHeightIsThePaddingPlusTheText() {
        let width: CGFloat = 200
        let text = "Two words"
        let room = width - TextBoxStyle.padding.width * 2
        let measured = (text as NSString).boundingRect(
            with: CGSize(width: room, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: TextBoxStyle.font]).height
        XCTAssertEqual(TextBoxStyle.height(for: text, width: width),
                       ceil(measured) + TextBoxStyle.padding.height * 2, accuracy: 0.5)
    }

    func testAnUnmeasurablyNarrowBoxFallsBack() {
        XCTAssertEqual(TextBoxStyle.aspect(for: "anything", boxWidth: 5), TextBoxStyle.fallbackAspect)
    }

    func testTheAspectAgreesWithTheHeight() {
        let width: CGFloat = 240
        XCTAssertEqual(TextBoxStyle.aspect(for: "Some words here", boxWidth: width),
                       Double(TextBoxStyle.height(for: "Some words here", width: width) / width),
                       accuracy: 0.001)
    }

    // MARK: - Ink you can read

    func testDarkInkOnALightCardIsLeftAlone() {
        XCTAssertEqual(TextBoxStyle.readableInk("#1A1A1A", on: "#FFF3B0"), "#1A1A1A")
    }

    func testInkThatWouldVanishIsReplaced() {
        // Black on navy, and white on pale yellow: both unreadable, both
        // turned round (Sean: "it should always be visible").
        XCTAssertEqual(TextBoxStyle.readableInk("#000000", on: "#101A44"), "#FFFFFF")
        XCTAssertEqual(TextBoxStyle.readableInk("#FFFFFF", on: "#FFF3B0"), "#000000")
    }

    func testWithNoCardThePenIsTrusted() {
        // No fill means the note's own paper, which the pen was picked on.
        XCTAssertEqual(TextBoxStyle.readableInk("#3355FF", on: nil), "#3355FF")
    }

    func testTheContrastMathsIsTheStandardOne() {
        XCTAssertEqual(TextBoxStyle.ratio(.black, .white), 21, accuracy: 0.01)
        XCTAssertEqual(TextBoxStyle.ratio(.white, .white), 1, accuracy: 0.01)
        XCTAssertEqual(TextBoxStyle.luminance(.white), 1, accuracy: 0.001)
        XCTAssertEqual(TextBoxStyle.luminance(.black), 0, accuracy: 0.001)
    }

    func testAColourComesBackOutOfItsHex() {
        let colour = try? XCTUnwrap(NSColor(hex: "#3366CC"))
        XCTAssertEqual(colour?.usingColorSpace(.sRGB)?.redComponent ?? 0, 0.2, accuracy: 0.01)
        XCTAssertEqual(colour?.usingColorSpace(.sRGB)?.blueComponent ?? 0, 0.8, accuracy: 0.01)
        XCTAssertNil(NSColor(hex: "not a colour"))
    }
}
