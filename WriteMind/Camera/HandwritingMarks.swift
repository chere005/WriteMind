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

    /// Where an arrow drawn in the gap between two words belongs: the index
    /// of the word it goes in FRONT of, so the line reads "A → B" rather
    /// than carrying the arrow away onto a line of its own (Sean,
    /// 2026-09-19: "when an arrow's box sits ON a recognised line's band
    /// and BETWEEN two of its words, it should go inline").
    ///
    /// Nil for every other arrow, which keeps what the reader did before:
    /// one beside the line, above it or below it still gets its own line at
    /// its own height, and one drawn OVER a word is left to Vision.
    ///
    /// TWO DIFFERENT THINGS ANSWER THE TWO QUESTIONS, and that is the whole
    /// design of this rule:
    ///
    /// * IS IT IN A GAP? — the INK answers, not Vision. `marks` is every
    ///   blob of ink on the page; nothing else on this line's band may
    ///   share the arrow's columns, and there must be ink both sides of it.
    ///   Vision's per-word boxes cannot answer this: measured on a drawn
    ///   page, the box it gave for "Lyon" began 74 points left of the
    ///   word's own ink, hard against the word before it, so an arrow sat
    ///   squarely "inside" a word box it was nowhere near.
    /// * WHICH WORD DOES IT GO IN FRONT OF? — Vision answers. Its word
    ///   boxes are loose but they are in ORDER, so the first word whose
    ///   MIDDLE is right of the arrow's middle is the one it belongs in
    ///   front of, and there has to be a word's middle to its left as well.
    ///
    /// `words` are in reading order and the index that comes back indexes
    /// that array; every box is in mask pixels.
    static func betweenWords(_ box: CGRect, line: CGRect, words: [CGRect],
                             marks: [CGRect]) -> Int? {
        guard box.width > 0, box.height > 0, words.count >= 2 else { return nil }
        // On the line's own band, not a line above or below it.
        let top = max(box.minY, line.minY), bottom = min(box.maxY, line.maxY)
        guard bottom - top >= 0.5 * box.height else { return nil }

        var inkLeft = false, inkRight = false
        for mark in marks where mark != box {
            guard !mark.isNull, mark.width > 1, sameBand(mark, line) else { continue }
            if mark.maxX <= box.minX { inkLeft = true; continue }
            if mark.minX >= box.maxX { inkRight = true; continue }
            return nil   // something is drawn where the arrow is: not a gap
        }
        guard inkLeft, inkRight else { return nil }

        guard let after = words.firstIndex(where: { !$0.isNull && $0.midX > box.midX }),
              after > 0,
              words[..<after].contains(where: { !$0.isNull && $0.midX < box.midX })
        else { return nil }
        return after
    }

    /// The arrows themselves, as characters.
    static let arrowGlyphs: Set<Character> = ["→", "←", "↔", "↑", "↓"]

    /// A reading that is nothing but an arrow. It is neither struck out
    /// (a shaft IS a bar across the middle of its own box, which is what
    /// `struckThrough` looks for) nor a word of the note.
    static func isArrowRead(_ text: String) -> Bool {
        let bare = text.trimmingCharacters(in: .whitespaces)
        return !bare.isEmpty && bare.allSatisfy { arrowGlyphs.contains($0) }
    }

    static func startsWithArrow(_ text: String) -> Bool {
        guard let first = text.trimmingCharacters(in: .whitespaces).first else { return false }
        return arrowGlyphs.contains(first)
    }

    static func endsWithArrow(_ text: String) -> Bool {
        guard let last = text.trimmingCharacters(in: .whitespaces).last else { return false }
        return arrowGlyphs.contains(last)
    }

    /// Whether two readings sit on the same line of writing.
    static func sameBand(_ one: CGRect, _ other: CGRect) -> Bool {
        guard one.height > 0, other.height > 0 else { return false }
        let top = max(one.minY, other.minY), bottom = min(one.maxY, other.maxY)
        return bottom - top >= 0.6 * min(one.height, other.height)
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

    // MARK: - Checkboxes

    /// A hand-drawn box at the start of a line is a task (Sean, 2026-09-19:
    /// "a hand-drawn box with a tick in it, or an empty one, in a line of
    /// writing, should come back as a markdown task item"). `nil` for
    /// anything that is not one; `true` when there is ink inside it.
    ///
    /// The rules, cheapest to fail first:
    ///
    /// * ROUGHLY SQUARE (0.6 to 1.7 wide for tall). The letters that are
    ///   nearly square — O at 0.92, e and o at 0.89 — get in here and are
    ///   thrown out by the edges below.
    /// * ABOUT THE HEIGHT OF THE WRITING: half to one-and-four-fifths of
    ///   the line Vision read. A lower-case letter is half a line box.
    /// * ALL FOUR EDGES OF ITS OWN BOUNDING BOX INKED, `edgesInked` ≥ 0.8.
    ///   This is what a closed box has and a letter has not.
    /// * NOT A BLOT: less than 0.7 of its middle is ink.
    ///
    /// The 0.8 is measured, not guessed. Drawn with Core Graphics at every
    /// side from 14 to 56 pixels and every pen from 2 to 4 — the range a
    /// checkbox comes out of a photographed page at — a clean square was
    /// 1.00 EVERY time; the letters were O 0.74, D 0.75, o 0.75, a 0.61,
    /// e 0.61, Q 0.61, c 0.56, H 0.40, E 0.38; a circle ran 0.67 to 0.81
    /// and a square wobbled by a tenth of its side at each corner, or with
    /// a corner left open, ran 0.67 to 0.88.
    ///
    /// So: every neatly drawn box is read, every letter measured is not,
    /// and the sloppy cases — a bad wobble, a circle — fall on both sides
    /// of the line on purpose. A box that is not clearly a box leaves its
    /// line alone, which is the whole instruction (Sean: "be conservative:
    /// when unsure, leave the line alone"). The thin margin between a
    /// letter at 0.75 and this at 0.80 is not what makes it safe on a page
    /// of ordinary writing — the caller's word test is: a square that sits
    /// inside a word Vision actually read is a letter of that word
    /// (`TextRecognition.checkbox(startingLine:words:in:)`).
    static func checkbox(_ box: CGRect, line: CGRect, ink: [Bool], width: Int, height: Int) -> Bool? {
        let shortSide = min(box.width, box.height)
        guard shortSide >= 8 else { return nil }
        let aspect = box.width / max(1, box.height)
        guard aspect >= 0.6, aspect <= 1.7 else { return nil }
        guard line.height > 0, box.height >= line.height * 0.5, box.height <= line.height * 1.8 else {
            return nil
        }
        guard edgesInked(box, ink: ink, width: width, height: height) >= 0.8 else { return nil }
        // A SOLID bullet big enough to outrun the threshold's window comes
        // back hollow, and a hollow square with four inked edges is exactly
        // what this function is looking for — so a fat filled square read
        // as an EMPTY checkbox (the open list, 2026-09-20). What tells them
        // apart is how THICK the ink round the hollow is: a pen draws two
        // to four pixels, and the ring a hollowed-out blob keeps is as deep
        // as the test looks, which is `localMeanRadius`. Nothing drawn with
        // a pen is that thick, so a box whose walls are is not a box.
        //
        // TWO readings, and it takes both, because either alone throws a
        // real box away. A wall as deep as the test looks is suspicious,
        // but on a small mask that window has a floor of 8 and an inked
        // pen stroke measures 4 — so the wall also has to be a large part
        // of the BOX, which a pen's line never is (4 pixels of a 32-pixel
        // square is an eighth) and a hollowed blob's ring always is.
        let radius = NotebookCapture.localMeanRadius(width: width, height: height)
        let walls = wallThickness(box, ink: ink, width: width, height: height)
        if walls >= Double(radius) * 0.5, walls >= Double(shortSide) * 0.25 { return nil }
        let inside = insideInk(box, ink: ink, width: width, height: height)
        // A tick fills about a third of the inside and a cross about
        // three fifths; a filled square small enough to stay solid in the
        // mask fills all of it.
        guard inside < 0.7 else { return nil }
        return inside >= 0.08
    }

    /// The short side of a box — what the wall rule measures against.
    static func inkBoxSide(_ box: CGRect) -> CGFloat { min(box.width, box.height) }

    /// How deep the ink is at the four walls of a box: from the middle of
    /// each edge, inwards, the run of ink before the first gap. The
    /// THINNEST of the four, because one heavy side is a pen pressed
    /// harder and a blob is thick on every side.
    static func wallThickness(_ box: CGRect, ink: [Bool], width: Int, height: Int) -> Double {
        let x0 = max(0, Int(box.minX)), x1 = min(width, Int(box.maxX.rounded(.up)))
        let y0 = max(0, Int(box.minY)), y1 = min(height, Int(box.maxY.rounded(.up)))
        guard x1 > x0, y1 > y0, ink.count == width * height else { return 0 }
        let midX = (x0 + x1) / 2, midY = (y0 + y1) / 2

        func run(_ steps: [Int], _ at: (Int) -> Bool) -> Double {
            var depth = 0
            for step in steps {
                guard at(step) else { break }
                depth += 1
            }
            return Double(depth)
        }

        let top = run(Array(y0..<y1)) { ink[$0 * width + midX] }
        let bottom = run(Array((y0..<y1).reversed())) { ink[$0 * width + midX] }
        let left = run(Array(x0..<x1)) { ink[midY * width + $0] }
        let right = run(Array((x0..<x1).reversed())) { ink[midY * width + $0] }
        return min(min(top, bottom), min(left, right))
    }

    /// How much of the WORST of the four edges of a box is inked: for each
    /// edge, the fraction of the positions along it that have ink within a
    /// band a fifth of the box's short side deep.
    static func edgesInked(_ box: CGRect, ink: [Bool], width: Int, height: Int) -> Double {
        let x0 = max(0, Int(box.minX)), x1 = min(width, Int(box.maxX.rounded(.up)))
        let y0 = max(0, Int(box.minY)), y1 = min(height, Int(box.maxY.rounded(.up)))
        guard x1 > x0, y1 > y0, ink.count == width * height else { return 0 }
        let band = max(2, min(x1 - x0, y1 - y0) / 5)

        func down(_ x: Int, _ rows: Range<Int>) -> Bool { rows.contains { ink[$0 * width + x] } }
        func across(_ y: Int, _ columns: Range<Int>) -> Bool { columns.contains { ink[y * width + $0] } }

        let columns = Double(x1 - x0), rows = Double(y1 - y0)
        let top = Double((x0..<x1).filter { down($0, y0..<min(y1, y0 + band)) }.count) / columns
        let bottom = Double((x0..<x1).filter { down($0, max(y0, y1 - band)..<y1) }.count) / columns
        let left = Double((y0..<y1).filter { across($0, x0..<min(x1, x0 + band)) }.count) / rows
        let right = Double((y0..<y1).filter { across($0, max(x0, x1 - band)..<x1) }.count) / rows
        return min(min(top, bottom), min(left, right))
    }

    /// How much of the INSIDE of a box is ink — the box less a quarter of
    /// its short side all round, so the outline itself is not counted. The
    /// whole mask is read, not one blob: a tick that never touched the box
    /// it is in is a component of its own.
    static func insideInk(_ box: CGRect, ink: [Bool], width: Int, height: Int) -> Double {
        let x0 = max(0, Int(box.minX)), x1 = min(width, Int(box.maxX.rounded(.up)))
        let y0 = max(0, Int(box.minY)), y1 = min(height, Int(box.maxY.rounded(.up)))
        guard x1 > x0, y1 > y0, ink.count == width * height else { return 0 }
        let inset = max(2, min(x1 - x0, y1 - y0) / 4)
        let ix0 = x0 + inset, ix1 = x1 - inset, iy0 = y0 + inset, iy1 = y1 - inset
        guard ix1 > ix0, iy1 > iy0 else { return 0 }
        var inked = 0
        for y in iy0..<iy1 {
            for x in ix0..<ix1 where ink[y * width + x] { inked += 1 }
        }
        return Double(inked) / Double((ix1 - ix0) * (iy1 - iy0))
    }

    /// Whether a mark sits at the START of a line: on the line's band, and
    /// no further right than its own width past where the line begins. A
    /// box Vision did not read sits in the margin to the LEFT of the line's
    /// own box; one Vision read as a letter is the line's first character,
    /// so both ends of that slack are needed.
    static func startsLine(_ box: CGRect, line: CGRect) -> Bool {
        guard box.width > 0, box.height > 0, line.height > 0 else { return false }
        // A box does not start a line that is INSIDE it: that is a tick
        // Vision read as a character, or the label of a small flow-chart
        // node, and either way the box is not a marker in front of words.
        guard !mostlyInside(line, box) else { return false }
        let top = max(box.minY, line.minY), bottom = min(box.maxY, line.maxY)
        guard bottom - top >= 0.5 * min(box.height, line.height) else { return false }
        guard box.minX >= line.minX - 4 * box.width else { return false }
        return box.maxX <= line.minX + 1.5 * box.width
    }

    /// Whether most of `inner` is inside `outer`.
    static func mostlyInside(_ inner: CGRect, _ outer: CGRect) -> Bool {
        let overlap = inner.intersection(outer)
        guard !overlap.isNull, inner.width > 0, inner.height > 0 else { return false }
        return (overlap.width * overlap.height) / (inner.width * inner.height) >= 0.6
    }

    /// What Vision reads a drawn checkbox as, when it reads one at all: an
    /// empty box comes back as D, O, 0 or a pair of brackets, a ticked one
    /// as X or V. Anything of ONE letter or digit counts, because this is
    /// only ever asked of a reading that sits inside the box's own outline
    /// — where a single character IS the box, not a word of the note.
    static func isBoxRead(_ text: String) -> Bool {
        let bare = text.trimmingCharacters(in: CharacterSet.whitespaces.union(.punctuationCharacters))
        if bare.isEmpty { return true }
        if ["□", "☐", "☑", "☒", "▢", "■", "▪︎", "口", "回", "目"].contains(bare) { return true }
        return bare.count == 1 && (bare.first!.isLetter || bare.first!.isNumber)
    }

    /// The line as a markdown task item. Empty when the box was all there
    /// was — a checkbox with nothing beside it is not a task.
    static func taskItem(_ text: String, ticked: Bool) -> String {
        var bare = text.trimmingCharacters(in: .whitespaces)
        // One list marker is enough: the box's own left edge, or a dash
        // drawn beside it, reads as a bullet often enough to matter.
        for marker in ["- [x] ", "- [ ] ", "- ", "* ", "• ", "·"] where bare.hasPrefix(marker) {
            bare = String(bare.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        guard !bare.isEmpty else { return "" }
        return (ticked ? "- [x] " : "- [ ] ") + bare
    }

    // MARK: - Maths

    /// The signs a sum is made of.
    static let operatorGlyphs: Set<Character> = Set("=+−-×÷/^√∑∫<>≤≥≠·")

    /// A reading that is nothing but an operator. Like an arrow, and for
    /// exactly the same reason, IT IS NEVER A WORD WITH A LINE THROUGH IT:
    /// an = is two bars across the middle of its own box and a + is one,
    /// which is precisely the shape `struckThrough` hunts for. A bar
    /// through a word only means something when the word is more than the
    /// bar — so every sign on a line of algebra came back struck out
    /// ("x = 2y + 1" read as "× ~~=~~ 2y ~~+~~ 1", measured on a page drawn
    /// at 40pt, 2026-09-19), and those marks then kept the line out of the
    /// maths path, which will not touch a line carrying any.
    static func isOperatorRead(_ text: String) -> Bool {
        let bare = text.trimmingCharacters(in: .whitespaces)
        return !bare.isEmpty && bare.allSatisfy { operatorGlyphs.contains($0) }
    }

    /// A line that is a sum rather than a sentence: it carries an operator,
    /// and what letters it has are the short names of variables.
    static func looksLikeMaths(_ text: String) -> Bool {
        let bare = text.trimmingCharacters(in: .whitespaces)
        guard !bare.isEmpty else { return false }
        guard bare.contains(where: { operatorGlyphs.contains($0) }) else { return false }
        guard bare.contains(where: { $0.isNumber || $0.isLetter }) else { return false }
        let words = bare.split { !$0.isLetter }
        // One or two short names is algebra; "the sum of x" is a sentence.
        guard words.count <= 3, words.allSatisfy({ $0.count <= 3 }) else { return false }
        return true
    }

    /// A × THAT CANNOT BE A TIMES SIGN IS THE LETTER x. Multiplication is
    /// infix: it needs a number or a name on BOTH sides of it. A × with an
    /// operator, or nothing at all, to one side is Vision reading a
    /// handwritten variable as the sign it is drawn like — measured
    /// 2026-09-19, "x = 2y + 1" drawn at 40pt came back from Vision as
    /// "× = 2y + 1", and `wolfram` then made that "* = 2y + 1", which no
    /// parser reads. A real sum is untouched: the × in "3 × 4" has an
    /// operand each side.
    static func strayTimesAsX(_ text: String) -> String {
        let characters = Array(text)
        func ends(_ at: Int, opening: Bool) -> Bool {
            guard at >= 0, at < characters.count else { return false }
            let character = characters[at]
            return character.isNumber || character.isLetter || character == (opening ? "(" : ")")
        }
        func past(_ from: Int, _ step: Int) -> Int {
            var at = from + step
            while at >= 0, at < characters.count, characters[at].isWhitespace { at += step }
            return at
        }
        var out = ""
        for (index, character) in characters.enumerated() {
            guard character == "×" else { out.append(character); continue }
            let left = ends(past(index, -1), opening: false)
            let right = ends(past(index, 1), opening: true)
            out.append(left && right ? character : "x")
        }
        return out
    }

    /// The same line as Wolfram Language: the signs a hand writes turned
    /// into the ones a parser reads.
    static func wolfram(_ text: String) -> String {
        var out = strayTimesAsX(text).trimmingCharacters(in: .whitespaces)
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
