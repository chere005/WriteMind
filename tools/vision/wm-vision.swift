// WriteMind's macOS helper: the two things Vision does that nothing on
// Windows can, kept in a binary of their own so the app stays one codebase.
//
// The app asks for it by capability (`Capabilities.handwritingOCR`), and
// the capability is simply whether this binary is there — which is how the
// Mac keeps its extra features while the Windows build shows nothing at
// all rather than a button that cannot work.
//
//   wm-vision text <file>   the words in a picture, in reading order
//   wm-vision page <file>   the page's four corners in the frame, or null
//
// Out goes JSON on stdout. Anything wrong is JSON too, with an "error".

import AppKit
import Foundation
import Vision

func fail(_ message: String) -> Never {
    print("{\"error\":\(quoted(message))}")
    exit(1)
}

func quoted(_ text: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: [text])
    guard let data, let whole = String(data: data, encoding: .utf8) else { return "\"\"" }
    return String(whole.dropFirst().dropLast())
}

guard CommandLine.arguments.count >= 3 else { fail("usage: wm-vision text|page <file>") }
let what = CommandLine.arguments[1]
let file = CommandLine.arguments[2]

guard let image = NSImage(contentsOfFile: file),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { fail("could not read \(file)") }

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

switch what {
case "text":
    // The same settings the Mac app uses: accurate, English first, and
    // language correction on — a page of handwriting is prose, not codes.
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    do { try handler.perform([request]) } catch { fail("\(error)") }
    let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let best = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return [
            "text": best.string,
            "confidence": Double(best.confidence),
            // Vision's box is fractions of the image, y UP from the
            // bottom left; the app wants y down from the top left.
            "x": Double(box.minX),
            "y": Double(1 - box.maxY),
            "width": Double(box.width),
            "height": Double(box.height),
        ]
    }
    let out = try? JSONSerialization.data(withJSONObject: ["lines": lines])
    print(String(data: out ?? Data(), encoding: .utf8) ?? "{\"lines\":[]}")

case "page":
    // Document segmentation first, rectangles as the fallback — the same
    // order the Mac app asks in.
    var quad: [String: Any]?
    if #available(macOS 13.0, *) {
        let request = VNDetectDocumentSegmentationRequest()
        if (try? handler.perform([request])) != nil,
           let found = request.results?.first {
            quad = [
                "topLeft": ["x": Double(found.topLeft.x), "y": Double(found.topLeft.y)],
                "topRight": ["x": Double(found.topRight.x), "y": Double(found.topRight.y)],
                "bottomLeft": ["x": Double(found.bottomLeft.x), "y": Double(found.bottomLeft.y)],
                "bottomRight": ["x": Double(found.bottomRight.x), "y": Double(found.bottomRight.y)],
                "confidence": Double(found.confidence),
            ]
        }
    }
    if quad == nil {
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = 0.3
        request.maximumObservations = 1
        request.minimumConfidence = 0.6
        if (try? handler.perform([request])) != nil, let found = request.results?.first {
            quad = [
                "topLeft": ["x": Double(found.topLeft.x), "y": Double(found.topLeft.y)],
                "topRight": ["x": Double(found.topRight.x), "y": Double(found.topRight.y)],
                "bottomLeft": ["x": Double(found.bottomLeft.x), "y": Double(found.bottomLeft.y)],
                "bottomRight": ["x": Double(found.bottomRight.x), "y": Double(found.bottomRight.y)],
                "confidence": Double(found.confidence),
            ]
        }
    }
    let out = try? JSONSerialization.data(withJSONObject: ["quad": quad as Any])
    print(String(data: out ?? Data(), encoding: .utf8) ?? "{\"quad\":null}")

default:
    fail("unknown command \(what)")
}
