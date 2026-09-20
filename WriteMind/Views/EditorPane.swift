import SwiftUI

/// The left pane: the markdown editor or its preview, with the drawing layer
/// on top of whichever is showing.
struct EditorPane: View {
    @EnvironmentObject private var store: NoteStore
    @EnvironmentObject private var appState: AppState
    /// Bumped by a click in the text, which is what tells the objects on the
    /// drawing layer to let go.
    @State private var textClicks = 0

    /// How far the source editor has scrolled: the drawing layer follows.
    @State private var scrollOffset: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            // Always there, even with nothing open (Sean, 2026-09-18): the +
            // tab is the way to a new note from here.
            TabBar()
            Divider()
            // Above the editor, so a tooltip hanging off the bar is drawn
            // over the text rather than under it.
            TopBar()
                .zIndex(2)
            Divider()
            if let pending = appState.pendingLink {
                LinkBanner(pending: pending)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            if let note = store.selectedNote {
                ZStack {
                    if appState.mode == .editor {
                        MarkdownTextView(text: $store.text, documentID: note.id,
                                         bridge: appState.editor,
                                         onLinkTrigger: { caret in beginLink(from: note, caret: caret) },
                                         onPasteImage: { store.pasteImage(from: $0) },
                                         onClick: { textClicks += 1 },
                                         cursor: appState.penActive ? DrawingCursors.pencil
                                             : (appState.connectActive ? .crosshair : nil),
                                         onScroll: { offset in
                                             scrollOffset = offset
                                             store.canvasScroll = offset
                                         },
                                         onTopCell: { store.topCell = $0 },
                                         topCell: store.topCell,
                                         collapsed: store.collapsedHere,
                                         onToggleSection: { store.toggleSection($0) },
                                         showMarkers: appState.showMarkers,
                                         // The pencil owns the note pane in
                                         // drawing mode (Sean, 2026-09-20:
                                         // "cursor only becomes a pen in the
                                         // notes pane in drawing mode!!!!!"),
                                         // and so does the arrow tool and a
                                         // placement waiting to land.
                                         seamsEnabled: !appState.penActive
                                             && !appState.connectActive
                                             && appState.placing == nil)
                    } else {
                        MarkdownPreview(markdown: $store.text,
                                        onFollow: { store.follow(destination: $0) },
                                        bridge: appState.editor,
                                        onEditingChanged: { appState.blockEditing = $0 },
                                        onScroll: { offset in
                                            scrollOffset = offset
                                            store.canvasScroll = offset
                                        },
                                        onTopCell: { store.topCell = $0 },
                                        topCell: store.topCell,
                                        collapsed: store.collapsedHere,
                                        onToggleSection: { store.toggleSection($0) })
                            .id(note.id)
                    }
                    // The drawing belongs to the note, so it shows in both
                    // modes. With the pen up it takes the whole pane; with the
                    // pen down it takes only the objects on it, and the text
                    // underneath gets everything else.
                    DrawingCanvas(drawing: $store.drawing,
                                  penActive: appState.penActive,
                                  color: appState.penColor,
                                  width: appState.penWidth,
                                  mediaDirectory: store.owningFolder(for: note.url),
                                  documentID: note.id,
                                  deselectToken: textClicks,
                                  onBeginChange: { store.beginDrawingChange() },
                                  onSize: { store.canvasSize = $0 },
                                  onCrop: { store.cropImage(id: $0, to: $1) },
                                  onReadText: { store.readText(in: $0) },
                                  onPasteImage: { store.pasteImage(from: $0) },
                                  connectActive: appState.connectActive,
                                  pendingLabelEdit: store.pendingLabelEdit,
                                  onLabelEditStarted: { store.pendingLabelEdit = nil },
                                  onSelectionChanged: { appState.canvasSelection = $0 },
                                  onUndo: { store.undoDrawing() },
                                  onRedo: { store.redoDrawing() },
                                  placing: appState.placing,
                                  onPlaced: { appState.placing = nil },
                                  // Both panes scroll their objects with
                                  // the text now, so a picture stays beside
                                  // what it was put beside.
                                  scrollOffset: scrollOffset)
                }
                .onAppear {
                    appState.editor.pasteImage = { store.pasteImage(from: $0) }
                    // Pictures land under the caret while the source editor
                    // is up; the preview's blocks have their own text views.
                    store.caretAnchor = { appState.mode == .editor ? appState.editor.caretLineFrame() : nil }
                    store.insertBelow = { text, y in
                        guard appState.mode == .editor else { return false }
                        appState.editor.insert(text, belowDocumentY: y)
                        return true
                    }
                }
                .onChange(of: store.pendingLinkInsertion) { _, range in
                    guard let range else { return }
                    appState.editor.select(range)
                    store.pendingLinkInsertion = nil
                }
                Divider()
                HStack {
                    Text(note.url.lastPathComponent)
                    if store.isCapturing {
                        ProgressView().controlSize(.mini)
                        Text("Reading the page…")
                    } else if let notice = store.captureNotice {
                        Text(notice).foregroundStyle(Color.accentColor).lineLimit(1)
                    }
                    Spacer()
                    if appState.penActive { Label("Pen", systemImage: "pencil.tip").foregroundStyle(Color.accentColor) }
                    if !store.drawing.isEmpty {
                        Text(store.drawing.items.count == 1 ? "1 object" : "\(store.drawing.items.count) objects")
                    }
                    Text(wordCount == 1 ? "1 word" : "\(wordCount) words")
                    if let saved = store.lastSaved {
                        Text("Saved \(saved, format: .dateTime.hour().minute())")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .frame(height: 24)
                .background(.bar)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "square.and.pencil").font(.system(size: 40)).foregroundStyle(.tertiary)
                    Text("No note open").font(.title3).foregroundStyle(.secondary)
                    Button("New Note  ⌘N") { store.createNote() }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .textBackgroundColor))
            }
        }
    }

    private var wordCount: Int {
        store.text.split { $0.isWhitespace || $0.isNewline }.count
    }

    private func beginLink(from note: Note, caret: Int) {
        withAnimation(.easeInOut(duration: 0.15)) {
            appState.pendingLink = AppState.PendingLink(
                sourceNoteID: note.id, sourceTitle: note.title, caret: caret)
        }
    }
}
