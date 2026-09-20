import AppKit
import XCTest
@testable import WriteMind

/// A table drawn by hand is read as a markdown table (the to-do list:
/// "not read: tables drawn by hand").
final class DrawnTableTests: XCTestCase {
    /// An ink mask with rules at these rows and columns, `thick` pixels
    /// thick, spanning the whole grid.
    private func ruled(width: Int, height: Int, rows: [Int], columns: [Int],
                       thick: Int = 3, span: ClosedRange<Int>? = nil) -> [Bool] {
        var ink = [Bool](repeating: false, count: width * height)
        let across = span ?? 0...(width - 1)
        for row in rows {
            for y in row..<(row + thick) where y < height {
                for x in across where x < width { ink[y * width + x] = true }
            }
        }
        for column in columns {
            for x in column..<(column + thick) where x < width {
                for y in (rows.first ?? 0)...(rows.last ?? height - 1) where y < height {
                    ink[y * width + x] = true
                }
            }
        }
        return ink
    }

    private func word(_ text: String, x: CGFloat, y: CGFloat) -> HandwritingMarks.Word {
        HandwritingMarks.Word(text: text, box: CGRect(x: x - 10, y: y - 6, width: 20, height: 12))
    }

    // MARK: - The rules

    func testAPageOfRulesFindsTheGrid() {
        let ink = ruled(width: 200, height: 120, rows: [10, 50, 90], columns: [10, 100, 190])
        let grid = try? XCTUnwrap(DrawnTable.grid(ink: ink, width: 200, height: 120))
        XCTAssertEqual(grid?.rowCount, 2)
        XCTAssertEqual(grid?.columnCount, 2)
    }

    func testAWobblyLineIsOneRuleNotThree() {
        // Three pixel rows of one drawn line must not read as three rules.
        let ink = ruled(width: 200, height: 120, rows: [10, 50, 90], columns: [10, 100, 190], thick: 4)
        XCTAssertEqual(DrawnTable.grid(ink: ink, width: 200, height: 120)?.rows.count, 3)
    }

    func testAPageOfWritingIsNotATable() {
        // Short runs of ink all over: no line crosses the page.
        var ink = [Bool](repeating: false, count: 200 * 120)
        for y in stride(from: 10, to: 110, by: 20) {
            for x in stride(from: 10, to: 180, by: 3) {
                for dx in 0..<2 where x + dx < 200 { ink[y * 200 + x + dx] = true }
            }
        }
        XCTAssertNil(DrawnTable.grid(ink: ink, width: 200, height: 120))
    }

    func testOneLineUnderAWordIsNotATable() {
        let ink = ruled(width: 200, height: 120, rows: [60], columns: [])
        XCTAssertNil(DrawnTable.grid(ink: ink, width: 200, height: 120))
    }

    func testAnEmptyPageHoldsNoGrid() {
        XCTAssertNil(DrawnTable.grid(ink: [Bool](repeating: false, count: 200 * 120),
                                     width: 200, height: 120))
    }

    // MARK: - Reading it

    func testTheWordsAreDealtIntoTheirCells() {
        let ink = ruled(width: 200, height: 120, rows: [10, 50, 90], columns: [10, 100, 190])
        let grid = try! XCTUnwrap(DrawnTable.grid(ink: ink, width: 200, height: 120))
        let markdown = DrawnTable.markdown(grid, words: [
            word("Name", x: 50, y: 30), word("Age", x: 140, y: 30),
            word("Ada", x: 50, y: 70), word("36", x: 140, y: 70),
        ])
        XCTAssertEqual(markdown, "| Name | Age |\n| --- | --- |\n| Ada | 36 |")
    }

    func testTheFirstRowIsTheHeader() {
        let ink = ruled(width: 200, height: 160, rows: [10, 50, 90, 130], columns: [10, 100, 190])
        let grid = try! XCTUnwrap(DrawnTable.grid(ink: ink, width: 200, height: 160))
        let markdown = try! XCTUnwrap(DrawnTable.markdown(grid, words: [
            word("A", x: 50, y: 30), word("B", x: 140, y: 30),
            word("1", x: 50, y: 70), word("2", x: 140, y: 70),
            word("3", x: 50, y: 110), word("4", x: 140, y: 110),
        ]))
        XCTAssertEqual(markdown.components(separatedBy: "\n").count, 4, "header, rule, two rows")
        XCTAssertTrue(markdown.hasPrefix("| A | B |"))
    }

    func testSeveralWordsInOneCellStayInReadingOrder() {
        let ink = ruled(width: 200, height: 120, rows: [10, 50, 90], columns: [10, 100, 190])
        let grid = try! XCTUnwrap(DrawnTable.grid(ink: ink, width: 200, height: 120))
        let markdown = try! XCTUnwrap(DrawnTable.markdown(grid, words: [
            word("Ada", x: 35, y: 70), word("Lovelace", x: 70, y: 70), word("x", x: 140, y: 30),
        ]))
        XCTAssertTrue(markdown.contains("| Ada Lovelace |"), "got \(markdown)")
    }

    func testAnEmptyGridReadsAsNothing() {
        let ink = ruled(width: 200, height: 120, rows: [10, 50, 90], columns: [10, 100, 190])
        let grid = try! XCTUnwrap(DrawnTable.grid(ink: ink, width: 200, height: 120))
        XCTAssertNil(DrawnTable.markdown(grid, words: []), "lines with no words are not a table")
    }

    func testTheGridKnowsWhichWordsItHolds() {
        let ink = ruled(width: 200, height: 120, rows: [10, 50, 90], columns: [10, 100, 190])
        let grid = try! XCTUnwrap(DrawnTable.grid(ink: ink, width: 200, height: 120))
        XCTAssertTrue(DrawnTable.holds(grid, word: CGRect(x: 40, y: 60, width: 20, height: 12)))
        XCTAssertFalse(DrawnTable.holds(grid, word: CGRect(x: 40, y: 105, width: 20, height: 12)),
                       "under the table, in the prose below it")
    }
}
