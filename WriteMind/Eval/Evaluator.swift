import AppKit
import Foundation

/// AN EVALUATION CELL IS NOT A CODE CELL. Sean, 2026-09-21: "evaluation
/// cells are completely different from code cells".
///
/// A code cell is code you are writing ABOUT — coloured, and that is all.
/// An evaluation cell is code the note RUNS, and it says so in the file:
/// its fence is `eval` and then which environment, so the two kinds are
/// never confused by this app, by another markdown editor, or by anyone
/// reading the file.
///
///     ```eval wl     ```eval python     ```eval c
///     ```eval c++    ```eval rust
///
/// ⌘9 makes one, or turns the cell the caret is in into one. ⇧↩ runs it.
/// The badge at its left says which environment it is and changes it.
///
/// `wl` inside the fence is safe: `MathMarkup.isMathFence` compares the
/// WHOLE info string to "wl", and "eval wl" is not that. Maths is
/// untouched, and the maths cell keeps its own fence to itself.
/// ⇧↩ RUNS AN EVALUATION CELL (Sean, 2026-09-21: "to evaluate this kind
/// of cell, it's shift+enter").
///
/// It arrives as `insertNewline:` and NOT as `insertLineBreak:`. macOS's
/// standard key bindings give `insertLineBreak:` to ⌃↩ and say nothing
/// about ⇧↩, so Return with shift held comes through as an ordinary
/// newline — which is why the shift is read off the event being handled
/// rather than inferred from the selector. `NSApp.currentEvent` is that
/// event; the global `NSEvent.modifierFlags` is a different question.
enum EvaluationKeys {
    static func isRun(_ modifiers: NSEvent.ModifierFlags) -> Bool {
        modifiers.contains(.shift)
            && !modifiers.contains(.command)
            && !modifiers.contains(.option)
            && !modifiers.contains(.control)
    }

    static var isRunNow: Bool { isRun(NSApp.currentEvent?.modifierFlags ?? []) }
}

enum Evaluator: String, CaseIterable, Identifiable, Equatable {
    /// WOLFRAM FIRST, because it is the one a new cell is (Sean,
    /// 2026-09-22: "default to wolfram"). The order here is the order the
    /// menu offers them in.
    case wolfram
    case python
    case c
    case cpp
    case rust

    var id: String { rawValue }

    /// What follows `eval` in the fence.
    var tag: String {
        switch self {
        case .wolfram: return "wl"
        case .python: return "python"
        case .c: return "c"
        case .cpp: return "c++"
        case .rust: return "rust"
        }
    }

    /// The whole info string an evaluation cell carries.
    var fence: String { "\(Self.fencePrefix) \(tag)" }
    static let fencePrefix = "eval"

    /// What the body is COLOURED as. An evaluation cell is still code to
    /// look at, so it gets the highlighter the code cell of that language
    /// would get.
    var language: CodeLanguage {
        switch self {
        case .wolfram: return .wolfram
        case .python: return .python
        case .c: return .c
        case .cpp: return .cpp
        case .rust: return .rust
        }
    }

    /// What the dropdown on the cell's left shows — short, because it is
    /// drawn in the margin beside the code.
    var badge: String {
        switch self {
        case .wolfram: return "WL"
        case .python: return "PY"
        case .c: return "C"
        case .cpp: return "C++"
        case .rust: return "RS"
        }
    }

    var title: String {
        switch self {
        case .wolfram: return "Wolfram"
        case .python: return "Python"
        case .c: return "C"
        case .cpp: return "C++"
        case .rust: return "Rust"
        }
    }

    /// The environment an info string names, or nil when the block is not
    /// an evaluation cell at all. A CODE cell — `python`, `cpp`, `wl` on
    /// their own — is not one, and never runs.
    static func from(fence: String?) -> Evaluator? {
        let words = (fence ?? "").trimmingCharacters(in: .whitespaces)
            .lowercased().split(separator: " ", omittingEmptySubsequences: true)
        guard words.first == Substring(fencePrefix) else { return nil }
        guard words.count > 1 else { return nil }
        let tag = String(words[1])
        return allCases.first { $0.tag == tag }
            // `cpp`, `py` and `mathematica` are what somebody types by
            // hand; the app always writes the canonical tag back.
            ?? allCases.first { $0.language == CodeLanguage.from(fence: tag) }
    }

    /// Whether this block is an evaluation cell, whatever environment it
    /// names — including one this app does not know.
    static func isEvaluation(fence: String?) -> Bool {
        (fence ?? "").trimmingCharacters(in: .whitespaces)
            .lowercased().split(separator: " ").first == Substring(fencePrefix)
    }

    // MARK: - The tools

    /// Where the tool might be. A LIST, and never one hardcoded path:
    /// `/usr/local/bin/wolframscript` does not exist on this machine (it
    /// is in /opt/homebrew/bin) and `/usr/bin/rm` does not either — and
    /// `Process.run()` THROWS for a path that is not there rather than
    /// handing back a status anybody would think to check.
    ///
    /// Absolute, because a GUI app inherits launchd's PATH: /usr/bin,
    /// /bin, /usr/sbin, /sbin and nothing else. Homebrew is not on it.
    var candidates: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        switch self {
        case .wolfram: return ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript"]
        case .python: return ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"]
        case .c: return ["/usr/bin/clang", "/opt/homebrew/bin/clang", "/usr/local/bin/clang"]
        case .cpp: return ["/usr/bin/clang++", "/opt/homebrew/bin/clang++"]
        // rustup puts it in the home directory and nowhere else, which
        // is the one place a list of system paths would never find it.
        case .rust: return ["\(home)/.cargo/bin/rustc", "/opt/homebrew/bin/rustc",
                            "/usr/local/bin/rustc"]
        }
    }

    // MARK: - The two shapes a cell runs in

    /// A COMPILED cell is two processes and two exit codes; an
    /// interpreted one is a single child. The extension is what tells the
    /// compiler what it is reading, so the name is the model's to say.
    var sourceFile: String? {
        switch self {
        case .wolfram: return nil  // it takes its source as an argument
        case .python: return "cell.py"
        case .c: return "cell.c"
        case .cpp: return "cell.cpp"
        case .rust: return "cell.rs"
        }
    }

    var isCompiled: Bool {
        switch self {
        case .c, .cpp, .rust: return true
        case .python, .wolfram: return false
        }
    }

    /// What the compiler is handed. The standard is named rather than
    /// left to the tool's default, so a cell means the same thing on a
    /// machine with a different compiler on it.
    func compileArguments(source: String, output: String) -> [String] {
        switch self {
        case .c: return ["-std=c17", "-o", output, source]
        case .cpp: return ["-std=c++20", "-o", output, source]
        // rustc warns loudly about a crate name it inferred from a file
        // called `cell`; naming the binary is enough to quiet it, and
        // `-O` because a cell is run once and read once.
        case .rust: return ["-O", "-o", output, source]
        case .python, .wolfram: return []
        }
    }

    /// Anything Sean has put in the defaults wins: the tool moved, or he
    /// wants a different Python, and neither should need a build.
    var overrideKey: String { "evalTool.\(rawValue)" }

    /// The first candidate that is on disk and runnable.
    func tool(_ defaults: UserDefaults = .standard,
              fileManager: FileManager = .default) -> String? {
        let all = [defaults.string(forKey: overrideKey)].compactMap { $0 } + candidates
        return all.first { fileManager.isExecutableFile(atPath: $0) }
    }

    /// The Wolfram kernel is not found by `wolframscript` on its own here
    /// — without this it exits 255 saying so. Handed in as an addition to
    /// an otherwise replaced environment.
    static let wolframKernel = "/Applications/Wolfram Engine.app/Contents/MacOS/WolframKernel"

    /// REPLACED, not inherited — but not empty either.
    ///
    /// `HOME` has to be here. Under `env -i` with only PATH and the
    /// kernel path, `wolframscript` prints NOTHING and exits 0: the
    /// worst failure there is, because it looks like a cell that ran and
    /// had nothing to say. It needs a home directory to find its own
    /// licence and configuration. Measured, both ways, on 2026-09-21.
    var environment: [String: String] {
        var env = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                   "LC_ALL": "en_US.UTF-8",
                   "HOME": FileManager.default.homeDirectoryForCurrentUser.path]
        if let tmp = ProcessInfo.processInfo.environment["TMPDIR"] { env["TMPDIR"] = tmp }
        if self == .wolfram { env["WolframKernel"] = Self.wolframKernel }
        return env
    }

    // MARK: - What is refused, and why

    /// Why a cell will not run. Every one of these is a sentence a person
    /// can act on; none of them spawns anything, and none of them writes
    /// an output cell.
    enum Refusal: Error, Equatable {
        case notAnEvaluationCell
        case unknownEnvironment(String)
        case missingTool(Evaluator)

        var message: String {
            switch self {
            case .notAnEvaluationCell:
                return "That is not an evaluation cell. ⌘9 makes one, "
                    + "or turns the cell the caret is in into one."
            case .unknownEnvironment(let tag):
                // The list is GENERATED, so adding an environment cannot
                // leave a sentence behind naming the old three.
                let known = Evaluator.allCases.map(\.title)
                return "This cell says it runs as “\(tag)”, which is not one of "
                    + "\(known.dropLast().joined(separator: ", ")) or \(known.last ?? "")."
                    + " Pick one from the badge on its left."
            case .missingTool(let evaluator):
                return "\(evaluator.title) is not installed where WriteMind looks "
                    + "(\(evaluator.candidates.joined(separator: ", ")))."
            }
        }
    }

    /// What a cell's info string means for running it: an environment, or
    /// the reason there is not one.
    static func resolve(fence: String?) -> Result<Evaluator, Refusal> {
        guard isEvaluation(fence: fence) else { return .failure(.notAnEvaluationCell) }
        guard let evaluator = from(fence: fence) else {
            let words = (fence ?? "").trimmingCharacters(in: .whitespaces).split(separator: " ")
            return .failure(.unknownEnvironment(words.count > 1 ? String(words[1]) : ""))
        }
        return .success(evaluator)
    }
}
