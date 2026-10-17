import { describe, expect, it } from "vitest"
import { keyboardElsewhere, openTakesKeyboard } from "../src/renderer/focusReturn"

/**
 * Who gets the keyboard when a note comes to the front (focusReturn.ts `openTakesKeyboard`). The race itself — the launch's
 * note opening while a search is typed, the note in front leaving the folder between two letters — is e2e sidebar/05.
 */

/** An element of the page as these rules read it: what it sits inside (`closest`), and whether it is contenteditable. */
const element = (inside: string[], editable = false): Element => ({
  closest: (selectors: string) => (selectors.split(",").some((one) => inside.includes(one.trim())) ? element(inside, editable) : null),
  isContentEditable: editable,
}) as unknown as Element

const body = element([])
const notes = element([".cm-content"], true)
const search = element(["input", ".sidebar"])
const findField = element(["input", ".float-cards"])
const dialogButton = element(["button", ".modal"])
const menuRow = element(["button", ".float-menu"])
const sidebarRow = element(["button", ".sidebar"])
const editableLabel = element([], true)

describe("something other than the notebook is meant to have the keyboard", () => {
  it("a field typed into: the sidebar's search, the Find card, a contenteditable that is not the notebook", () => {
    expect(keyboardElsewhere(search)).toBe(true)
    expect(keyboardElsewhere(findField)).toBe(true)
    expect(keyboardElsewhere(editableLabel)).toBe(true)
  })
  it("a popup that is up: a dialog, a menu", () => {
    expect(keyboardElsewhere(dialogButton)).toBe(true)
    expect(keyboardElsewhere(menuRow)).toBe(true)
  })
  it("not the notebook itself, nothing at all, or a button in the chrome (a click there hands the keyboard back)", () => {
    expect(keyboardElsewhere(notes)).toBe(false)
    expect(keyboardElsewhere(body)).toBe(false)
    expect(keyboardElsewhere(null)).toBe(false)
    expect(keyboardElsewhere(sidebarRow)).toBe(false)
  })
})

describe("a note that comes to the front takes the keyboard", () => {
  it("always, when the person opened it — even from the search field or a dialog (Enter on a result, a row, a tab)", () => {
    for (const active of [body, notes, search, findField, dialogButton, menuRow, null]) expect(openTakesKeyboard(false, active)).toBe(true)
  })
  it("when the app opened it by itself (a launch, the note in front gone), only if nothing else is meant to have it", () => {
    expect(openTakesKeyboard(true, body)).toBe(true)
    expect(openTakesKeyboard(true, null)).toBe(true)
    expect(openTakesKeyboard(true, sidebarRow)).toBe(true)
    // The Windows runner, 2026-10-17: the launch's note opened after "u" of "unique-token-2999" and took the rest.
    expect(openTakesKeyboard(true, search)).toBe(false)
    expect(openTakesKeyboard(true, findField)).toBe(false)
    expect(openTakesKeyboard(true, dialogButton)).toBe(false)
    expect(openTakesKeyboard(true, menuRow)).toBe(false)
  })
})
