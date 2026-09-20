import AppKit
import Combine
import Foundation

/// The open project: its folders, its file on disk (if it has one yet), and
/// whether it has changes that file does not.
@MainActor
final class ProjectStore: ObservableObject {
    @Published private(set) var project = Project()
    @Published private(set) var fileURL: URL?
    @Published private(set) var hasUnsavedProjectChanges = false

    private static let lastProjectKey = "lastProjectPath"

    var name: String {
        fileURL.map { $0.deletingPathExtension().lastPathComponent } ?? "Untitled Project"
    }

    var folders: [URL] { project.folderURLs }
    /// Folders inside the project kept out of the sidebar.
    var excluded: [URL] { project.excludedURLs }

    /// The project last open, so a launch comes back to it.
    static func lastProjectPath() -> String? {
        UserDefaults.standard.string(forKey: lastProjectKey)
    }

    func adopt(folders: [URL], excluded: [URL] = []) {
        project.folders = folders.map(\.standardizedFileURL.path)
        project.excluded = excluded.map(\.standardizedFileURL.path)
        hasUnsavedProjectChanges = fileURL != nil
    }

    /// Take a folder inside the project out of it, leaving it on disk.
    func exclude(_ url: URL) {
        let path = url.standardizedFileURL.path
        guard !project.excluded.contains(path) else { return }
        project.excluded.append(path)
        hasUnsavedProjectChanges = true
    }

    /// Bring a hidden folder back.
    func include(_ url: URL) {
        let path = url.standardizedFileURL.path
        guard project.excluded.contains(path) else { return }
        project.excluded.removeAll { $0 == path }
        hasUnsavedProjectChanges = true
    }

    func addFolder(_ url: URL) {
        let path = url.standardizedFileURL.path
        guard !project.folders.contains(path) else { return }
        project.folders.append(path)
        hasUnsavedProjectChanges = true
    }

    func removeFolder(_ url: URL) {
        let path = url.standardizedFileURL.path
        guard project.folders.contains(path) else { return }
        project.folders.removeAll { $0 == path }
        hasUnsavedProjectChanges = true
    }

    // MARK: - The file

    func newProject(startingAt folder: URL) {
        project = Project(folders: [folder.standardizedFileURL.path])
        fileURL = nil
        hasUnsavedProjectChanges = false
        UserDefaults.standard.removeObject(forKey: Self.lastProjectKey)
    }

    @discardableResult
    func open(_ url: URL) -> Bool {
        do {
            project = try Project.load(from: url)
            fileURL = url
            hasUnsavedProjectChanges = false
            UserDefaults.standard.set(url.path, forKey: Self.lastProjectKey)
            return true
        } catch {
            NSLog("WriteMind: could not open that project: \(error)")
            return false
        }
    }

    func openWithPanel() -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = []
        panel.message = "Choose a WriteMind project."
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        return open(url)
    }

    /// Save over the project's own file, or ask for one the first time.
    @discardableResult
    func save() -> Bool {
        guard let fileURL else { return saveAs() }
        do {
            try project.save(to: fileURL)
            hasUnsavedProjectChanges = false
            UserDefaults.standard.set(fileURL.path, forKey: Self.lastProjectKey)
            return true
        } catch {
            NSLog("WriteMind: could not save the project: \(error)")
            return false
        }
    }

    @discardableResult
    func saveAs() -> Bool {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(name).\(Project.fileExtension)"
        panel.message = "Save this project's folders as a file you can reopen."
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, var url = panel.url else { return false }
        if url.pathExtension.isEmpty { url.appendPathExtension(Project.fileExtension) }
        do {
            try project.save(to: url)
            fileURL = url
            hasUnsavedProjectChanges = false
            UserDefaults.standard.set(url.path, forKey: Self.lastProjectKey)
            return true
        } catch {
            NSLog("WriteMind: could not save the project: \(error)")
            return false
        }
    }

    /// Pick a folder to add. Returns it so the caller can reload around it.
    func chooseFolder(message: String) -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Add to Project"
        panel.message = message
        guard panel.runModal() == .OK else { return nil }
        return panel.url
    }
}
