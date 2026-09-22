import AppKit
import XCTest
@testable import WriteMind

/// The format popup under the save panel (Sean, 2026-09-21: "export is
/// either as pdf or as project (which is just the directory structure)..
/// output format is chosen in the save menu").
final class ExportFormatTests: XCTestCase {
    @MainActor
    func testThePopupOffersBothFormatsByTheirOwnNames() {
        let chooser = ExportFormatChooser()
        XCTAssertEqual(chooser.formats.map(\.title), ["PDF", "Project"])
        XCTAssertEqual(chooser.format, .pdf, "the one somebody means when they press ⌘E")
    }

    /// Nothing is offered that cannot be made: with no note open there is
    /// no page to print, and the popup says so by having one entry.
    @MainActor
    func testWithNoNoteOpenOnlyTheProjectIsOffered() {
        let chooser = ExportFormatChooser()
        chooser.setFormats([.project])
        XCTAssertEqual(chooser.formats.map(\.title), ["Project"])
        XCTAssertEqual(chooser.format, .project, "and it is what an export would write")
        // An empty list is not an answer; the old one stands.
        chooser.setFormats([])
        XCTAssertEqual(chooser.formats, [.project])
    }

    @MainActor
    func testChangingTheFormatIsAnnounced() {
        let chooser = ExportFormatChooser()
        var heard: [ExportMenu.Format] = []
        chooser.onChange = { heard.append($0) }
        chooser.onChange?(chooser.format)
        XCTAssertEqual(heard, [.pdf])
    }

    func testEachFormatNamesTheExtensionItWrites() {
        XCTAssertEqual(ExportMenu.Format.pdf.extensionName, "pdf")
        XCTAssertEqual(ExportMenu.Format.project.extensionName, Project.fileExtension)
        XCTAssertEqual(ExportMenu.Format.allCases.count, 2)
    }

    /// An exported project is the FOLDERS and nothing else — it names no
    /// note, because the notes are already files and a project is only
    /// the shape they sit in.
    func testAnExportedProjectIsJustTheDirectoryStructure() throws {
        let dir = FileManager.default.temporaryDirectory
            .appending(path: "WriteMindExport-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let file = dir.appending(path: "Out.\(Project.fileExtension)")
        try Project(folders: ["/a/notes", "/b/more"], excluded: ["/a/notes/old"]).save(to: file)
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertTrue(text.contains("/a/notes"), text)
        XCTAssertTrue(text.contains("/a/notes/old"), text)
        XCTAssertFalse(text.contains(".md"), "no note is written into it")
        XCTAssertEqual(try Project.load(from: file).folders, ["/a/notes", "/b/more"])
    }
}
