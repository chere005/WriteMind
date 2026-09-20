import CoreGraphics
import Foundation

/// The marks a page of handwriting carries that are not letters: a line
/// through a word, an arrow between two of them, a ring round one, and the
/// little raised digits that make a power (Sean, 2026-09-19: "make the ocr
/// detect things like strikethrough and math and arrows circles and clean
/// that up"). Pure geometry over the ink mask and the boxes Vision gives
/// back, so every rule can be tested without a camera.
enum HandwritingMarks {
    /// A word Vision read, with its box in MASK pixels — top-left origin,
    /// the same way round as the mask.
    struct Word: Equatable {
        var text: String
        var box: CGRect
    }

    // MARK: - A line through a word

    /// A bar across the middle of the word, thin, and reaching most of the
    /// way over: that is a word struck out, not a letter.
    static func struckThrough(word: CGRect, ink: [Bool], width: Int, height: Int) -> Bool {
        let x0 = max(0, Int(word.minX)), x1 = min(width, Int(word.maxX.rounded(.up)))
        let y0 = max(0, Int(word.minY)), y1 = min(height, Int(word.maxY.rounded(.up)))
        guard x1 - x0 >= 8, y1 - y0 >= 5, ink.count == width * height else { return false }
        let span = Double(x1 - x0)
        let box = y1 - y0

        func coverage(_ y: Int) -> Double {
            guard y >= 0, y < height else { return 0 }
            var count = 0
            for x in x0..<x1 where ink[y * width + x] { count += 1 }
            return Double(count) / span
        }

        // Only the middle half of the word: a line under it is an
        // underline, and the tops of the letters are not a bar.
        let from = y0 + box / 4, to = y0 + (box * 3) / 4
        for y in from...max(from, to) where coverage(y) >= 0.8 {
            // Thin: the ink four rows away has to be much sparser, or this
            // is a solid block rather than a stroke through the word.
            let above = coverage(y - max(2, box / 6)), below = coverage(y + max(2, box / 6))
            if above < 0.5, below < 0.5 { return true }
        }
        return false
    }

    // MARK: - Arrows

    /// A long thin mark with one end heavier than the other is an arrow,
    /// and the heavy end is the head. Nil for anything else — a plain line
    /// is a line.
    static func arrow(box: CGRect, ink: [Bool], width: Int, height: Int) -> String? {
        let x0 = max(0, Int(box.minX)), x1 = min(width, Int(box.maxX.rounded(.up)))
        let y0 = max(0, Int(box.minY)), y1 = min(height, Int(box.maxY.rounded(.up)))
        let w = x1 - x0, h = y1 - y0
        guard w > 0, h > 0, ink.count == width * height else { return nil }
        let long = max(w, h), short = min(w, h)
        guard long >= 14, Double(long) / Double(max(1, short)) >= 3 else { return nil }

        let horizontal = w >= h
        let quarter = max(1, long / 4)
        var head = 0, tail = 0
        for y in y0..<y1 {
            for x in x0..<x1 where ink[y * width + x] {
                let along = horizontal ? x - x0 : y - y0
                if along < quarter { tail += 1 }
                if along >= long - quarter { head += 1 }
            }
        }
        guard head > 0 || tail > 0 else { return nil }
        let ratio = Double(max(head, tail)) / Double(max(1, min(head, tail)))
        guard ratio >= 1.4 else { return nil }
        let pointsForward = head > tail
        if horizontal { return pointsForward ? "→" : "←" }
        return pointsForward ? "↓" : "↑"
    }

    /// What Vision itself reads an arrow as, when it reads one at all.
    static func normaliseArrows(_ text: String) -> String {
        var out = text
        for (drawn, arrow) in [("<->", "↔"), ("<-->", "↔"), ("-->", "→"), ("->", "→"), ("=>", "→"),
                               ("<--", "←"), ("<-", "←"), ("<=", "←")] {
            out = out.replacingOccurrences(of: drawn, with: arrow)
        }
        return out
    }

    // MARK: - A ring round a word

    /// A big round outline with nothing much inside it.
    static func isRing(box: CGRect, fill: Double, shortSide: Int) -> Bool {
        let aspect = box.height / max(1, box.width)
        return box.width >= CGFloat(shortSide) / 40
            && aspect >= 0.5 && aspect <= 2
            && fill <= 0.35
    }

    /// Whether a ring holds a word — most of the word, not a corner of it.
    static func encircles(_ ring: CGRect, word: CGRect) -> Bool {
        let overlap = ring.intersection(word)
        guard !overlap.isNull, word.width > 0, word.height > 0 else { return false }
        let covered = (overlap.width * overlap.height) / (word.width * word.height)
        return covered >= 0.8
    }

    /// The letter a ring is read as by mistake — an O, a zero, a pair of
    /// brackets. Dropped when a ring is already in that place.
    static func isRingRead(_ text: String) -> Bool {
        let bare = text.trimmingCharacters(in: .whitespaces)
        return ["O", "o", "0", "()", "( )", "◦", "○", "Q", "D"].contains(bare)
    }

    // MARK: - Maths

    /// A line that is a sum rather than a sentence: it carries an operator,
    /// and what letters it has are the short names of variables.
    static func looksLikeMaths(_ text: String) -> Bool {
        let bare = text.trimmingCharacters(in: .whitespaces)
        guard !bare.isEmpty else { return false }
        let operators = Set("=+−-×÷/^√∑∫<>≤≥≠·")
        guard bare.contains(where: { operators.contains($0) }) else { return false }
        guard bare.contains(where: { $0.isNumber || $0.isLetter }) else { return false }
        let words = bare.split { !$0.isLetter }
        // One or two short names is algebra; "the sum of x" is a sentence.
        guard words.count <= 3, words.allSatisfy({ $0.count <= 3 }) else { return false }
        return true
    }

    /// The same line as Wolfram Language: the signs a hand writes turned
    /// into the ones a parser reads.
    static func wolfram(_ text: String) -> String {
        var out = text.trimmingCharacters(in: .whitespaces)
        for (written, wl) in [("×", "*"), ("·", "*"), ("÷", "/"), ("−", "-"), ("≤", "<="), ("≥", ">="),
                              ("≠", "!="), ("√", "Sqrt"), ("∑", "Sum"), ("∫", "Integrate"), ("π", "Pi"),
                              ("∞", "Infinity")] {
            out = out.replacingOccurrences(of: written, with: wl)
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    /// `x²` written by hand comes back as "x2" with the 2 sitting high and
    /// small; put the caret back in. `characters` are in reading order with
    /// their boxes in mask pixels.
    static func superscripted(_ characters: [(character: Character, box: CGRect)]) -> String {
        let bodies = characters.filter { !$0.character.isWhitespace }
        guard bodies.count >= 2 else { return String(characters.map(\.character)) }
        let heights = bodies.map(\.box.height).sorted()
        let median = heights[heights.count / 2]
        guard median > 0 else { return String(characters.map(\.character)) }
        let baseline = bodies.map { $0.box.maxY }.sorted()[bodies.count / 2]

        var out = ""
        for (character, box) in characters {
            let raised = box.maxY <= baseline - median * 0.25
            let small = box.height <= median * 0.75
            if raised, small, character.isNumber || character.isLetter {
                if !out.hasSuffix("^") { out.append("^") }
                out.append(character)
            } else {
                out.append(character)
            }
        }
        return out
    }
}
