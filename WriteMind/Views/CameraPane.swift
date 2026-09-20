import SwiftUI

/// The right pane: whatever camera the Input Devices menu picked.
struct CameraPane: View {
    @EnvironmentObject private var camera: CameraController
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var store: NoteStore

    /// A box drawn on the picture: the capture button then brings in just
    /// that part of the page. Nothing arms it and nothing confirms it — a
    /// drag on the picture IS the box, a click clears it, a double-click
    /// takes the whole picture (Sean, 2026-09-19: "instead select a box for
    /// selecting by clicking and dragging .. click to get rid of a
    /// selection.. double click to select the whole image").
    @State private var section: CGRect?
    /// Armed to drag the box the pane zooms into (Sean, 2026-09-19: "drag a
    /// square to resize camera").

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black
            switch camera.status {
            case .running:
                GeometryReader { geo in
                    ZStack(alignment: .topLeading) {
                        // Turned inside the pane, not with it: at a quarter
                        // turn the preview is given the pane's height as its
                        // width, so the picture still fits after it comes round.
                        CameraPreview(session: camera.session)
                            .frame(width: appState.cameraIsTurned ? geo.size.height : geo.size.width,
                                   height: appState.cameraIsTurned ? geo.size.width : geo.size.height)
                            .rotationEffect(.degrees(Double(appState.cameraRotation)))
                            .position(x: geo.size.width / 2, y: geo.size.height / 2)
                            // Zoomed by moving the whole picture, not by
                            // touching the camera: the box the pane is
                            // showing is blown up to fill it.
                            .scaleEffect(zoomScale(in: geo.size))
                            .offset(zoomOffset(in: geo.size))
                            .clipped()
                        SectionBox(section: $section, size: geo.size,
                                   onWholePicture: { section = wholePictureBox(pane: geo.size) })
                            .disabled(store.selectedNote == nil)
                        if appState.cameraZooming {
                            BoxDragger(hint: "Drag a box — the pane shows that much") { box in
                                appState.cameraZoom = CameraZoom.compose(box, over: appState.cameraZoom,
                                                                         in: geo.size)
                                appState.cameraZooming = false
                                publishRegion(pane: geo.size)
                            }
                        }
                    }
                    .onChange(of: geo.size) { _, size in publishRegion(pane: size) }
                    .onChange(of: appState.cameraZoom) { _, _ in publishRegion(pane: geo.size) }
                    .onChange(of: appState.cameraRotation) { _, _ in publishRegion(pane: geo.size) }
                    .onAppear { publishRegion(pane: geo.size) }
                }
            case .starting:
                ProgressView().controlSize(.large).tint(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .idle:
                placeholder(icon: "video", title: "No camera selected",
                            detail: "Pick one from the Input Devices menu.") {
                    devicePicker
                }
            case .denied:
                placeholder(icon: "video.slash", title: "Camera access is off",
                            detail: "Allow WriteMind in System Settings › Privacy & Security › Camera.") {
                    Button("Open Privacy Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            case .failed(let message):
                placeholder(icon: "exclamationmark.triangle", title: "Camera unavailable", detail: message) {
                    devicePicker
                }
            }

            if camera.status == .running, let name = camera.selectedDeviceName {
                VStack {
                    Spacer()
                    HStack {
                        Label(name, systemImage: "video.fill")
                            .font(.caption)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(.ultraThinMaterial, in: Capsule())
                        Spacer()
                    }
                    .padding(12)
                }
            }

            // Turning the picture, its size and the box to zoom into are
            // all on the editor's bar now, under the button that shows and
            // hides the video. The ONE thing left here is the way back from
            // whole screen — and only then, because with the notes pane
            // away there is no bar to put it on.
            HStack(spacing: 6) {
                if !appState.showEditor {
                    corner(icon: "rectangle.lefthalf.inset.filled", label: "Back to Side by Side",
                           help: "The notes and the video side by side again (⌃⌘E)") {
                        appState.toggleEditorPane()
                    }
                }
            }
            .padding(10)
        }
        .clipped()
        .onChange(of: camera.status) { _, status in
            if status != .running { section = nil; appState.cameraZooming = false }
        }
        .onChange(of: appState.cameraRotation) { _, _ in section = nil }
    }

    // MARK: - The zoom

    private func zoomScale(in pane: CGSize) -> CGFloat {
        guard let box = appState.cameraZoom else { return 1 }
        return CameraZoom.scale(of: box, in: pane)
    }

    private func zoomOffset(in pane: CGSize) -> CGSize {
        guard let box = appState.cameraZoom else { return .zero }
        return CameraZoom.offset(of: box, in: pane)
    }

    /// The box a double-click draws: the picture as it is actually on
    /// screen. Not the whole pane — the video is letterboxed inside it, and
    /// a box over the bars would be a lie (the capture clips it anyway).
    /// Zoomed in, it is the part of the picture that can be seen, which is
    /// what is being captured.
    private func wholePictureBox(pane: CGSize) -> CGRect? {
        guard let frame = camera.currentFrame() else { return nil }
        let raw = frame.extent.size
        let upright = appState.cameraIsTurned ? CGSize(width: raw.height, height: raw.width) : raw
        let shown = NotebookCapture.displayedFrame(of: upright, in: pane)
        guard shown.width > 2, shown.height > 2 else { return nil }
        let drawn = appState.cameraZoom.map { CameraZoom.zoomed(shown, box: $0, in: pane) } ?? shown
        let visible = drawn.intersection(CGRect(origin: .zero, size: pane))
        guard !visible.isNull, visible.width >= 2, visible.height >= 2 else { return nil }
        return visible
    }

    /// What the capture button will bring in, in the frame's own
    /// fractions: the box drawn on the picture if there is one, otherwise
    /// whatever the pane is zoomed into, otherwise nothing at all — which
    /// means the whole frame.
    private func publishRegion(pane: CGSize) {
        guard let frame = camera.currentFrame() else { appState.cameraRegion = nil; return }
        let raw = frame.extent.size
        let upright = appState.cameraIsTurned ? CGSize(width: raw.height, height: raw.width) : raw

        let wanted: CGRect?
        if let section {
            // A box drawn on a zoomed picture is somewhere else on the real one.
            wanted = appState.cameraZoom.map { CameraZoom.unzoomed(section, box: $0, in: pane) } ?? section
        } else if let zoom = appState.cameraZoom {
            wanted = CameraZoom.unzoomed(CGRect(origin: .zero, size: pane), box: zoom, in: pane)
        } else {
            wanted = nil
        }
        guard let wanted else { appState.cameraRegion = nil; return }
        appState.cameraRegion = NotebookCapture.region(from: wanted, frame: upright, in: pane)
    }

    private func corner(icon: String, label: String, help: String, isOn: Bool = false,
                        action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isOn ? Color.accentColor : Color.primary)
                .padding(6)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(label)
    }

    private var devicePicker: some View {
        Menu {
            if camera.devices.isEmpty {
                Text("No cameras found")
            }
            ForEach(camera.devices) { device in
                Button(device.name) { camera.select(deviceID: device.id) }
            }
            Divider()
            Button("Refresh Device List") { camera.refreshDevices() }
        } label: {
            Label("Input Devices", systemImage: "video.badge.ellipsis")
        }
        .fixedSize()
    }

    private func placeholder<Extra: View>(icon: String, title: String, detail: String,
                                          @ViewBuilder extra: () -> Extra) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(.white.opacity(0.5))
            Text(title).font(.title3).foregroundStyle(.white)
            Text(detail)
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            extra().padding(.top, 6)
        }
        .padding()
        // The pane's stack is aligned top-trailing for its corner buttons;
        // the placeholder takes the whole pane so it sits in the middle
        // (Sean, 2026-09-18).
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A box dragged over the camera picture, and the two ways to bring what is
/// inside it onto the page: the writing alone, or the picture.
/// Drag a box on the picture, and that is it — no chooser afterwards. What
/// the box is FOR is the caller's business; the zoom uses it.
private struct BoxDragger: View {
    let hint: String
    let onBox: (CGRect) -> Void
    @State private var box: CGRect?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    guard let box else { return }
                    var outside = Path(CGRect(origin: .zero, size: geo.size))
                    outside.addRect(box)
                    context.fill(outside, with: .color(.black.opacity(0.45)), style: FillStyle(eoFill: true))
                    context.stroke(Path(box), with: .color(.white),
                                   style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2, coordinateSpace: .local)
                        .onChanged { value in
                            box = CanvasGeometry.rect(from: value.startLocation, to: value.location)
                        }
                        .onEnded { value in
                            let drawn = CanvasGeometry.rect(from: value.startLocation, to: value.location)
                            box = nil
                            guard drawn.width > 8, drawn.height > 8 else { return }
                            onBox(drawn)
                        }
                )

                if box == nil {
                    Text(hint)
                        .font(.callout)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.55), in: Capsule())
                        .position(x: geo.size.width / 2, y: 30)
                        .allowsHitTesting(false)
                }
            }
        }
    }
}

private struct SectionBox: View {
    @Binding var section: CGRect?
    let size: CGSize
    /// Put the box round the whole picture, without dragging one.
    let onWholePicture: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Canvas { context, _ in
                guard let section else { return }
                var outside = Path(CGRect(origin: .zero, size: size))
                outside.addRect(section)
                context.fill(outside, with: .color(.black.opacity(0.45)), style: FillStyle(eoFill: true))
                context.stroke(Path(section), with: .color(.white),
                               style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
            }
            .contentShape(Rectangle())
            // Four points of slack, so a click stays a click and only a
            // real drag draws a box.
            .gesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .local)
                    .onChanged { value in
                        section = CanvasGeometry.rect(from: value.startLocation, to: value.location)
                    }
            )
            // The two-tap gesture is declared FIRST, or a double-click is
            // read as two clears.
            .onTapGesture(count: 2) { onWholePicture() }
            .onTapGesture { section = nil }

            if let section {
                Text("The capture button brings in this box")
                    .font(.caption)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.black.opacity(0.55), in: Capsule())
                    .position(x: min(max(section.midX, 130), max(size.width - 130, 130)),
                              y: min(section.maxY + 20, max(size.height - 16, 16)))
                    .allowsHitTesting(false)
            }
        }
    }
}
