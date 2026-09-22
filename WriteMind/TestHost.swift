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

    /// And where it keeps its SESSION, instead of Application Support.
    ///
    /// THE SCRATCH NOTES FOLDER ALONE DOES NOT MAKE SUCH A RUN SAFE.
    /// `notesDirectory` only changes where a store with no folders of its
    /// own looks — and a restored session HAS folders of its own, named by
    /// absolute path, along with the notes that were open and any text that
    /// had not reached disk. So the smoke came up on `~/Documents/WriteMind`
    /// anyway, opened Sean's note, and was then sent the SIGTERM that made
    /// it flush a save: the 2026-09-20 loss of two cells, by the route the
    /// scratch folder was believed to have closed (found again 2026-09-21,
    /// with a scratch run showing his notes on screen). Moving the session's
    /// base directory is what closes it — a run that restores nothing comes
    /// up on `notesDirectory`, which is the whole point.
    static let supportDirectory = FileManager.default.temporaryDirectory
        .appending(path: "WriteMind-test-support", directoryHint: .isDirectory)
}
