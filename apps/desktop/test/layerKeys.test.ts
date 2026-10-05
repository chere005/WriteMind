import { describe, expect, it } from "vitest"
import { layerKey, type KeyFacts } from "../src/renderer/layerKeys"

/**
 * Whose key is it (Drawinglane-fix1)? The drawing layer watches keys the notebook also hears; every key it
 * takes it takes completely (the Mac's key monitor returns nil to swallow), and a key that works on the words
 * is the notebook's and ends the pick. The rule is pure so it is tested here; `e2e/suites/drawing/06-keys.mjs`
 * is the same rule with real key events in the real editor.
 */

const facts = (over: Partial<KeyFacts>): KeyFacts => ({
  key: "", ctrl: false, meta: false, alt: false, shift: false, altGraph: false, composing: false,
  inField: false, inSelect: false, inNotebook: true, picked: true, cropOpen: false, ...over,
})

describe("a picked object answers Backspace and Delete, and the note does not also lose a letter", () => {
  it("takes Backspace and Delete on their own", () => {
    expect(layerKey(facts({ key: "Backspace" }))).toEqual({ take: "delete" })
    expect(layerKey(facts({ key: "Delete" }))).toEqual({ take: "delete" })
  })

  it("takes them wherever the key landed that is not a field (a button, the page)", () => {
    expect(layerKey(facts({ key: "Backspace", inNotebook: false }))).toEqual({ take: "delete" })
  })

  it("leaves them to the note with nothing picked", () => {
    expect(layerKey(facts({ key: "Backspace", picked: false }))).toBeNull()
    expect(layerKey(facts({ key: "Delete", picked: false }))).toBeNull()
  })

  it("leaves them to a label, a text box or any input", () => {
    expect(layerKey(facts({ key: "Backspace", inField: true }))).toBeNull()
  })

  it("does not take Shift+Backspace or Ctrl+Backspace: those are the note's word-wise edits, and end the pick", () => {
    expect(layerKey(facts({ key: "Backspace", shift: true }))).toEqual({ take: "letGo" })
    expect(layerKey(facts({ key: "Backspace", ctrl: true }))).toEqual({ take: "letGo" })
    expect(layerKey(facts({ key: "Delete", alt: true }))).toEqual({ take: "letGo" })
  })
})

describe("a toolbar palette that kept the focus after a choice", () => {
  it("does not stop Backspace and Delete from taking the picked object", () => {
    expect(layerKey(facts({ key: "Backspace", inSelect: true, inNotebook: false }))).toEqual({ take: "delete" })
    expect(layerKey(facts({ key: "Delete", inSelect: true, inNotebook: false }))).toEqual({ take: "delete" })
  })

  it("keeps its arrows (they change its choice) and every other key", () => {
    expect(layerKey(facts({ key: "ArrowDown", inSelect: true, inNotebook: false }))).toBeNull()
    expect(layerKey(facts({ key: "c", ctrl: true, inSelect: true, inNotebook: false }))).toBeNull()
    expect(layerKey(facts({ key: "Backspace", inSelect: true, inNotebook: false, picked: false }))).toBeNull()
  })
})

describe("the arrows", () => {
  it("nudge one point, ten with Shift, only while something is picked and drawn", () => {
    expect(layerKey(facts({ key: "ArrowLeft" }))).toEqual({ take: "nudge", dx: -1, dy: 0 })
    expect(layerKey(facts({ key: "ArrowDown", shift: true }))).toEqual({ take: "nudge", dx: 0, dy: 10 })
    expect(layerKey(facts({ key: "ArrowRight", picked: false }))).toBeNull()
    expect(layerKey(facts({ key: "ArrowUp", inField: true }))).toBeNull()
  })

  it("are the caret's the moment they carry Ctrl or Alt", () => {
    expect(layerKey(facts({ key: "ArrowLeft", ctrl: true }))).toEqual({ take: "letGo" })
    expect(layerKey(facts({ key: "ArrowRight", alt: true }))).toEqual({ take: "letGo" })
  })

  it("do not nudge a picture whose crop box is up", () => {
    expect(layerKey(facts({ key: "ArrowLeft", cropOpen: true }))).toBeNull()
  })
})

describe("copy and cut", () => {
  it("are the objects' while they are picked", () => {
    expect(layerKey(facts({ key: "c", ctrl: true }))).toEqual({ take: "copy" })
    expect(layerKey(facts({ key: "X", meta: true }))).toEqual({ take: "cut" })
    expect(layerKey(facts({ key: "c", ctrl: true, shift: true }))).toBeNull()
    expect(layerKey(facts({ key: "c", ctrl: true, picked: false }))).toBeNull()
  })

  it("are the notebook's once the person selected the words: Ctrl+A ended the pick", () => {
    // The sequence of the report: click a shape, Ctrl+A in the note, Ctrl+X.
    expect(layerKey(facts({ key: "a", ctrl: true }))).toEqual({ take: "letGo" })
    expect(layerKey(facts({ key: "x", ctrl: true, picked: false }))).toBeNull()
  })
})

describe("a key that works on the words ends the pick", () => {
  it("is every letter, digit and space typed, Enter, Tab, Home / End / Page keys", () => {
    for (const key of ["t", "e", "h", "5", " ", "é", "Enter", "Tab", "Home", "End", "PageUp", "PageDown"]) {
      expect(layerKey(facts({ key }))).toEqual({ take: "letGo" })
    }
  })

  it("is a character typed with AltGr (Windows reports it as Ctrl+Alt)", () => {
    expect(layerKey(facts({ key: "@", ctrl: true, alt: true, altGraph: true }))).toEqual({ take: "letGo" })
  })

  it("is an input method at work", () => {
    expect(layerKey(facts({ key: "Process" }))).toEqual({ take: "letGo" })
    expect(layerKey(facts({ key: "k", composing: true }))).toEqual({ take: "letGo" })
  })

  it("is not the layer's business when the key landed outside the notebook", () => {
    expect(layerKey(facts({ key: "t", inNotebook: false }))).toBeNull()
    expect(layerKey(facts({ key: "Enter", inNotebook: false }))).toBeNull()
  })

  it("leaves the pick alone for commands and modifiers that edit nothing in the note", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta", "Escape", "F5", "CapsLock"]) {
      expect(layerKey(facts({ key }))).toBeNull()
    }
    expect(layerKey(facts({ key: "z", ctrl: true }))).toBeNull()
    expect(layerKey(facts({ key: "g", ctrl: true }))).toBeNull()
    expect(layerKey(facts({ key: "v", ctrl: true }))).toBeNull()
    expect(layerKey(facts({ key: "s", meta: true }))).toBeNull()
  })
})

describe("an open crop box", () => {
  it("is confirmed by Enter on its own, and Enter does not reach the note", () => {
    expect(layerKey(facts({ key: "Enter", cropOpen: true }))).toEqual({ take: "confirmCrop" })
    expect(layerKey(facts({ key: "Enter", cropOpen: true, picked: false }))).toEqual({ take: "confirmCrop" })
    expect(layerKey(facts({ key: "Enter", cropOpen: true, inNotebook: false }))).toEqual({ take: "confirmCrop" })
  })

  it("is not confirmed by Enter with a modifier, nor from inside a field", () => {
    expect(layerKey(facts({ key: "Enter", cropOpen: true, ctrl: true }))).toBeNull()
    expect(layerKey(facts({ key: "Enter", cropOpen: true, shift: true }))).toBeNull()
    expect(layerKey(facts({ key: "Enter", cropOpen: true, inField: true }))).toBeNull()
  })

  it("takes no other key (Backspace would otherwise delete the picture being cropped)", () => {
    expect(layerKey(facts({ key: "Backspace", cropOpen: true }))).toBeNull()
    expect(layerKey(facts({ key: "c", ctrl: true, cropOpen: true }))).toBeNull()
  })
})

describe("Ctrl+C / Ctrl+X with words selected in the note are the words' (Drawinglane-fix2)", () => {
  it("lets go of the pick and leaves the copy to the notebook", () => {
    expect(layerKey(facts({ key: "x", ctrl: true, textSelected: true }))).toEqual({ take: "letGo" })
    expect(layerKey(facts({ key: "c", ctrl: true, textSelected: true }))).toEqual({ take: "letGo" })
  })
  it("still copies and cuts the objects when only a caret is in the note", () => {
    expect(layerKey(facts({ key: "x", ctrl: true, textSelected: false }))).toEqual({ take: "cut" })
    expect(layerKey(facts({ key: "c", ctrl: true }))).toEqual({ take: "copy" })
  })
})
