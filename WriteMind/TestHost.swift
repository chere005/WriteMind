import Foundation

/// Whether this process is a RUN OF THE APP THAT IS NOT SEAN'S — the host
/// Xcode launches to run the unit tests, or the copy `tools/smoke.sh`
/// starts and kills to check a build comes up.
///
/// Both run the whole app, its window and its stores, so both would open
/// `~/Documents/WriteMind` and turn the camera on at launch. That put two
/// permission prompts up on every test run (Sean, 2026-09-18: "still keeps
/// asking for camera and documents access") — and it did something worse
/// on 2026-09-20, which is the reason the smoke is in here too: the smoke
/// opened Sean's real note, was sent SIGTERM eight seconds later, and
/// flushed a save of whatever it was holding on the way out. His note lost
/// two cells. A check that can reach his data is not a check.
///
/// So neither keeps its notes where his are, and neither touches the
/// camera; the tests build stores of their own anyway.
enum TestHost {
    /// `WRITEMIND_SCRATCH_NOTES` is what the smoke sets. It is read from
    /// the environment and nothing else — no default, no file — so an app
    /// Sean launches himself can never be in this mode by accident.
    static let isActive: Bool = {
        let env = ProcessInfo.processInfo.environment
        let hostingTests = env["XCTestConfigurationFilePath"] != nil
            || env["XCTestBundlePath"] != nil
            || env["XCTestSessionIdentifier"] != nil
            || NSClassFromString("XCTestCase") != nil
        let smoking = env["WRITEMIND_SCRATCH_NOTES"] != nil
        if hostingTests || smoking {
            NSLog("WriteMind: %@ — notes in %@, camera left off",
                  smoking ? "smoke run" : "hosting the unit tests", notesDirectory.path)
        }
        return hostingTests || smoking
    }()

    /// Where such a run keeps its notes instead of `~/Documents/WriteMind`.
    static let notesDirectory = FileManager.default.temporaryDirectory
        .appending(path: "WriteMind-test-host", directoryHint: .isDirectory)
}
