import XCTest
@testable import WriteMind

final class ProjectTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindProject-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    func testAProjectRoundTripsThroughItsFile() throws {
        let project = Project(folders: ["/a/notes", "/b/more notes"])
        let file = dir.appending(path: "Test.\(Project.fileExtension)")
        try project.save(to: file)
        XCTAssertEqual(try Project.load(from: file), project)
        XCTAssertEqual(project.folderURLs.map(\.lastPathComponent), ["notes", "more notes"])
    }

    func testHiddenFoldersRoundTripAndAnOlderFileStillOpens() throws {
        let project = Project(folders: ["/a/notes"], excluded: ["/a/notes/old"])
        let file = dir.appending(path: "Hidden.\(Project.fileExtension)")
        try project.save(to: file)
        XCTAssertEqual(try Project.load(from: file), project)
        XCTAssertEqual(project.excludedURLs.map(\.lastPathComponent), ["old"])

        let older = Data("{\"version\":1,\"folders\":[\"/a\"]}".utf8)
        let loaded = try JSONDecoder().decode(Project.self, from: older)
        XCTAssertEqual(loaded.folders, ["/a"])
        XCTAssertTrue(loaded.excluded.isEmpty)

        let olderSession = Data("{\"folders\":[\"/a\"],\"openNotePaths\":[],\"unsavedBuffers\":{}}".utf8)
        XCTAssertTrue(try JSONDecoder().decode(ProjectSession.self, from: olderSession).excluded.isEmpty)
    }

    func testAHiddenFolderStaysOnDiskAndOutOfTheTree() throws {
        let keep = dir.appending(path: "Keep"), hide = dir.appending(path: "Hide")
        try FileManager.default.createDirectory(at: keep, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: hide, withIntermediateDirectories: true)
        try Data("# k".utf8).write(to: keep.appending(path: "k.md"))
        try Data("# h".utf8).write(to: hide.appending(path: "h.md"))

        let everything = NoteTree.read(directory: dir, root: dir, order: NoteOrder.load(in: dir))
        XCTAssertEqual(everything.sections.map(\.name).sorted(), ["Hide", "Keep"])
        let without = NoteTree.read(directory: dir, root: dir, order: NoteOrder.load(in: dir),
                                    excluding: [hide.standardizedFileURL.path])
        XCTAssertEqual(without.sections.map(\.name), ["Keep"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: hide.appending(path: "h.md").path), "still on disk")
    }

    func testTheSavedFileIsReadableJSON() throws {
        let file = dir.appending(path: "Test.\(Project.fileExtension)")
        try Project(folders: ["/a"]).save(to: file)
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertTrue(text.contains("\"folders\""), text)
        XCTAssertTrue(text.contains("\"/a\""), text)
    }

    func testSessionsForDifferentProjectsDoNotShareAFile() {
        let one = ProjectSession.url(forProjectAt: "/Users/x/A.writemind-project")
        let two = ProjectSession.url(forProjectAt: "/Users/y/A.writemind-project")
        XCTAssertNotNil(one)
        XCTAssertNotEqual(one, two, "same file name in two places must not collide")
        XCTAssertEqual(ProjectSession.url(forProjectAt: nil)?.lastPathComponent, "default.json")
    }

    func testASessionFileNameHasNoPathSeparators() throws {
        let url = try XCTUnwrap(ProjectSession.url(forProjectAt: "/deep/path/My Notes.writemind-project"))
        XCTAssertFalse(url.lastPathComponent.contains("/"))
        XCTAssertEqual(url.pathExtension, "json")
    }

    func testSessionRoundTrip() throws {
        var session = ProjectSession()
        session.projectPath = dir.appending(path: "P.writemind-project").path
        session.folders = [dir.path]
        session.openNotePaths = ["/a.md", "/b.md"]
        session.activeNotePath = "/b.md"
        session.unsavedBuffers = ["/a.md": "half a sentence"]
        session.save()
        let loaded = try XCTUnwrap(ProjectSession.load(forProjectAt: session.projectPath))
        XCTAssertEqual(loaded, session)
        if let url = ProjectSession.url(forProjectAt: session.projectPath) {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

final class NoteOrderTests: XCTestCase {
    private let root = URL(fileURLWithPath: "/notes", isDirectory: true)

    func testTheRootFolderKeyIsEmptyAndNestedKeysAreRelative() {
        XCTAssertEqual(NoteOrder.key(for: root, in: root), "")
        XCTAssertEqual(NoteOrder.key(for: root.appending(path: "Ideas/2026"), in: root), "Ideas/2026")
    }

    func testArrangePutsKnownNamesFirstInOrderAndUnknownOnesAfter() {
        var order = NoteOrder()
        order.set(["b.md", "a.md"], folder: root, root: root)
        XCTAssertEqual(order.arrange(["a.md", "new.md", "b.md"], folder: root, root: root),
                       ["b.md", "a.md", "new.md"])
    }

    func testANameThatIsGoneIsSimplySkipped() {
        var order = NoteOrder()
        order.set(["gone.md", "a.md"], folder: root, root: root)
        XCTAssertEqual(order.arrange(["a.md"], folder: root, root: root), ["a.md"])
    }

    func testForgettingTheLastNameDropsTheFolderEntirely() {
        var order = NoteOrder()
        order.set(["a.md"], folder: root, root: root)
        order.forget(name: "a.md", folder: root, root: root)
        XCTAssertTrue(order.folders.isEmpty)
    }

    func testAnUnknownFolderJustKeepsTheOrderItWasGiven() {
        let order = NoteOrder()
        XCTAssertEqual(order.arrange(["b.md", "a.md"], folder: root, root: root), ["b.md", "a.md"])
    }
}

final class NoteTreeTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appending(path: "WriteMindTree-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir.appending(path: "Ideas/2026"), withIntermediateDirectories: true)
        try "# One".write(to: dir.appending(path: "one.md"), atomically: true, encoding: .utf8)
        try "# Two".write(to: dir.appending(path: "Ideas/two.md"), atomically: true, encoding: .utf8)
        try "# Three".write(to: dir.appending(path: "Ideas/2026/three.md"), atomically: true, encoding: .utf8)
        try "not a note".write(to: dir.appending(path: "photo.png"), atomically: true, encoding: .utf8)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    func testTheTreeMirrorsTheFoldersAndSkipsNonNotes() {
        let root = NoteTree.read(directory: dir, root: dir, order: NoteOrder())
        XCTAssertEqual(root.notes.map(\.title), ["One"])
        XCTAssertEqual(root.sections.map(\.name), ["Ideas"])
        XCTAssertEqual(root.sections.first?.sections.map(\.name), ["2026"])
        XCTAssertEqual(root.allNotes.count, 3)
        XCTAssertEqual(root.depth, 0)
        XCTAssertEqual(root.sections.first?.depth, 1)
    }

    func testTheHiddenBookkeepingFoldersAreNotSections() throws {
        try FileManager.default.createDirectory(at: dir.appending(path: ".drawings"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: dir.appending(path: ".writemind"), withIntermediateDirectories: true)
        let root = NoteTree.read(directory: dir, root: dir, order: NoteOrder())
        XCTAssertEqual(root.sections.map(\.name), ["Ideas"])
    }

    func testTheRememberedOrderWins() {
        var order = NoteOrder()
        order.set(["Ideas", "one.md"], folder: dir, root: dir)
        let root = NoteTree.read(directory: dir, root: dir, order: order)
        // Sections and notes keep their own lists, each arranged by the file.
        XCTAssertEqual(root.notes.map(\.url.lastPathComponent), ["one.md"])
        XCTAssertEqual(root.sections.map(\.name), ["Ideas"])
    }

    func testUniqueURLStepsAsideForWhatIsThere() {
        let first = NoteTree.uniqueURL(in: dir, base: "one", extension: "md")
        XCTAssertEqual(first.lastPathComponent, "one 2.md")
        XCTAssertEqual(NoteTree.uniqueURL(in: dir, base: "Ideas", extension: nil).lastPathComponent, "Ideas 2")
        XCTAssertEqual(NoteTree.uniqueURL(in: dir, base: "a/b", extension: "md").lastPathComponent, "a-b.md")
    }

    /// "Remove Folder from Project" is offered only for a folder that is
    /// really there (Sean, 2026-09-19), and this is the check behind it —
    /// asked at the moment, not remembered from the read.
    func testOnlyAFolderThatExistsRightNowIsReal() throws {
        XCTAssertTrue(NoteTree.isRealFolder(at: dir.appending(path: "Ideas")))
        XCTAssertTrue(NoteTree.isRealFolder(at: dir.appending(path: "Ideas/2026")))
        XCTAssertFalse(NoteTree.isRealFolder(at: dir.appending(path: "one.md")), "a note is a file, not a folder")
        XCTAssertFalse(NoteTree.isRealFolder(at: dir.appending(path: "Never made")))

        // A symlink to a folder is that folder as far as Finder is concerned;
        // one pointing at nothing is nothing.
        let link = dir.appending(path: "Link"), dangling = dir.appending(path: "Dangling")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: dir.appending(path: "Ideas"))
        try FileManager.default.createSymbolicLink(at: dangling, withDestinationURL: dir.appending(path: "Never made"))
        XCTAssertTrue(NoteTree.isRealFolder(at: link))
        XCTAssertFalse(NoteTree.isRealFolder(at: dangling))

        // A section read while its folder was there stops being real the
        // moment the folder goes — nothing re-reads the tree for this.
        let root = NoteTree.read(directory: dir, root: dir, order: NoteOrder())
        let ideas = try XCTUnwrap(root.sections.first { $0.name == "Ideas" })
        XCTAssertTrue(ideas.isRealFolder)
        try FileManager.default.removeItem(at: ideas.url)
        XCTAssertFalse(ideas.isRealFolder)

        // A section made up around a path nothing was read from is not real.
        let made = NoteSection(url: dir.appending(path: "Nowhere"), name: "Notes", depth: 0, notes: [], sections: [])
        XCTAssertFalse(made.isRealFolder)
    }
}
