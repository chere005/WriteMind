import Foundation

/// Whether this process is the app Xcode launched to HOST the unit tests,
/// rather than WriteMind proper. The host runs the whole app — its window,
/// its stores — and an app that opens `~/Documents` and turns the camera on
/// at launch put both permission prompts up on every test run (Sean,
/// 2026-09-18: "still keeps asking for camera and documents access"). So the
/// host keeps its notes in a scratch folder and leaves the camera alone; the
/// tests build stores of their own anyway.
enum TestHost {
    static let isActive: Bool = {
        let env = ProcessInfo.processInfo.environment
        let active = env["XCTestConfigurationFilePath"] != nil
            || env["XCTestBundlePath"] != nil
            || env["XCTestSessionIdentifier"] != nil
            || NSClassFromString("XCTestCase") != nil
        if active {
            NSLog("WriteMind: hosting the unit tests — notes in %@, camera left off", notesDirectory.path)
        }
        return active
    }()

    /// Where the host keeps its notes instead of `~/Documents/WriteMind`.
    static let notesDirectory = FileManager.default.temporaryDirectory
        .appending(path: "WriteMind-test-host", directoryHint: .isDirectory)
}
