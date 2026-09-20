import SwiftUI
import XCTest
@testable import WriteMind

final class ColorHexTests: XCTestCase {
    func testRoundTrip() {
        XCTAssertEqual(Color(hex: "#2D7DD2")?.hexString, "#2D7DD2")
        XCTAssertEqual(Color(hex: "f2542d")?.hexString, "#F2542D")
        XCTAssertEqual(Color(hex: "#2D7DD280")?.hexString, "#2D7DD2")
    }

    func testGarbageIsNil() {
        XCTAssertNil(Color(hex: "#12345"))
        XCTAssertNil(Color(hex: "zzzzzz"))
        XCTAssertNil(Color(hex: ""))
    }
}
