import Foundation

/// THE ONLY PLACE THIS APP STARTS A PROCESS.
///
/// Before evaluation cells it started none at all — the whole codebase had
/// no `Process`, and the only outbound calls were two `NSWorkspace.open`.
/// So this file is the boundary, and a test fails the build if `Process(`
/// appears anywhere else.
///
/// The app is unsandboxed with the hardened runtime off (AGENTS.md, "No
/// sandbox, on purpose"), so a child runs with Sean's full privileges and
/// inherits WriteMind's TCC identity: a Python cell that opens
/// ~/Documents raises a prompt with this app's name on it. That is the
/// right answer for a local notebook and the wrong one to arrive at by
/// accident, so:
///
/// - A RUN ONLY EVER STARTS FROM A PRESS. Never on opening a note, never
///   on a save, never from a view's body, never on a reload.
/// - `TestHost.isActive` is asked ON THE FIRST LINE of `run`, not at the
///   menu item: `tools/test.sh` makes the Debug app the test host and the
///   tests reach in with `@testable`, so a disabled menu guards nothing.
///   `tools/smoke.sh` kills only the app's pid, and a child started there
///   would outlive it.
/// - The child never touches the note. The result comes back in memory.
enum CellRunner {
    /// How long a cell may take. Long enough for a C++ compile with
    /// `<iostream>` in it (measured at about 0.6 s here) and short enough
    /// that `while True: print()` is over quickly.
    static let timeout: TimeInterval = 20

    enum Failure: Error, Equatable {
        case refused(Evaluator.Refusal)
        case couldNotStart(String)
        case notHere
    }

    /// Run a cell's source. Off the main actor — every caller awaits it
    /// from a detached task, the way `NoteStore.readText` does.
    static func run(_ source: String, as evaluator: Evaluator) async -> Result<EvalResult, Failure> {
        // A CHECK THAT CAN REACH THE REAL THING IS NOT A CHECK, and a
        // test host that can start a compiler is worse than that.
        guard !TestHost.isActive else { return .failure(.notHere) }
        guard let tool = evaluator.tool() else {
            return .failure(.refused(.missingTool(evaluator)))
        }
        do {
            switch evaluator {
            case .python, .wolfram:
                return .success(try await interpret(source, with: tool, as: evaluator))
            case .cpp:
                return .success(try await compileAndRun(source, with: tool, as: evaluator))
            }
        } catch let failure as Failure {
            return .failure(failure)
        } catch {
            return .failure(.couldNotStart(error.localizedDescription))
        }
    }

    // MARK: - The two shapes

    private static func interpret(_ source: String, with tool: String,
                                  as evaluator: Evaluator) async throws -> EvalResult {
        let directory = try scratch()
        defer { try? FileManager.default.removeItem(at: directory) }

        // WOLFRAM TAKES ITS SOURCE AS AN ARGUMENT, and the flag matters.
        // `wolframscript <path>` opens an INTERACTIVE session and prints
        // a banner; `-file` runs the file but shows no value; `-code`
        // shows the value of the last expression, which is what an Out
        // cell is for. Measured all three on 2026-09-21.
        let arguments: [String]
        if evaluator == .wolfram {
            arguments = ["-code", source]
        } else {
            let file = directory.appending(path: "cell.py")
            try source.write(to: file, atomically: true, encoding: .utf8)
            arguments = [file.path]
        }
        var result = try await spawn(tool, arguments, in: directory,
                                     environment: evaluator.environment)
        if evaluator == .wolfram { result.stdout = withoutTrailingNull(result.stdout) }
        result.note = wolframNote(result, evaluator: evaluator)
        return result
    }

    /// `-code` prints the value of the last expression, and a cell whose
    /// last expression was a `Print` has the value `Null`. That is
    /// Wolfram saying "nothing more", not an answer, so it is not one
    /// here either — and a cell that printed nothing at all still gets
    /// `[no output]` rather than the word Null.
    static func withoutTrailingNull(_ out: String) -> String {
        var lines = out.components(separatedBy: "\n")
        while let last = lines.last, last.trimmingCharacters(in: .whitespaces).isEmpty {
            lines.removeLast()
        }
        guard lines.last?.trimmingCharacters(in: .whitespaces) == "Null" else { return out }
        lines.removeLast()
        return lines.joined(separator: "\n")
    }

    /// C++ is not an interpreter: two processes, two exit codes and
    /// two stderrs that mean different things. A compile that fails is the
    /// answer — there is nothing to run and the diagnostics ARE the output.
    private static func compileAndRun(_ source: String, with tool: String,
                                      as evaluator: Evaluator) async throws -> EvalResult {
        let directory = try scratch()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appending(path: "cell.cpp")
        let binary = directory.appending(path: "cell.out")
        try source.write(to: file, atomically: true, encoding: .utf8)

        let standard = "-std=c++20"
        let build = try await spawn(tool, [standard, "-o", binary.path, file.path],
                                    in: directory, environment: evaluator.environment)
        guard build.status == 0, !build.timedOut else {
            var failed = build
            failed.note = build.timedOut ? "the compiler timed out" : "it did not compile"
            return failed
        }
        var result = try await spawn(binary.path, [], in: directory, environment: evaluator.environment)
        // The compiler's warnings belong to the run too — a clean compile
        // with a warning in it is the commonest thing there is.
        if !build.stderr.trimmingCharacters(in: .newlines).isEmpty {
            result.stderr = build.stderr + (result.stderr.isEmpty ? "" : "\n" + result.stderr)
        }
        return result
    }

    /// Wolfram Engine here is installed and NOT ACTIVATED, and it fails
    /// TWO different ways that BOTH exit 255 with nothing on stdout — so
    /// the status cannot tell them apart and stderr has to. Without the
    /// kernel path it says it cannot find a kernel; with it, that the
    /// installation is not activated. The app says which, and never tries
    /// to activate anything or ask for a licence.
    static func wolframNote(_ result: EvalResult, evaluator: Evaluator) -> String? {
        guard evaluator == .wolfram, result.status != 0 else { return result.note }
        let errors = result.stderr.lowercased()
        // MATCHED ON THE WORD IT ACTUALLY SAYS. The engine here reports
        // "The Wolfram Engine requires one-time activation on this
        // computer" and then ASKS FOR A WOLFRAM ID on stdin — which is
        // why the child's stdin is the null device: it gets EOF, answers
        // "Incorrect username or password" and exits instead of hanging
        // on a terminal that is not there. This app never types into
        // that prompt and never asks Sean for a licence; it says what
        // happened and where to fix it, once.
        if errors.contains("activat") {
            return "Wolfram Engine is installed but not activated — "
                + "run `wolframscript -activate` once in a terminal, then try again"
        }
        if errors.contains("kernel") && errors.contains("could not be determined") {
            return "Wolfram Engine's kernel was not found at \(Evaluator.wolframKernel)"
        }
        return result.note
    }

    // MARK: - One child

    private static func scratch() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "WriteMind-eval-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Start it, drain it, and give up on it.
    ///
    /// BOTH PIPES ARE DRAINED WHILE THE CHILD RUNS. A pipe holds 64 KiB on
    /// this machine (measured) and then the writer blocks: `waitUntilExit`
    /// before reading is a permanent hang the moment a cell prints more
    /// than that, and it looks fine on every small test.
    ///
    /// And the answer is not given until BOTH pipes have reached EOF AND
    /// the process has ended. `terminationHandler` fires on its own queue
    /// and can beat the last bytes out of the handlers, which truncates
    /// output non-deterministically — fine on `print(1)`, wrong on
    /// anything real.
    private static func spawn(_ tool: String, _ arguments: [String], in directory: URL,
                              environment: [String: String]) async throws -> EvalResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        process.currentDirectoryURL = directory
        // REPLACED, not added to: a child should not inherit whatever this
        // app happens to have been launched with.
        process.environment = environment
        // Nothing to read. A cell that asks for input gets EOF rather than
        // hanging on a terminal that is not there.
        process.standardInput = FileHandle.nullDevice

        let out = Pipe(), errors = Pipe()
        process.standardOutput = out
        process.standardError = errors
        let sink = OutputSink(limit: EvalOutput.byteLimit)

        return try await withCheckedThrowingContinuation { continuation in
            let finish = Finish(continuation: continuation)
            out.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; finish.closedOut(); return }
                if sink.append(data, toErrors: false) { process.terminate() }
            }
            errors.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; finish.closedErrors(); return }
                if sink.append(data, toErrors: true) { process.terminate() }
            }
            process.terminationHandler = { process in
                finish.ended(status: process.terminationStatus, sink: sink)
            }
            do {
                try process.run()
            } catch {
                // A path that is not there THROWS; it does not come back
                // as a status. `/usr/local/bin/wolframscript` is not on
                // this machine and neither is `/usr/bin/rm`.
                finish.failed(Failure.couldNotStart(error.localizedDescription))
                return
            }
            // The timeout kills the child we started. Foundation cannot
            // put it in a process group of its own, so a grandchild — the
            // `clang -cc1` behind the clang++ shim, wolframscript's own
            // kernel — can outlive it. A known limit, written down rather
            // than pretended away.
            finish.deadline(timeout) {
                process.terminate()
                DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                }
            }
        }
    }
}

/// What came out, under a lock, capped.
private final class OutputSink: @unchecked Sendable {
    private let lock = NSLock()
    private var out = Data()
    private var errors = Data()
    private(set) var truncated = false
    private let limit: Int

    init(limit: Int) { self.limit = limit }

    /// True when the cap has just been passed and the child should stop.
    func append(_ data: Data, toErrors: Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if toErrors { errors.append(data) } else { out.append(data) }
        guard out.count + errors.count > limit, !truncated else { return false }
        truncated = true
        return true
    }

    /// Lenient on purpose: a child's bytes are arbitrary, and
    /// `String(data:encoding:)` returning nil would throw away the whole
    /// answer over one bad byte.
    var result: EvalResult {
        lock.lock()
        defer { lock.unlock() }
        return EvalResult(stdout: String(decoding: out.prefix(limit), as: UTF8.self),
                          stderr: String(decoding: errors.prefix(limit), as: UTF8.self),
                          status: nil, timedOut: false, truncated: truncated)
    }
}

/// Resumes the continuation exactly once, when the process has ended AND
/// both pipes have closed — or when the deadline passes.
private final class Finish: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<EvalResult, Error>?
    private var status: Int32?
    private var outClosed = false
    private var errorsClosed = false
    private var sink: OutputSink?
    private var timedOut = false
    private var timer: DispatchWorkItem?

    init(continuation: CheckedContinuation<EvalResult, Error>) {
        self.continuation = continuation
    }

    func closedOut() { lock.lock(); outClosed = true; let go = ready(); lock.unlock(); deliver(go) }
    func closedErrors() { lock.lock(); errorsClosed = true; let go = ready(); lock.unlock(); deliver(go) }

    func ended(status: Int32, sink: OutputSink) {
        lock.lock()
        self.status = status
        self.sink = sink
        let go = ready()
        lock.unlock()
        deliver(go)
    }

    func failed(_ error: Error) {
        lock.lock()
        let waiting = continuation
        continuation = nil
        timer?.cancel()
        lock.unlock()
        waiting?.resume(throwing: error)
    }

    func deadline(_ seconds: TimeInterval, _ kill: @escaping () -> Void) {
        let work = DispatchWorkItem { [weak self] in
            self?.lock.lock()
            self?.timedOut = true
            self?.lock.unlock()
            kill()
        }
        lock.lock()
        timer = work
        lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + seconds, execute: work)
    }

    /// Everything in, or nothing left to wait for.
    private func ready() -> EvalResult? {
        guard continuation != nil, let status, outClosed, errorsClosed, let sink else { return nil }
        var result = sink.result
        result.status = status
        result.timedOut = timedOut
        return result
    }

    private func deliver(_ result: EvalResult?) {
        guard let result else { return }
        lock.lock()
        let waiting = continuation
        continuation = nil
        timer?.cancel()
        lock.unlock()
        waiting?.resume(returning: result)
    }
}
