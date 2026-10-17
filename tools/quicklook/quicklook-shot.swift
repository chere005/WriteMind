// A photograph of what Quick Look draws for a file, for tools/check-quicklook.sh (docs/TESTING.md, "Quick Look").
//
//   quicklook-shot <file> <out.png> [width] [height] [light|dark] [timeout-seconds]
//
// Shows the file in a QLPreviewView - the view Finder's own preview panel is - in a window of this process, waits for
// Quick Look's web view to have the page and its pictures, and snapshots THAT view (WKWebView.takeSnapshot: an API, so
// no Screen Recording permission, which a screenshot of `qlmanage -p`'s window would need). `light` / `dark` sets this
// process's appearance, which is what the page's prefers-color-scheme answers.
//
// The line it prints for a page also says how long Quick Look took to have it (`in N ms`, from the preview being asked
// for) and, if the page carries the mark a script in a crafted note would leave (`data-wm-injected`, the hostile sample's
// payloads: apps/desktop/scripts/quicklook-sample-notes.ts), `INJECTED: <which>` - script ran in the preview.
//
// Exit 0: the PNG is written. Exit 2: Quick Look drew no HTML page for the file within the timeout (a file handed back
// to Quick Look, or an extension that is not registered). Exit 1: anything else.
import AppKit
import QuickLookUI
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else { FileHandle.standardError.write(Data("usage: quicklook-shot <file> <out.png> [width] [height] [light|dark] [timeout]\n".utf8)); exit(1) }
let file = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let width = args.count > 3 ? Double(args[3]) ?? 900 : 900
let height = args.count > 4 ? Double(args[4]) ?? 1000 : 1000
let asked = Date()
let deadline = asked.addingTimeInterval(args.count > 6 ? Double(args[6]) ?? 60 : 60)
/// When the web view first had its whole page (the document and every picture), in ms from `asked`.
var tookMs: Int?

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
if args.count > 5 { app.appearance = NSAppearance(named: args[5] == "dark" ? .darkAqua : .aqua) }
let window = NSWindow(contentRect: NSRect(x: 40, y: 40, width: width, height: height), styleMask: [.titled], backing: .buffered, defer: false)
let view = QLPreviewView(frame: NSRect(x: 0, y: 0, width: width, height: height), style: .normal)!
window.contentView = view
view.previewItem = file as NSURL
window.orderFrontRegardless()

func tree(_ v: NSView) -> [NSView] { [v] + v.subviews.flatMap { tree($0) } }

func snap(_ web: WKWebView) {
    web.takeSnapshot(with: WKSnapshotConfiguration()) { image, error in
        guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            print("snapshot failed: \(String(describing: error))"); exit(1)
        }
        do { try png.write(to: out) } catch { print("could not write \(out.path): \(error)"); exit(1) }
        // What the page says at its foot (a long note's cut), which is below the photograph's edge, and whether a
        // script in the note ran (it would have marked the page).
        let ask = "[(document.querySelector('.foot') || {}).textContent || '', document.documentElement.getAttribute('data-wm-injected') || '']"
        web.evaluateJavaScript(ask) { answer, _ in
            let parts = answer as? [String] ?? ["", ""]
            let said = parts[0].isEmpty ? "" : "; foot: \(parts[0])"
            let injected = parts.count > 1 && !parts[1].isEmpty ? "; INJECTED: \(parts[1])" : ""
            let took = tookMs.map { " in \($0) ms" } ?? " (not finished loading)"
            print("wrote \(out.lastPathComponent) \(rep.pixelsWide)x\(rep.pixelsHigh)\(took)\(said)\(injected)")
            exit(0)
        }
    }
}

func poll() {
    if let web = tree(view).compactMap({ $0 as? WKWebView }).first {
        // Ready: the document has loaded and every picture in it has either drawn or failed.
        web.evaluateJavaScript("document.readyState === 'complete' && [...document.images].every((i) => i.complete)") { ready, _ in
            if (ready as? Bool) == true {
                tookMs = Int(Date().timeIntervalSince(asked) * 1000)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { snap(web) }
            }
            else if Date() > deadline { snap(web) }
            else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: poll) }
        }
        return
    }
    if Date() > deadline { print("no page: Quick Look drew no HTML preview of \(file.lastPathComponent)"); exit(2) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: poll)
}
DispatchQueue.main.async(execute: poll)
app.run()
