import AVFoundation
import SwiftUI

/// Hosts an `AVCaptureVideoPreviewLayer` for the capture session.
struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession

    func makeNSView(context: Context) -> PreviewView {
        PreviewView(session: session)
    }

    func updateNSView(_ view: PreviewView, context: Context) {
        if view.previewLayer.session !== session {
            view.previewLayer.session = session
        }
    }

    final class PreviewView: NSView {
        let previewLayer = AVCaptureVideoPreviewLayer()

        init(session: AVCaptureSession) {
            super.init(frame: .zero)
            wantsLayer = true
            previewLayer.session = session
            previewLayer.videoGravity = .resizeAspect
            previewLayer.backgroundColor = NSColor.black.cgColor
            layer = previewLayer
            layerContentsRedrawPolicy = .duringViewResize
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func layout() {
            super.layout()
            previewLayer.frame = bounds
        }
    }
}
