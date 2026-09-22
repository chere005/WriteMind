import Foundation

/// A project is a list of folders, saved as JSON — Sublime Text's shape, and
/// for the same reason: the folders are the durable part, worth keeping in a
/// file you can read, move and put in git.
struct Project: Codable, Equatable {
    /// Bumped only if the file's shape ever changes incompatibly.
    var version = 1
    /// Absolute paths. Stored as strings so the file reads as a file.
    var folders: [String] = []
    /// Folders INSIDE the project's folders that are kept out of it: still
    /// on disk, not in the sidebar (Sean, 2026-09-18: "remove folder from
    /// project", since the Trash is for a folder that should go). Absolute
    /// paths, like `folders`.
    var excluded: [String] = []

    static let fileExtension = "writemind-project"

    var folderURLs: [URL] { folders.map { URL(fileURLWithPath: $0, isDirectory: true) } }
    var excludedURLs: [URL] { excluded.map { URL(fileURLWithPath: $0, isDirectory: true) } }

    private enum CodingKeys: String, CodingKey { case version, folders, excluded }

    init(version: Int = 1, folders: [String] = [], excluded: [String] = []) {
        self.version = version
        self.folders = folders
        self.excluded = excluded
    }

    // A project file written before `excluded` existed still opens.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        folders = try container.decodeIfPresent([String].self, forKey: .folders) ?? []
        excluded = try container.decodeIfPresent([String].self, forKey: .excluded) ?? []
    }

    static func load(from url: URL) throws -> Project {
        try JSONDecoder().decode(Project.self, from: Data(contentsOf: url))
    }

    func save(to url: URL) throws {
        let encoder = JSONEncoder()
        // Paths, unescaped — the file is meant to be read and edited by hand.
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(self).write(to: url, options: .atomic)
    }
}

/// What the project does NOT keep in its file: which notes are open, which one
/// is in front, and any text that has not reached disk. Sublime splits these
/// the same way — the project is worth sharing, the session is yours — and it
/// is what makes closing an unsaved project safe: the session is cached
/// whether or not the project itself was ever saved.
struct ProjectSession: Codable, Equatable {
    var projectPath: String?
    var folders: [String] = []
    /// The hidden folders, for a project that has no file to keep them in.
    var excluded: [String] = []
    var openNotePaths: [String] = []
    var activeNotePath: String?
    /// Note path → text that had not been written when the app closed. Empty
    /// in the normal case, because editing autosaves; it is the crash and
    /// quit-mid-keystroke case this exists for.
    var unsavedBuffers: [String: String] = [:]
    /// Note path → the notebook sections that were closed in it.
    var collapsedSections: [String: [String]] = [:]

    private enum CodingKeys: String, CodingKey {
        case projectPath, folders, excluded, openNotePaths, activeNotePath, unsavedBuffers
        case collapsedSections
    }

    init() {}

    // A session cached before `excluded` existed still loads.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        projectPath = try container.decodeIfPresent(String.self, forKey: .projectPath)
        folders = try container.decodeIfPresent([String].self, forKey: .folders) ?? []
        excluded = try container.decodeIfPresent([String].self, forKey: .excluded) ?? []
        openNotePaths = try container.decodeIfPresent([String].self, forKey: .openNotePaths) ?? []
        activeNotePath = try container.decodeIfPresent(String.self, forKey: .activeNotePath)
        unsavedBuffers = try container.decodeIfPresent([String: String].self, forKey: .unsavedBuffers) ?? [:]
        collapsedSections = try container.decodeIfPresent([String: [String]].self,
                                                          forKey: .collapsedSections) ?? [:]
    }

    /// One file per project, plus one for "no project open yet", in Application
    /// Support — never beside the notes, which stay a folder of markdown.
    static func url(forProjectAt path: String?) -> URL? {
        // A TEST HOST OR A SMOKE RUN KEEPS ITS SESSION SOMEWHERE ELSE, and
        // that is not a nicety: the session names its folders and its open
        // notes by ABSOLUTE PATH, so restoring one took a run that had been
        // sent to a scratch notes folder straight back into
        // ~/Documents/WriteMind — and `restoreSession` writes the cached
        // buffers over the files it finds there. See `TestHost.supportDirectory`.
        let base = TestHost.isActive
            ? TestHost.supportDirectory
            : FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let base else { return nil }
        let folder = base.appending(path: "WriteMind/Sessions", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = path.map { key(for: $0) } ?? "default"
        return folder.appending(path: "\(name).json")
    }

    /// A file name that cannot collide and cannot contain a slash.
    private static func key(for path: String) -> String {
        var hash: UInt64 = 5381
        for byte in path.utf8 { hash = (hash &* 33) ^ UInt64(byte) }
        let stem = (path as NSString).lastPathComponent
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ".", with: "-")
        return "\(stem)-\(String(hash, radix: 36))"
    }

    static func load(forProjectAt path: String?) -> ProjectSession? {
        guard let url = url(forProjectAt: path), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ProjectSession.self, from: data)
    }

    func save() {
        guard let url = Self.url(forProjectAt: projectPath) else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try encoder.encode(self).write(to: url, options: .atomic)
        } catch {
            NSLog("WriteMind: could not cache the session: \(error)")
        }
    }
}
