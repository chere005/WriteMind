import SwiftUI

/// The banner `/link` puts up: "select section to point to". It stays until
/// the target is picked or the user backs out, and it rides above whichever
/// note is open — that is the whole point, since the target is usually
/// somewhere else.
struct LinkBanner: View {
    @EnvironmentObject private var store: NoteStore
    @EnvironmentObject private var appState: AppState

    let pending: AppState.PendingLink

    private var isSourceNote: Bool { store.selection == pending.sourceNoteID }
    private var hasSelection: Bool { (appState.editor.selection?.length ?? 0) > 0 }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "link")
            VStack(alignment: .leading, spacing: 1) {
                Text("Select section to point to").font(.callout.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button("Cancel") { appState.pendingLink = nil }
                .keyboardShortcut(.cancelAction)
            Button("Link Here") { link() }
                .keyboardShortcut(.defaultAction)
                .disabled(isSourceNote)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.accentColor.opacity(0.16))
        .overlay(alignment: .bottom) { Divider() }
    }

    private var detail: String {
        if isSourceNote {
            return "Open the note you want to point at — from “\(pending.sourceTitle)”."
        }
        if hasSelection {
            return "Links to the highlighted text, and marks it in this note as linked."
        }
        return "Links to the block the cursor is in. Highlight text first to point at just that."
    }

    private func link() {
        guard let selection = appState.editor.selection else { return }
        if store.completeLink(pending, targetSelection: selection) {
            appState.pendingLink = nil
        }
    }
}
