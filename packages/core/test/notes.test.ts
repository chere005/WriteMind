import { describe, expect, it } from "vitest"
import { makeNote, stem } from "../src/notes/note"
import { arrange, emptyOrder, forget, orderKey, setOrder } from "../src/notes/order"
import { mayWrite } from "../src/notes/writing"

/** Transcribed from `WriteMindTests/NoteTests.swift`. */
describe("a note's row", () => {
  const path = "/tmp/WriteMindTests/Ideas for spring.md"

  it("takes its title from the first heading", () => {
    const note = makeNote(path, 0, "\n\n## Garden plan\nbeds\nseeds\nthird")
    expect(note.title).toBe("Garden plan")
    expect(note.snippet).toBe("beds · seeds")
    expect(stem(path)).toBe("Ideas for spring")
  })

  it("falls back to the file name", () => {
    const note = makeNote(path, 0, "just prose")
    expect(note.title).toBe("Ideas for spring")
    expect(note.snippet).toBe("just prose")
  })

  it("drops inline markup from the snippet", () => {
    const note = makeNote(path, 0, "# T\n- **bold** and <u>under</u> `code`\n> quoted")
    expect(note.snippet).toBe("bold and under code · quoted")
  })

  it("drops the hashes from later headings too", () => {
    const note = makeNote(path, 0, "# T\n###### Sean Cheren\n## Next")
    expect(note.snippet).toBe("Sean Cheren · Next")
  })

  it("falls back to the file name for an empty heading", () => {
    expect(makeNote(path, 0, "#\n").title).toBe("Ideas for spring")
  })
})

/** Transcribed from `WriteMindTests/NoteWritingTests.swift`. */
describe("whether the open note may be written back", () => {
  it("owns a file nobody else has touched", () => {
    expect(mayWrite("hello", "hello")).toBe(true)
  })

  it("refuses a file somebody else has written", () => {
    expect(mayWrite("hello there", "hello")).toBe(false)
  })

  it("lets a new note save itself the first time", () => {
    expect(mayWrite(null, null)).toBe(true)
  })

  it("does not put a trashed file back", () => {
    expect(mayWrite(null, "hello")).toBe(false)
  })

  it("does not overwrite a file it has never read", () => {
    expect(mayWrite("somebody else's words", null)).toBe(false)
  })

  it("counts an empty file as a file it knows", () => {
    expect(mayWrite("", "")).toBe(true)
    expect(mayWrite("", "hello")).toBe(false)
  })
})

describe("the row order", () => {
  const root = "/notes"

  it("keys a folder by its path relative to the root", () => {
    expect(orderKey("/notes", root)).toBe("")
    expect(orderKey("/notes/Ideas", root)).toBe("Ideas")
    expect(orderKey("/notes/Ideas/2026", root)).toBe("Ideas/2026")
  })

  it("sorts the names it knows and leaves the rest at the end", () => {
    const order = setOrder(emptyOrder(), ["b.md", "a.md"], root, root)
    expect(arrange(order, ["a.md", "b.md", "new.md"], root, root)).toEqual(["b.md", "a.md", "new.md"])
  })

  it("forgets a name and drops the folder when nothing is left", () => {
    let order = setOrder(emptyOrder(), ["a.md"], root, root)
    order = forget(order, "a.md", root, root)
    expect(order.folders).toEqual({})
  })
})
