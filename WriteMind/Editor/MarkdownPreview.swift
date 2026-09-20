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

    @State private var rowHeights: [Int: CGFloat] = [:]

    @State private var editingRange: NSRange?
    @State private var draft = ""
    @State private var focusToken = 0
    @State private var caretAtStart = false
    @State private var hoveredGap: Int?

    private static let space = "WriteMindPreview"
    private static let topInset: CGFloat = 22

    /// What each block has to move down by to clear the pictures.
    private var pushes: [Int: CGFloat] {
        PreviewLayout.padding(rows: items.map { ($0.id, rowHeights[$0.id] ?? 0) },
                              spacing: 0, top: Self.topInset, bands: keepClear)
    }

    var body: some View {
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
            .padding(.horizontal, 28)
            .padding(.vertical, Self.topInset)
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
        .onPreferenceChange(PreviewScrollKey.self) { onScroll?($0) }
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: editingRange) { _, range in onEditingChanged?(range != nil) }
        .onAppear {
            guard editable else { return }
            // Every button on the bar works on this side: pressing one with
            // nothing clicked opens a block first (Sean, 2026-09-19: "allow
            // wysiwyg editing including all the buttons on the bar").
            bridge.ensureEditing = { openSomething() }
            bridge.moveSectionInDocument = { up in moveWholeSection(up: up) }
        }
        .onDisappear {
            onEditingChanged?(false)
            bridge.ensureEditing = nil
            bridge.moveSectionInDocument = nil
        }
        .environment(\.openURL, OpenURLAction { url in
            let destination = url.absoluteString
            // A note link is relative, so it arrives with no scheme.
            guard url.scheme == nil || url.scheme == "file",
                  let onFollow, onFollow(destination) else { return .systemAction }
            return .handled
        })
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

    private var items: [Item] {
        let parsed = MarkdownParser.positioned(from: markdown)
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

    @ViewBuilder
    private func row(_ item: Item) -> some View {
        if item.isEditing {
            BlockEditor(text: draftBinding,
                        font: BlockView.editingNSFont(item.block),
                        bridge: bridge,
                        focusToken: focusToken,
                        caretAtStart: caretAtStart,
                        placeholder: "Write something — ⌘1 a title, ⇧⌘L a list, ⌃⌘Q a quote",
                        keepsNewlines: Self.keepsNewlines(item.block),
                        onSplit: { head, tail in split(head: head, tail: tail) },
                        onDeleteEmpty: { removeBlock() },
                        onMove: { move($0) })
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(Color.accentColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.accentColor.opacity(0.35)))
                .padding(.vertical, 2)
        } else if let block = item.block {
            // NO .textSelection here. A selectable Text takes the click
            // itself, so tapping the WORDS of a block did nothing and only
            // the empty space beside them opened it — which reads as "I
            // can't edit this" (Sean, 2026-09-19: "i still cant do things
            // like edit code or text etc in wysiwyg editing"). Selecting
            // text is what the editor that opens is for.
            BlockView(block: block)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 3)
                .contentShape(Rectangle())
                .onTapGesture { beginEditing(item.range) }
        }
    }

    /// The line between two blocks: hover it and it offers to put one there.
    @ViewBuilder
    private func gap(at offset: Int) -> some View {
        if editable {
            ZStack(alignment: .leading) {
                Color.clear.frame(height: 12)
                if hoveredGap == offset {
                    HStack(spacing: 6) {
                        Image(systemName: "plus.circle.fill").font(.system(size: 12))
                        Rectangle().frame(height: 1)
                    }
                    .foregroundStyle(Color.accentColor.opacity(0.75))
                }
            }
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { hoveredGap = offset }
                else if hoveredGap == offset { hoveredGap = nil }
            }
            .onTapGesture { insertBlock(at: offset) }
            .help("Add a block here")
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
            markdown = ns.replacingCharacters(in: range, with: typed)
            editingRange = NSRange(location: range.location, length: (typed as NSString).length)
        })
    }

    private func beginEditing(_ range: NSRange, caretAtStart: Bool = false) {
        guard editable else { return }
        let ns = markdown as NSString
        guard NSMaxRange(range) <= ns.length else { return }
        draft = ns.substring(with: range)
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
        draft = ""
        editingRange = NSRange(location: caret, length: 0)
        caretAtStart = true
        focusToken += 1
        hoveredGap = nil
    }

    private func split(head: String, tail: String) {
        guard let range = editingRange else { return }
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

        var body: some View {
            switch block {
            case .heading(let level, let text):
                Text(MarkdownInline.attributed(text, baseSize: Self.headingSize(level)))
                    .font(Self.headingFont(level))
                    .italic(level == 6)
                    .foregroundStyle(level >= 5 ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                    .padding(.top, level <= 2 ? 8 : 4)
            case .paragraph(let text):
                Text(MarkdownInline.attributed(text))
                    .font(.system(size: 15))
                    .lineSpacing(4)
            case .bullets(let items):
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(.secondary)
                            Text(MarkdownInline.attributed(item)).font(.system(size: 15))
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
                            Text(MarkdownInline.attributed(item)).font(.system(size: 15))
                        }
                    }
                }
                .padding(.leading, 8)
            case .numbered(let items):
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(index + 1).").foregroundStyle(.secondary).monospacedDigit()
                            Text(MarkdownInline.attributed(item)).font(.system(size: 15))
                        }
                    }
                }
                .padding(.leading, 8)
            case .quote(let text):
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.6)).frame(width: 3)
                    Text(MarkdownInline.attributed(text))
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


/// A table in the preview: the header in bold over a rule, and grid lines
/// only when the markdown asked for them (Sean, 2026-09-19: "add tables with
/// grids or no grids").
struct TableBlock: View {
    let table: MarkdownTable

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
        Text(MarkdownInline.attributed(cell))
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
