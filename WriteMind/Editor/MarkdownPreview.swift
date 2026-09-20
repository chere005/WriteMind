import AppKit
import SwiftUI

/// The rendered note — and, since it is where Sean does the reading, where he
/// writes too.
///
/// Click a block and it becomes a real text view holding THAT BLOCK'S
/// markdown, styled as it is typed, with the whole toolbar live on it: bold,
/// the heading ladder, lists, quotes, indentation, the text style, maths.
/// Return starts the next block, ⌫ in an empty one takes it away, the arrows
/// walk between them, and the line that appears between two blocks adds one
/// wherever it is clicked. Only the block being edited is ever rewritten —
/// the whole document is never converted from rich text back to markdown,
/// which is the lossy step every WYSIWYG markdown editor gets wrong.
struct MarkdownPreview: View {
    @Binding var markdown: String
    /// A link to another note, as written in the markdown ("Other.md#wm-1234").
    var onFollow: ((String) -> Bool)?
    var editable: Bool = true
    /// What the toolbar talks through. The block being edited hands itself to
    /// it, which is what makes the buttons work on this side.
    var bridge: EditorBridge = EditorBridge()
    /// True while a block is open for editing — the bar uses it to decide
    /// whether its buttons do anything.
    var onEditingChanged: ((Bool) -> Void)?
    /// The bands the pictures and text boxes take, in document points. The
    /// blocks step over them, the way the source editor's text does.
    var keepClear: [CGRect] = []
    /// How far the preview has scrolled, so the drawing layer can scroll
    /// with it and a picture stays beside the block it was put next to.
    var onScroll: ((CGFloat) -> Void)?
    /// The cell at the top of the window, as a character offset — reported
    /// as the page scrolls, and asked for when the page appears, so the
    /// two modes show the same place (Sean, 2026-09-19: "positions stay
    /// the same in markdown and wysiwyg mode").
    var onTopCell: ((Int) -> Void)?
    var topCell: Int = 0
    /// The notebook sections that are folded away — the same set the
    /// markdown editor uses, so the notebook is the same on both sides.
    var collapsed: Set<String> = []
    var onToggleSection: ((String) -> Void)?

    @State private var rowHeights: [Int: CGFloat] = [:]
    /// The fence lines of the code block being typed in. The editor shows
    /// the code alone; these go back round it on every keystroke.
    @State private var fence: Fence?

    struct Fence: Equatable {
        var open: String
        var close: String
        var language: CodeLanguage { CodeLanguage.from(fence: MarkdownFormatting.fenceLanguage(open)) ?? .plain }
    }

    @State private var editingRange: NSRange?
    @State private var draft = ""
    @State private var focusToken = 0
    @State private var caretAtStart = false
    @State private var hoveredGap: Int?

    private static let space = "WriteMindPreview"
    /// The air above the first cell and below the last. Not private: the
    /// PDF export lays the same column out on paper and has to start it in
    /// the same place, or the drawing's objects would sit a margin off the
    /// text they were put beside.
    static let topInset: CGFloat = 22
    /// The page's left and right margin, the same both sides.
    static let sideInset: CGFloat = 28
    /// The ONE gap between two cells — the same four points everywhere,
    /// whatever the cells are (Sean, 2026-09-19: "gaps should just be a
    /// small fixed padding, not some varying amount"). No block adds
    /// padding of its own on top of it.
    ///
    /// Thin on purpose: cells sit against each
    /// other the way a notebook's do (Sean, 2026-09-19: "there shouldn't
    /// be gaps between cells"), and this is only enough to put the pointer
    /// in — the insertion line itself is drawn over the seam rather than
    /// inside a band of empty page.
    ///
    /// It is still part of the stack, so the brackets and the picture
    /// bands count it — leaving it out put every bracket a strip higher
    /// than its cell, and the error piled up down the page (Sean,
    /// 2026-09-19: "notebook bar placement bugs").
    static let gapHeight: CGFloat = 8

    /// What each block has to move down by to clear the pictures.
    private var pushes: [Int: CGFloat] {
        PreviewLayout.padding(rows: items.map { ($0.id, rowHeights[$0.id] ?? 0) },
                              spacing: Self.gapHeight, top: Self.topInset + Self.gapHeight,
                              bands: keepClear)
    }

    var body: some View {
        ScrollViewReader { page in
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Reports how far the content has scrolled, in the same
                // coordinates the drawing layer works in.
                GeometryReader { proxy in
                    Color.clear.preference(key: PreviewScrollKey.self,
                                           value: -proxy.frame(in: .named(Self.space)).minY)
                }
                .frame(height: 0)

                ForEach(items) { item in
                    gap(at: item.range.location)
                    row(item)
                        .id(item.id)
                        .padding(.top, pushes[item.id] ?? 0)
                        .background {
                            GeometryReader { proxy in
                                Color.clear.preference(key: PreviewRowHeights.self,
                                                       value: [item.id: proxy.size.height])
                            }
                        }
                }
                gap(at: (markdown as NSString).length)

                if editable {
                    // Somewhere to click that is not a block, to add one.
                    Color.clear
                        .frame(height: 80)
                        .contentShape(Rectangle())
                        .onTapGesture { insertBlock(at: (markdown as NSString).length) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Self.sideInset)
            .padding(.vertical, Self.topInset)
            // The cell brackets, in the margin the page already leaves.
            .overlay(alignment: .topTrailing) {
                CellBrackets(brackets: cellBrackets,
                             onSelect: { beginEditing($0) },
                             onToggle: { onToggleSection?($0) },
                             onMoveCell: { range, up in
                                 cellEdit { _, text in CellCommands.move(range, up: up, in: text) }
                             })
                    // As tall as the brackets go, not a fixed 4000 points:
                    // past that the page had cells with no bracket beside
                    // them (Sean, 2026-09-19: "make sure the notebook bars
                    // on the side work properly in markdown and wysiwyg
                    // mode").
                    .frame(height: CellBrackets.height(of: cellBrackets), alignment: .top)
                    // Clear of the scroller, and clear of the page's own
                    // right margin.
                    .padding(.trailing, 4)
                    .allowsHitTesting(editable)
            }
        }
        .coordinateSpace(name: Self.space)
        .onPreferenceChange(PreviewRowHeights.self) { heights in
            // The height a block WANTS, measured without its push — so the
            // padding never feeds back into the measurement.
            for (id, height) in heights {
                let push = pushes[id] ?? 0
                let bare = max(0, height - push)
                if abs((rowHeights[id] ?? -1) - bare) > 0.5 { rowHeights[id] = bare }
            }
        }
        .onPreferenceChange(PreviewScrollKey.self) { offset in
            onScroll?(offset)
            // Which cell the fold is on, for the other mode to open at.
            let places = PreviewLayout.positions(rows: items.map { ($0.id, rowHeights[$0.id] ?? 0) },
                                                 spacing: Self.gapHeight,
                                                 top: Self.topInset + Self.gapHeight,
                                                 bands: keepClear)
            if let top = PreviewLayout.topRow(positions: places, scroll: offset) { onTopCell?(top) }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: editingRange) { _, range in onEditingChanged?(range != nil) }
        .onAppear {
            // Open where the markdown pane was left, on the same cell.
            if topCell > 0,
               let block = MarkdownParser.positioned(from: markdown)
                .last(where: { $0.range.location <= topCell }) {
                DispatchQueue.main.async { page.scrollTo(block.range.location, anchor: .top) }
            }
            guard editable else { return }
            // Every button on the bar works on this side: pressing one with
            // nothing clicked opens a block first (Sean, 2026-09-19: "allow
            // wysiwyg editing including all the buttons on the bar").
            bridge.ensureEditing = { openSomething() }
            bridge.moveSectionInDocument = { up in moveWholeSection(up: up) }
            bridge.mergeCellsInDocument = { mergeCells() }
            bridge.cellAnchorInDocument = { y in cellAnchor(near: y) }
            bridge.cellTopInDocument = { anchor in cellTop(of: anchor) }
            bridge.cellRangeInDocument = { editingRange ?? items.first?.range }
            bridge.cellEditInDocument = { make in cellEdit(make) }
            bridge.cellBoxesInDocument = {
                places.map { FloatingHoming.CellBox(anchor: $0.key, top: $0.value.top,
                                                    bottom: $0.value.bottom) }
            }
        }
        .onDisappear {
            onEditingChanged?(false)
            bridge.ensureEditing = nil
            bridge.moveSectionInDocument = nil
            bridge.mergeCellsInDocument = nil
            bridge.cellAnchorInDocument = nil
            bridge.cellTopInDocument = nil
            bridge.cellBoxesInDocument = nil
            bridge.cellRangeInDocument = nil
            bridge.cellEditInDocument = nil
        }
        .environment(\.openURL, OpenURLAction { url in
            let destination = url.absoluteString
            // A note link is relative, so it arrives with no scheme.
            guard url.scheme == nil || url.scheme == "file",
                  let onFollow, onFollow(destination) else { return .systemAction }
            return .handled
        })
        }
    }

    // MARK: - What is on the page

    /// A rendered block, or the one being edited — which may be a block that
    /// is not in the document yet, and so has to be carried separately.
    private struct Item: Identifiable {
        let id: Int
        let range: NSRange
        let block: MarkdownBlock?
        let isEditing: Bool
    }

    /// What a folded section hides, in the markdown.
    private var hidden: [NSRange] {
        NotebookOutline.hiddenRanges(in: markdown, collapsed: collapsed)
    }

    private var items: [Item] {
        let folded = hidden
        let parsed = MarkdownParser.positioned(from: markdown).filter { block in
            // A block inside a closed section is not on the page at all.
            !folded.contains { NSIntersectionRange($0, block.range).length == block.range.length }
        }
        guard let editing = editingRange, editable else {
            return parsed.map { Item(id: $0.range.location, range: $0.range, block: $0.block, isEditing: false) }
        }

        func overlaps(_ range: NSRange) -> Bool {
            NSIntersectionRange(range, editing).length > 0 || range.location == editing.location
        }
        let edited = Item(id: editing.location, range: editing,
                          block: parsed.first { overlaps($0.range) }?.block, isEditing: true)

        var items: [Item] = []
        var placed = false
        for positioned in parsed {
            if overlaps(positioned.range) {
                if !placed { items.append(edited); placed = true }
                continue
            }
            if !placed, positioned.range.location > editing.location {
                items.append(edited)
                placed = true
            }
            items.append(Item(id: positioned.range.location, range: positioned.range,
                              block: positioned.block, isEditing: false))
        }
        if !placed { items.append(edited) }
        return items
    }

    /// A bracket for every cell, and one further out for every section
    /// that holds them.
    private var cellBrackets: [CellBrackets.Bracket] {
        let shown = items
        guard !shown.isEmpty else { return [] }
        let places = PreviewLayout.positions(rows: shown.map { ($0.id, rowHeights[$0.id] ?? 0) },
                                             spacing: Self.gapHeight, top: Self.topInset + Self.gapHeight,
                                             bands: keepClear)
        let sections = NotebookOutline.sections(in: markdown)
        var out: [CellBrackets.Bracket] = []

        for item in shown {
            guard let place = places[item.id], place.bottom - place.top > 1 else { continue }
            let depth = NotebookOutline.cellDepth(at: item.range.location, in: sections)
            out.append(CellBrackets.Bracket(key: "cell:\(item.id)", depth: depth,
                                            top: place.top, bottom: place.bottom,
                                            selected: editingRange == item.range, range: item.range))
        }

        // A drawing is a cell too, as tall as the drawing (Sean,
        // 2026-09-19: "drawings from the pen tool or that are grabbed from
        // the camera should go in a cell.. the cell is the height of the
        // drawn stuff"). It has no markdown behind it, so its bracket
        // selects nothing — it is there to show the cell.
        let beside = out.map { (top: $0.top, depth: $0.depth) }
        for ink in InkBands.cells(for: keepClear, beside: beside) {
            out.append(CellBrackets.Bracket(key: ink.key, depth: ink.depth,
                                            top: ink.top, bottom: ink.bottom,
                                            range: NSRange(location: NSNotFound, length: 0)))
        }

        for section in sections {
            let inside = shown.filter {
                NSIntersectionRange($0.range, section.range).length == $0.range.length
            }
            let places = inside.compactMap { places[$0.id] }
            guard let first = places.map(\.top).min(), let last = places.map(\.bottom).max(),
                  last - first > 1
            else { continue }
            out.append(CellBrackets.Bracket(key: section.key, depth: section.depth,
                                            top: first, bottom: last,
                                            collapsed: collapsed.contains(section.key),
                                            foldable: true, range: section.range))
        }
        return out
    }

    @ViewBuilder
    private func row(_ item: Item) -> some View {
        if item.isEditing {
            BlockEditor(text: draftBinding,
                        font: BlockView.editingNSFont(item.block),
                        bridge: bridge,
                        focusToken: focusToken,
                        caretAtStart: caretAtStart,
                        placeholder: fence == nil
                            ? "Write something — ⌘1 a title, ⇧⌘L a list, ⌃⌘Q a quote"
                            : "Type the code",
                        keepsNewlines: Self.keepsNewlines(item.block),
                        language: fence?.language,
                        onSplit: { head, tail in split(head: head, tail: tail) },
                        onDeleteEmpty: { removeBlock() },
                        onMove: { move($0) })
                // The same room the rendered block has — nothing at all
                // for prose, the code block's own twelve for a fence — so
                // opening a cell moves no text (Sean, 2026-09-19: "gaps
                // should just be a small fixed padding").
                .padding(.horizontal, fence == nil ? 0 : 12)
                .padding(.vertical, fence == nil ? 0 : 12)
                // A code block being typed in keeps looking like a code
                // block, so nothing jumps when it is clicked.
                .background(fence == nil ? AnyShapeStyle(Color.accentColor.opacity(0.07))
                                         : AnyShapeStyle(CodeColours.background),
                            in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.accentColor.opacity(0.35)))
        } else if case .table(let table)? = item.block, editable {
            // A table is typed into as a grid, not as its markdown (Sean's
            // to-do list: "a grid you tab through"). The bracket beside it
            // still opens the raw lines.
            TableEditor(table: table) { edited in replace(item.range, with: edited) }
        } else if let block = item.block {
            // NO .textSelection here. A selectable Text takes the click
            // itself, so tapping the WORDS of a block did nothing and only
            // the empty space beside them opened it — which reads as "I
            // can't edit this" (Sean, 2026-09-19: "i still cant do things
            // like edit code or text etc in wysiwyg editing"). Selecting
            // text is what the editor that opens is for.
            BlockView(block: block)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { beginEditing(item.range) }
        }
    }

    /// The line between two blocks: hover it and it offers to put one there.
    @ViewBuilder
    /// The space between two cells. The pointer turns on its side there
    /// and a bar runs across the page — Wolfram's insertion point, and
    /// Jupyter's (Sean, 2026-09-19: "there should be the horizontal cursor
    /// and bar for inserting between cells"). Clicking it opens a new cell,
    /// and a new cell is always plain text.
    private func gap(at offset: Int) -> some View {
        if editable {
            ZStack(alignment: .leading) {
                Color.clear.frame(height: Self.gapHeight)
                if hoveredGap == offset {
                    HStack(spacing: 6) {
                        Image(systemName: "plus.circle.fill").font(.system(size: 11))
                        Capsule().frame(height: 2)
                    }
                    .foregroundStyle(Color.accentColor)
                    // Drawn over the seam, not inside it: the strip is
                    // four points tall and the mark is bigger than that.
                    .frame(height: 12)
                    .transition(.opacity)
                }
            }
            .contentShape(Rectangle())
            .onContinuousHover(coordinateSpace: .local) { phase in
                switch phase {
                case .active:
                    if hoveredGap != offset { hoveredGap = offset }
                    // Set on every move, not pushed once: the text views
                    // either side put their own cursors back the moment the
                    // pointer touches them.
                    NSCursor.iBeamCursorForVerticalLayout.set()
                case .ended:
                    if hoveredGap == offset { hoveredGap = nil }
                }
            }
            .onTapGesture { insertBlock(at: offset) }
            .help("A new cell here — plain text, whatever is above it")
        }
    }

    // MARK: - Editing

    /// Every keystroke goes straight into the note, at the block's own range.
    /// Nothing is held back to be "committed", so a click anywhere else, a
    /// crash, or a save in between can never lose what was typed.
    private var draftBinding: Binding<String> {
        Binding(get: { draft }, set: { typed in
            draft = typed
            guard let range = editingRange else { return }
            let ns = markdown as NSString
            guard NSMaxRange(range) <= ns.length else { return }
            let stored = fence.map {
                MarkdownFormatting.refenced(open: $0.open, body: typed, close: $0.close)
            } ?? typed
            markdown = ns.replacingCharacters(in: range, with: stored)
            editingRange = NSRange(location: range.location, length: (stored as NSString).length)
        })
    }

    private func beginEditing(_ range: NSRange, caretAtStart: Bool = false) {
        guard editable else { return }
        let ns = markdown as NSString
        guard NSMaxRange(range) <= ns.length else { return }
        let source = ns.substring(with: range)
        // A fenced block is opened as its CODE: the fences stay put and
        // what is typed is coloured for the language they name.
        if let parts = MarkdownFormatting.fenced(source) {
            fence = Fence(open: parts.open, close: parts.close)
            draft = parts.body
        } else {
            fence = nil
            draft = source
        }
        editingRange = range
        self.caretAtStart = caretAtStart
        focusToken += 1
    }

    /// Something to type in: whatever is already open, else the block the
    /// caret was last in, else the first one — and a new one when the note
    /// is empty.
    private func openSomething() -> Bool {
        guard editable else { return false }
        if editingRange != nil { return true }
        let parsed = MarkdownParser.positioned(from: markdown)
        if let first = parsed.first {
            beginEditing(first.range)
        } else {
            insertBlock(at: (markdown as NSString).length)
        }
        return true
    }

    /// Moving a section from the preview moves it in the whole note, with
    /// the block being edited standing in for the caret.
    /// Where each cell sits on the rendered page, measured.
    private var places: [Int: (top: CGFloat, bottom: CGFloat)] {
        PreviewLayout.positions(rows: items.map { ($0.id, rowHeights[$0.id] ?? 0) },
                                spacing: Self.gapHeight, top: Self.topInset + Self.gapHeight,
                                bands: keepClear)
    }

    /// The cell a point down the page belongs to — an object dropped there
    /// remembers it, so it is beside the same cell in the markdown pane.
    private func cellAnchor(near y: CGFloat) -> Int? {
        PreviewLayout.topRow(positions: places, scroll: y)
    }

    /// Where that cell starts here.
    private func cellTop(of anchor: Int) -> CGFloat? {
        guard let block = MarkdownParser.positioned(from: markdown)
            .last(where: { $0.range.location <= anchor }) else { return nil }
        return places[block.range.location]?.top
    }

    /// A whole-cell edit — delete, duplicate, move — over the note, with
    /// the cell that is open (or the first one) as the subject. A cell on
    /// this side is a block, so the edit cannot go through one block's own
    /// text view (Sean, 2026-09-20: "make cells behave like mathematica
    /// cells").
    private func cellEdit(_ make: (NSRange, String) -> MarkdownFormatting.Edit?) {
        let cell = editingRange ?? items.first?.range
        guard let cell, let edit = make(cell, markdown) else { return }
        let updated = (markdown as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        markdown = updated
        // Follow the cell: to where it went, or to whatever moved up into
        // the place of the one that was taken away.
        if let block = MarkdownParser.positioned(from: updated)
            .first(where: { NSLocationInRange(edit.selection.location, $0.range)
                || $0.range.location == edit.selection.location }) {
            beginEditing(block.range)
        } else {
            editingRange = nil
        }
    }

    /// Joining the open cell to the one after it. The seam is between two
    /// blocks, so it is the note that is edited, not the block's own text
    /// view (Sean, 2026-09-19: "cmd+d and cmd+m to split and merge cells").
    private func mergeCells() {
        let inside = bridge.textView?.selectedRange().location ?? 0
        let caret = (editingRange?.location ?? 0) + inside
        guard let edit = NotebookCells.merge(text: markdown,
                                             selection: NSRange(location: caret, length: 0))
        else { return }
        let updated = (markdown as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        markdown = updated
        // Stay in the cell the two became.
        if editingRange != nil,
           let block = MarkdownParser.positioned(from: updated)
            .first(where: { NSLocationInRange(edit.selection.location, $0.range) }) {
            beginEditing(block.range)
        }
    }

    /// A table's block, rewritten as the lines of the table it now is.
    private func replace(_ range: NSRange, with table: MarkdownTable) {
        let text = markdown as NSString
        guard range.location >= 0, NSMaxRange(range) <= text.length else { return }
        // The block's range stops at the last line; whatever followed it —
        // the blank line, the next cell — is left exactly as it was.
        let kept = text.substring(with: range)
        let trailing = kept.hasSuffix("\n") ? "\n" : ""
        markdown = text.replacingCharacters(in: range,
                                            with: table.lines.joined(separator: "\n") + trailing)
    }

    private func moveWholeSection(up: Bool) {
        let caret = editingRange?.location ?? 0
        guard let edit = NotebookOutline.moveSection(text: markdown,
                                                     selection: NSRange(location: caret, length: 0), up: up)
        else { return }
        let updated = (markdown as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        markdown = updated
        // Follow the section to where it went.
        if editingRange != nil {
            let parsed = MarkdownParser.positioned(from: updated)
            let landing = edit.selection.location
            if let block = parsed.first(where: { NSLocationInRange(landing, $0.range) }) ?? parsed.first {
                beginEditing(block.range)
            }
        }
    }

    private func insertBlock(at offset: Int) {
        guard editable else { return }
        let (updated, caret) = PreviewEditing.insertBlock(in: markdown, at: offset)
        markdown = updated
        // Always a plain text cell, whatever the cell above it was (Sean,
        // 2026-09-19: "default is always just text").
        fence = nil
        draft = ""
        editingRange = NSRange(location: caret, length: 0)
        caretAtStart = true
        focusToken += 1
        hoveredGap = nil
    }

    private func split(head: String, tail: String) {
        guard let range = editingRange, fence == nil else { return }
        let (updated, editing) = PreviewEditing.split(markdown, at: range, head: head, tail: tail)
        markdown = updated
        draft = tail
        editingRange = editing
        caretAtStart = true
        focusToken += 1
    }

    private func removeBlock() {
        guard let range = editingRange else { return }
        let (updated, previous) = PreviewEditing.removeBlock(markdown, at: range)
        markdown = updated
        if let previous {
            beginEditing(previous)
        } else {
            editingRange = nil
        }
    }

    private func move(_ move: BlockEditor.Move) {
        guard let range = editingRange else { return }
        let parsed = MarkdownParser.positioned(from: markdown)
        switch move {
        case .out:
            editingRange = nil
        case .up:
            if let previous = parsed.last(where: { NSMaxRange($0.range) <= range.location }) {
                beginEditing(previous.range)
            } else {
                editingRange = nil
            }
        case .down:
            if let next = parsed.first(where: { $0.range.location >= NSMaxRange(range) }) {
                beginEditing(next.range, caretAtStart: true)
            } else {
                insertBlock(at: (markdown as NSString).length)
            }
        }
    }

    /// Return adds a line to a list, a quote or a fenced block; anywhere else
    /// it starts the next block.
    private static func keepsNewlines(_ block: MarkdownBlock?) -> Bool {
        switch block {
        case .bullets, .dashes, .numbered, .quote, .code, .table: return true
        default: return false
        }
    }

    // MARK: - Rendering

    struct BlockView: View {
        let block: MarkdownBlock
        @Environment(\.notePaper) private var paper

        var body: some View {
            switch block {
            case .heading(let level, let text):
                Text(MarkdownInline.attributed(text, baseSize: Self.headingSize(level), paper: paper))
                    .font(Self.headingFont(level))
                    .italic(level == 6)
                    .foregroundStyle(level >= 5 ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                    .padding(.top, level <= 2 ? 8 : 4)
            case .paragraph(let text):
                Text(MarkdownInline.attributed(text, paper: paper))
                    .font(.system(size: 15))
                    .lineSpacing(4)
            case .bullets(let items):
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(.secondary)
                            Text(MarkdownInline.attributed(item, paper: paper)).font(.system(size: 15))
                        }
                    }
                }
                .padding(.leading, 8)
            case .dashes(let items):
                // The same list, written with `* `, marked with a dash.
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\u{2013}").foregroundStyle(.secondary)
                            Text(MarkdownInline.attributed(item, paper: paper)).font(.system(size: 15))
                        }
                    }
                }
                .padding(.leading, 8)
            case .numbered(let items):
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(index + 1).").foregroundStyle(.secondary).monospacedDigit()
                            Text(MarkdownInline.attributed(item, paper: paper)).font(.system(size: 15))
                        }
                    }
                }
                .padding(.leading, 8)
            case .quote(let text):
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.6)).frame(width: 3)
                    Text(MarkdownInline.attributed(text, paper: paper))
                        .font(.system(size: 15))
                        .italic()
                        .foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            case .code(let language, let body) where MathMarkup.isMathFence(language):
                // Maths on its own line, set properly rather than shown as code.
                MathView(source: body, size: 21)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 6)
            case .code(let language, let body):
                // Coloured when the fence names a language this app knows,
                // plain monospace otherwise (Sean, 2026-09-19).
                Text(CodeColours.attributed(body, language: CodeLanguage.from(fence: language) ?? .plain))
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(CodeColours.background, in: RoundedRectangle(cornerRadius: 6))
            case .table(let table):
                TableBlock(table: table)
            case .blank(let lines):
                // A cell of empty lines: as tall as those lines, and
                // clickable, so it can be typed into (Sean, 2026-09-20).
                Color.clear
                    .frame(height: CGFloat(lines) * 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
            case .rule:
                Divider().padding(.vertical, 4)
            }
        }

        /// Title · Header · Section · Subsection · Subsubsection · Author
        /// subheader — the last is italic and slightly BIGGER than body (15),
        /// not smaller, which is the whole point of it.
        static func headingSize(_ level: Int) -> CGFloat {
            switch level {
            case 1: return 28
            case 2: return 22
            case 3: return 18
            case 4: return 16
            case 5: return 15
            default: return 17
            }
        }

        static func headingFont(_ level: Int) -> Font {
            let size = headingSize(level)
            switch level {
            case 1: return .system(size: size, weight: .bold)
            case 2, 3, 4, 5: return .system(size: size, weight: .semibold)
            default: return .system(size: size, weight: .regular)
            }
        }

        /// What the in-place editor writes in. The heading sizes come from the
        /// `#` markers as they are typed, so this is only about code.
        static func editingNSFont(_ block: MarkdownBlock?) -> NSFont {
            if case .code = block { return .monospacedSystemFont(ofSize: 13, weight: .regular) }
            return .systemFont(ofSize: 15)
        }
    }
}


/// What the blocks are being drawn ON, as `#RRGGBB`.
///
/// Nil on screen, where the preview's background is the very thing the
/// colours were picked against. The PDF export sets it to white, because
/// paper is white whatever the window is, and a `<span style="color:…">`
/// that reads on a dark editor is not there at all on a printed page
/// (Sean, 2026-09-19: "be mindful of text color... it should always be
/// visible against the background"). `MarkdownInline` does the checking;
/// this only says what it is checking against.
struct NotePaperKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var notePaper: String? {
        get { self[NotePaperKey.self] }
        set { self[NotePaperKey.self] = newValue }
    }
}


/// A table in the preview: the header in bold over a rule, and grid lines
/// only when the markdown asked for them (Sean, 2026-09-19: "add tables with
/// grids or no grids").
struct TableBlock: View {
    let table: MarkdownTable
    @Environment(\.notePaper) private var paper

    private var lineColour: Color { Color.primary.opacity(0.18) }

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(table.header.enumerated()), id: \.offset) { _, cell in
                    cellView(cell, bold: true)
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal).overlay(lineColour)
            ForEach(Array(table.rows.enumerated()), id: \.offset) { index, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                        cellView(cell, bold: false)
                    }
                }
                if table.grid, index < table.rows.count - 1 {
                    Divider().gridCellUnsizedAxes(.horizontal).overlay(lineColour)
                }
            }
        }
        .padding(table.grid ? 0 : 2)
        .background {
            if table.grid {
                RoundedRectangle(cornerRadius: 4).strokeBorder(lineColour)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func cellView(_ cell: String, bold: Bool) -> some View {
        Text(MarkdownInline.attributed(cell, paper: paper))
            .font(.system(size: 14, weight: bold ? .semibold : .regular))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .trailing) {
                if table.grid { Rectangle().fill(lineColour).frame(width: 1) }
            }
    }
}


/// The measured height of every block, so the pictures' bands can be
/// stepped over without the padding changing what was measured.
private struct PreviewRowHeights: PreferenceKey {
    static let defaultValue: [Int: CGFloat] = [:]
    static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) {
        value.merge(nextValue()) { _, new in new }
    }
}

private struct PreviewScrollKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
