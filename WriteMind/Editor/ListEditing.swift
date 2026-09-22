import Foundation

/// One reminder of a task list, as offsets in the note.
///
/// `text` is the WORDS and nothing else — everything before them is the
/// box and its marker, which on the rendered page is a live checkbox and
/// not something to be typed (Sean, 2026-09-21: "when modifying a
/// checklist.. the checkboxes remain in tact and just the text part of the
/// list becomes editable, one at a time").
struct Reminder: Equatable {
    /// The whole line, newline and all.
    var line: NSRange
    /// Just the words.
    var text: NSRange
    /// The character between the brackets — what a tick replaces.
    var box: Int
    var ticked: Bool
}

/// Editing a task list one item at a time: where each item's words are,
/// and what Return and Backspace do to the note.
///
/// Pure, and ONE WALK. `MarkdownFormatting.toggleTodo` used to count a
/// line's indentation in Characters while `CellFurniture.reminderBox`
/// counted it in UTF-16 — two counters for one offset, and a third was
/// about to be added here. A tick and an edit must never disagree about
/// which reminder is the third one, so everything asks this.
enum ListEditing {
    /// Every reminder inside a cell, in order. Lines that are not
    /// reminders are skipped rather than counted, which is the same rule
    /// the renderer and the tick follow.
    static func reminders(in cell: NSRange, of text: NSString) -> [Reminder] {
        var out: [Reminder] = []
        var start = max(0, cell.location)
        let end = min(NSMaxRange(cell), text.length)
        while start < end {
            let line = text.lineRange(for: NSRange(location: start, length: 0))
            guard line.length > 0 else { break }
            if let reminder = self.reminder(onLineAt: line, in: text) { out.append(reminder) }
            start = NSMaxRange(line)
        }
        return out
    }

    /// The reminder on one line, or nil when that line is not one.
    static func reminder(onLineAt line: NSRange, in text: NSString) -> Reminder? {
        guard let box = CellFurniture.reminderBox(onLineAt: line, in: text) else { return nil }
        // `box.end` is past the box and the space after it: the words.
        let bare = NSMaxRange(line) - (text.substring(with: line).hasSuffix("\n") ? 1 : 0)
        let words = NSRange(location: box.end, length: max(0, bare - box.end))
        return Reminder(line: line, text: words, box: box.state, ticked: box.ticked)
    }

    /// The reminder whose WORDS are exactly this range — how the page
    /// finds the item it has open again after the note has changed.
    static func reminder(forText range: NSRange, in text: NSString) -> Reminder? {
        guard range.location <= text.length else { return nil }
        let line = text.lineRange(for: NSRange(location: min(range.location, max(text.length - 1, 0)),
                                               length: 0))
        guard let found = reminder(onLineAt: line, in: text),
              found.text.location == range.location else { return nil }
        return found
    }

    /// The reminder on the line above this one, when that line is one too.
    static func previous(of line: NSRange, in text: NSString) -> Reminder? {
        guard line.location > 0 else { return nil }
        let above = text.lineRange(for: NSRange(location: line.location - 1, length: 0))
        return reminder(onLineAt: above, in: text)
    }

    /// The marker this line carries, with its box UNTICKED — what the
    /// next reminder starts with. A new task is not a done one (the same
    /// answer `PreviewEditing.listContinuation` gives).
    static func freshMarker(of line: NSRange, in text: NSString) -> String? {
        guard let box = CellFurniture.reminderBox(onLineAt: line, in: text),
              box.end <= text.length
        else { return nil }
        // The box is the one character between the brackets. In UTF-16,
        // like every other offset here — a second way of counting is how
        // a tick and an edit come to disagree.
        let head = NSMutableString(string: text.substring(
            with: NSRange(location: line.location, length: box.end - line.location)))
        let at = box.state - line.location
        guard at >= 0, at < head.length else { return nil }
        head.replaceCharacters(in: NSRange(location: at, length: 1), with: " ")
        return head as String
    }

    /// RETURN inside an item: what is behind the caret stays, what is in
    /// front of it becomes the next reminder, and that is the one that is
    /// open afterwards.
    static func split(_ markdown: String, item: NSRange,
                      head: String, tail: String) -> (markdown: String, editing: NSRange)? {
        let ns = markdown as NSString
        guard NSMaxRange(item) <= ns.length else { return nil }
        let line = ns.lineRange(for: item)
        guard let marker = freshMarker(of: line, in: ns) else { return nil }
        let replacement = head + "\n" + marker + tail
        let updated = ns.replacingCharacters(in: item, with: replacement)
        let start = item.location + (head as NSString).length + 1 + (marker as NSString).length
        return (updated, NSRange(location: start, length: (tail as NSString).length))
    }

    /// BACKSPACE in an item with nothing in it: the item goes, and the one
    /// above it is open at its end. Nil for `editing` when there was no
    /// reminder above — the caller takes the whole cell away instead.
    static func removeEmpty(_ markdown: String,
                            item: NSRange) -> (markdown: String, editing: NSRange?)? {
        let ns = markdown as NSString
        guard NSMaxRange(item) <= ns.length, item.length == 0 else { return nil }
        let line = ns.lineRange(for: item)
        let above = previous(of: line, in: ns)
        let updated = ns.replacingCharacters(in: line, with: "")
        guard let above else { return (updated, nil) }
        return (updated, NSRange(location: NSMaxRange(above.text), length: 0))
    }

    /// BACKSPACE at the start of an item that is NOT empty: its words join
    /// the end of the one above, and the caret sits at the seam between
    /// what was there and what has arrived. Nil when there is nothing
    /// above to join to.
    static func joinPrevious(_ markdown: String,
                             item: NSRange) -> (markdown: String, editing: NSRange)? {
        let ns = markdown as NSString
        guard NSMaxRange(item) <= ns.length else { return nil }
        let line = ns.lineRange(for: item)
        guard let above = previous(of: line, in: ns) else { return nil }
        let words = ns.substring(with: item)
        // Everything from the end of the line above's words to the end of
        // this item goes, and the words come back on the end of that line.
        let cut = NSRange(location: NSMaxRange(above.text),
                          length: NSMaxRange(item) - NSMaxRange(above.text))
        let updated = ns.replacingCharacters(in: cut, with: words)
        // The seam: after what was already there, before what arrived.
        return (updated, NSRange(location: NSMaxRange(above.text), length: 0))
    }
}
