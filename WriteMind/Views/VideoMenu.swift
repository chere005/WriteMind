import SwiftUI

/// What the video can do, hanging off the button that shows and hides it
/// (Sean, 2026-09-19: "picture and whole screen should be dropdowns from
/// the show video button"). A popover, not a Menu, because turning the
/// picture and putting it back to its own size are things you do two or
/// three times in a row and the panel has to stay up (Sean, 2026-09-19:
/// "don't exit the menu for rotate or original size clicks").
struct VideoMenu: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var camera: CameraController
    @Binding var isPresented: Bool

    private var live: Bool { camera.status == .running && appState.showCamera }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Picture").font(.headline).foregroundStyle(.primary)

            HStack(spacing: 6) {
                item("Turn Left", icon: "rotate.left", help: "A quarter turn anticlockwise",
                     enabled: live) { appState.rotateCamera(by: -90) }
                item("Turn Right", icon: "rotate.right", help: "A quarter turn clockwise",
                     enabled: live) { appState.rotateCamera(by: 90) }
            }

            item("Original Size", icon: "arrow.down.right.and.arrow.up.left",
                 help: "The whole camera picture again, at the size it comes in",
                 wide: true, enabled: live && appState.cameraZoom != nil) {
                appState.cameraZoom = nil
            }

            item("Resize by Square", icon: "square.dashed",
                 help: "Drag a box on the picture and the pane shows just that much",
                 wide: true, isOn: appState.cameraZooming, enabled: live) {
                appState.cameraZooming = true
                // This one is finished on the picture itself, so the panel
                // gets out of the way.
                isPresented = false
            }

            if let box = appState.cameraZoom {
                Text("Showing \(Int((box.width * box.height * 100).rounded()))% of the picture")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            item(appState.showEditor ? "Whole Screen" : "Back to Side by Side",
                 icon: appState.showEditor ? "rectangle.inset.filled" : "rectangle.lefthalf.inset.filled",
                 help: appState.showEditor
                     ? "Put the notes away and give the window to the video (⌃⌘E)"
                     : "The notes and the video side by side again (⌃⌘E)",
                 wide: true, enabled: appState.showCamera) {
                appState.toggleEditorPane()
                // The bar this panel hangs off goes with the notes pane.
                isPresented = false
            }
        }
        .padding(14)
        .frame(width: 244)
        // The popover hangs off a control inside a BarSplit, which tints
        // ITS contents with the accent colour while the video is on — and
        // SwiftUI carries that tint into the popover, so every label came
        // out faint blue on the dark panel (Sean, 2026-09-19: "the opacity
        // is weird here, make the text readable"). Pinned here.
        .foregroundStyle(.primary)
        .tint(.accentColor)
    }

    private func item(_ title: String, icon: String, help: String, wide: Bool = false,
                      isOn: Bool = false, enabled: Bool = true,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 12, weight: .medium))
                // Readable either way: what cannot be done goes grey, not
                // transparent. A 40% label on a translucent panel over a
                // camera picture is not text anybody can read.
                .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
                .frame(maxWidth: wide ? .infinity : nil, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(isOn ? Color.accentColor.opacity(0.22) : Color.primary.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 6))
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(help)
    }
}
