// A `.wm` note to the page Quick Look shows (docs/FEATURES.md "Quick Look"). The page itself is the core's
// (`renderQuickLook`, packages/core/src/export/quickLook.ts), run in JavaScriptCore from Resources/preview.js; this
// side unpacks what it needs from the archive (WmArchive) and hands the pictures it asks for back as attachments.
//
// The order is the archive reader's: the structure is vetted (WmArchive.init), then the NAMES are put to the core's own
// rule (`refusal`), then `mimetype` must say what it is, and only then is anything else inflated - the manifest, the
// text, the drawing, and the pictures the page shows. Every way this can fail is a plain page saying why.
//
// Spawns no process, opens nothing but the file Quick Look hands it, reaches no network.

import Foundation
import JavaScriptCore
import OSLog
import UniformTypeIdentifiers

struct PreviewPage {
    var html: String
    /// `cid:<key>` in the page.
    var attachments: [String: (data: Data, type: UTType)] = [:]
}

/// What a preview unpacks at most (the script then cuts the text to what it draws: `PREVIEW_LIMITS` in quickLook.ts).
enum PreviewLimits {
    /// `note.mdwm`: unpacked (and checked) whole up to this; a larger one is refused with a message.
    static let textBytes = 64 * 1024 * 1024
    /// Of which the script is handed the first part (it parses 200 000 characters at most).
    static let textHandedOver = 1024 * 1024
    static let manifestBytes = 1024 * 1024
    /// `drawing.json`: past this the page is drawn without the drawing, and says so.
    static let drawingBytes = 24 * 1024 * 1024
    /// One picture, and all of them together; past either a picture is its placeholder.
    static let pictureBytes = 32 * 1024 * 1024
    static let picturesBytes = 96 * 1024 * 1024
}

let previewLog = Logger(subsystem: "com.seancheren.writemind.quicklook", category: "preview")

/// The core's page renderer in a JavaScriptCore context.
final class PreviewScript {
    private let context: JSContext
    private let api: JSValue
    private var failure: String?

    init(bundle: Bundle) throws {
        guard let url = bundle.url(forResource: "preview", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw WmArchiveError("the preview's script is missing from the extension")
        }
        guard let context = JSContext() else { throw WmArchiveError("JavaScriptCore could not be started") }
        self.context = context
        context.name = "WriteMind Preview"
        var thrown: String?
        context.exceptionHandler = { _, value in thrown = value?.toString() ?? "an exception" }
        context.evaluateScript(source, withSourceURL: url)
        if let thrown {
            // (A macOS older than 13.3 has a JavaScriptCore without a regular expression's look-behind, which the parser uses.)
            throw WmArchiveError("this Mac could not run the preview's script (\(thrown)); WriteMind's preview needs macOS 13.3 or newer")
        }
        guard let api = context.objectForKeyedSubscript("WriteMindPreview"), api.isObject else {
            throw WmArchiveError("the preview's script did not start")
        }
        self.api = api
        context.exceptionHandler = { [weak self] _, value in self?.failure = value?.toString() ?? "an exception" }
    }

    /// `WriteMindPreview[name](argument)` as text, or nil for null / undefined.
    func call(_ name: String, _ argument: String) throws -> String? {
        failure = nil
        let result = api.invokeMethod(name, withArguments: [argument])
        if let failure { throw WmArchiveError("the preview's script failed (\(failure))") }
        guard let result, !result.isNull, !result.isUndefined else { return nil }
        return result.toString()
    }
}

enum PreviewRenderer {
    /// The page for the note at `url`. Never throws: a note that cannot be shown is a page that says why.
    static func page(for url: URL, bundle: Bundle) -> PreviewPage {
        let started = Date()
        var script: PreviewScript?
        do {
            script = try PreviewScript(bundle: bundle)
            let page = try render(url: url, script: script!)
            previewLog.info("previewed \(url.lastPathComponent, privacy: .private) in \(Int(Date().timeIntervalSince(started) * 1000)) ms, \(page.html.utf8.count) bytes, \(page.attachments.count) pictures")
            return page
        } catch {
            let message = "This note could not be shown: \((error as? WmArchiveError)?.description ?? error.localizedDescription)."
            previewLog.error("preview failed: \(message, privacy: .public)")
            if let script, let html = try? script.call("message", message) { return PreviewPage(html: html) }
            return PreviewPage(html: plainMessage(message))
        }
    }

    private static func json(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [])
        return String(decoding: data, as: UTF8.self)
    }

    private static func render(url: URL, script: PreviewScript) throws -> PreviewPage {
        let archive = try WmArchive(url: url)
        // 1. The names, by the core's own rule (SPEC-WM 1.5), before anything is unpacked.
        if let refusal = try script.call("refusal", json(archive.names)) {
            return PreviewPage(html: try script.call("message", refusal) ?? plainMessage(refusal))
        }
        // 2. The first word (1.1).
        guard let mime = try archive.bytes(named: "mimetype", limit: 64),
              mime == Data("application/vnd.writemind.note+zip".utf8) else {
            throw WmArchiveError("this is not a WriteMind note (its mimetype is another type)")
        }
        // 3. The manifest (1.7), the text (a long one handed over in part) and the drawing (left out when it is huge).
        guard let manifestData = try archive.bytes(named: "manifest.json", limit: PreviewLimits.manifestBytes),
              let manifest = String(data: manifestData, encoding: .utf8) else {
            throw WmArchiveError("manifest.json is not UTF-8")
        }
        let textData = try archive.bytes(named: "note.mdwm", limit: PreviewLimits.textBytes) ?? Data()
        var text = String(decoding: textData.prefix(PreviewLimits.textHandedOver), as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        var input: [String: Any] = [
            "text": text, "textBytes": textData.count, "manifest": manifest, "names": archive.names,
        ]
        if let drawing = archive.entry("drawing.json") {
            if drawing.size > PreviewLimits.drawingBytes {
                input["drawingSkipped"] = true
            } else {
                input["drawing"] = String(decoding: try archive.bytes(drawing, limit: PreviewLimits.drawingBytes), as: UTF8.self)
            }
        }
        // 4. The page.
        guard let out = try script.call("render", json(input)), let rendered = try JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any],
              let html = rendered["html"] as? String else {
            throw WmArchiveError("the preview's script gave no page")
        }
        var page = PreviewPage(html: html)
        // 5. The pictures it shows, unpacked one by one; one that cannot be is left out (its picture does not draw).
        var budget = PreviewLimits.picturesBytes
        for case let one as [String: Any] in rendered["attachments"] as? [Any] ?? [] {
            guard let cid = one["cid"] as? String, let name = one["entry"] as? String, let entry = archive.entry(name) else { continue }
            guard entry.size <= min(budget, PreviewLimits.pictureBytes) else { continue }
            do {
                let data = try archive.bytes(entry, limit: PreviewLimits.pictureBytes)
                budget -= data.count
                page.attachments[cid] = (data, contentType(of: name))
            } catch {
                previewLog.error("picture \(name, privacy: .private) left out: \(String(describing: error), privacy: .public)")
            }
        }
        return page
    }

    /// The first sixteen bytes of every Windows Media (ASF) file: its header object's GUID.
    static let asfHeader: [UInt8] = [0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C]

    /// Whether the file is Windows Media rather than a note (both are `.wm`; a note is a ZIP, SPEC-WM 1.1).
    static func isWindowsMedia(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        guard let head = try? handle.read(upToCount: asfHeader.count) else { return false }
        return [UInt8](head) == asfHeader
    }

    /// The type of a picture entry, by its extension (what the writer stored it as, SPEC-WM 1.4).
    static func contentType(of name: String) -> UTType {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "png": return .png
        case "jpg", "jpeg": return .jpeg
        case "gif": return .gif
        case "webp": return .webP
        case "heic", "heif": return .heic
        case "svg": return .svg
        case "pdf": return .pdf
        case "tif", "tiff": return .tiff
        case "bmp": return .bmp
        default: return UTType(filenameExtension: ext) ?? .data
        }
    }

    /// The message page when even the script could not start: the same words, set plainly.
    static func plainMessage(_ message: String) -> String {
        let escaped = message.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            + "<meta name=\"color-scheme\" content=\"light dark\"><style>body{margin:0;padding:32px;font:15px/1.45 -apple-system,sans-serif}"
            + "@media (prefers-color-scheme: dark){body{background:#1E1F22;color:#E8E8EA}}</style></head>"
            + "<body><b>WriteMind note</b><br>\(escaped)</body></html>"
    }
}
