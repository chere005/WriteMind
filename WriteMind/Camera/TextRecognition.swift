import AppKit
import CoreImage
import Vision

/// The words in a picture — a photographed page, a captured chunk of
/// writing, a pasted screenshot — read by Vision and handed back as lines in
/// reading order (Sean, 2026-09-18: "transform an image … into its text and
/// insert that text below the image").
enum TextRecognition {
    /// Everything one pass of Vision found: the words as markdown lines,
    /// and the raw material a flow chart is read from.
    struct Reading {
        var lines: [String] = []
        var page: Page?
        var words: [HandwritingMarks.Word] = []
    }

    /// One pass, used for both. Vision is the expensive part, so the chart
    /// reader gets the same observations the words came from.
    static func read(_ image: CGImage) -> Reading {
        let flattened = onWhite(image) ?? image
        let page = Page.of(flattened)
        let prepared = page?.cleaned ?? flattened
        let observations = readBest(prepared)
        var reading = Reading(lines: compose(observations, page: page), page: page)
        if let page {
            for observation in observations {
                guard let best = observation.topCandidates(1).first else { continue }
                reading.words += words(of: best, in: page)
            }
        }
        return reading
    }

    /// Lines of text, top to bottom. Empty when nothing could be read.
    /// What comes back is markdown: a word with a line through it arrives
    /// struck out, a word with a ring round it in bold, an arrow as an
    /// arrow, and a line of algebra as this app's maths (Sean, 2026-09-19).
    static func lines(in image: CGImage) -> [String] { read(image).lines }

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

    /// One reading of Vision's while the marks drawn on the page are being
    /// sorted onto it: the words, where they are, and how high up the line
    /// sits (Vision's y, so it sorts with everything else).
    struct ReadLine {
        var candidate: VNRecognizedText
        var box: CGRect
        var words: [HandwritingMarks.Word]
        var y: CGFloat
    }

    static func compose(_ observations: [VNRecognizedTextObservation], page: Page?) -> [String] {
        // With no ink mask there is nothing drawn to read: the words, in
        // order, and that is all.
        guard let page else {
            return observations
                .compactMap { observation -> (CGFloat, String)? in
                    guard let best = observation.topCandidates(1).first else { return nil }
                    let text = best.string.trimmingCharacters(in: .whitespaces)
                    guard looksLikeText(text, confidence: best.confidence) else { return nil }
                    return (observation.boundingBox.midY, HandwritingMarks.normaliseArrows(text))
                }
                .sorted { $0.0 > $1.0 }
                .map(\.1)
                .filter { !$0.isEmpty }
        }

        // Every word on the page, whether or not its reading was kept: what
        // tells a checkbox from a small flow-chart node is the word INSIDE
        // the square, and Vision reads that as a line of its own.
        var onThePage: [HandwritingMarks.Word] = []
        var read: [ReadLine] = []

        for observation in observations {
            guard let best = observation.topCandidates(1).first else { continue }
            let text = best.string.trimmingCharacters(in: .whitespaces)
            let inLine = words(of: best, in: page)
            onThePage += inLine
            guard looksLikeText(text, confidence: best.confidence) else { continue }
            let box = page.rect(observation.boundingBox)
            // A ring read as a letter is not a letter.
            if HandwritingMarks.isRingRead(text), rings(in: page).contains(where: {
                HandwritingMarks.encircles($0.insetBy(dx: -2, dy: -2), word: box)
            }) { continue }
            read.append(ReadLine(candidate: best, box: box, words: inLine,
                                 y: observation.boundingBox.midY))
        }

        // The arrows nobody read: some belong between two words of a line,
        // the rest on a line of their own.
        let placed = arrows(in: page, on: read)
        var pieces: [Piece] = []
        for (index, line) in read.enumerated() {
            // A box drawn at the head of the line makes the line a task
            // (Sean, 2026-09-19). The box goes to `marked` too, so the
            // letter Vision read it as does not stay in the words.
            let tick = checkbox(startingLine: line.box, words: onThePage, in: page)
            var text = marked(line.candidate, box: line.box, in: page,
                              ignoring: tick?.box, inserting: placed.inline[index] ?? [:])
            if let tick { text = HandwritingMarks.taskItem(text, ticked: tick.ticked) }
            pieces.append(Piece(y: line.y, box: line.box, text: text))
        }

        var lines = joinAcrossArrows(pieces)
            .map { (y: $0.y, text: $0.text, box: Optional($0.box)) }
        for (y, arrow) in placed.ownLine { lines.append((y: y, text: arrow, box: nil)) }

        // A table ruled on the page used to come in as a markdown table.
        // Tables went out of the app whole on 2026-09-20 (Sean: "just
        // completely remove tables as a feature and we'll rebuild that
        // from scratch"), and reading one existed only to write one, so
        // the rules are ink and the words in them are prose like any
        // other. It comes back when tables do.

        return lines
            .sorted { $0.y > $1.y }
            .map(\.text)
            .filter { !$0.isEmpty }
    }

    /// One line of the reading while it is being put together.
    struct Piece: Equatable {
        var y: CGFloat
        var box: CGRect
        var text: String
    }

    /// Vision BREAKS A LINE AT A DRAWN ARROW: "Paris → Lyon" comes back as
    /// two readings, "Paris" and "→ Lyon", side by side on one band — which
    /// is the other half of an arrow belonging between two words (Sean,
    /// 2026-09-19). Put them back into one line.
    ///
    /// Deliberately narrow, because joining two readings that were not one
    /// line would be worse than leaving them apart: the right-hand piece
    /// must BEGIN with an arrow (or the left-hand one END with one), the
    /// two must sit on the same band, the right one must start clear of the
    /// left one, and the gap between them must be no more than three times
    /// the taller one's height — an arrow's worth of gap, not a column of a
    /// table away. (Measured on a drawn page: an arrow between two words
    /// left Vision's two readings 98 points apart at a 36-point line.)
    /// `pieces` arrive in READING ORDER — which is what `observations`
    /// hands back, top line first and left to right within a line — and
    /// only a piece and the one before it are ever joined. Sorting here by
    /// y would undo that: two halves of one line have midYs a hair apart,
    /// and the right-hand half sorted in FRONT of the left.
    static func joinAcrossArrows(_ pieces: [Piece]) -> [Piece] {
        var out: [Piece] = []
        for piece in pieces {
            if let last = out.last,
               HandwritingMarks.startsWithArrow(piece.text) || HandwritingMarks.endsWithArrow(last.text),
               HandwritingMarks.sameBand(last.box, piece.box),
               piece.box.minX >= last.box.maxX,
               piece.box.minX - last.box.maxX <= 3 * max(last.box.height, piece.box.height) {
                out[out.count - 1].text = last.text + " " + piece.text
                out[out.count - 1].box = last.box.union(piece.box)
                continue
            }
            out.append(piece)
        }
        return out
    }

    /// One line of writing, with what is drawn over it taken into account.
    /// `ignoring` is a mark the line is not made of — the checkbox at its
    /// head — so the single letter Vision read that mark as is dropped
    /// rather than left sitting in front of the words.
    /// `inserting` puts a drawn mark — an arrow — in FRONT of the word at
    /// that index, so "A → B" comes back as one line.
    static func marked(_ candidate: VNRecognizedText, box: CGRect, in page: Page,
                       ignoring: CGRect? = nil, inserting: [Int: String] = [:]) -> String {
        let text = HandwritingMarks.normaliseArrows(candidate.string.trimmingCharacters(in: .whitespaces))
        let ringed = rings(in: page)

        var pieces: [String] = []
        for (index, word) in words(of: candidate, in: page).enumerated() {
            if let arrow = inserting[index] { pieces.append(arrow) }
            if let ignoring, HandwritingMarks.isBoxRead(word.text),
               HandwritingMarks.mostlyInside(word.box, ignoring) { continue }
            var piece = HandwritingMarks.normaliseArrows(word.text)
            // An arrow is not a word with a line through it: its shaft IS a
            // bar across the middle of its own box, which is exactly what
            // `struckThrough` is looking for ("Paris → Lyon" came back
            // "Paris ~~→~~ Lyon").
            if HandwritingMarks.isArrowRead(piece) {
                pieces.append(piece)
                continue
            }
            // Nor is an operator: a word has to be more than the bar
            // itself before a bar through it means anything, and an = or a
            // + IS the bar (see `isOperatorRead`).
            if !HandwritingMarks.isOperatorRead(piece),
               HandwritingMarks.struckThrough(word: word.box, ink: page.ink,
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

    /// A checkbox found at the head of a line, and whether it is ticked.
    struct Checkbox: Equatable {
        var box: CGRect
        var ticked: Bool
    }

    /// The box drawn at the start of a line, if there is one.
    ///
    /// The geometry is `HandwritingMarks.checkbox`; the guard that makes it
    /// safe on a page of ordinary writing is here. A square that sits
    /// inside a WORD Vision read — the O of "Order", the 口 of a Japanese
    /// line — is a letter, not a box, and the line is left exactly as it
    /// was. Only a reading of a single character, which is what a drawn box
    /// comes back as when it comes back at all, is allowed to sit on one.
    static func checkbox(startingLine line: CGRect, words: [HandwritingMarks.Word],
                         in page: Page) -> Checkbox? {
        for index in page.marks.writing {
            let blob = page.marks.components[index]
            let box = CGRect(x: blob.minX, y: blob.minY, width: blob.width, height: blob.height)
            guard HandwritingMarks.startsLine(box, line: line) else { continue }
            guard let ticked = HandwritingMarks.checkbox(box, line: line, ink: page.ink,
                                                         width: page.width, height: page.height)
            else { continue }
            // Either way round: the square inside a word is one of its
            // letters, and a word inside the square is what a small
            // flow-chart node has in it.
            let read = words.first {
                HandwritingMarks.mostlyInside(box, $0.box) || HandwritingMarks.mostlyInside($0.box, box)
            }
            if let read, !HandwritingMarks.isBoxRead(read.text) { continue }
            return Checkbox(box: box, ticked: ticked)
        }
        return nil
    }

    /// The hollow rings drawn round words.
    static func rings(in page: Page) -> [CGRect] {
        page.marks.writing.compactMap { index in
            let blob = page.marks.components[index]
            let box = CGRect(x: blob.minX, y: blob.minY, width: blob.width, height: blob.height)
            return HandwritingMarks.isRing(box: box, fill: blob.fill, shortSide: page.shortSide) ? box : nil
        }
    }

    /// Where an arrow found in the ink goes.
    enum ArrowPlace: Equatable {
        /// Into that line, in front of the word at that index.
        case inline(line: Int, before: Int)
        /// On a line of its own: the arrow is beside the writing, or above
        /// or below it.
        case ownLine
        /// Over a line's words — whatever it is, Vision has already read
        /// it, and a second copy on the page would be a duplicate.
        case read
    }

    /// Which of the three a mark's box is, against the lines that were
    /// read — their own boxes and their words'. Pure geometry, so the
    /// awkward ones are tested without a camera.
    static func place(_ box: CGRect, onLines lines: [(box: CGRect, words: [HandwritingMarks.Word])],
                      amongInk marks: [CGRect]) -> ArrowPlace {
        for (index, line) in lines.enumerated() {
            // Vision may have read this very arrow: putting a second one in
            // gave "Paris → → Lyon".
            if line.words.contains(where: {
                HandwritingMarks.isArrowRead(HandwritingMarks.normaliseArrows($0.text))
                    && $0.box.intersects(box)
            }) { return .read }
            if let before = HandwritingMarks.betweenWords(box, line: line.box,
                                                          words: line.words.map(\.box),
                                                          marks: marks) {
                return .inline(line: index, before: before)
            }
        }
        let overlapped = lines.contains { line in
            let overlap = line.box.intersection(box)
            return !overlap.isNull && overlap.height > box.height * 0.5 && overlap.width > box.width * 0.5
        }
        return overlapped ? .read : .ownLine
    }

    /// The arrows Vision did not read, sorted onto the lines: the ones that
    /// belong between two words of a line, and the ones that get a line of
    /// their own at the height they sit at (in Vision's coordinates, so
    /// they sort with everything else).
    static func arrows(in page: Page, on lines: [ReadLine])
        -> (inline: [Int: [Int: String]], ownLine: [(CGFloat, String)]) {
        var inline: [Int: [Int: String]] = [:]
        var ownLine: [(CGFloat, String)] = []
        let bands = lines.map { (box: $0.box, words: $0.words) }
        let marks = page.marks.writing.map { index -> CGRect in
            let blob = page.marks.components[index]
            return CGRect(x: blob.minX, y: blob.minY, width: blob.width, height: blob.height)
        }
        for box in marks {
            let where_ = place(box, onLines: bands, amongInk: marks)
            guard where_ != .read else { continue }
            guard let arrow = HandwritingMarks.arrow(box: box, ink: page.ink,
                                                     width: page.width, height: page.height)
            else { continue }
            switch where_ {
            case .inline(let line, let before): inline[line, default: [:]][before] = arrow
            case .ownLine: ownLine.append((1 - (box.midY / CGFloat(page.height)), arrow))
            case .read: break
            }
        }
        return (inline, ownLine)
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
