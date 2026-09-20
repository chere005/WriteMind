import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// File ▸ Export ▸ PDF… — the note as it is read, on paper (Sean,
/// 2026-09-19: "export as pdf").
///
/// It is a submenu of one for now because the next two are already obvious
/// (HTML, and the note plus its sidecar as a bundle), and because an
/// "Export PDF…" item sitting loose in the File menu is where the second
/// one would have nowhere to go. The menu bar is the ONLY place it lives:
/// no button on the bar, no item in the sidebar's Folder menu (Sean,
/// 2026-09-19: "there should only be one … button").
struct ExportMenu: Commands {
    @ObservedObject var store: NoteStore

    var body: some Commands {
        CommandGroup(after: .importExport) {
            Menu("Export") {
                Button("PDF…") { exportPDF() }
                    .disabled(store.selectedNote == nil)
            }
        }
    }

    /// Ask where it goes, then write it. The default is the note's own name
    /// in ~/Documents — the folder a person looks for a file they made.
    private func exportPDF() {
        guard let note = store.selectedNote else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = NoteExport.suggestedName(for: note.url)
        panel.directoryURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        panel.canCreateDirectories = true
        panel.message = "Where the PDF of “\(note.title)” goes."
        guard panel.runModal() == .OK, let url = panel.url else { return }

        // The text is taken from the editor rather than the disk: what is
        // on screen is what Sean means by "this note", debounce or no.
        guard let data = NoteExport.pdf(markdown: store.text,
                                        drawing: store.drawing,
                                        media: store.owningFolder(for: note.url),
                                        pane: store.canvasSize) else {
            report("WriteMind could not make a PDF of this note.", url: url)
            return
        }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            report(error.localizedDescription, url: url)
        }
    }

    /// A failed export is worth a word — a file that silently did not
    /// appear is the worst of the three outcomes.
    private func report(_ message: String, url: URL) {
        let alert = NSAlert()
        alert.messageText = "Could not write “\(url.lastPathComponent)”"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }
}
