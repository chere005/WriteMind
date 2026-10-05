import { describe, expect, it } from "vitest"
import {
  joinPreviousReminder, nextReminder, reminderForText, remindersIn, removeEmptyReminder, splitReminder,
  type Reminder,
} from "../src/cells/preview"
import { toggleTodo } from "../src/markdown/formatting"
import { range, substring } from "../src/text/range"

/**
 * Transcribed from `WriteMindTests/ListEditingTests.swift` (Mac 0fdd031): editing a checklist one item at a time
 * (Sean, 2026-09-21: "when modifying a checklist.. the checkboxes remain in tact and just the text part of the list
 * becomes editable, one at a time").
 */
const list = "- [x] done\n- [ ] not yet\n- [ ] nor this"
const reminders = (markdown: string): Reminder[] => remindersIn(range(0, markdown.length), markdown)
const words = (markdown: string): string[] => reminders(markdown).map((r) => substring(markdown, r.text))

describe("where the words are", () => {
  it("finds every item's words without its box", () => {
    expect(words(list)).toEqual(["done", "not yet", "nor this"])
    expect(reminders(list).map((r) => r.ticked)).toEqual([true, false, false])
  })

  it("keeps the box as the character a tick replaces", () => {
    for (const reminder of reminders(list)) {
      expect(list.slice(reminder.box, reminder.box + 1)).toBe(reminder.ticked ? "x" : " ")
    }
  })

  it("gives an empty item an empty range where its words would go", () => {
    const one = reminders("- [ ] ")
    expect(one).toHaveLength(1)
    expect(one[0]!.text).toEqual(range(6, 0))
    // And one with no space after the box at all.
    expect(reminders("- [ ]")[0]!.text.length).toBe(0)
  })

  it("keeps an indented item's indent out of the words", () => {
    expect(words("    - [ ] nested")).toEqual(["nested"])
    expect(reminders("    - [ ] nested")[0]!.text.location).toBe(10)
  })

  it("does not count lines that are not reminders", () => {
    // The tick counts task LINES; so does this, or the third item on screen would not be the third in the note.
    expect(words("- [ ] one\njust words\n- [x] two")).toEqual(["one", "two"])
    expect(reminders("- a bullet\n> a quote\nwords")).toEqual([])
  })

  it("finds an item again by the range of its words", () => {
    const second = reminders(list)[1]!
    expect(reminderForText(second.text, list)).toEqual(second)
    // A range that is not an item's words is not one.
    expect(reminderForText(range(second.text.location + 1, 3), list)).toBeNull()
  })

  it("finds the item below (the port's forward delete)", () => {
    const [first, second] = reminders(list)
    expect(nextReminder(first!.line, list)).toEqual(second)
    expect(nextReminder(reminders(list)[2]!.line, list)).toBeNull()
  })
})

describe("Return", () => {
  it("at the end of an item makes the next one", () => {
    const item = reminders(list)[0]!.text
    const split = splitReminder(list, item, "done", "")!
    expect(split.markdown).toBe("- [x] done\n- [ ] \n- [ ] not yet\n- [ ] nor this")
    // The new one is open, empty, and NOT ticked however the one it came from was.
    expect(split.editing.length).toBe(0)
    expect(words(split.markdown)).toEqual(["done", "", "not yet", "nor this"])
    expect(reminders(split.markdown).map((r) => r.ticked)).toEqual([true, false, false, false])
  })

  it("in the middle cuts the words in two", () => {
    const item = reminders(list)[1]!.text
    const split = splitReminder(list, item, "not", " yet")!
    expect(words(split.markdown)).toEqual(["done", "not", " yet", "nor this"])
    expect(substring(split.markdown, split.editing)).toBe(" yet") // the half that moved is the half that is open
  })

  it("keeps the marker the list is written with, and the indentation", () => {
    const starred = "* [ ] one"
    expect(splitReminder(starred, reminders(starred)[0]!.text, "one", "")?.markdown).toBe("* [ ] one\n* [ ] ")
    const nested = "    - [x] one"
    expect(splitReminder(nested, reminders(nested)[0]!.text, "one", "")?.markdown).toBe("    - [x] one\n    - [ ] ")
  })
})

describe("Backspace", () => {
  it("in an empty item takes it away and opens the one above at its end", () => {
    const note = "- [ ] one\n- [ ] \n- [ ] three"
    const gone = removeEmptyReminder(note, reminders(note)[1]!.text)!
    expect(gone.markdown).toBe("- [ ] one\n- [ ] three")
    expect(gone.editing).toEqual(range(9, 0))
    expect(gone.markdown.slice(0, 9)).toBe("- [ ] one")
  })

  it("in the first item of a list has nothing to go back to", () => {
    const note = "- [ ] \n- [ ] two"
    const gone = removeEmptyReminder(note, reminders(note)[0]!.text)!
    expect(gone.markdown).toBe("- [ ] two")
    expect(gone.editing).toBeNull() // the caller takes the cell away instead
  })

  it("at the start of words joins them to the item above", () => {
    const note = "- [ ] one\n- [ ] two"
    const second = reminders(note)[1]!.text
    const joined = joinPreviousReminder(note, range(second.location, 3))!
    expect(joined.markdown).toBe("- [ ] onetwo")
    expect(joined.editing).toEqual(range(9, 0)) // the caret sits at the seam
    expect(words(joined.markdown)).toEqual(["onetwo"])
  })

  it("has nothing to join to at the top of a list", () => {
    const note = "- [ ] one\n- [ ] two"
    expect(joinPreviousReminder(note, reminders(note)[0]!.text)).toBeNull()
    // Nor when the line above is not a reminder at all.
    const mixed = "Some prose\n\n- [ ] one"
    expect(joinPreviousReminder(mixed, reminders(mixed)[0]!.text)).toBeNull()
  })
})

describe("one walk", () => {
  it("lets the tick and the walk agree about every item", () => {
    for (const note of [list, "    - [ ] a\n    - [x] b", "- [ ] a\nnot one\n- [ ] b", "* [x] a\n+ [ ] b"]) {
      const found = remindersIn(range(0, note.length), note)
      found.forEach((reminder, index) => {
        const change = toggleTodo(note, range(0, note.length), index)
        expect(change, `no tick for item ${index} of ${JSON.stringify(note)}`).not.toBeNull()
        expect(change!.range).toEqual(range(reminder.box, 1))
      })
    }
  })

  it("makes a tick always one character for one", () => {
    for (let index = 0; index < 3; index++) {
      const change = toggleTodo(list, range(0, list.length), index)
      expect(change?.range.length).toBe(1)
      expect(change?.replacement.length).toBe(1)
    }
  })
})
