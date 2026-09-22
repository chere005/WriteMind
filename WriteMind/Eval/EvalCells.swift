import Foundation

/// Where an Out cell goes, and what gets replaced when the same cell is
/// run again.
///
/// FOUND BY POSITION, VETOED BY THE TAG: the answer to a cell is the block
/// immediately after it, and only when that block is an `out` fence. By
/// position, because every other cell identity in this app is a character
/// offset and a note is not a database; vetoed by the tag, because
/// otherwise a re-run would overwrite whatever the person happened to have
/// written under the code.
enum EvalCells {
    /// The cell the caret is in, if it is a fenced block — what ⌘9 runs.
    static func runnable(at caret: Int, in text: String) -> PositionedBlock? {
        guard let block = MarkdownParser.positioned(from: text)
            .first(where: { NSLocationInRange(caret, $0.range) || $0.range.location == caret })
        else { return nil }
        guard case .code = block.block else { return nil }
        return block
    }

    /// The Out cell belonging to this one, if it has one already.
    static func out(after cell: NSRange, in text: String) -> PositionedBlock? {
        let blocks = MarkdownParser.positioned(from: text)
        guard let index = blocks.firstIndex(where: { $0.range.location == cell.location }),
              index + 1 < blocks.count
        else { return nil }
        let next = blocks[index + 1]
        return EvalOutput.isOut(next.block) ? next : nil
    }

    /// The edit that puts a result under a cell: over the Out cell that is
    /// already there, or a new one after it.
    ///
    /// Replacing uses the Out block's OWN range and never
    /// `CellCommands.extent`, which deliberately swallows the blank line
    /// after a cell and would glue the answer to whatever is below.
    static func write(_ result: EvalResult, under cell: NSRange,
                      in text: String) -> MarkdownFormatting.Edit {
        let written = EvalOutput.cell(for: result)
        if let existing = out(after: cell, in: text) {
            return MarkdownFormatting.Edit(range: existing.range, replacement: written,
                                           selection: NSRange(location: existing.range.location,
                                                              length: 0))
        }
        return CellCommands.paste(written, after: cell, in: text)
    }

    /// A range that was measured before an edit, where it is afterwards.
    ///
    /// An Out cell lands BELOW the cell that was run, so anything the
    /// person is holding further down the note — a cell open for typing, a
    /// handful held by their brackets, the bar between two of them —
    /// moves by however much longer the note just got. Nothing else shifts
    /// those, because nothing else edits a note from outside the pane the
    /// caret is in.
    static func shifted(_ range: NSRange, by edit: MarkdownFormatting.Edit) -> NSRange {
        let change = (edit.replacement as NSString).length - edit.range.length
        guard change != 0, range.location >= NSMaxRange(edit.range) else { return range }
        return NSRange(location: range.location + change, length: range.length)
    }

    static func shifted(_ offset: Int, by edit: MarkdownFormatting.Edit) -> Int {
        let change = (edit.replacement as NSString).length - edit.range.length
        guard change != 0, offset >= NSMaxRange(edit.range) else { return offset }
        return offset + change
    }

    /// Changing a cell's environment rewrites its fence and nothing else —
    /// the body is untouched, and so is any Out cell under it.
    ///
    /// The open line is replaced whole rather than patched, because an
    /// info string is one opaque string to the parser and picking it apart
    /// is how a second reader of it gets invented.
    static func setEnvironment(_ evaluator: Evaluator, of cell: NSRange,
                               in text: String) -> MarkdownFormatting.Edit? {
        let ns = text as NSString
        guard NSMaxRange(cell) <= ns.length else { return nil }
        let open = ns.lineRange(for: NSRange(location: cell.location, length: 0))
        let line = ns.substring(with: open).trimmingCharacters(in: .newlines)
        guard line.trimmingCharacters(in: .whitespaces).hasPrefix("```") else { return nil }
        let replacement = "```" + evaluator.language.fence
        guard replacement != line else { return nil }
        return MarkdownFormatting.Edit(
            range: NSRange(location: open.location, length: (line as NSString).length),
            replacement: replacement,
            selection: NSRange(location: open.location + (replacement as NSString).length, length: 0))
    }
}
