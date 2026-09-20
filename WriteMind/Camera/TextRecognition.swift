import AppKit
import CoreImage
import Vision

/// The words in a picture — a photographed page, a captured chunk of
/// writing, a pasted screenshot — read by Vision and handed back as lines in
/// reading order (Sean, 2026-09-18: "transform an image … into its text and
/// insert that text below the image").
enum TextRecognition {
    /// Lines of text, top to bottom. Empty when nothing could be read.
    /// What comes back is markdown: a word with a line through it arrives
    /// struck out, a word with a ring round it in bold, an arrow as an
    /// arrow, and a line of algebra as this app's maths (Sean, 2026-09-19).
    static func lines(in image: CGImage) -> [String] {
        // A captured chunk of writing is ink on nothing at all; Vision reads
        // dark on light, so everything goes on white first — and a printed
        // dot grid is painted out before it can be read as punctuation.
        let flattened = onWhite(image) ?? image
        let page = Page.of(flattened)
        let prepared = page?.cleaned ?? flattened
        return compose(readBest(prepared), page: page)
    }

    /// The reading Vision makes most sense of. Japanese first when this Mac
    /// has it: an English-first request reads a Japanese page as NOTHING at
    /// all, and reads a mixed line as nonsense ("Meeting notes 会議" came
    /// back "Meeting notes SIt"). Measured 2026-09-19, Vision revision 3
    /// (Sean: "is it easy to have japanese ocr from handwriting as well?").
    /// Nothing Japanese back means an English page, and English-first reads
    /// English handwriting better ("Buy milk" against "Buy wilk").
    static func readBest(_ image: CGImage) -> [VNRecognizedTextObservation] {
        if japaneseAvailable {
            let japanese = observations(in: image, languages: [japaneseTag, englishTag])
            let readable = japanese.compactMap { $0.topCandidates(1).first?.string }
            if readable.contains(where: { $0.contains(where: isJapanese) }) { return japanese }
        }
        return observations(in: image, languages: nil)
    }

    /// One pass of Vision, in reading order. Vision's y goes up: the top
    /// line has the largest midY. Lines at the same height read left to
    /// right.
    static func observations(in image: CGImage, languages: [String]?) -> [VNRecognizedTextObservation] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if let languages { request.recognitionLanguages = languages }
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        guard (try? handler.perform([request])) != nil, let results = request.results else { return [] }
        return results.sorted {
            abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.02
                ? $0.boundingBox.midY > $1.boundingBox.midY
                : $0.boundingBox.minX < $1.boundingBox.minX
        }
    }

    /// The old shape of this, kept for the tests and for anything that only
    /// wants the words.
    static func read(_ image: CGImage, languages: [String]?) -> [String] {
        observations(in: image, languages: languages).compactMap { observation in
            guard let best = observation.topCandidates(1).first else { return nil }
            let text = best.string.trimmingCharacters(in: .whitespaces)
            return looksLikeText(text, confidence: best.confidence) ? text : nil
        }
    }

    // MARK: - The page's ink

    /// The picture's ink, sorted into blobs, and the copy of it that goes to
    /// Vision with any printed dot grid painted out.
    struct Page {
        var ink: [Bool]
        var width: Int
        var height: Int
        var marks: NotebookCapture.Marks
        var cleaned: CGImage

        var shortSide: Int { min(width, height) }

        static func of(_ image: CGImage) -> Page? {
            guard image.width > 8, image.height > 8 else { return nil }
            let source = CIImage(cgImage: image)
            guard let (gray, width, height) = NotebookCapture.grayscale(source, maxWidth: gridSearchWidth)
            else { return nil }
            let ink = NotebookCapture.darkerThanPaper(gray: gray, width: width, height: height)
            let marks = NotebookCapture.marks(in: ink, width: width, height: height)
            let cleaned = paintOutDots(image, gray: gray, marks: marks, width: width, height: height) ?? image
            return Page(ink: ink, width: width, height: height, marks: marks, cleaned: cleaned)
        }

        /// A box Vision gives back (0–1, y up) in this mask's pixels.
        func rect(_ box: CGRect) -> CGRect {
            CGRect(x: box.minX * CGFloat(width), y: (1 - box.maxY) * CGFloat(height),
                   width: box.width * CGFloat(width), height: box.height * CGFloat(height))
        }
    }

    // MARK: - Putting the reading together

    static func compose(_ observations: [VNRecognizedTextObservation], page: Page?) -> [String] {
        var lines: [(y: CGFloat, text: String)] = []
        var lineBoxes: [CGRect] = []

        for observation in observations {
            guard let best = observation.topCandidates(1).first else { continue }
            let text = best.string.trimmingCharacters(in: .whitespaces)
            guard looksLikeText(text, confidence: best.confidence) else { continue }
            guard let page else {
                lines.append((observation.boundingBox.midY, HandwritingMarks.normaliseArrows(text)))
                continue
            }
            let box = page.rect(observation.boundingBox)
            // A ring read as a letter is not a letter.
            if HandwritingMarks.isRingRead(text), rings(in: page).contains(where: {
                HandwritingMarks.encircles($0.insetBy(dx: -2, dy: -2), word: box)
            }) { continue }
            lineBoxes.append(box)
            lines.append((observation.boundingBox.midY, marked(best, box: box, in: page)))
        }

        // The arrows nobody read: they belong between the words they sit
        // between, or on a line of their own.
        if let page {
            for (y, arrow) in arrows(in: page, avoiding: lineBoxes) {
                lines.append((y, arrow))
            }
        }

        return lines
            .sorted { $0.y > $1.y }
            .map(\.text)
            .filter { !$0.isEmpty }
    }

    /// One line of writing, with what is drawn over it taken into account.
    static func marked(_ candidate: VNRecognizedText, box: CGRect, in page: Page) -> String {
        let text = HandwritingMarks.normaliseArrows(candidate.string.trimmingCharacters(in: .whitespaces))
        let ringed = rings(in: page)

        var pieces: [String] = []
        for word in words(of: candidate, in: page) {
            var piece = HandwritingMarks.normaliseArrows(word.text)
            if HandwritingMarks.struckThrough(word: word.box, ink: page.ink,
                                              width: page.width, height: page.height) {
                piece = "~~" + piece + "~~"
            } else if ringed.contains(where: { HandwritingMarks.encircles($0, word: word.box) }) {
                piece = "**" + piece + "**"
            }
            pieces.append(piece)
        }
        let marked = pieces.isEmpty ? text : pieces.joined(separator: " ")

        // Algebra is written as this app's maths, with the little raised
        // digits put back as powers.
        if HandwritingMarks.looksLikeMaths(marked), !marked.contains("~~"), !marked.contains("**") {
            let raised = HandwritingMarks.superscripted(characters(of: candidate, in: page))
            let expression = HandwritingMarks.wolfram(raised.isEmpty ? marked : raised)
            if !expression.isEmpty { return MathMarkup.inline(expression) }
        }
        // A word struck out and nothing else is still a line of the note.
        _ = box
        return marked
    }

    /// The words of one reading, each with its box in mask pixels.
    static func words(of candidate: VNRecognizedText, in page: Page) -> [HandwritingMarks.Word] {
        let string = candidate.string
        var out: [HandwritingMarks.Word] = []
        var index = string.startIndex
        while index < string.endIndex {
            guard !string[index].isWhitespace else { index = string.index(after: index); continue }
            var end = index
            while end < string.endIndex, !string[end].isWhitespace { end = string.index(after: end) }
            let word = String(string[index..<end])
            if let piece = try? candidate.boundingBox(for: index..<end) {
                out.append(HandwritingMarks.Word(text: word, box: page.rect(piece.boundingBox)))
            } else {
                out.append(HandwritingMarks.Word(text: word, box: .null))
            }
            index = end
        }
        return out
    }

    /// Every character of a reading with its own box — what tells a power
    /// from a digit on the line.
    static func characters(of candidate: VNRecognizedText,
                           in page: Page) -> [(character: Character, box: CGRect)] {
        let string = candidate.string
        var out: [(Character, CGRect)] = []
        var index = string.startIndex
        while index < string.endIndex {
            let next = string.index(after: index)
            let box = (try? candidate.boundingBox(for: index..<next))?.boundingBox
            out.append((string[index], box.map { page.rect($0) } ?? .null))
            index = next
        }
        return out
    }

    /// The hollow rings drawn round words.
    static func rings(in page: Page) -> [CGRect] {
        page.marks.writing.compactMap { index in
            let blob = page.marks.components[index]
            let box = CGRect(x: blob.minX, y: blob.minY, width: blob.width, height: blob.height)
            return HandwritingMarks.isRing(box: box, fill: blob.fill, shortSide: page.shortSide) ? box : nil
        }
    }

    /// The arrows that are not inside anything Vision read, with the height
    /// they sit at (in Vision's coordinates, so they sort with the lines).
    static func arrows(in page: Page, avoiding lines: [CGRect]) -> [(CGFloat, String)] {
        page.marks.writing.compactMap { index in
            let blob = page.marks.components[index]
            let box = CGRect(x: blob.minX, y: blob.minY, width: blob.width, height: blob.height)
            guard !lines.contains(where: { $0.intersection(box).height > box.height * 0.5
                                            && $0.intersection(box).width > box.width * 0.5 })
            else { return nil }
            guard let arrow = HandwritingMarks.arrow(box: box, ink: page.ink,
                                                     width: page.width, height: page.height)
            else { return nil }
            let y = 1 - (box.midY / CGFloat(page.height))
            return (y, arrow)
        }
    }

    static let japaneseTag = "ja-JP"
    static let englishTag = "en-US"

    /// Whether this Mac's Vision can read Japanese at all — asked once.
    static let japaneseAvailable: Bool = {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        return supported.contains(japaneseTag)
    }()

    /// Vision finds "text" in a doodle, a dot grid, a diagram: a few stray
    /// characters read with little confidence. Only what is read with some
    /// confidence, has a word in it, and is mostly letters and digits counts
    /// (Sean, 2026-09-18: "ignore non-text when converting images to text").
    /// Japanese counts too: one kana is a word, so 「え」 is kept — but the
    /// strokes a doodle reads as (ー 一 ノ 丶 、 。) are not.
    static func looksLikeText(_ string: String, confidence: Float) -> Bool {
        guard confidence >= 0.3 else { return false }
        let alphanumerics = CharacterSet.alphanumerics
        let visible = string.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) }
        guard !visible.isEmpty else { return false }
        let letters = visible.filter { alphanumerics.contains($0) }.count
        guard Double(letters) / Double(visible.count) >= 0.5 else { return false }
        let hasWord = string.split(whereSeparator: { $0.isWhitespace }).contains { token in
            token.unicodeScalars.filter { alphanumerics.contains($0) }.count >= 2
                || token.unicodeScalars.contains { isJapanese($0) && !isStrokeLike($0) }
        }
        return hasWord
    }

    /// Kana, kanji and the full-width forms — what tells a Japanese reading
    /// from an English one.
    static func isJapanese(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x3040...0x309F,   // hiragana
             0x30A0...0x30FF,   // katakana
             0x31F0...0x31FF,   // katakana phonetic extensions
             0x3400...0x4DBF,   // kanji, extension A
             0x4E00...0x9FFF,   // kanji
             0xFF66...0xFF9D:   // half-width katakana
            return true
        default: return false
        }
    }

    static func isJapanese(_ character: Character) -> Bool {
        character.unicodeScalars.contains(where: isJapanese)
    }

    /// A single stroke that a doodle or a dot grid reads as, rather than a word.
    static func isStrokeLike(_ scalar: Unicode.Scalar) -> Bool {
        "ー一ノ丶丿亅乀乁〇々〜・。、".unicodeScalars.contains(scalar)
    }

    // MARK: - The paper

    static func onWhite(_ image: CGImage) -> CGImage? {
        guard let context = CGContext(data: nil, width: image.width, height: image.height,
                                      bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(bounds)
        context.draw(image, in: bounds)
        return context.makeImage()
    }

    /// How wide a picture is looked at when hunting for the dot grid. The
    /// search is quadratic in the number of dots, and a grid is just as
    /// visible at this size as at 4000 pixels across.
    static let gridSearchWidth: CGFloat = 1400

    /// The same picture with a printed dot grid painted out in the paper's
    /// own colour (Sean, 2026-09-19: "if the paper has a dot background,
    /// make sure to ignore the dots"). Nil when there is no grid to remove —
    /// the picture then goes to Vision untouched, so nothing is lost on the
    /// pages that never had dots. Without this a row of dots reads as
    /// "・・・" or "....." and joins itself onto the line above.
    static func withoutDotGrid(_ image: CGImage) -> CGImage? {
        guard image.width > 8, image.height > 8 else { return nil }
        let source = CIImage(cgImage: image)
        guard let (gray, width, height) = NotebookCapture.grayscale(source, maxWidth: gridSearchWidth) else {
            return nil
        }
        let ink = NotebookCapture.darkerThanPaper(gray: gray, width: width, height: height)
        let marks = NotebookCapture.marks(in: ink, width: width, height: height)
        return paintOutDots(image, gray: gray, marks: marks, width: width, height: height)
    }

    /// The dots of a found grid, filled in with the paper's own colour.
    static func paintOutDots(_ image: CGImage, gray: [UInt8], marks: NotebookCapture.Marks,
                             width: Int, height: Int) -> CGImage? {
        guard let lattice = marks.lattice, !lattice.isEmpty else { return nil }

        let paper = NotebookCapture.localMean(gray, width: width, height: height,
                                              radius: max(8, min(width, height) / 40))
        guard let context = CGContext(data: nil, width: image.width, height: image.height,
                                      bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))

        // The mask is the picture scaled down and turned over (its first row
        // is the picture's top, Core Graphics counts up from the bottom).
        let scaleX = CGFloat(image.width) / CGFloat(width)
        let scaleY = CGFloat(image.height) / CGFloat(height)
        for index in lattice {
            let dot = marks.components[index]
            let level = CGFloat(paper[min(paper.count - 1,
                                          (dot.minY + dot.maxY) / 2 * width + (dot.minX + dot.maxX) / 2)]) / 255
            context.setFillColor(CGColor(red: level, green: level, blue: level, alpha: 1))
            // A pixel of slack round the dot: its edge is grey, and grey
            // left behind is what Vision reads as a full stop.
            let box = CGRect(x: CGFloat(dot.minX - 1) * scaleX,
                             y: CGFloat(height - dot.maxY - 2) * scaleY,
                             width: CGFloat(dot.width + 2) * scaleX,
                             height: CGFloat(dot.height + 2) * scaleY)
            context.fill(box)
        }
        return context.makeImage()
    }
}
