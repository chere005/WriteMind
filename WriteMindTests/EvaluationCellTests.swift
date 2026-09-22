import XCTest
@testable import WriteMind

/// Evaluation cells: what runs, what is refused, and what the answer
/// looks like in the note.
final class EvaluationCellTests: XCTestCase {

    // MARK: - What runs, and what does not

    func testTheFourEnvironmentsResolveFromTheirOwnFences() {
        XCTAssertEqual(Evaluator.from(fence: "python"), .python)
        XCTAssertEqual(Evaluator.from(fence: "py"), .python)
        XCTAssertEqual(Evaluator.from(fence: "c"), .c)
        XCTAssertEqual(Evaluator.from(fence: "cpp"), .cpp)
        XCTAssertEqual(Evaluator.from(fence: "c++"), .cpp)
        XCTAssertEqual(Evaluator.from(fence: "wls"), .wolfram)
        XCTAssertEqual(Evaluator.from(fence: "mathematica"), .wolfram)
    }

    /// `wl` IS MATHS AND IS NEVER RUN. It is this app's maths fence, and
    /// Wolfram code has had its own fences all along.
    func testTheMathsFenceIsNotAnEnvironment() {
        XCTAssertNil(Evaluator.from(fence: "wl"))
        XCTAssertEqual(Evaluator.resolve(fence: "wl"), .failure(.maths))
        XCTAssertEqual(Evaluator.resolve(fence: "WL"), .failure(.maths))
        // And the Wolfram environment writes wls, never wl.
        XCTAssertEqual(Evaluator.wolfram.language.fence, "wolfram")
        XCTAssertNotEqual(Evaluator.wolfram.language.fence, MathMarkup.fence)
    }

    func testWhatIsRefusedAndWhySaysSomethingActionable() {
        XCTAssertEqual(Evaluator.resolve(fence: nil), .failure(.noLanguage))
        XCTAssertEqual(Evaluator.resolve(fence: ""), .failure(.noLanguage))
        XCTAssertEqual(Evaluator.resolve(fence: "bash"), .failure(.shell("Bash")))
        XCTAssertEqual(Evaluator.resolve(fence: "zsh"), .failure(.shell("Zsh")))
        XCTAssertEqual(Evaluator.resolve(fence: "rust"), .failure(.notRunnable("Rust")))
        XCTAssertEqual(Evaluator.resolve(fence: "nonsense"), .failure(.notRunnable("nonsense")))
        for refusal: Evaluator.Refusal in [.maths, .noLanguage, .notRunnable("Rust"),
                                           .shell("Bash"), .missingTool(.python)] {
            XCTAssertFalse(refusal.message.isEmpty)
            XCTAssertTrue(refusal.message.hasSuffix(".") || refusal.message.hasSuffix("cell."),
                          refusal.message)
        }
    }

    /// A shell cell is refused on purpose and permanently, not because it
    /// is hard: the text of a fence is not evidence Sean typed it.
    func testAShellCellIsNeverRun() {
        for fence in ["bash", "sh", "zsh", "shell"] {
            if case .success(let evaluator) = Evaluator.resolve(fence: fence) {
                XCTFail("\(fence) resolved to \(evaluator)")
            }
        }
    }

    func testTheToolsAreLookedForByAbsolutePathAndNeverJustOne() {
        for evaluator in Evaluator.allCases {
            XCTAssertGreaterThan(evaluator.candidates.count, 1, "\(evaluator)")
            for path in evaluator.candidates {
                XCTAssertTrue(path.hasPrefix("/"), "\(path) is not absolute")
            }
        }
        // A GUI app inherits launchd's PATH, which has no Homebrew in it.
        XCTAssertTrue(Evaluator.wolfram.candidates.contains("/opt/homebrew/bin/wolframscript"))
        XCTAssertEqual(Evaluator.python.candidates.first, "/usr/bin/python3")
    }

    func testOnlyWolframIsHandedAKernelPath() {
        XCTAssertEqual(Evaluator.wolfram.environment["WolframKernel"], Evaluator.wolframKernel)
        for evaluator in Evaluator.allCases where evaluator != .wolfram {
            XCTAssertNil(evaluator.environment["WolframKernel"], "\(evaluator)")
        }
        // Replaced, not inherited.
        XCTAssertEqual(Evaluator.python.environment["PATH"], "/usr/bin:/bin:/usr/sbin:/sbin")
    }

    /// Both wolframscript failures exit 255 with nothing on stdout, so
    /// the status cannot tell them apart and stderr has to.
    func testTheTwoWolframFailuresAreToldApartByStderr() {
        // The real words, captured from this machine on 2026-09-21.
        let notActivated = EvalResult(
            stderr: "The Wolfram Engine requires one-time activation on this computer.\n"
                + "Visit https://wolfram.com/engine/free-license to get your free license.\n"
                + "Wolfram ID: Password: \nIncorrect username or password",
            status: 255)
        XCTAssertTrue(CellRunner.wolframNote(notActivated, evaluator: .wolfram)?
            .contains("not activated") ?? false)
        XCTAssertTrue(CellRunner.wolframNote(notActivated, evaluator: .wolfram)?
            .contains("wolframscript -activate") ?? false)
        let noKernel = EvalResult(
            stderr: "A WolframKernel location could not be determined. Use -configure…",
            status: 255)
        XCTAssertTrue(CellRunner.wolframNote(noKernel, evaluator: .wolfram)?
            .contains("kernel was not found") ?? false)
        // A run that worked is not given a note, and no other environment
        // is given one at all.
        XCTAssertNil(CellRunner.wolframNote(EvalResult(status: 0), evaluator: .wolfram))
        XCTAssertNil(CellRunner.wolframNote(notActivated, evaluator: .python))
    }

    // MARK: - The Out cell

    func testAnAnswerIsAnOutFenceAndAnOutFenceIsNotACodeLanguage() {
        let cell = EvalOutput.cell(for: EvalResult(stdout: "4\n", status: 0))
        XCTAssertEqual(cell, "```out\n4\n```")
        // Nothing else in the app has to learn about it: it is a plain
        // code block to the highlighter, and not maths.
        XCTAssertNil(CodeLanguage.from(fence: EvalOutput.fence))
        XCTAssertFalse(MathMarkup.isMathFence(EvalOutput.fence))
        XCTAssertTrue(EvalOutput.isOut(.code(language: "out", body: "4")))
        XCTAssertFalse(EvalOutput.isOut(.code(language: "python", body: "print(4)")))
        XCTAssertFalse(EvalOutput.isOut(.paragraph("out")))
    }

    func testAnOutCellIsNeverAnEmptyFence() {
        XCTAssertEqual(EvalOutput.body(for: EvalResult(status: 0)), "[no output]")
        XCTAssertEqual(EvalOutput.body(for: EvalResult(stdout: "   \n\n", status: 0)), "[no output]")
    }

    func testTheAppsOwnWordsAreInSquareBracketsAndTheProgramsAreNot() {
        let result = EvalResult(stdout: "hello", stderr: "boom", status: 2,
                                timedOut: true, truncated: true, note: "it did not compile")
        let body = EvalOutput.body(for: result)
        XCTAssertEqual(body.components(separatedBy: "\n").first, "hello")
        XCTAssertTrue(body.contains("[stderr]"))
        XCTAssertTrue(body.contains("boom"))
        XCTAssertTrue(body.contains("[it did not compile]"))
        XCTAssertTrue(body.contains("[output cut at 64 KB]"))
        XCTAssertTrue(body.contains("[timed out]"))
        XCTAssertTrue(body.contains("[exit 2]"))
        // A clean run says nothing about its exit.
        XCTAssertFalse(EvalOutput.body(for: EvalResult(stdout: "hi", status: 0)).contains("[exit"))
    }

    /// OUTPUT MAY NEVER CLOSE ITS OWN FENCE. The parser ends a fenced
    /// block at any line whose TRIMMED form begins with three backticks,
    /// so indenting does not save it — the rest of the note would
    /// re-parse as code.
    func testOutputThatPrintsAFenceCannotEndItsOwnCell() {
        let result = EvalResult(stdout: "before\n```\n   ```swift\nafter", status: 0)
        let cell = EvalOutput.cell(for: result)
        let blocks = MarkdownParser.positioned(from: "```python\nx\n```\n\n" + cell)
        XCTAssertEqual(blocks.count, 2, "the answer split the note: \(cell)")
        guard case .code(let language, let body)? = blocks.last?.block else {
            return XCTFail("the answer is not one code block")
        }
        XCTAssertEqual(language, "out")
        XCTAssertTrue(body.contains("after"), "everything the program printed is still there")
    }

    // MARK: - Where the answer goes

    private let note = "# Notes\n\n```python\nprint(2 + 2)\n```\n\nAfter it."

    private func cell(_ text: String, at index: Int) -> NSRange {
        MarkdownParser.positioned(from: text)[index].range
    }

    func testTheFirstRunPutsANewCellUnderTheCodeAndLeavesTheRestAlone() {
        let code = cell(note, at: 1)
        let edit = EvalCells.write(EvalResult(stdout: "4", status: 0), under: code, in: note)
        let after = (note as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        XCTAssertEqual(after, "# Notes\n\n```python\nprint(2 + 2)\n```\n\n```out\n4\n```\n\nAfter it.")
        XCTAssertEqual(MarkdownParser.positioned(from: after).count, 4)
    }

    func testASecondRunReplacesTheFirstAnswerRatherThanPilingUp() {
        let code = cell(note, at: 1)
        let once = (note as NSString).replacingCharacters(
            in: EvalCells.write(EvalResult(stdout: "4", status: 0), under: code, in: note).range,
            with: EvalCells.write(EvalResult(stdout: "4", status: 0), under: code, in: note).replacement)
        let again = EvalCells.write(EvalResult(stdout: "5", status: 0),
                                    under: cell(once, at: 1), in: once)
        let twice = (once as NSString).replacingCharacters(in: again.range, with: again.replacement)
        XCTAssertEqual(twice, "# Notes\n\n```python\nprint(2 + 2)\n```\n\n```out\n5\n```\n\nAfter it.")
        XCTAssertEqual(MarkdownParser.positioned(from: twice).count, 4, "one answer, not two")
        // And the words under it are untouched.
        XCTAssertTrue(twice.hasSuffix("After it."))
    }

    /// The tag is the veto: a bare code block a person wrote under their
    /// own code is not an answer and is never overwritten.
    func testAPlainBlockUnderTheCodeIsNotMistakenForAnAnswer() {
        let hand = "```python\nprint(1)\n```\n\n```\nmine\n```"
        XCTAssertNil(EvalCells.out(after: cell(hand, at: 0), in: hand))
        let edit = EvalCells.write(EvalResult(stdout: "1", status: 0), under: cell(hand, at: 0), in: hand)
        let after = (hand as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        XCTAssertTrue(after.contains("mine"), "their block was overwritten")
        XCTAssertEqual(MarkdownParser.positioned(from: after).count, 3)
    }

    func testAnAnswerOnlyBelongsToTheCellDirectlyAboveIt() {
        let two = "```python\na\n```\n\n```out\nA\n```\n\n```python\nb\n```"
        XCTAssertNotNil(EvalCells.out(after: cell(two, at: 0), in: two))
        XCTAssertNil(EvalCells.out(after: cell(two, at: 2), in: two), "the last cell has no answer yet")
    }

    func testOnlyAFencedCellIsRunnable() {
        XCTAssertNotNil(EvalCells.runnable(at: 12, in: note))
        XCTAssertNil(EvalCells.runnable(at: 2, in: note), "the heading is not a cell to run")
    }

    // MARK: - Picking the environment

    func testPickingAnEnvironmentRewritesTheFenceAndNothingElse() {
        let code = cell(note, at: 1)
        guard let edit = EvalCells.setEnvironment(.cpp, of: code, in: note) else {
            return XCTFail("no edit")
        }
        let after = (note as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        XCTAssertEqual(after, "# Notes\n\n```cpp\nprint(2 + 2)\n```\n\nAfter it.")
        // Picking the one it already is changes nothing at all.
        XCTAssertNil(EvalCells.setEnvironment(.python, of: cell(note, at: 1), in: note))
    }

    func testPickingAnEnvironmentOnSomethingThatIsNotAFenceDoesNothing() {
        XCTAssertNil(EvalCells.setEnvironment(.python, of: cell(note, at: 0), in: note))
    }

    // MARK: - What moves when an answer lands

    func testWhatIsBelowTheAnswerMovesAndWhatIsAboveItDoesNot() {
        let edit = MarkdownFormatting.Edit(range: NSRange(location: 10, length: 0),
                                           replacement: "12345",
                                           selection: NSRange(location: 10, length: 0))
        XCTAssertEqual(EvalCells.shifted(NSRange(location: 4, length: 2), by: edit),
                       NSRange(location: 4, length: 2), "above it")
        XCTAssertEqual(EvalCells.shifted(NSRange(location: 20, length: 2), by: edit),
                       NSRange(location: 25, length: 2), "below it")
        XCTAssertEqual(EvalCells.shifted(30, by: edit), 35)
        XCTAssertEqual(EvalCells.shifted(3, by: edit), 3)
    }
}

/// The promise that only a press starts a child, kept by the build.
final class EvaluationSpawnTests: XCTestCase {
    private var sources: [URL] {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "WriteMind", directoryHint: .isDirectory)
        return (FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }
            .filter { $0.pathExtension == "swift" }) ?? []
    }

    /// ONE FILE STARTS PROCESSES. Before evaluation cells the app started
    /// none at all, and that is worth keeping visible.
    func testNothingButTheRunnerSpawnsAProcess() throws {
        XCTAssertFalse(sources.isEmpty)
        for file in sources where file.lastPathComponent != "CellRunner.swift" {
            let text = try String(contentsOf: file, encoding: .utf8)
            for needle in ["Process(", "NSTask", "posix_spawn", "execv"] {
                XCTAssertFalse(text.contains(needle),
                               "\(file.lastPathComponent) reaches for \(needle)")
            }
        }
    }

    /// AND NOTHING STARTS ONE BY ITSELF. A run is a press: never on
    /// opening a note, never on a save, never from a view's body.
    func testNoRunIsStartedFromLoadingOrSaving() throws {
        let store = try String(contentsOf: URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "WriteMind/Notes/NoteStore.swift"), encoding: .utf8)
        for caller in ["runCell(", "CellRunner.run"] {
            XCTAssertFalse(store.contains(caller),
                           "NoteStore.swift itself calls \(caller) — the store loads, saves and watches")
        }
    }

    /// The guard is at the SPAWN, not at the menu: the test host IS the
    /// app, and the tests reach in with @testable.
    func testATestHostRunsNothing() async {
        XCTAssertTrue(TestHost.isActive, "the unit suite is a test host")
        let outcome = await CellRunner.run("print('no')", as: .python)
        guard case .failure(.notHere) = outcome else {
            return XCTFail("a test host got as far as \(outcome)")
        }
    }
}
