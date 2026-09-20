import SwiftUI

@main
struct WriteMindApp: App {
    @StateObject private var store = NoteStore()
    @StateObject private var appState = AppState()
    @StateObject private var camera = CameraController.shared
    @StateObject private var projects = ProjectStore()
    @State private var didRestoreSession = false

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .environmentObject(appState)
                .environmentObject(camera)
                .environmentObject(projects)
                .frame(minWidth: 900, minHeight: 560)
                .task {
                    guard !didRestoreSession else { return }
                    didRestoreSession = true
                    restoreSession()
                }
                .onReceive(NotificationCenter.default.publisher(
                    for: NSApplication.willTerminateNotification)) { _ in
                    cacheSession()
                }
        }
        .defaultSize(width: 1280, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Note") { store.createNote() }
                    .keyboardShortcut("n", modifiers: .command)
                Divider()
                Button("Close Tab") {
                    if let selection = store.selection { store.closeTab(selection) }
                }
                .keyboardShortcut("w", modifiers: .command)
                .disabled(store.selection == nil)
                Divider()
                Button("Open Notes Folder") { store.revealFolderInFinder() }
                    .keyboardShortcut("o", modifiers: [.command, .shift])
            }

            ExportMenu(store: store)

            ProjectMenu(store: store, projects: projects, cacheSession: cacheSession)

            CommandGroup(after: .sidebar) {
                Button(appState.showSidebar ? "Hide Notes Sidebar" : "Show Notes Sidebar") {
                    appState.toggleSidebar()
                }
                .keyboardShortcut("s", modifiers: [.command, .control])

                Button(appState.mode == .editor ? "Show Markdown Preview" : "Show Markdown Editor") {
                    appState.toggleMode()
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])

                // ⌃⌘C was promised by the buttons' help and registered
                // nowhere, so the video pane could only be brought back from
                // the sidebar — which can itself be put away (Sean,
                // 2026-09-19: "what happened to the right pane with the
                // camera view?").
                Button(appState.showCamera ? "Hide Video" : "Show Video") {
                    appState.toggleCameraPane()
                }
                .keyboardShortcut("c", modifiers: [.command, .control])

                Button(appState.showEditor ? "Hide Notes Pane" : "Show Notes Pane") {
                    appState.toggleEditorPane()
                }
                .keyboardShortcut("e", modifiers: [.command, .control])

                Button(appState.showMarkers ? "Hide Markdown Markers" : "Show Markdown Markers") {
                    appState.showMarkers.toggle()
                }
                .keyboardShortcut("m", modifiers: [.command, .option])

                Divider()

                // Folding a notebook section, from the keyboard as well as
                // from its bracket in the gutter.
                Button("Fold Section") {
                    if let key = appState.editor.caretSection() { store.setSection(key, collapsed: true) }
                }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
                Button("Unfold Section") {
                    if let key = appState.editor.caretSection() { store.setSection(key, collapsed: false) }
                }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                Button("Fold All Sections") { store.foldAllSections() }
                    .keyboardShortcut(.leftArrow, modifiers: [.command, .option, .shift])
                Button("Unfold All Sections") { store.unfoldAllSections() }
                    .keyboardShortcut(.rightArrow, modifiers: [.command, .option, .shift])
            }

            // ⌘Z ITSELF, not a monitor underneath it. The Edit menu's own
            // Undo is a key equivalent, and a key equivalent is answered by
            // the menu before any local event monitor sees it — which is
            // why undo in drawing mode went to the TEXT (Sean, 2026-09-19:
            // "fix undo in drawing mode"). This item decides where it goes
            // and hands it to the responder chain when it is not the
            // drawing's.
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") {
                    if appState.drawingOwnsUndo, store.undoDrawing() { return }
                    NSApp.sendAction(Selector(("undo:")), to: nil, from: nil)
                }
                .keyboardShortcut("z", modifiers: .command)

                Button("Redo") {
                    if appState.drawingOwnsUndo, store.redoDrawing() { return }
                    NSApp.sendAction(Selector(("redo:")), to: nil, from: nil)
                }
                .keyboardShortcut("z", modifiers: [.command, .shift])
            }

            // And the drawing's own pair, whatever has the keyboard.
            CommandGroup(after: .undoRedo) {
                Button("Undo Drawing") { store.undoDrawing() }
                    .keyboardShortcut("z", modifiers: [.command, .option])
                    .disabled(!store.canUndoDrawing)
                Button("Redo Drawing") { store.redoDrawing() }
                    .keyboardShortcut("z", modifiers: [.command, .option, .shift])
                    .disabled(!store.canRedoDrawing)
            }

            CommandGroup(after: .pasteboard) {
                Divider()
                // ⌘. as in a notebook: the selection grows a step at a time.
                Button("Expand Selection") { appState.editor.expandSelection() }
                    .keyboardShortcut(".", modifiers: .command)
                Button("Select Next Occurrence") { appState.editor.selectNextOccurrence() }
                    .keyboardShortcut("d", modifiers: .command)
                Button("Select All Occurrences") { appState.editor.selectAllOccurrences() }
                    .keyboardShortcut("g", modifiers: [.command, .control])
            }

            // Every formatting shortcut lives HERE, not on a toolbar button
            // — a button inside a collapsed group is not in the view tree,
            // and a shortcut attached to it would stop working the moment
            // that section of the bar was put away (Sean, 2026-09-19: "each
            // section of the toolbar should be collapsable"). The menu bar
            // is also where a shortcut is discoverable.
            FormatMenu(appState: appState, store: store)
            InsertMenu(appState: appState, store: store)

            InputDevicesMenu(camera: camera)
        }
    }
}

extension WriteMindApp {
    /// Come back to the project that was open, the notes that were open in
    /// it, and the one that was in front — plus any text that had not reached
    /// disk. Sublime Text's hot exit, and the reason closing an unsaved
    /// project is safe.
    private func restoreSession() {
        if let path = ProjectStore.lastProjectPath() {
            projects.open(URL(fileURLWithPath: path))
        }
        let session = ProjectSession.load(forProjectAt: projects.fileURL?.path)

        var folders = projects.folders
        if folders.isEmpty, let cached = session?.folders, !cached.isEmpty {
            folders = cached.map { URL(fileURLWithPath: $0, isDirectory: true) }
            projects.adopt(folders: folders,
                           excluded: (session?.excluded ?? []).map { URL(fileURLWithPath: $0, isDirectory: true) })
        }
        if folders.isEmpty {
            folders = [store.directory]
            projects.adopt(folders: folders)
        }
        store.setFolders(folders, excluding: projects.excluded)

        guard let session else { return }
        // Unsaved text first: restoring a tab loads the note from disk, and
        // the cached buffer is what should win over it.
        for (path, text) in session.unsavedBuffers where text != (try? String(contentsOfFile: path, encoding: .utf8)) {
            try? text.write(toFile: path, atomically: true, encoding: .utf8)
        }
        store.reload()
        store.restoreTabs(session.openNotePaths, active: session.activeNotePath)
        store.setCollapsedSections(session.collapsedSections)
    }

    /// Write the session down. Called on quit, and whenever a project closes.
    func cacheSession() {
        store.flushPendingSave()
        var session = ProjectSession()
        session.projectPath = projects.fileURL?.path
        session.folders = store.folders.map(\.path)
        session.excluded = projects.excluded.map(\.path)
        session.openNotePaths = store.openNoteIDs
        session.activeNotePath = store.selection
        session.collapsedSections = store.collapsedSectionsForSession
        session.save()
    }
}

/// The Format menu: the heading ladder, the marks a span can carry, lists,
/// code, indentation and moving a whole section.
struct FormatMenu: Commands {
    @ObservedObject var appState: AppState
    @ObservedObject var store: NoteStore

    private var editor: EditorBridge { appState.editor }

    var body: some Commands {
        CommandMenu("Format") {
            // ⌘1 title, ⌘2 chapter, ⌘3 author, ⌘4–⌘6 sections, ⌘7 body.
            ForEach(MarkdownFormatting.Heading.ladder) { level in
                Button(level.name) { editor.heading(level) }
                    .keyboardShortcut(KeyEquivalent(level.key), modifiers: .command)
            }
            Divider()
            Button("Bold") { editor.bold() }.keyboardShortcut("b", modifiers: .command)
            Button("Italic") { editor.italic() }.keyboardShortcut("i", modifiers: .command)
            Button("Underline") { editor.underline() }.keyboardShortcut("u", modifiers: .command)
            Button("Strikethrough") { editor.strikethrough() }
                .keyboardShortcut("x", modifiers: [.command, .shift])
            Divider()
            Button("\(appState.bulletStyle.title) List") { editor.list(appState.bulletStyle) }
                .keyboardShortcut("l", modifiers: [.command, .shift])
            Button("Quote") { editor.quote() }.keyboardShortcut("q", modifiers: [.command, .control])
            Divider()
            Button("Decrease Indentation") { editor.outdent() }.keyboardShortcut("[", modifiers: .command)
            Button("Increase Indentation") { editor.indent() }.keyboardShortcut("]", modifiers: .command)
            Divider()
            // The notebook's own two commands. ⌃D and ⌃M, not ⌘D and ⌘M:
            // ⌘D was already Select Next Occurrence (Sean, 2026-09-19:
            // "cmd d was already multi text selection... change make ctrl d
            // and ctrl m divide and merge"), and ⌘M is Minimise.
            Button("Split Cell") { editor.splitCell() }
                .keyboardShortcut("d", modifiers: .control)
                .disabled(store.selectedNote == nil)
            Button("Merge Cells") { editor.mergeCells() }
                .keyboardShortcut("m", modifiers: .control)
                .disabled(store.selectedNote == nil)
            Divider()
            // A cell is a thing you can hold, the way a notebook's is
            // (Sean, 2026-09-20). ⌘D is Sublime's multi-cursor and stays
            // that way, so the cell commands take ⌃ keys.
            Button("Duplicate Cell") { editor.duplicateCell() }
                .keyboardShortcut("d", modifiers: [.control, .shift])
                .disabled(store.selectedNote == nil)
            Button("Delete Cell") { editor.deleteCell() }
                .keyboardShortcut(.delete, modifiers: [.control])
                .disabled(store.selectedNote == nil)
            Button("Move Cell Up") { editor.moveCell(up: true) }
                .keyboardShortcut(.upArrow, modifiers: [.control, .shift])
                .disabled(store.selectedNote == nil)
            Button("Move Cell Down") { editor.moveCell(up: false) }
                .keyboardShortcut(.downArrow, modifiers: [.control, .shift])
                .disabled(store.selectedNote == nil)
            Divider()
            Button("Move Section Up") { editor.moveSection(up: true) }
                .keyboardShortcut(.upArrow, modifiers: [.command, .control])
            Button("Move Section Down") { editor.moveSection(up: false) }
                .keyboardShortcut(.downArrow, modifiers: [.command, .control])
        }
    }
}

/// The Insert menu: the things that go ON a note rather than change how it
/// reads — a picture, a box of words, a table, a block of code (Sean,
/// 2026-09-19: "the insert image should be in a menu bar entry under
/// insert").
struct InsertMenu: Commands {
    @ObservedObject var appState: AppState
    @ObservedObject var store: NoteStore

    var body: some Commands {
        CommandMenu("Insert") {
            Button("Image…") {
                appState.penActive = false
                store.chooseImage()
            }
            .keyboardShortcut("i", modifiers: [.command, .shift])
            .disabled(store.selectedNote == nil)

            Button("Text Box") {
                appState.penActive = false
                store.addTextBox(colorHex: appState.penColorHex)
            }
            .disabled(store.selectedNote == nil)

            Divider()

            Button("Table") { appState.editor.insertTable(grid: appState.tableGrid) }
                .keyboardShortcut("t", modifiers: [.command, .control])
                .disabled(store.selectedNote == nil)

            Button("\(appState.codeLanguage == .plain ? "Code Block" : appState.codeLanguage.title + " Block")") {
                appState.editor.codeBlock(language: appState.codeLanguage.fence)
            }
            .keyboardShortcut("8", modifiers: .command)
            .disabled(store.selectedNote == nil)
        }
    }
}

/// The Project menu: the folders a project is made of, and the file it can
/// be saved as.
struct ProjectMenu: Commands {
    @ObservedObject var store: NoteStore
    @ObservedObject var projects: ProjectStore
    let cacheSession: () -> Void

    var body: some Commands {
        CommandMenu("Project") {
            Text(projects.name + (projects.hasUnsavedProjectChanges ? " — edited" : ""))

            Divider()

            Button("Add Folder to Project…") {
                guard let folder = projects.chooseFolder(
                    message: "Add a folder of notes to “\(projects.name)”.") else { return }
                projects.addFolder(folder)
                store.setFolders(projects.folders, excluding: projects.excluded)
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])

            Menu("Remove Folder") {
                ForEach(store.folders, id: \.path) { folder in
                    Button(folder.lastPathComponent) {
                        projects.removeFolder(folder)
                        store.setFolders(projects.folders, excluding: projects.excluded)
                    }
                    .disabled(store.folders.count <= 1)
                }
            }

            Divider()

            Button("Save Project") { projects.save() }
                .keyboardShortcut("s", modifiers: [.command, .control])
            Button("Save Project As…") { projects.saveAs() }

            Divider()

            Button("Open Project…") {
                cacheSession()
                if projects.openWithPanel() { store.setFolders(projects.folders, excluding: projects.excluded) }
            }
            Button("New Project") {
                cacheSession()
                projects.newProject(startingAt: NoteStore.defaultDirectory())
                store.setFolders(projects.folders, excluding: projects.excluded)
            }
        }
    }
}

/// The "Input Devices" menu bar item: every camera the Mac can see, plus an off switch.
struct InputDevicesMenu: Commands {
    @ObservedObject var camera: CameraController

    var body: some Commands {
        CommandMenu("Input Devices") {
            if camera.devices.isEmpty {
                Text("No cameras found")
            } else {
                ForEach(camera.devices) { device in
                    Button {
                        camera.select(deviceID: device.id)
                    } label: {
                        HStack {
                            Text(device.name)
                            if camera.selectedDeviceID == device.id { Image(systemName: "checkmark") }
                        }
                    }
                }
            }

            Divider()

            Button("Turn Camera Off") { camera.turnOff() }
                .disabled(camera.selectedDeviceID == nil)

            Button("Refresh Device List") { camera.refreshDevices() }
                .keyboardShortcut("r", modifiers: [.command, .option])
        }
    }
}
