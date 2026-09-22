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

    /// AN EVALUATION CELL AND ITS ANSWER ARE ONE GROUP — the In/Out pair
    /// a notebook draws one bracket round (Sean, 2026-09-21: "input and
    /// output cells are grouped together").
    ///
    /// It is not a section: nothing is folded and nothing is nested by
    /// it in the note. It is two adjacent cells the gutter embraces, so
    /// that the answer visibly belongs to the code above it and moving
    /// your eye down the margin tells you which is which.
    struct Group: Equatable {
        var input: NSRange
        var output: NSRange
        var key: String
        /// The two of them, end to end.
        var range: NSRange {
            NSRange(location: input.location, length: NSMaxRange(output) - input.location)
        }
    }

    static func groups(in text: String) -> [Group] {
        let blocks = MarkdownParser.positioned(from: text)
        var out: [Group] = []
        for (index, block) in blocks.enumerated() {
            guard case .code(let language, _) = block.block,
                  Evaluator.isEvaluation(fence: language),
                  index + 1 < blocks.count,
                  EvalOutput.isOut(blocks[index + 1].block)
            else { continue }
            out.append(Group(input: block.range, output: blocks[index + 1].range,
                             key: "eval:\(block.range.location)"))
        }
        return out
    }

    /// Whether a cell is inside a group — which is what pushes its own
    /// bracket one step in, so the group's sits outside it.
    static func isGrouped(_ cell: NSRange, in groups: [Group]) -> Bool {
        groups.contains { NSEqualRanges($0.input, cell) || NSEqualRanges($0.output, cell) }
    }

    /// WHERE THE BAR GOES WHEN A CELL HAS FINISHED: the start of the
    /// next cell, which is the offset both panes already read as "the
    /// seam under this one" (arming parks the caret at the separator and
    /// `NotebookCells.block(containing:)` reads that as the cell below).
    /// The end of the note when there is nothing after it.
    static func seam(after cell: NSRange, in text: String) -> Int {
        let blocks = MarkdownParser.positioned(from: text)
        if let index = blocks.firstIndex(where: { $0.range.location == cell.location }),
           index + 1 < blocks.count {
            return blocks[index + 1].range.location
        }
        return (text as NSString).length
    }

    /// Changing a cell's environment rewrites its fence and nothing else
    /// — the body is untouched, and so is any Out cell under it. This is
    /// also what TURNS A CELL INTO AN EVALUATION CELL (⌘9 over a fenced
    /// block): the fence goes from `python` to `eval python`, and a code
    /// cell becomes a cell the note runs.
    ///
    /// The open line is replaced whole rather than patched, because an
    /// info string is one opaque string to the parser and picking it
    /// apart is how a second reader of it gets invented.
    static func setEnvironment(_ evaluator: Evaluator, of cell: NSRange,
                               in text: String) -> MarkdownFormatting.Edit? {
        let ns = text as NSString
        guard NSMaxRange(cell) <= ns.length else { return nil }
        let open = ns.lineRange(for: NSRange(location: cell.location, length: 0))
        let line = ns.substring(with: open).trimmingCharacters(in: .newlines)
        guard line.trimmingCharacters(in: .whitespaces).hasPrefix("```") else { return nil }
        let replacement = "```" + evaluator.fence
        guard replacement != line else { return nil }
        return MarkdownFormatting.Edit(
            range: NSRange(location: open.location, length: (line as NSString).length),
            replacement: replacement,
            selection: NSRange(location: open.location + (replacement as NSString).length, length: 0))
    }

    /// ⌘9 — an evaluation cell here. An existing fenced block becomes
    /// one; anything else gets a new one after it.
    ///
    /// Nothing is thrown away: a Python code cell keeps its code and its
    /// colouring and simply starts running, which is what "turn this into
    /// an evaluation cell" has to mean for it to be worth a key.
    static func makeEvaluation(_ evaluator: Evaluator, at cell: NSRange?,
                               in text: String) -> MarkdownFormatting.Edit {
        if let cell, NSMaxRange(cell) <= (text as NSString).length,
           MarkdownFormatting.fenced((text as NSString).substring(with: cell)) != nil,
           let converted = setEnvironment(evaluator, of: cell, in: text) {
            return converted
        }
        let fresh = "```\(evaluator.fence)\n\n```"
        guard let cell else {
            let end = (text as NSString).length
            return MarkdownFormatting.Edit(range: NSRange(location: end, length: 0),
                                           replacement: (text.isEmpty ? "" : "\n\n") + fresh,
                                           selection: NSRange(location: end, length: 0))
        }
        return CellCommands.paste(fresh, after: cell, in: text)
    }
}
