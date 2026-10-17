// WriteMind's Quick Look preview extension (Sean, 2026-10-17: "add a preview of rendered mode to macos spotlight").
// Spotlight's preview, Finder's space bar and its column view all ask this for a `.wm` file (Info.plist
// QLSupportedContentTypes: the note's own type, and Windows Media's, which is what macOS itself calls every `.wm`) and get
// the note's RENDERED page: a data-based reply, HTML with the note's pictures as `cid:` attachments, which Quick Look
// draws in its own WebKit view (and lays out in the system's appearance: the page carries both).
// PreviewRenderer.swift says how the page is made; docs/FEATURES.md "Quick Look" what it shows.
//
// Sandboxed (WriteMindPreview.entitlements): it reads only the file Quick Look hands it.

import Foundation
import QuickLookUI
import UniformTypeIdentifiers

@objc(WMPreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        // A real Windows Media file (Info.plist: macOS calls every .wm that) is not ours to draw: the error hands it
        // back, and Quick Look shows it as it shows any file it has no preview for.
        if PreviewRenderer.isWindowsMedia(request.fileURL) { throw CocoaError(.fileReadCorruptFile) }
        let page = PreviewRenderer.page(for: request.fileURL, bundle: Bundle.main)
        // 900 points: the page's own width (PREVIEW_PANE in quickLook.ts), so a note opens at its size.
        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 900, height: 1000)) { reply in
            reply.stringEncoding = .utf8
            reply.attachments = page.attachments.mapValues { QLPreviewReplyAttachment(data: $0.data, contentType: $0.type) }
            return Data(page.html.utf8)
        }
    }
}
