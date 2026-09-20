import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The notes list: the folder tree under `~/Documents/WriteMind`, where a
/// folder IS a section and a folder inside it is a subsection. Selecting a
/// section is what decides where a new note goes.
struct SidebarView: View {
    @EnvironmentObject private var store: NoteStore
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var projects: ProjectStore

    @State private var editing = false
    @State private var renamingNote: Note?
    @State private var renamingSection: NoteSection?
    @State private var newName = ""
    /// The trash button that has been clicked once: "note:…" or
    /// "section:…". Red, and the next click on it deletes.
    @State private var armedTrash: String?
    /// What the right-click menu is about to trash. The edit-mode icon
    /// arms itself red instead (Sean, 2026-09-18), but a menu item has no
    /// second click to give, so it asks (Sean, 2026-09-19: "right click
    /// move to trash needs a confirmation").
    @State private var pendingTrash: TrashTarget?

    struct TrashTarget: Identifiable {
        enum Kind { case note(Note), section(NoteSection) }
        let kind: Kind

        var id: String {
            switch kind {
            case .note(let note): return "note:" + note.url.path
            case .section(let section): return "section:" + section.url.path
            }
        }
        var name: String {
            switch kind {
            case .note(let note): return note.title
            case .section(let section): return section.name
            }
        }
        var what: String {
            switch kind {
            case .note: return "note"
            case .section: return "section"
            }
        }
        var detail: String {
            switch kind {
            case .note: return "It goes to the Trash, where you can put it back."
            case .section:
                return "The folder and every note in it go to the Trash, where you can put them back."
            }
        }
    }
    @State private var expanded: Set<NoteSection.ID> = []
    @State private var dropTarget: NoteSection.ID?
    @State private var dropRow: Note.ID?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            if store.accessDenied {
                accessDenied
            } else if store.roots.allSatisfy(\.isEmpty) {
                empty
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(rows) { row in
                            switch row {
                            case .note(let note, let section, let indent):
                                noteRow(note, in: section, indent: indent)
                            case .section(let section, let indent):
                                sectionRow(section, indent: indent)
                            }
                        }
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 6)
                }
                // The empty space under the rows is "no section": clicking
                // it puts the next new note back at the top level (Sean,
                // 2026-09-19: "clicking outside a section in this bar
                // should deselect a section").
                .contentShape(Rectangle())
                .onTapGesture { store.selectedSectionID = nil }
                .dropDestination(for: SidebarItem.self) { items, _ in
                    drop(items, into: store.root)
                }
                .contextMenu {
                    Button("New Note") { store.createNote() }
                    Button("New Section") {
                        if let made = store.createSection() { expanded.insert(made.id) }
                    }
                    Divider()
                    Button("Add Folder to Project…") { addFolderToProject() }
                    Divider()
                    Button(editing ? "Done Editing" : "Edit Notes") {
                        withAnimation(.easeInOut(duration: 0.15)) { editing.toggle(); armedTrash = nil }
                    }
                    Button("Reveal Folder in Finder") { store.revealFolderInFinder() }
                }
            }

            Divider()
            footer
        }
        .onAppear { expanded = Set(store.allSections.map(\.id)) }
        .confirmationDialog("Move \u{201C}\(pendingTrash?.name ?? "")\u{201D} to the Trash?",
                            isPresented: Binding(get: { pendingTrash != nil },
                                                 set: { if !$0 { pendingTrash = nil } }),
                            titleVisibility: .visible,
                            presenting: pendingTrash) { target in
            Button("Move to Trash", role: .destructive) {
                switch target.kind {
                case .note(let note): store.delete(note)
                case .section(let section): store.delete(section)
                }
                pendingTrash = nil
            }
            Button("Cancel", role: .cancel) { pendingTrash = nil }
        } message: { target in
            Text(target.detail)
        }
        .onChange(of: store.roots.map(\.id)) { _, _ in
            // A folder added to the project opens with its sections showing.
            expanded.formUnion(store.roots.map(\.id))
        }
        .alert("Rename", isPresented: Binding(get: { renamingNote != nil || renamingSection != nil },
                                              set: { if !$0 { renamingNote = nil; renamingSection = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let note = renamingNote { store.rename(note, to: newName) }
                if let section = renamingSection { store.rename(section, to: newName) }
                renamingNote = nil; renamingSection = nil
            }
            Button("Cancel", role: .cancel) { renamingNote = nil; renamingSection = nil }
        } message: {
            Text(renamingSection == nil ? "The file keeps its .md extension." : "This renames the folder on disk.")
        }
    }

    /// The trash in edit mode looks like Duplicate until it is clicked: the
    /// first click arms it (red), the second sends the thing to the Trash,
    /// and there is no dialog (Sean, 2026-09-18) — the Trash is the undo. It
    /// disarms on its own after a moment, when another trash is armed, or
    /// when editing ends.
    private func trashButton(key: String, what: String, delete: @escaping () -> Void) -> some View {
        let armed = armedTrash == key
        return RowButton(systemImage: "trash",
                         help: armed ? "Click again to move this \(what) to the Trash" : "Move to Trash (click twice)",
                         destructive: armed) {
            if armed {
                armedTrash = nil
                delete()
            } else {
                armedTrash = key
                Task {
                    try? await Task.sleep(nanoseconds: 4_000_000_000)
                    if armedTrash == key { armedTrash = nil }
                }
            }
        }
    }

    // MARK: - Chrome

    private var header: some View {
        // The collapse button belongs to the sidebar (Sean, 2026-09-18), not
        // to the editor's bar; the way back is the button that appears there
        // when this is hidden, ⌃⌘S, or the View menu.
        // FOUR BUTTONS IN 250 POINTS, AND NO TITLE.
        //
        // The video's own switch is not one of them (Sean, 2026-09-19:
        // "there should only be one show/hide button for the video feed"):
        // every pane's switch lives on ANOTHER pane, once — the video's on
        // the editor's bar, the notes pane's in the video's corner, the
        // sidebar's here with its way back on the editor's bar.
        //
        // The word "Notes" that sat beside the collapse button is gone
        // (Sean, 2026-09-19: "the word "Notes" doesn't need to be there in
        // the menu bar"): the collapse button keeps the left edge, the other
        // three keep the right, and the bar keeps its 44 points. The buttons
        // are narrower here than in the text bar.
        HStack(spacing: 1) {
            BarButton(systemImage: "sidebar.left", label: "Hide Notes Sidebar",
                      help: "Hide the notes sidebar (⌃⌘S)", width: 22) { appState.toggleSidebar() }
            Spacer(minLength: 2)
            BarButton(systemImage: editing ? "checkmark" : "slider.horizontal.3",
                      label: editing ? "Done Editing" : "Edit Notes",
                      help: editing ? "Done" : "Duplicate and delete",
                      isOn: editing, width: 22) {
                withAnimation(.easeInOut(duration: 0.15)) { editing.toggle(); armedTrash = nil }
            }
            BarButton(systemImage: "folder.badge.plus", label: "New Section",
                      help: "New section in \(store.targetSection.name)", width: 22) {
                if let made = store.createSection() { expanded.insert(made.id) }
            }
            BarButton(systemImage: "square.and.pencil", label: "New Note",
                      help: "New note in \(store.targetSection.name) (⌘N)", width: 22) { store.createNote() }
        }
        .padding(.horizontal, 6)
        .frame(height: 44)
        .background(.bar)
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Text(store.notes.count == 1 ? "1 note" : "\(store.notes.count) notes")
            if store.folders.count > 1 {
                Text("· \(store.folders.count) folders")
            }
            Spacer()
            Menu {
                Button("Add Folder to Project…") { addFolderToProject() }
                // Only folders that are really on disk are offered, to remove
                // or to show again (Sean, 2026-09-19: "remove folder on
                // project only if it's a real folder that exists").
                if !removableFolders.isEmpty {
                    Menu("Remove Folder from Project") {
                        ForEach(removableFolders, id: \.path) { folder in
                            Button(folder.lastPathComponent) {
                                projects.removeFolder(folder)
                                store.setFolders(projects.folders, excluding: projects.excluded)
                            }
                        }
                    }
                }
                if !hiddenFoldersOnDisk.isEmpty {
                    Menu("Hidden Folders") {
                        ForEach(hiddenFoldersOnDisk, id: \.path) { folder in
                            Button("Show \(folder.lastPathComponent)") {
                                projects.include(folder)
                                store.setFolders(projects.folders, excluding: projects.excluded)
                            }
                        }
                    }
                }
                Divider()
                Button("Reveal in Finder") { store.revealFolderInFinder() }
                Button("Choose Folder…") { store.chooseFolder() }
                if store.directory != NoteStore.defaultDirectory() {
                    Button("Use ~/Documents/WriteMind") { store.useDefaultFolder() }
                }
            } label: {
                Label("Folder", systemImage: "folder")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help(store.directory.path)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .frame(height: 28)
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Image(systemName: "note.text").font(.system(size: 30)).foregroundStyle(.tertiary)
            Text("No notes yet").foregroundStyle(.secondary)
            HStack {
                Button("New Note") { store.createNote() }
                Button("New Section") {
                    if let made = store.createSection() { expanded.insert(made.id) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .contextMenu {
            Button("New Note") { store.createNote() }
            Button("New Section") {
                if let made = store.createSection() { expanded.insert(made.id) }
            }
            Divider()
            Button("Add Folder to Project…") { addFolderToProject() }
        }
    }

    /// The same thing the Project menu does, where the folders actually are
    /// (Sean, 2026-09-18) — the sidebar's own folder menu and its right-click.
    private func addFolderToProject() {
        guard let folder = projects.chooseFolder(
            message: "Add a folder of notes to “\(projects.name)”.") else { return }
        projects.addFolder(folder)
        store.setFolders(projects.folders, excluding: projects.excluded)
    }

    private var accessDenied: some View {
        VStack(spacing: 10) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 30)).foregroundStyle(.tertiary)
            Text("Can't open the notes folder").font(.headline)
            Text(store.directory.path)
                .font(.caption).foregroundStyle(.secondary)
                .lineLimit(2).truncationMode(.middle)
            Text("macOS asks before an app reads your Documents folder. Allow it in Settings, or pick the folder yourself — choosing it here grants access for good.")
                .font(.caption).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Choose Folder…") { store.chooseFolder() }
            Button("Open Privacy Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders") {
                    NSWorkspace.shared.open(url)
                }
            }
            .buttonStyle(.link)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }


    // MARK: - Rows

    /// The tree, flattened to the rows that are actually showing. A view that
    /// recursed here could not be type-checked — its opaque return type would
    /// be defined in terms of itself — and a flat list draws faster anyway.
    private var rows: [SidebarRow] {
        var out: [SidebarRow] = []
        func walk(_ section: NoteSection, indent: Int) {
            for note in section.notes { out.append(.note(note, section, indent)) }
            for child in section.sections {
                out.append(.section(child, indent))
                if expanded.contains(child.id) { walk(child, indent: indent + 1) }
            }
        }
        // A one-folder project reads better without a header over everything;
        // a project with several needs to say which folder a note is in.
        let showRoots = store.roots.count > 1
        for root in store.roots {
            if showRoots {
                out.append(.section(root, 0))
                if expanded.contains(root.id) { walk(root, indent: 1) }
            } else {
                walk(root, indent: 0)
            }
        }
        return out
    }

    /// A note's row. THE DRAG SOURCE GOES ON BEFORE THE TAP, here and in
    /// `sectionRow`, and that order is what lets a row be dragged at all
    /// (Sean, 2026-09-19: "Allow dragging to reorder in the side bar.. it
    /// doesn't need edit mode"). Nothing in this file ever asked `editing`
    /// before allowing a drag or a drop — the tap gesture was what blocked
    /// the drag, in either mode. A gesture added with `.onTapGesture` (that
    /// is, `.gesture`) yields to the gestures its view already has, and the
    /// drag source is a gesture too, so with the tap put on FIRST the drag,
    /// added after it and so outside it, ranked below the tap; and on macOS
    /// a TapGesture does not give up when the mouse moves — it waits for the
    /// mouse-up and judges the distance then — so for the whole of a
    /// click-and-drag the tap still had first claim, the drag source under
    /// it never got to begin its dragging session, and at the mouse-up the
    /// tap failed as well: nothing happened. With the drag source inside, IT
    /// has first claim: movement begins the drag and the tap is cancelled
    /// with it; a click that never moves lets the drag fail at mouse-up and
    /// the tap — still a plain click, still on mouse-up — selects. The
    /// buttons of edit mode are children of the row and beat both, as they
    /// did, so a click on Duplicate or on the trash neither selects nor
    /// drags. The drop line (`dropRow`) and the lit section (`dropTarget`)
    /// come from `isTargeted`, which never asked the mode either, so they
    /// show whenever a drag is over a row.
    private func noteRow(_ note: Note, in section: NoteSection, indent: Int) -> some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text(note.title).lineLimit(1)
                HStack(spacing: 6) {
                    Text(note.modified, format: .dateTime.month(.abbreviated).day())
                    if !note.snippet.isEmpty { Text(note.snippet).lineLimit(1) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if editing {
                RowButton(systemImage: "plus.square.on.square", help: "Duplicate") { store.duplicate(note) }
                trashButton(key: "note:\(note.id)", what: "note") { store.delete(note) }
            }
        }
        .padding(.vertical, 3)
        .padding(.leading, CGFloat(indent) * 14 + 8)
        .padding(.trailing, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(store.selection == note.id ? Color.accentColor.opacity(0.22) : .clear,
                    in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .draggable(SidebarItem(kind: .note, path: note.url.path)) {
            Label(note.title, systemImage: "doc.text")
        }
        .onTapGesture {
            store.selection = note.id
            store.selectedSectionID = section.id
        }
        .dropDestination(for: SidebarItem.self) { items, _ in
            place(items, before: note, in: section)
        } isTargeted: { targeted in
            dropRow = targeted ? note.id : (dropRow == note.id ? nil : dropRow)
        }
        .overlay(alignment: .top) {
            // The line a dropped row would land above.
            if dropRow == note.id {
                Rectangle().fill(Color.accentColor).frame(height: 2)
            }
        }
        .contextMenu {
            Button("New Note Here") { store.selectedSectionID = section.id; store.createNote() }
            Button("New Section Here") {
                if let made = store.createSection(in: section) { expanded.insert(made.id) }
            }
            Divider()
            Button("Rename…") { newName = note.filename; renamingNote = note }
            Button("Duplicate") { store.duplicate(note) }
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([note.url]) }
            Divider()
            moveMenu(for: note)
            Divider()
            Button("Move to Trash…", role: .destructive) {
                pendingTrash = TrashTarget(kind: .note(note))
            }
        }
    }

    private func sectionRow(_ section: NoteSection, indent: Int) -> some View {
        HStack(spacing: 4) {
            Button {
                withAnimation(.easeInOut(duration: 0.12)) {
                    if expanded.contains(section.id) { expanded.remove(section.id) } else { expanded.insert(section.id) }
                }
            } label: {
                Image(systemName: expanded.contains(section.id) ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .frame(width: 12)
            }
            .buttonStyle(.plain)

            Image(systemName: section.isRoot ? "folder.fill" : "folder")
                .font(.system(size: 11))
                .foregroundStyle(section.isRoot ? Color.accentColor : .secondary)
            Text(section.name)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
            Spacer(minLength: 0)
            if editing, !section.isRoot {
                trashButton(key: "section:\(section.id)", what: "section and its notes") { store.delete(section) }
            } else if !section.allNotes.isEmpty {
                Text("\(section.allNotes.count)")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .padding(.leading, CGFloat(indent) * 14 + 6)
        .padding(.trailing, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background(for: section), in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        // Drag source first, tap after — the order `noteRow` explains.
        .draggable(SidebarItem(kind: .section, path: section.url.path)) {
            Label(section.name, systemImage: "folder")
        }
        .onTapGesture { store.selectedSectionID = section.id }
        .dropDestination(for: SidebarItem.self) { items, _ in
            drop(items, into: section)
        } isTargeted: { targeted in
            dropTarget = targeted ? section.id : (dropTarget == section.id ? nil : dropTarget)
        }
        .contextMenu {
            Button("New Note Here") { store.selectedSectionID = section.id; store.createNote() }
            Button("New Subsection") {
                if let made = store.createSection(in: section) { expanded.insert(made.id) }
            }
            if !section.isRoot {
                Button("Rename…") { newName = section.name; renamingSection = section }
            }
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([section.url]) }
            Divider()
            // "Remove Folder from Project" only for a folder that is really
            // on disk at this moment (Sean, 2026-09-19: "remove folder on
            // project only if it's a real folder that exists"). The menu is
            // built on the right-click, so `isRealFolder` looks right then:
            // a section whose folder Finder or the Trash took since the last
            // read (the watcher sees the primary folder's top level, nothing
            // deeper) or whose volume has gone gets no such item — hiding a
            // ghost would only put its path in `Project.excluded` for good.
            if section.isRoot {
                // A project folder is not this app's to trash — it is only
                // in the project because the project says so.
                if section.isRealFolder {
                    Button("Remove Folder from Project") {
                        projects.removeFolder(section.url)
                        store.setFolders(projects.folders, excluding: projects.excluded)
                    }
                    .disabled(store.folders.count <= 1)
                }
            } else {
                // A folder can be taken OUT of the project and left where it
                // is (Sean, 2026-09-18) — the Trash is for one that should go.
                if section.isRealFolder {
                    Button("Remove Folder from Project") { hide(section) }
                }
                Button("Move to Trash…", role: .destructive) {
                    pendingTrash = TrashTarget(kind: .section(section))
                }
            }
        }
    }

    /// Out of the sidebar, still on disk; the footer's Folder menu brings it back.
    private func hide(_ section: NoteSection) {
        projects.exclude(section.url)
        store.setFolders(projects.folders, excluding: projects.excluded)
    }

    /// The project's other folders that are really on disk — the only ones
    /// the footer offers to remove (Sean, 2026-09-19). The primary folder is
    /// not offered there, as before; the root's own menu is where that lives.
    private var removableFolders: [URL] {
        store.folders.dropFirst().filter { NoteTree.isRealFolder(at: $0) }
    }

    /// The hidden folders that still exist — the only ones worth a "Show"
    /// item. One that has gone stays in `Project.excluded`, harmless: nothing
    /// on disk matches it any more.
    private var hiddenFoldersOnDisk: [URL] {
        projects.excluded.filter { NoteTree.isRealFolder(at: $0) }
    }

    private func background(for section: NoteSection) -> Color {
        if dropTarget == section.id { return Color.accentColor.opacity(0.35) }
        if store.selectedSectionID == section.id { return Color.accentColor.opacity(0.14) }
        return .clear
    }

    @ViewBuilder
    private func moveMenu(for note: Note) -> some View {
        Menu("Move to") {
            ForEach(store.roots) { root in
                Button(root.name) { store.move(note, to: root) }
            }
            Divider()
            ForEach(store.allSections.filter { !$0.isRoot }) { section in
                Button(section.name) { store.move(note, to: section) }
            }
        }
    }

    /// A row dropped on a row: rearrange rather than only re-file.
    private func place(_ items: [SidebarItem], before target: Note, in section: NoteSection) -> Bool {
        defer { dropRow = nil }
        var moved = false
        for item in items {
            let url = URL(fileURLWithPath: item.path)
            switch item.kind {
            case .note:
                if let note = store.notes.first(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) {
                    moved = store.place(note, before: target) || moved
                }
            case .section:
                // A section cannot go between two notes; it goes into the
                // section that holds them.
                if let dragged = store.section(withURL: url) {
                    moved = store.move(dragged, to: section) || moved
                }
            }
        }
        return moved
    }

    private func drop(_ items: [SidebarItem], into section: NoteSection) -> Bool {
        var moved = false
        for item in items {
            let url = URL(fileURLWithPath: item.path)
            switch item.kind {
            case .note:
                if let note = store.notes.first(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) {
                    moved = store.move(note, to: section) || moved
                }
            case .section:
                if let dragged = store.section(withURL: url) {
                    moved = store.move(dragged, to: section) || moved
                }
            }
        }
        dropTarget = nil
        return moved
    }
}

/// One line of the sidebar: a note (with the section holding it, so tapping
/// it also selects where the next note goes) or a section.
enum SidebarRow: Identifiable {
    case note(Note, NoteSection, Int)
    case section(NoteSection, Int)

    var id: String {
        switch self {
        case .note(let note, _, _): return "n:" + note.id
        case .section(let section, _): return "s:" + section.id
        }
    }
}

/// What a sidebar row carries while it is being dragged: which kind of thing
/// it is and where it lives. A path rather than a row index, because the drop
/// is a real file move on disk.
struct SidebarItem: Codable, Transferable, Equatable {
    enum Kind: String, Codable { case note, section }
    let kind: Kind
    let path: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .writeMindSidebarItem)
    }
}

extension UTType {
    static let writeMindSidebarItem = UTType(exportedAs: "com.seancheren.WriteMind.sidebar-item")
}

private struct RowButton: View {
    let systemImage: String
    let help: String
    var destructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .medium))
                .frame(width: 20, height: 18)
                .foregroundStyle(destructive ? Color.red : Color.secondary)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }
}
