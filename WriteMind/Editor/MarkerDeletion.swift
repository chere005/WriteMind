import Foundation

/// Deleting text that has hidden markers in it.
///
/// The markers are still in the note — `**` round bold, `~~` round struck
/// text, `#` in front of a heading — they are only drawn with no width. So
/// a selection made with the eye can cut a pair in half: take "**bo" out of
/// "**bold**" and the note is left holding `ld**`, which renders as a stray
/// pair of asterisks (the to-do list: "a selection that spans one `**` of a
/// pair can leave `**bold*` behind").
///
/// A delete therefore takes whole markers, never half of one, and when it
/// takes one half of a pair it takes the other half too — otherwise the
/// text left behind is marked up with an opener that never closes.
enum MarkerDeletion {
    /// The ranges a delete should really take, biggest location first so a
    /// caller can apply them back to front without recomputing anything.
    /// One range — the one asked for — when there is nothing to widen.
    ///
    /// The FIRST element of the result is the range that was asked for,
    /// widened; the rest are orphaned partners, which are always deleted
    /// outright. A caller replacing rather than deleting needs to tell the
    /// two apart, so `asked(in:)` says which is which.
    static func deletions(for range: NSRange, in source: String) -> [NSRange] {
        // A range that runs off the end is nobody's edit, and the marker
        // maths below would hand back ranges that cannot be applied.
        let length = (source as NSString).length
        let range = NSIntersectionRange(range, NSRange(location: 0, length: length))
        guard range.length > 0 else { return [range] }
        let runs = MarkdownSourceStyle.runs(in: source)
        guard !runs.isEmpty else { return [range] }

        var wanted = range
        // A marker the delete only clips is taken whole.
        for run in runs where run.kind == .marker {
            let overlap = NSIntersectionRange(run.range, wanted)
            guard overlap.length > 0, overlap.length < run.range.length else { continue }
            wanted = NSUnionRange(wanted, run.range)
        }

        // …and a pair with one half gone loses the other half as well.
        var extra: [NSRange] = []
        for pair in pairs(in: runs) {
            let opener = NSIntersectionRange(pair.open, wanted).length == pair.open.length
            let closer = NSIntersectionRange(pair.close, wanted).length == pair.close.length
            if opener, !closer { extra.append(pair.close) }
            if closer, !opener { extra.append(pair.open) }
        }

        return ([wanted] + extra).sorted { $0.location > $1.location }
    }

    /// Which of `deletions` is the range the user actually selected — the
    /// one a replacement goes into. The others are orphaned markers and
    /// are only ever removed.
    ///
    /// It matters because a delete is not the only thing that can cut a
    /// pair in half: TYPING over such a selection, or pasting into it,
    /// does the same damage and used to go straight through unwidened —
    /// "**bo" replaced by "x" in "**bold** here" left "xld** here".
    static func asked(_ range: NSRange, in deletions: [NSRange]) -> NSRange {
        deletions.first { NSIntersectionRange($0, range).length > 0 } ?? range
    }

    /// The marker either side of a styled run — the two halves that have to
    /// go together.
    static func pairs(in runs: [MarkdownSourceStyle.Run]) -> [(open: NSRange, close: NSRange)] {
        let markers = runs.filter { $0.kind == .marker }
        var out: [(open: NSRange, close: NSRange)] = []
        for run in runs {
            switch run.kind {
            case .bold, .italic, .strikethrough, .code, .math:
                guard let open = markers.first(where: { NSMaxRange($0.range) == run.range.location }),
                      let close = markers.first(where: { $0.range.location == NSMaxRange(run.range) })
                else { continue }
                out.append((open.range, close.range))
            default:
                continue
            }
        }
        return out
    }
}
