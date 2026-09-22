import Foundation

/// What came back from a run, and what the Out cell says.
struct EvalResult: Equatable {
    var stdout: String = ""
    var stderr: String = ""
    /// Nil when the run never finished — a timeout, or a tool that would
    /// not start.
    var status: Int32?
    var timedOut = false
    /// The output was longer than this app will put in a note.
    var truncated = false
    /// Something the app itself wants to say — a tool that would not
    /// start, an engine that is not activated.
    var note: String?
}

/// THE OUT CELL: a fenced block written into the note under the cell that
/// was run, and replaced by the next run of that same cell.
///
/// It is a `out` fence and nothing cleverer. `CodeLanguage.from(fence:)`
/// returns nil for it, so it draws as plain monospace everywhere already —
/// the rendered page, the source pane and the PDF — and
/// `MathMarkup.isMathFence` is false for it, so maths is untouched. No new
/// block case, no parser change, and the answer travels with the note into
/// any other markdown editor, which is the point of a note being a file.
///
/// ONE CONVENTION INSIDE IT: a line in square brackets is the app talking;
/// every other line came out of the process. That is the only way to tell
/// `[no output]` from a program that printed the words "no output".
enum EvalOutput {
    /// The info string an Out cell carries.
    static let fence = "out"
    /// How much of a run's output goes in a note. A cell that prints
    /// forever must not grow the file forever.
    static let byteLimit = 64 * 1024

    static func isOut(_ block: MarkdownBlock) -> Bool {
        guard case .code(let language, _) = block else { return false }
        return language?.trimmingCharacters(in: .whitespaces).lowercased() == fence
    }

    /// The whole cell, fences and all.
    static func cell(for result: EvalResult) -> String {
        "```\(fence)\n" + body(for: result) + "\n```"
    }

    /// What goes between the fences.
    static func body(for result: EvalResult) -> String {
        var lines: [String] = []
        // Trailing newlines go, because every program ends with one and
        // an Out cell should not end with a blank line. WHETHER there is
        // anything at all is asked of whitespace too: a program that
        // printed three spaces has said nothing, and a line of three
        // spaces in the note looks like a bug rather than an answer.
        let out = result.stdout.trimmingCharacters(in: .newlines)
        if !out.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines += out.components(separatedBy: "\n").map(escaped)
        }

        let errors = result.stderr.trimmingCharacters(in: .newlines)
        if !errors.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines.append("[stderr]")
            lines += errors.components(separatedBy: "\n").map(escaped)
        }
        if let note = result.note { lines.append("[\(note)]") }
        if result.truncated { lines.append("[output cut at \(byteLimit / 1024) KB]") }
        if result.timedOut { lines.append("[timed out]") }
        if let status = result.status, status != 0 { lines.append("[exit \(status)]") }
        // An Out cell is never an empty fence: a run that printed nothing
        // still has to look like a run that happened.
        return lines.isEmpty ? "[no output]" : lines.joined(separator: "\n")
    }

    /// A line of a program's output that would CLOSE THE FENCE, made
    /// harmless.
    ///
    /// `MarkdownParser` ends a fenced block at any line whose TRIMMED form
    /// begins with three backticks, so indenting does not save it — a
    /// program that prints ``` would end its own Out cell and the rest of
    /// the note would re-parse as code. A backslash in front is markdown's
    /// own escape and is what the parser no longer closes on.
    static func escaped(_ line: String) -> String {
        line.trimmingCharacters(in: .whitespaces).hasPrefix("```") ? "\\" + line : line
    }
}
