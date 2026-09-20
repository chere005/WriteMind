import SwiftUI

/// UI-only state: which pane is showing, whether the sidebar is out, and the pen.
final class AppState: ObservableObject {
    enum Mode: String { case editor, preview }

    /// A `/link` waiting for its target: which note it was typed in, roughly
    /// where, and what the note was called so the banner can say so.
    struct PendingLink: Equatable {
        let sourceNoteID: Note.ID
        let sourceTitle: String
        let caret: Int
    }

    @Published var showSidebar: Bool { didSet { defaults.set(showSidebar, forKey: Keys.showSidebar) } }
    @Published var showEditor: Bool { didSet { defaults.set(showEditor, forKey: Keys.showEditor) } }
    @Published var showCamera: Bool { didSet { defaults.set(showCamera, forKey: Keys.showCamera) } }
    @Published var penWidth: Double { didSet { defaults.set(penWidth, forKey: Keys.penWidth) } }
    /// Quarter turns of the video pane, kept because a camera that is mounted
    /// sideways stays mounted sideways.
    @Published var cameraRotation: Int { didSet { defaults.set(cameraRotation, forKey: Keys.cameraRotation) } }
    /// What the viewfinder button brings in: the writing, or the whole page.
    @Published var captureMode: NotebookCapture.Mode {
        didSet { defaults.set(captureMode.rawValue, forKey: Keys.captureMode) }
    }
    @Published var penColorHex: String { didSet { defaults.set(penColorHex, forKey: Keys.penColorHex) } }
    /// The part of the video the pane is zoomed into, in pane fractions of
    /// the unzoomed picture (Sean, 2026-09-19: "drag a square to resize
    /// camera"). Nil is the whole picture.
    @Published var cameraZoom: CGRect? {
        didSet {
            defaults.set(cameraZoom.map { [$0.minX, $0.minY, $0.width, $0.height] }, forKey: Keys.cameraZoom)
        }
    }
    /// Armed to drag the box the video zooms into. Lives here because the
    /// button that arms it is on the editor's bar and the drag happens on
    /// the video (Sean, 2026-09-19: "picture and whole screen should be
    /// dropdowns from the show video button").
    @Published var cameraZooming = false
    /// What that zoom is in the FRAME's own fractions — worked out by the
    /// camera pane, used by the capture button so what is brought in is
    /// what is on show.
    @Published var cameraRegion: CGRect?
    /// What the list button writes: dots, dashes or numbers — dots by
    /// default (Sean, 2026-09-19).
    @Published var bulletStyle: MarkdownFormatting.ListStyle {
        didSet { defaults.set(bulletStyle.rawValue, forKey: Keys.bulletStyle) }
    }
    /// Whether a new table is written with grid lines.
    @Published var tableGrid: Bool { didSet { defaults.set(tableGrid, forKey: Keys.tableGrid) } }
    /// The language a new code block is tagged with.
    @Published var codeLanguage: CodeLanguage {
        didSet { defaults.set(codeLanguage.rawValue, forKey: Keys.codeLanguage) }
    }
    @Published var textFamily: String { didSet { defaults.set(textFamily, forKey: Keys.textFamily) } }
    @Published var textSize: Double { didSet { defaults.set(textSize, forKey: Keys.textSize) } }
    @Published var textColorHex: String { didSet { defaults.set(textColorHex, forKey: Keys.textColorHex) } }
    @Published var textApplyFamily: Bool { didSet { defaults.set(textApplyFamily, forKey: Keys.textApplyFamily) } }
    @Published var textApplySize: Bool { didSet { defaults.set(textApplySize, forKey: Keys.textApplySize) } }
    @Published var textApplyColor: Bool { didSet { defaults.set(textApplyColor, forKey: Keys.textApplyColor) } }
    /// True shows the raw markdown in the editor — `**`, `#`, the link's
    /// URL. Off (the default) hides them, leaving the styled text, with the
    /// caret's own paragraph always showing its own (Sean, 2026-09-19:
    /// "allow wysiwyg editing including all the buttons on the bar").
    @Published var showMarkers: Bool { didSet { defaults.set(showMarkers, forKey: Keys.showMarkers) } }
    /// Which sections of the toolbar are put away (Sean, 2026-09-19: "each
    /// section of the toolbar should be collapsable to make things sane").
    /// The shortcuts keep working: they live in the Format menu, not on the
    /// buttons.
    @Published var collapsedToolGroups: Set<String> {
        didSet { defaults.set(Array(collapsedToolGroups).sorted(), forKey: Keys.collapsedToolGroups) }
    }
    /// Set while the user is picking what a `/link` should point at.
    @Published var pendingLink: PendingLink?
    @Published var mode: Mode = .editor
    @Published var penActive: Bool = false {
        didSet { if penActive, connectActive { connectActive = false } }
    }
    /// The arrow tool (Sean, 2026-09-18): drag from node to node. One tool
    /// at a time — picking it up puts the pen down, and the other way round.
    @Published var connectActive: Bool = false {
        didSet { if connectActive, penActive { penActive = false } }
    }
    /// The shape or mark armed by the palette, waiting for the drag that
    /// says where it goes (Sean, 2026-09-19). One tool at a time.
    @Published var placing: CanvasPlacement? {
        didSet {
            guard placing != nil else { return }
            penActive = false
            connectActive = false
        }
    }
    /// True while a block in the preview is open for editing. The bar's
    /// buttons work on that block, so they are live on that side too.
    @Published var blockEditing = false

    /// The toolbar's handle on the live NSTextView.
    let editor = EditorBridge()

    static let presetColors = ["#F2542D", "#F5B700", "#2FBF71", "#2D7DD2", "#8E44AD", "#1C1C1E"]

    private let defaults: UserDefaults
    private enum Keys {
        static let showSidebar = "showSidebar"
        static let showEditor = "showEditor"
        static let showCamera = "showCamera"
        static let penWidth = "penWidth"
        static let cameraRotation = "cameraRotation"
        static let captureMode = "captureMode"
        static let penColorHex = "penColorHex"
        static let cameraZoom = "cameraZoom"
        static let bulletStyle = "bulletStyle"
        static let tableGrid = "tableGrid"
        static let codeLanguage = "codeLanguage"
        static let collapsedToolGroups = "collapsedToolGroups"
        static let showMarkers = "showMarkers"
        static let textFamily = "textFamily"
        static let textSize = "textSize"
        static let textColorHex = "textColorHex"
        static let textApplyFamily = "textApplyFamily"
        static let textApplySize = "textApplySize"
        static let textApplyColor = "textApplyColor"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showSidebar = defaults.object(forKey: Keys.showSidebar) as? Bool ?? true
        // BOTH PANES, EVERY LAUNCH (Sean, 2026-09-19: "default video always
        // to side by side"). Putting a pane away is a thing you do for a
        // minute, not a setting — and a launch that came up with the video
        // hidden left him hunting for the way back. Still written down, so
        // nothing else has to change; simply not read at startup.
        showEditor = true
        showCamera = true
        penWidth = defaults.object(forKey: Keys.penWidth) as? Double ?? 3
        cameraRotation = defaults.object(forKey: Keys.cameraRotation) as? Int ?? 0
        captureMode = NotebookCapture.Mode(rawValue: defaults.string(forKey: Keys.captureMode) ?? "") ?? .ink
        penColorHex = defaults.string(forKey: Keys.penColorHex) ?? Self.presetColors[0]
        if let box = defaults.array(forKey: Keys.cameraZoom) as? [Double], box.count == 4 {
            cameraZoom = CGRect(x: box[0], y: box[1], width: box[2], height: box[3])
        } else {
            cameraZoom = nil
        }
        bulletStyle = MarkdownFormatting.ListStyle(rawValue: defaults.string(forKey: Keys.bulletStyle) ?? "") ?? .dots
        tableGrid = defaults.object(forKey: Keys.tableGrid) as? Bool ?? true
        codeLanguage = CodeLanguage(rawValue: defaults.string(forKey: Keys.codeLanguage) ?? "") ?? .plain
        collapsedToolGroups = Set(defaults.stringArray(forKey: Keys.collapsedToolGroups) ?? [])
        showMarkers = defaults.object(forKey: Keys.showMarkers) as? Bool ?? false
        textFamily = defaults.string(forKey: Keys.textFamily) ?? "System"
        textSize = defaults.object(forKey: Keys.textSize) as? Double ?? 15
        textColorHex = defaults.string(forKey: Keys.textColorHex) ?? Self.presetColors[3]
        textApplyFamily = defaults.object(forKey: Keys.textApplyFamily) as? Bool ?? false
        textApplySize = defaults.object(forKey: Keys.textApplySize) as? Bool ?? false
        textApplyColor = defaults.object(forKey: Keys.textApplyColor) as? Bool ?? true
    }

    /// What the T menu would write: only the parts that are ticked, and
    /// "System" means "no font-family at all", not a family called System.
    var spanStyle: MarkdownFormatting.SpanStyle {
        MarkdownFormatting.SpanStyle(
            family: (textApplyFamily && textFamily != "System") ? textFamily : nil,
            size: textApplySize ? textSize : nil,
            colorHex: textApplyColor ? textColorHex : nil)
    }

    var penColor: Color {
        get { Color(hex: penColorHex) ?? .orange }
        set { penColorHex = newValue.hexString }
    }

    /// Quarter turns, and only quarter turns — a video pane seven degrees off
    /// is a mistake, not a choice.
    func rotateCamera(by degrees: Int) {
        withAnimation(.easeInOut(duration: 0.2)) {
            cameraRotation = ((cameraRotation + degrees) % 360 + 360) % 360
        }
    }

    /// On its side, so the preview's width and height swap.
    var cameraIsTurned: Bool { cameraRotation == 90 || cameraRotation == 270 }

    func isCollapsed(_ group: ToolGroup) -> Bool { collapsedToolGroups.contains(group.rawValue) }

    func setCollapsed(_ group: ToolGroup, _ collapsed: Bool) {
        withAnimation(.easeInOut(duration: 0.16)) {
            if collapsed { collapsedToolGroups.insert(group.rawValue) }
            else { collapsedToolGroups.remove(group.rawValue) }
        }
    }

    func toggleSidebar() {
        withAnimation(.easeInOut(duration: 0.18)) { showSidebar.toggle() }
    }

    /// Either pane can be put away, but not both — an empty window has no way
    /// back, since the buttons that bring a pane back live on the panes.
    func toggleCameraPane() {
        withAnimation(.easeInOut(duration: 0.18)) {
            if showCamera { showCamera = false; showEditor = true } else { showCamera = true }
        }
    }

    func toggleEditorPane() {
        withAnimation(.easeInOut(duration: 0.18)) {
            if showEditor { showEditor = false; showCamera = true } else { showEditor = true }
        }
    }

    func toggleMode() {
        withAnimation(.easeInOut(duration: 0.15)) {
            mode = (mode == .editor) ? .preview : .editor
        }
        // Drawing only happens over the editor.
        if mode == .preview { penActive = false }
        if mode == .editor { blockEditing = false }
    }
}
