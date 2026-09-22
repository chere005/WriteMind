import Foundation

/// WHAT CAN RUN A CELL, and what it says when it cannot.
///
/// Sean, 2026-09-21: "finish the work on evaluation cells… this type of
/// cell has a drop down icon on the far left picking the evaluator
/// environment". The environment is the fence's own language, so picking
/// one on a cell rewrites its fence and the note carries the choice — no
/// second place to keep it and nothing to get out of step.
///
/// THE APP HAS NEVER SPAWNED A PROCESS BEFORE THIS. Everything here is
/// written to be refused by default: an environment that is not on this
/// list does not run, a tool that is not on disk does not run, and a
/// refusal is a sentence rather than a silence.
enum Evaluator: String, CaseIterable, Identifiable, Equatable {
    case python
    case c
    case cpp
    case wolfram

    var id: String { rawValue }

    /// The fence this environment is written with — the one the language
    /// chooser and the highlighter already know.
    ///
    /// WOLFRAM IS `wls`, NEVER `wl`. `wl` is this app's MATHS fence
    /// (`MathMarkup.fence`), typeset rather than run, and
    /// `CodeLanguage.from(fence:)` leaves it out on purpose with a test
    /// pinning it. `wls`, `wolfram` and `mathematica` were already
    /// Wolfram CODE fences before any of this, so nothing had to be
    /// invented and nothing about maths moves.
    var language: CodeLanguage {
        switch self {
        case .python: return .python
        case .c: return .c
        case .cpp: return .cpp
        case .wolfram: return .wolfram
        }
    }

    /// What the dropdown on the cell's left shows. Short, because it is
    /// drawn in the margin beside the code.
    var badge: String {
        switch self {
        case .python: return "PY"
        case .c: return "C"
        case .cpp: return "C++"
        case .wolfram: return "WL"
        }
    }

    var title: String { language.title }

    /// The environment a fence names, or nil when that fence is not one
    /// this app runs.
    static func from(fence: String?) -> Evaluator? {
        guard let language = CodeLanguage.from(fence: fence) else { return nil }
        return allCases.first { $0.language == language }
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
        switch self {
        case .python: return ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"]
        case .c, .cpp: return ["/usr/bin/clang++", "/usr/bin/clang"]
        case .wolfram: return ["/opt/homebrew/bin/wolframscript", "/usr/local/bin/wolframscript"]
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

    var environment: [String: String] {
        var env = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "en_US.UTF-8"]
        if self == .wolfram { env["WolframKernel"] = Self.wolframKernel }
        return env
    }

    // MARK: - What is refused, and why

    /// Why a cell will not run. Every one of these is a sentence a person
    /// can act on; none of them spawns anything, and none of them writes
    /// an output cell.
    enum Refusal: Error, Equatable {
        case maths
        case noLanguage
        case notRunnable(String)
        case shell(String)
        case missingTool(Evaluator)

        var message: String {
            switch self {
            case .maths:
                return "That is a maths cell — it is typeset, not run. "
                    + "Wolfram code goes in a ```wls cell."
            case .noLanguage:
                return "This block has no language. Pick one from the menu on its left."
            case .notRunnable(let name):
                return "\(name) is coloured here, not run. Python, C, C++ and Wolfram run."
            case .shell(let name):
                return "\(name) is not run: a note is a file anything can write, "
                    + "and a shell cell is a command it would be running as you."
            case .missingTool(let evaluator):
                return "\(evaluator.title) is not installed where WriteMind looks "
                    + "(\(evaluator.candidates.joined(separator: ", ")))."
            }
        }
    }

    /// What a fenced cell's info string means for running it: an
    /// environment, or the reason there is not one.
    static func resolve(fence: String?) -> Result<Evaluator, Refusal> {
        if MathMarkup.isMathFence(fence) { return .failure(.maths) }
        guard let language = CodeLanguage.from(fence: fence) else {
            return .failure(.notRunnable(fence?.trimmingCharacters(in: .whitespaces) ?? "This block"))
        }
        switch language {
        case .plain: return .failure(.noLanguage)
        case .bash, .zsh: return .failure(.shell(language.title))
        default: break
        }
        guard let evaluator = allCases.first(where: { $0.language == language }) else {
            return .failure(.notRunnable(language.title))
        }
        return .success(evaluator)
    }
}
