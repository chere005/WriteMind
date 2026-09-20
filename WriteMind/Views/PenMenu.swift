import SwiftUI

/// The small menu under the pen button: size, colour, and a way to start over.
struct PenMenu: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var store: NoteStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Pen").font(.headline)
                Spacer()
                Toggle("On", isOn: $appState.penActive)
                    .toggleStyle(.switch)
                    .controlSize(.small)
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
                    appState.penActive = false
                    store.chooseImage()
                } label: {
                    Label("Add Image", systemImage: "photo.badge.plus")
                }
                .disabled(store.selectedNote == nil)
            }

            Divider()

            // Everything on this layer is its own object, so it is worth
            // saying how to get hold of one.
            Text("With the pen down: drag an object to move it, and use the handles to turn, resize or delete it. Hold ⌘ and drag to draw a box round several — anything it touches comes along. Pictures can be pasted straight in.")
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
