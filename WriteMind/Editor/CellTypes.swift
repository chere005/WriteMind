import Foundation

/// What the + at the left-hand end of the insertion bar offers, and what
/// picking one does to the cell that seam opens.
///
/// Sean, 2026-09-20: "pressing the + button on that bar should bring up the
/// list of style types that the next input will create a cell the type of".
/// The bar arms exactly as it always did and the choice rides with it: the
/// seam opens ONE plain cell through `PreviewEditing.insertBlock`, and then
/// the very command the Format menu and the toolbar already run over the
/// cell the caret is in turns it into the kind that was chosen. One path,
/// the tested one — there is no second block builder here, and every entry
/// in the list is a command that shipped months ago.
///
/// The order matters and is the reason the type is applied to the cell
/// while it is still EMPTY, before a character goes in: `- `, `> `, `#### `
/// and a pair of fences all leave the caret where the words belong, so the
/// character typed at the bar simply lands after the marker. Applying the
/// command afterwards would have to hold the typed text in a selection and
/// would mean a different dance for the fenced block, which is not a
/// prefix at all.
///
/// The names are the app's own and invent nothing: the heading ladder as
/// the Format menu names it, the three list styles, the quote, and the
/// fenced block the Insert menu calls Code Block.
///
/// A TABLE IS NOT IN THE LIST. `MarkdownFormatting.insertTable` writes its
/// grid OVER the range it is given and selects the first header cell, so a
/// table opened this way either eats the character that opened it or
/// leaves it stranded beside a grid — a table is not a line, and making it
/// fit would mean the second builder this whole file exists to avoid.
/// Insert ▸ Table (⌃⌘T) is where it stays.
enum CellTypes {
    /// A kind of cell, as the + names it.
    enum Kind: Hashable {
        /// A paragraph — the default, and what an ordinary click on the
        /// bar arms (Sean, 2026-09-19: "default is always just text").
        case text
        case heading(MarkdownFormatting.Heading)
        case list(MarkdownFormatting.ListStyle)
        case quote
        case code

        /// What the menu calls it: the Format menu's word for the heading
        /// ladder and the lists, the Insert menu's for the fenced block.
        var name: String {
            switch self {
            case .text: return MarkdownFormatting.Heading.body.name
            case .heading(let level): return level.name
            case .list(let style): return "\(style.title) List"
            case .quote: return "Quote"
            case .code: return "Code Block"
            }
        }
    }

    /// The list, in the groups a separator goes between: body text on its
    /// own at the top because it is the default, then the ladder six deep
    /// (Sean's own rungs, not "Heading 1…6"), then the lists and the
    /// quote, then the fenced block.
    static let groups: [[Kind]] = [
        [.text],
        MarkdownFormatting.Heading.ladder.filter { $0 != .body }.map { Kind.heading($0) },
        MarkdownFormatting.ListStyle.allCases.map { Kind.list($0) } + [.quote],
        [.code],
    ]

    /// The same list, flat.
    static var all: [Kind] { groups.flatMap { $0 } }

    /// What choosing this does to the cell the caret is in — nil for plain
    /// text, which is the absence of a command rather than one of its own.
    ///
    /// Each of these is the command the menu item of the same name runs,
    /// handed the caret in the empty cell instead of the caret in the note.
    static func opening(_ kind: Kind, in markdown: String, at caret: Int) -> MarkdownFormatting.Edit? {
        let place = min(max(caret, 0), (markdown as NSString).length)
        let selection = NSRange(location: place, length: 0)
        switch kind {
        case .text:
            return nil
        case .heading(let level):
            // `evenIfEmpty`, because the cell is empty when the marker is
            // written and the ladder otherwise leaves a blank line alone.
            return MarkdownFormatting.setHeading(text: markdown, selection: selection, level: level,
                                                 evenIfEmpty: true)
        case .list(let style):
            return MarkdownFormatting.toggleList(text: markdown, selection: selection, style: style)
        case .quote:
            return MarkdownFormatting.toggleQuote(text: markdown, selection: selection)
        case .code:
            return MarkdownFormatting.codeBlock(text: markdown, selection: selection)
        }
    }

    /// A new cell of this kind at `offset`, with `written` already typed
    /// into it: the note, the cell's OWN range, and where the caret lands
    /// inside it.
    ///
    /// Both panes go through here and differ only in what they do with the
    /// answer — the markdown pane types the character itself through
    /// NSTextView and passes `written` empty, the rendered page has no text
    /// view at the bar and carries it in.
    static func open(_ kind: Kind, writing written: String = "", in markdown: String,
                     at offset: Int) -> (markdown: String, cell: NSRange, caret: Int) {
        let (opened, place) = PreviewEditing.insertBlock(in: markdown, at: offset)
        var text = opened as NSString
        var caret = min(max(place, 0), text.length)
        if let edit = opening(kind, in: text as String, at: caret) {
            text = text.replacingCharacters(in: edit.range, with: edit.replacement) as NSString
            caret = min(max(edit.selection.location, 0), text.length)
        }
        if !written.isEmpty {
            text = text.replacingCharacters(in: NSRange(location: caret, length: 0),
                                            with: written) as NSString
            caret = min(caret + (written as NSString).length, text.length)
        }
        return (text as String, cell(at: caret, in: text as String), caret)
    }

    /// The cell the caret has landed in — what the rendered page opens for
    /// typing.
    ///
    /// Asked in that order because the ends are ambiguous: the caret after
    /// `- ` is at the end of the bullet cell AND at the start of nothing,
    /// and the caret in an empty cell is at the start of the run of blank
    /// lines that cell is. A caret inside a cell always means that cell.
    private static func cell(at caret: Int, in markdown: String) -> NSRange {
        let blocks = MarkdownParser.positioned(from: markdown).map(\.range)
        if let inside = blocks.first(where: { $0.location < caret && caret < NSMaxRange($0) }) {
            return inside
        }
        if let starting = blocks.first(where: { $0.location == caret }) { return starting }
        if let ending = blocks.first(where: { NSMaxRange($0) == caret }) { return ending }
        return NSRange(location: caret, length: 0)
    }
}
