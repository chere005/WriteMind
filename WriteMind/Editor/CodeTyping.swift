import Foundation

/// What typing does inside a code cell (Sean, 2026-09-19: "in a code cell
/// in wysiwyg add basic features like auto {} () [] and tab inserts a
/// 4space width tab").
///
/// The rules every code editor has and prose does not: a bracket brings its
/// partner, typing the partner steps over it instead of doubling it,
/// backspace between the two takes both, and Tab is indentation rather than
/// the markdown indent command. All of it is decided here, over a string
/// and a selection, so the text view only has to apply the answer.
enum CodeTyping {
    /// The pairs that close themselves. The quotes are in it too: they are
    /// their own closer, which is why they need the "typing it again steps
    /// over it" rule more than the brackets do.
    static let pairs: [Character: Character] = ["(": ")", "[": "]", "{": "}",
                                                "\"": "\"", "'": "'", "`": "`"]
    /// A tab, shown four spaces wide by the editor's paragraph style.
    static let tab = "\t"

    /// One edit to the text: what to put where, and what is selected after.
    struct Edit: Equatable {
        var range: NSRange
        var replacement: String
        var selection: NSRange
    }

    // MARK: - Typing a character

    /// Nil means "nothing special": the character goes in as it would
    /// anywhere else.
    static func typing(_ input: String, in text: String, selection: NSRange) -> Edit? {
        guard input.count == 1, let character = input.first else { return nil }
        let ns = text as NSString
        let caret = min(max(selection.location, 0), ns.length)

        // Wrap what is selected, rather than replacing it.
        if selection.length > 0, let closer = pairs[character] {
            let inner = ns.substring(with: selection)
            return Edit(range: selection,
                        replacement: "\(character)\(inner)\(closer)",
                        selection: NSRange(location: selection.location + 1, length: selection.length))
        }

        let next: Character? = caret < ns.length ? Character(ns.substring(with: NSRange(location: caret, length: 1))) : nil
        let previous: Character? = caret > 0
            ? Character(ns.substring(with: NSRange(location: caret - 1, length: 1)))
            : nil

        // Typing the closer that is already there steps over it, so the
        // pair does not end up doubled.
        if let next, next == character, pairs.values.contains(character) {
            return Edit(range: NSRange(location: caret, length: 1), replacement: input,
                        selection: NSRange(location: caret + 1, length: 0))
        }

        guard let closer = pairs[character] else { return nil }

        // An apostrophe in a word is an apostrophe, not an opening quote.
        if character == closer, let previous, previous.isLetter || previous.isNumber { return nil }
        // Nor does a quote pair up when it is closing one already open.
        if character == closer, let next, next.isLetter || next.isNumber { return nil }

        return Edit(range: NSRange(location: caret, length: 0),
                    replacement: "\(character)\(closer)",
                    selection: NSRange(location: caret + 1, length: 0))
    }

    /// Backspace between the two halves of a pair takes both.
    static func backspace(in text: String, selection: NSRange) -> Edit? {
        guard selection.length == 0, selection.location > 0 else { return nil }
        let ns = text as NSString
        let caret = selection.location
        guard caret < ns.length else { return nil }
        let before = Character(ns.substring(with: NSRange(location: caret - 1, length: 1)))
        let after = Character(ns.substring(with: NSRange(location: caret, length: 1)))
        guard let closer = pairs[before], closer == after else { return nil }
        return Edit(range: NSRange(location: caret - 1, length: 2), replacement: "",
                    selection: NSRange(location: caret - 1, length: 0))
    }

    // MARK: - Tab

    /// Tab in code is indentation: one `unit` where the caret is, or a
    /// level on every line of a selection. Shift-Tab takes one off.
    ///
    /// The unit differs by where the typing is happening (Sean,
    /// 2026-09-20: "make tab enter 4 spaces in markdown code blocks but in
    /// wysiwyg make it an actual tab when copying"): the markdown pane
    /// writes four spaces, because that is what the file should hold and
    /// what every other reader will show; a code cell on the rendered page
    /// writes a real tab, so what you copy out of it is a tab.
    static func tabbing(in text: String, selection: NSRange, outdent: Bool,
                        unit: String = tab) -> Edit {
        let ns = text as NSString
        let lines = ns.lineRange(for: selection)
        let spansLines = selection.length > 0
            && ns.substring(with: selection).contains("\n")

        guard spansLines || outdent else {
            return Edit(range: selection, replacement: unit,
                        selection: NSRange(location: selection.location + (unit as NSString).length,
                                           length: 0))
        }

        // Every line of the selection, in or out by one level.
        let body = ns.substring(with: lines)
        let parts = body.components(separatedBy: "\n")
        var changed: [String] = []
        var removedFirst = 0
        var removed = 0
        for (index, line) in parts.enumerated() {
            if line.isEmpty, index == parts.count - 1 { changed.append(line); continue }
            if outdent {
                let taken = strippedLevel(line)
                if index == 0 { removedFirst = line.count - taken.count }
                removed += line.count - taken.count
                changed.append(taken)
            } else {
                changed.append(unit + line)
            }
        }
        let replacement = changed.joined(separator: "\n")
        let count = parts.filter { !($0.isEmpty && $0 == parts.last) }.count
        let width = (unit as NSString).length
        let selected = outdent
            ? NSRange(location: max(lines.location, selection.location - removedFirst),
                      length: max(0, selection.length - (removed - removedFirst)))
            : NSRange(location: selection.location + width,
                      length: selection.length + max(0, count - 1) * width)
        return Edit(range: lines, replacement: replacement, selection: selected)
    }

    /// Whether the caret is inside a fenced code block — where Tab is
    /// indentation rather than the markdown indent command.
    static func inFence(_ text: String, selection: NSRange) -> Bool {
        guard let block = NotebookCells.block(containing: selection.location, in: text) else {
            return false
        }
        if case .code = block.block { return true }
        return false
    }

    /// One level off the front of a line: a tab, or up to four spaces.
    static func strippedLevel(_ line: String) -> String {
        if line.hasPrefix(tab) { return String(line.dropFirst()) }
        // The spaces at the FRONT, up to four — `for … where` would have
        // counted the spaces between the words further along the line too.
        var taken = 0
        for character in line {
            guard character == " ", taken < 4 else { break }
            taken += 1
        }
        return String(line.dropFirst(taken))
    }
}
