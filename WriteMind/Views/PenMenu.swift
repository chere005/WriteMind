import SwiftUI

/// The small menu under the pen button: which of the three modes the pane is
/// in, the pen's size and colour, and a way to start over.
struct PenMenu: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var store: NoteStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Pen").font(.headline)

            // The switch that was here said On and Off, and there are three
            // answers now (Sean, 2026-09-20: "the pen button section should
            // allow choosing between pen mode, cursor mode, and pointer
            // select mode"). One picker, so picking one is putting the
            // others down.
            HStack(spacing: 12) {
                Text("Mode").frame(width: 36, alignment: .leading)
                Picker("Mode", selection: $appState.canvasMode) {
                    ForEach(AppState.CanvasMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .help(appState.canvasMode.help)
            }

            HStack(spacing: 12) {
                Text("Size").frame(width: 36, alignment: .leading)
                Slider(value: $appState.penWidth, in: 1...24, step: 1)
                ZStack {
                    Circle().fill(appState.penColor).frame(width: appState.penWidth, height: appState.penWidth)
                }
                .frame(width: 28, height: 28)
                Text("\(Int(appState.penWidth))")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(width: 22, alignment: .trailing)
            }

            HStack(spacing: 10) {
                Text("Colour").frame(width: 36, alignment: .leading)
                ColorPicker("Pen colour", selection: colourBinding, supportsOpacity: false)
                    .labelsHidden()
                ForEach(AppState.presetColors, id: \.self) { hex in
                    Button {
                        appState.penColorHex = hex
                    } label: {
                        Circle()
                            .fill(Color(hex: hex) ?? .clear)
                            .frame(width: 20, height: 20)
                            .overlay(
                                Circle().strokeBorder(Color.primary.opacity(0.8), lineWidth: 2)
                                    .opacity(hex.caseInsensitiveCompare(appState.penColorHex) == .orderedSame ? 1 : 0)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }

            Divider()

            HStack(spacing: 8) {
                Button { store.undoDrawing() } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .disabled(!store.canUndoDrawing)
                .help("Undo the last thing that happened on the drawing layer — a stroke, a move, a delete (⇧⌘Z is the text's undo)")

                Button { store.redoDrawing() } label: {
                    Label("Redo", systemImage: "arrow.uturn.forward")
                }
                .disabled(!store.canRedoDrawing)

                Spacer()
                Text(objectCount)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button("Clear Drawing", role: .destructive) { store.clearDrawing() }
                    .disabled(store.drawing.isEmpty)
                Spacer()
                Button {
                    appState.canvasMode = .cursor
                    store.chooseImage()
                } label: {
                    Label("Add Image", systemImage: "photo.badge.plus")
                }
                .disabled(store.selectedNote == nil)
            }

            Divider()

            // Three modes over one page, so it is worth saying which of
            // them a drag belongs to.
            Text("Cursor is the notebook's: the words, the bars between the cells and the brackets take the clicks, and an object can still be dragged by hand or worked with its handles. Pen draws. Select pulls a rectangle and takes everything it touches, which ⌘ and drag still does from cursor mode. Pictures can be pasted straight in.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(width: 330)
        .foregroundStyle(.primary)
        .tint(.accentColor)
    }

    private var objectCount: String {
        let strokes = store.drawing.strokes.count
        let images = store.drawing.images.count
        let parts = [strokes == 1 ? "1 stroke" : "\(strokes) strokes",
                     images == 0 ? nil : (images == 1 ? "1 picture" : "\(images) pictures")]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    private var colourBinding: Binding<Color> {
        Binding(get: { appState.penColor }, set: { appState.penColor = $0 })
    }
}
