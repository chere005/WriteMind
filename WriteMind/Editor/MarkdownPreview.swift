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
    /// False while the pen, the arrow tool or a placement is up: the
    /// pencil owns the note pane then (Sean, 2026-09-20: "cursor only
    /// becomes a pen in the notes pane in drawing mode!!!!!"), so the
    /// pointer is never horizontal and no seam can be armed. The same
    /// switch the markdown pane has, off the same expression.
    var seamsEnabled: Bool = true

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
    /// The cells held by their brackets — several of them, discontiguous,
    /// and none of them open for typing (Sean, 2026-09-20: "fix selecting
    /// multiple cells by clicking and dragging, shift clicking, or cmd
    /// clicking").
    ///
    /// Separate from `editingRange`, which is the ONE cell open for typing:
    /// a cell you are in and a cell you are holding are different things,
    /// and the rendered page has no text view to keep the second in the way
    /// the markdown pane keeps it in `tv.selectedRanges`.
    @State private var selectedCells: [NSRange] = []
    @State private var draft = ""
    @State private var focusToken = 0
    @State private var caretAtStart = false
    @State private var hoveredSeam: SeamID?
    /// The seam the bar is sitting in, waiting to be typed into. Nothing
    /// is written there until a key says so (Sean, 2026-09-20: "when
    /// clicking in between, the horizontal line appears and that is where
    /// the cursor is"), so clicking about the page leaves no empty cells
    /// behind.
    @State private var armedSeam: SeamID?
    /// The armed seam holds the keyboard, because the bar IS the cursor
    /// and there is no text view to hold it on this side.
    @FocusState private var focusedSeam: SeamID?
    /// And the bracket column holds it while cells are held, for the same
    /// reason: typing over a selection has to reach somewhere.
    @FocusState private var focusedBrackets: Bool
    /// How tall the window on the page is: the tail seam runs to the
    /// bottom of it, so everything under the last cell can be typed in.
    @State private var pageHeight: CGFloat = 0

    /// WHICH seam — its place down the page, and the offset a cell would
    /// be opened at.
    ///
    /// Not the offset alone: an empty cell at the end of the note has the
    /// zero length that makes the seam above it and the tail seam under it
    /// carry the identical offset, and everything offset-keyed then
    /// answered for both — two bars drawn, two views bound to the same
    /// focus. The index is what tells them apart.
    struct SeamID: Hashable {
        var index: Int
        var offset: Int
    }

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
    /// The air under the last cell. All of it is the tail seam now — the
    /// gap, the strip the page used to offer a click on, and the margin
    /// that was under them — because everything below the last cell is
    /// one seam and there has to be somewhere to put a cell down there.
    static let tailHeight: CGFloat = 80 + topInset + gapHeight
    /// How tall the insertion mark itself is — the plus is bigger than
    /// the two points of the bar, and the mark is centred on the seam's
    /// own line.
    static let markHeight: CGFloat = 12

    var body: some View {
        // The window on the page, measured from OUTSIDE the scroll view:
        // the tail seam runs to the bottom of it. A preference from a
        // GeometryReader in the scroll view's background never arrived —
        // the tail came out 110 points tall against a 700 point window,
        // so the space under a short note answered nothing.
        GeometryReader { window in
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

                // A seam above every cell and one under the last: the
                // page is cell, seam, cell, seam, and nothing else. By
                // INDEX, because `seams` is built from these same rows in
                // this same order and two of them can share an offset.
                let seams = self.seams
                let cells = items
                ForEach(Array(cells.enumerated()), id: \.element.id) { index, item in
                    seamView(index < seams.count ? seams[index] : nil, index: index)
                    row(item)
                        .id(item.id)
                        .background {
                            GeometryReader { proxy in
                                Color.clear.preference(key: PreviewRowHeights.self,
                                                       value: [item.id: proxy.size.height])
                            }
                        }
                        // The page's margin is on the CELLS, not on the
                        // stack: a seam is the full width of the page,
                        // and a margin round the stack would have left a
                        // strip down each side that answered nothing.
                        .padding(.horizontal, Self.sideInset)
                }
                seamView(cells.count < seams.count ? seams[cells.count] : nil, index: cells.count)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // No padding above or below either: the air at the two ends
            // of the page is SEAM, not margin, and the head and tail
            // seams carry it themselves (`topInset` in the one,
            // `tailHeight` in the other).
            // The cell brackets, in the margin the page already leaves.
            .overlay(alignment: .topTrailing) {
                CellBrackets(brackets: cellBrackets,
                             onSelect: { beginEditing($0) },
                             onSelectCells: { selectCells($0) },
                             onToggle: { onToggleSection?($0) },
                             onMoveCell: { range, up in
                                 // Through `moving`, which moves the SPANS:
                                 // the closure this used to hand `cellEdit`
                                 // threw its span away and moved the dragged
                                 // cell once per span, so a selection with a
                                 // hole in it wrote the swapped text into the
                                 // note twice over (2026-09-20).
                                 let cells = heldCells.contains { NSEqualRanges($0, range) }
                                     ? heldCells : [range]
                                 applyCellEdits(CellCommands.moving(cells, up: up, in: markdown))
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
                    // The keyboard, while cells are held. There is no text
                    // view on this side to hear it — the same hole the
                    // armed seam had, and the same answer.
                    .focusable(editable && !selectedCells.isEmpty)
                    .focusEffectDisabled()
                    .focused($focusedBrackets)
                    .onKeyPress(phases: .down) { press in cellsKey(press) }
            }
        }
        .coordinateSpace(name: Self.space)
        .onPreferenceChange(PreviewRowHeights.self) { heights in
            for (id, height) in heights {
                if abs((rowHeights[id] ?? -1) - height) > 0.5 { rowHeights[id] = height }
            }
        }
        .onPreferenceChange(PreviewScrollKey.self) { offset in
            onScroll?(offset)
            // Which cell the fold is on, for the other mode to open at.
            let places = PreviewLayout.positions(rows: items.map { ($0.id, rowHeights[$0.id] ?? 0) },
                                                 spacing: Self.gapHeight,
                                                 top: Self.topInset + Self.gapHeight)
            if let top = PreviewLayout.topRow(positions: places, scroll: offset) { onTopCell?(top) }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: editingRange) { _, range in onEditingChanged?(range != nil) }
        // The pen going up takes the bar with it.
        .onChange(of: seamsEnabled) { _, enabled in if !enabled { disarm() } }
        .onChange(of: focusedSeam) { _, focused in
            // Whatever else takes the keyboard takes it from the bar.
            if armedSeam != nil, focused != armedSeam { armedSeam = nil }
        }
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
            bridge.splitCellInDocument = { splitCell() }
            bridge.cellRangeInDocument = { editingRange ?? items.first?.range }
            bridge.cellEditInDocument = { make in cellEdit(make) }
        }
        .onDisappear {
            onEditingChanged?(false)
            bridge.ensureEditing = nil
            bridge.moveSectionInDocument = nil
            bridge.mergeCellsInDocument = nil
            bridge.splitCellInDocument = nil
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
        .onAppear { pageHeight = window.size.height }
        .onChange(of: window.size.height) { _, height in pageHeight = height }
        }
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
                                             spacing: Self.gapHeight, top: Self.topInset + Self.gapHeight)
        let sections = NotebookOutline.sections(in: markdown)
        var out: [CellBrackets.Bracket] = []

        for item in shown {
            guard let place = places[item.id], place.bottom - place.top > 1 else { continue }
            let depth = NotebookOutline.cellDepth(at: item.range.location, in: sections)
            // Lit and HELD are not the same thing: the cell open for
            // typing is drawn heavy with nothing picked up, and the
            // gestures may not read that as a cell being held
            // (2026-09-20).
            let held = CellSelection.covers(item.range, selectedCells)
            out.append(CellBrackets.Bracket(key: "cell:\(item.id)", depth: depth,
                                            top: place.top, bottom: place.bottom,
                                            selected: editingRange == item.range || held,
                                            held: held, range: item.range))
        }

        for section in sections {
            let inside = shown.filter {
                NSIntersectionRange($0.range, section.range).length == $0.range.length
            }
            let places = inside.compactMap { places[$0.id] }
            guard let first = places.map(\.top).min(), let last = places.map(\.bottom).max(),
                  last - first > 1
            else { continue }
            let held = CellSelection.covers(section.range, selectedCells)
            out.append(CellBrackets.Bracket(key: section.key, depth: section.depth,
                                            top: first, bottom: last,
                                            collapsed: collapsed.contains(section.key),
                                            selected: held, held: held,
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

    /// One seam: the WHOLE space between two cells, top to bottom and
    /// edge to edge — the air above the first cell, the strip between two
    /// of them, and everything under the last (Sean, 2026-09-20: "the
    /// cursor should be horizontal any space between the two cells").
    ///
    /// The pointer turns on its side anywhere inside it and a click ARMS
    /// it: a bar runs across the page and that bar is the cursor, which
    /// is why no block is left open behind it. The note is not touched
    /// until a key arrives — clicking about the page used to leave an
    /// empty cell everywhere it had been.
    @ViewBuilder
    private func seamView(_ seam: CellSeams.Seam?, index: Int) -> some View {
        // A seam the page has not measured yet still holds the stack
        // apart, or every cell would jump a gap up and back.
        let height = seam.map { max(0, $0.bottom - $0.top) } ?? Self.gapHeight
        if let seam, editable, seamsEnabled {
            let id = SeamID(index: index, offset: seam.offset)
            Color.clear
                .frame(height: height)
                // From the TOP of the seam, offset to the line the seam
                // itself names, and not centred in it: the tail seam is
                // everything under the last cell, so centring put the bar
                // hundreds of points down an empty page (Sean,
                // 2026-09-20: "when i select somewhere below the cell,
                // the bar should go immediately after the last cell, not
                // the random spot below it's currently at"). The whole
                // seam is still the hit area.
                .overlay(alignment: .top) {
                    if armedSeam == id || hoveredSeam == id {
                        HStack(spacing: 6) {
                            Image(systemName: "plus.circle.fill").font(.system(size: 11))
                            Capsule().frame(height: 2)
                        }
                        .foregroundStyle(Color.accentColor)
                        // Drawn inside the page's margin though the seam
                        // itself reaches both edges: the bar is furniture
                        // and lines up with the words, the hit area is
                        // the whole width.
                        .padding(.horizontal, Self.sideInset)
                        // An overlay, and taller than the seam it is in:
                        // the strip between two cells is eight points and
                        // the mark is twelve, and the page must not move
                        // when the pointer arrives.
                        .frame(height: Self.markHeight)
                        // An offset rather than padding, for the same
                        // reason: it moves the mark without asking the
                        // page for room.
                        .offset(y: seam.line - seam.top - Self.markHeight / 2)
                        .transition(.opacity)
                    }
                }
                .contentShape(Rectangle())
                .onContinuousHover(coordinateSpace: .local) { phase in
                    switch phase {
                    case .active:
                        if hoveredSeam != id { hoveredSeam = id }
                        // Set on every move, not pushed once: the text
                        // views either side put their own cursors back
                        // the moment the pointer touches them.
                        Self.cursor(hovering: true)?.set()
                    case .ended:
                        if hoveredSeam == id { hoveredSeam = nil }
                        // And handed back on the way out. There is no
                        // text view under the pointer on this side to put
                        // its own cursor back, so the horizontal I-beam
                        // followed the pointer over the words, the
                        // toolbar and the sidebar — the same trap
                        // `CursorLayer` was written for.
                        Self.cursor(hovering: false)?.set()
                    }
                }
                .onTapGesture { arm(id) }
                // The bar has to hear the keyboard, and there is no text
                // view on this side to hear it for us.
                .focusable()
                .focusEffectDisabled()
                .focused($focusedSeam, equals: id)
                .onKeyPress(phases: .down) { press in key(press, in: id) }
                .help("Click for the line, then type — or Return for an empty cell")
        } else {
            // Read-only, or the pen is up: the space is still there, it
            // just does nothing at all.
            Color.clear.frame(height: height)
        }
    }

    /// What the pointer should be over a seam, and what it should be put
    /// back to on the way out.
    ///
    /// `NSCursor.set()` is global and sticks until something else sets
    /// one. Nothing on the rendered page does: the blocks are SwiftUI
    /// `Text` with no cursor rects at all. Nil means "leave whatever is
    /// there alone" — a cursor somebody else has set on the way out is
    /// theirs, and taking it would be the same bug the other way round.
    static func cursor(hovering: Bool, current: NSCursor = .current) -> NSCursor? {
        if hovering { return .iBeamCursorForVerticalLayout }
        return current == .iBeamCursorForVerticalLayout ? .arrow : nil
    }

    // MARK: - The seams

    /// The spaces between the cells on this page.
    private var seams: [CellSeams.Seam] {
        Self.seams(rows: items.map { ($0.id, rowHeights[$0.id] ?? 0) },
                   noteLength: (markdown as NSString).length, pageHeight: pageHeight)
    }

    /// The same seams the markdown pane has, measured off the stack
    /// instead of off the glyphs: `CellSeams` is the one model, and the
    /// two panes only differ in how they find the cells' boxes.
    ///
    /// `pageHeight` is the window on the page. The tail reaches the
    /// bottom of it when the note is shorter than the window, and
    /// `tailHeight` under the last cell when it is longer — either way
    /// everything below the last cell is seam.
    static func seams(rows: [(id: Int, height: CGFloat)], noteLength: Int,
                      pageHeight: CGFloat) -> [CellSeams.Seam] {
        let places = PreviewLayout.positions(rows: rows, spacing: gapHeight,
                                             top: topInset + gapHeight)
        let cells: [CellSeams.Box] = rows.compactMap { row in
            guard let place = places[row.id] else { return nil }
            return CellSeams.Box(top: place.top, bottom: place.bottom, offset: row.id)
        }
        let bottom = (cells.last?.bottom ?? 0) + tailHeight
        return CellSeams.seams(cells: cells, pageTop: 0, pageBottom: max(pageHeight, bottom),
                               noteLength: noteLength)
    }

    /// What a key pressed in an armed seam means.
    ///
    /// Pure, because the awkward ones are not obvious: an arrow and a
    /// delete arrive as characters too — in Unicode's private use area,
    /// where AppKit keeps the function keys — and ⌘S is not an S.
    enum SeamKey: Equatable {
        /// A printable character: the cell opens and this goes in it.
        case write(String)
        /// Return: an empty cell, open for typing.
        case empty
        /// Escape: the bar goes out and the note is untouched.
        case disarm
        /// An arrow: the bar walks into the cell beside it, so ↓ and ↑ go
        /// cell, bar, cell the way they do in the markdown pane. It
        /// writes nothing either.
        case step(up: Bool)
        /// Nobody's business here; whoever else wants the key can have it.
        case pass
    }

    static func seamKey(characters: String, modifiers: EventModifiers) -> SeamKey {
        if characters == "\u{1B}" { return .disarm }
        if characters == "\r" || characters == "\n" { return .empty }
        // AppKit keeps the function keys in Unicode's private use area.
        if characters == "\u{F700}" { return .step(up: true) }
        if characters == "\u{F701}" { return .step(up: false) }
        // ⌘S is not an S. Shift is, though — it is how a capital arrives.
        guard modifiers.isDisjoint(with: [.command, .control]), !characters.isEmpty else { return .pass }
        let printable = characters.unicodeScalars.allSatisfy { scalar in
            !CharacterSet.controlCharacters.contains(scalar) && !(0xF700...0xF8FF).contains(scalar.value)
        }
        return printable ? .write(characters) : .pass
    }

    /// What that key does to the NOTE: the cell the seam stands for, with
    /// what was typed already in it, and the range it is edited at.
    ///
    /// Nil for a key that only takes the bar back, and that is the whole
    /// promise of the armed state — arming and then clicking away leaves
    /// the markdown byte for byte as it was. The opening itself is
    /// `PreviewEditing.insertBlock`, the same one rule both panes follow.
    static func opened(_ key: SeamKey, at offset: Int, in markdown: String)
        -> (markdown: String, editing: NSRange, draft: String)? {
        let written: String
        switch key {
        case .write(let characters): written = characters
        case .empty: written = ""
        case .disarm, .step, .pass: return nil
        }
        let (opened, caret) = PreviewEditing.insertBlock(in: markdown, at: offset)
        let ns = opened as NSString
        let place = min(max(caret, 0), ns.length)
        let updated = ns.replacingCharacters(in: NSRange(location: place, length: 0), with: written)
        return (updated, NSRange(location: place, length: (written as NSString).length), written)
    }

    // MARK: - Cells held by their brackets

    /// What a key means while cells are HELD, which is not what the same
    /// key means in a seam: Return opens an empty cell in a seam and has
    /// nothing to say over a selection, and a delete only puts the bar out
    /// there while here it takes the cells.
    enum CellKey: Equatable {
        /// A printable character: the cells go, and one cell with this
        /// already in it takes their place. Typing over a selection.
        case replace(String)
        /// ⌫ or ⌦: they go, and nothing takes their place.
        case remove
        /// Escape: the brackets go out and the note is untouched.
        case clear
        /// Nobody's business here.
        case pass
    }

    static func cellKey(characters: String, modifiers: EventModifiers) -> CellKey {
        // ⌃⌫ is the Delete Cell menu item and never reaches this, and ⌘S
        // is not an S. Shift is, though — it is how a capital arrives.
        guard modifiers.isDisjoint(with: [.command, .control]) else { return .pass }
        if characters == "\u{1B}" { return .clear }
        if characters == "\u{8}" || characters == "\u{7F}" { return .remove }
        guard !characters.isEmpty else { return .pass }
        let printable = characters.unicodeScalars.allSatisfy { scalar in
            !CharacterSet.controlCharacters.contains(scalar) && !(0xF700...0xF8FF).contains(scalar.value)
        }
        return printable ? .replace(characters) : .pass
    }

    // MARK: - Editing

    /// Cells picked up by their brackets: shown, not opened. Whatever else
    /// was holding a cursor lets go — a block open for typing and an armed
    /// seam are both a cursor, and three lit brackets are a third.
    private func selectCells(_ ranges: [NSRange]) {
        guard editable else { return }
        disarm()
        hoveredSeam = nil
        editingRange = nil
        selectedCells = ranges
        guard !ranges.isEmpty else { return }
        // A turn late: the column is only focusable once there is
        // something in it, and it is this write that puts it there.
        DispatchQueue.main.async { focusedBrackets = true }
    }

    /// A key while cells are held.
    private func cellsKey(_ press: KeyPress) -> KeyPress.Result {
        guard !selectedCells.isEmpty else { return .ignored }
        // Escape and the deletes by name: what `characters` carries for
        // them is AppKit's business, and the meaning is not.
        let characters: String
        switch press.key {
        case .escape: characters = "\u{1B}"
        case .delete: characters = "\u{8}"
        case .deleteForward: characters = "\u{7F}"
        default: characters = press.characters
        }
        switch Self.cellKey(characters: characters, modifiers: press.modifiers) {
        case .clear:
            selectedCells = []
            return .handled
        case .remove:
            replaceCells(with: "")
            return .handled
        case .replace(let typed):
            replaceCells(with: typed)
            return .handled
        case .pass:
            return .ignored
        }
    }

    /// The held cells taken away, and — for a character typed — one cell
    /// put where they were with that character already in it.
    ///
    /// Delete then open one, because "typing replaces the selection" has
    /// no other meaning on a page of rendered blocks: the markdown pane
    /// gets it from NSTextView, which types over a discontiguous selection
    /// by itself.
    private func replaceCells(with typed: String) {
        let cells = selectedCells
        guard !cells.isEmpty else { return }
        let edits = CellCommands.edits(over: cells, in: markdown) { CellCommands.delete($0, in: $1) }
        guard let landing = edits.last?.selection.location else { return }
        var text = markdown as NSString
        for edit in edits { text = text.replacingCharacters(in: edit.range, with: edit.replacement) as NSString }
        selectedCells = []
        editingRange = nil
        markdown = text as String
        guard !typed.isEmpty,
              let opened = Self.opened(.write(typed), at: min(landing, text.length), in: text as String)
        else { return }
        markdown = opened.markdown
        // Always a plain text cell, whatever the cells it replaced were
        // (Sean, 2026-09-19: "default is always just text").
        fence = nil
        draft = opened.draft
        editingRange = opened.editing
        caretAtStart = false
        focusToken += 1
    }

    /// A click in a seam: the bar goes there and takes the keyboard.
    /// Nothing is written — the note is not touched until a key arrives.
    private func arm(_ id: SeamID) {
        guard editable, seamsEnabled else { return }
        // The bar IS the cursor, so nothing else may be holding one: the
        // block that was open closes, caret and all (Sean, 2026-09-20:
        // "the mouse cursor and text cursor should both become horizontal
        // between cells"), and the brackets let go of what they held.
        editingRange = nil
        selectedCells = []
        armedSeam = id
        focusedSeam = id
    }

    /// The bar goes out, and it lets the keyboard go with it.
    ///
    /// Both, always. `focusedSeam` left pointing at a seam that is no
    /// longer armed is a view still asserting first responder against the
    /// block editor that has just opened — they raced, and the second
    /// character typed went to the seam, failed its own guard and was
    /// dropped.
    private func disarm() {
        armedSeam = nil
        focusedSeam = nil
    }

    /// A key while this seam is armed.
    private func key(_ press: KeyPress, in id: SeamID) -> KeyPress.Result {
        guard armedSeam == id else { return .ignored }
        // Escape, Return and the arrows by name: what `characters` carries
        // for them is AppKit's business, and the meaning is not.
        let characters: String
        switch press.key {
        case .escape: characters = "\u{1B}"
        case .return: characters = "\r"
        case .upArrow: characters = "\u{F700}"
        case .downArrow: characters = "\u{F701}"
        default: characters = press.characters
        }
        let meaning = Self.seamKey(characters: characters, modifiers: press.modifiers)
        switch meaning {
        case .pass:
            // Whatever it was, the bar is not what it was meant for, and
            // a bar left armed off the top of a scrolled page opens a
            // cell somewhere he cannot see (docs/FEATURES.md: "Escape, an
            // arrow or a click anywhere else takes the line back without
            // leaving an empty cell behind"). The markdown pane's
            // `doCommand(by:)` does exactly this for every selector.
            disarm()
            return .ignored
        case .disarm:
            disarm()
            return .handled
        case .step(let up):
            walk(from: id, up: up)
            return .handled
        case .empty, .write:
            openSeam(meaning, at: id.offset)
            return .handled
        }
    }

    /// ↑ or ↓ out of the bar: into the cell above or the cell below it,
    /// which is the other half of walking cell, bar, cell. At the two ends
    /// of the note there is no cell that way and the bar simply stays.
    private func walk(from id: SeamID, up: Bool) {
        let cells = items
        if up {
            guard id.index > 0 else { return }
            beginEditing(cells[id.index - 1].range)
        } else {
            guard id.index < cells.count else { return }
            beginEditing(cells[id.index].range, caretAtStart: true)
        }
    }

    /// ↑ or ↓ off the end of a CELL: the bar beside it, not the next cell
    /// and never a new one (the plan's step 4 — "Nothing is written until
    /// a key says so"). ↓ off the last cell used to run `insertBlock` at
    /// the end of the note, so an arrow key wrote two newlines into the
    /// file and left an empty cell behind every time it was pressed.
    private func armSeam(beside cell: NSRange, below: Bool) {
        editingRange = nil
        let cells = items
        let all = seams
        guard let index = cells.firstIndex(where: { $0.range.location == cell.location }) else { return }
        let wanted = below ? index + 1 : index
        guard wanted >= 0, wanted < all.count else { return }
        arm(SeamID(index: wanted, offset: all[wanted].offset))
    }

    /// The cell that key opens, put on the page: the note as `opened` made
    /// it, and the new cell being edited with what was typed already in it.
    private func openSeam(_ key: SeamKey, at offset: Int) {
        disarm()
        hoveredSeam = nil
        guard let opened = Self.opened(key, at: offset, in: markdown) else { return }
        markdown = opened.markdown
        // Always a plain text cell, whatever the cell above it was (Sean,
        // 2026-09-19: "default is always just text").
        fence = nil
        draft = opened.draft
        editingRange = opened.editing
        // Behind what was typed — which for an empty cell is the same place.
        caretAtStart = false
        focusToken += 1
    }

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
        // Two cursors is what he was looking at before: a block with a
        // caret in it is not a seam with a bar in it, and neither of them
        // is a handful of cells held by their brackets.
        disarm()
        selectedCells = []
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
                                spacing: Self.gapHeight, top: Self.topInset + Self.gapHeight)
    }

    /// A whole-cell edit — delete, duplicate, move — over the note: every
    /// cell whose bracket is lit, and the one that is open (or the first)
    /// when none is. A cell on this side is a block, so the edit cannot go
    /// through one block's own text view (Sean, 2026-09-20: "make cells
    /// behave like mathematica cells").
    ///
    /// Back to front, through `CellCommands.edits`, which is what lets ⌃⌫
    /// take three cells at once: an edit made in front of another would
    /// have moved the characters the second one names.
    private func cellEdit(_ make: (NSRange, String) -> MarkdownFormatting.Edit?) {
        applyCellEdits(CellCommands.edits(over: heldCells, in: markdown, make: make))
    }

    /// The cells a whole-cell command acts on: every one whose bracket is
    /// held, and the one open for typing (or the first) when none is.
    private var heldCells: [NSRange] {
        selectedCells.isEmpty
            ? [editingRange ?? items.first?.range].compactMap { $0 }
            : selectedCells
    }

    /// What is still held after a whole-cell command: the cells the edit's
    /// landing selection covers.
    ///
    /// Three cells moved or duplicated stay held, so pressing ⌃⇧↓ twice
    /// walks the same three down the page. The page used to let go of them
    /// and open the landing cell for typing, and the second press then
    /// moved one cell out of the run it had just made. The markdown pane
    /// never had the fault — `tv.selectedRanges` keeps the run — and the
    /// two panes are meant to behave the same (2026-09-20).
    static func stillHeld(after landing: NSRange, in text: String) -> [NSRange] {
        CellSelection.picked(cells: MarkdownParser.positioned(from: text).map(\.range),
                             selection: [landing])
    }

    private func applyCellEdits(_ edits: [MarkdownFormatting.Edit]) {
        guard let landing = edits.last?.selection else { return }
        var text = markdown as NSString
        for edit in edits { text = text.replacingCharacters(in: edit.range, with: edit.replacement) as NSString }
        let updated = text as String
        let wasHolding = !selectedCells.isEmpty
        markdown = updated
        let still = Self.stillHeld(after: landing, in: updated)
        if wasHolding, !still.isEmpty {
            selectedCells = still
            editingRange = nil
            // The column keeps the keyboard, the way it had it before the
            // command: what is held can be typed over, moved again, taken.
            DispatchQueue.main.async { focusedBrackets = true }
            return
        }
        selectedCells = []
        // Follow the cell: to where it went, or to whatever moved up into
        // the place of the one that was taken away.
        if let block = MarkdownParser.positioned(from: updated)
            .first(where: { NSLocationInRange(landing.location, $0.range)
                || $0.range.location == landing.location }) {
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

    /// Cutting the open cell in two, and leaving the bar between the
    /// halves (Sean, 2026-09-20: "when dividing a cell, the cursor should
    /// go inbetween the new cells").
    ///
    /// The note's edit and not the block's, the same as the merge: the
    /// moment the cut is made the two halves are two blocks, and the
    /// block editor that was holding the caret is holding a range that
    /// spans both of them. Closing it and arming the seam under the head
    /// is what "the cursor is between the cells" means on this side —
    /// the markdown pane gets there by the caret alone, but there is no
    /// caret here to follow.
    private func splitCell() {
        let inside = bridge.textView?.selectedRange().location ?? 0
        let caret = (editingRange?.location ?? 0) + inside
        guard let cell = NotebookCells.block(containing: caret, in: markdown),
              let edit = NotebookCells.split(text: markdown,
                                             selection: NSRange(location: caret, length: 0))
        else { return }
        markdown = (markdown as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        // Nothing before the cut moved, so the head still begins where the
        // whole cell did — and the seam under it is the one between them.
        armSeam(beside: cell.range, below: true)
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
        disarm()
        hoveredSeam = nil
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
        switch move {
        case .out:
            disarm()
            editingRange = nil
        case .up:
            armSeam(beside: range, below: false)
        case .down:
            armSeam(beside: range, below: true)
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
                // The only padding left on the page, and it is the rule's
                // own body rather than space round it: a `Divider` is one
                // point tall, and a one-point cell is a cell that neither
                // a bracket nor a seam can hold — the seams either side
                // would be widened to the 8 pt minimum straight through
                // it, and there would be nowhere left to click the rule.
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


/// The measured height of every block — what the stack is laid out from.
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
