import { describe, expect, it } from "vitest"
import { keepUnknown } from "../src/drawing/keep"
import { rewriteLegacyText } from "../src/wm/legacy"
import {
  WmError, entriesToWrite, foldedName, newWmFile, openWm, stamped, utf8, writeNamesError, entryNameError, type WmEntry,
} from "../src/index"
import { emptyProjectData, parseProjectData, stringifyProjectData } from "../src/wm/projectFile"

// What three adversarial reviews found in the model's pure half (docs/SPEC-WM.md sections 1, 3.6, 4, 5.3): every test was
// seen to fail against the code it was written for.

const APP = { name: "WriteMind", version: "3.0.0" }
const NOW = new Date("2026-10-08T09:14:03Z")

describe("19. the text of a converted note is rewritten at the destination, as typed", () => {
  it("a new name that holds $&, $', $` or $$ is put in as it is (String.replace reads them)", () => {
    for (const name of ["R$&D", "a$'b", "x$`y", "m$$n"]) {
      const out = rewriteLegacyText(`[x](${name}.md) and [y](${name}.md#h)\n`, { link: (file) => (file === `${name}.md` ? `${name}.wm` : null) })
      expect(out, name).toBe(`[x](${name}.wm) and [y](${name}.wm#h)\n`)
    }
    // (and a name taken by another note, which is written percent-encoded)
    expect(rewriteLegacyText("[x](A.md)\n", { link: () => "A 2.wm" })).toBe("[x](A%202.wm)\n")
  })

  it("a destination in angle brackets may hold spaces: a link and a picture are both rewritten, as the page reads them", () => {
    expect(rewriteLegacyText("[x](<A b.md>) and [y](<Sub/A b.md#top> \"title\")\n", { link: () => "A b.wm" }))
      .toBe("[x](<A b.wm>) and [y](<Sub/A b.wm#top> \"title\")\n")
    expect(rewriteLegacyText("![](<.drawings/media/a b.png>)\n", {})).toBe("![](<media/a b.png>)\n")
    expect(rewriteLegacyText("![](<../.drawings/media/a b.png>)\n", { renamed: new Map([["a b.png", "a b-2.png"]]) }))
      .toBe("![](<media/a%20b-2.png>)\n")
    // A picture that is nowhere stays as it was written.
    expect(rewriteLegacyText("![](<.drawings/media/a b.png>)\n", { missing: new Set(["a b.png"]) })).toBe("![](<.drawings/media/a b.png>)\n")
  })

  it("a picture inside a link's text is a picture: [![alt](pic)](https://…) is rewritten and its address is not touched", () => {
    expect(rewriteLegacyText("[![i](.drawings/media/x.png)](https://example.com/B.md)\n", { link: () => "B.wm" }))
      .toBe("[![i](media/x.png)](https://example.com/B.md)\n")
    expect(rewriteLegacyText("[![i](.drawings/media/x.png) words](B.md)\n", { link: () => "B.wm" }))
      .toBe("[![i](media/x.png) words](B.wm)\n")
    // Plain pictures and links are as before.
    expect(rewriteLegacyText("![a](.drawings/media/p.png) [b](B.md#x)\n", { link: () => "B.wm" })).toBe("![a](media/p.png) [b](B.wm#x)\n")
  })
})

describe("21. names that differ only by case, as the file systems fold it", () => {
  it("final sigma and sigma, long s and s: one name to NTFS and APFS", () => {
    expect(foldedName("media/ς.png")).toBe(foldedName("media/σ.png"))
    expect(foldedName("media/ſ.png")).toBe(foldedName("media/s.png"))
    expect(foldedName("media/É.png")).toBe(foldedName("media/é.png".replace("é", "é")))
    expect(foldedName("media/a.png")).not.toBe(foldedName("media/b.png"))
    expect(writeNamesError(["mimetype", "manifest.json", "media/ς.png", "media/σ.png"])).toMatch(/differ only by case/)
    expect(writeNamesError(["mimetype", "manifest.json", "media/s.png", "media/ſ.png"])).toMatch(/differ only by case/)
    expect(writeNamesError(["mimetype", "manifest.json", "media/σ.png", "media/ς2.png"])).toBeNull()
  })
})

describe("23. the manifest id and the name's byte-order mark", () => {
  it("an upper-case id that is a valid UUID is the same id in lower case, not a new one", () => {
    const manifest = newWmFile(NOW, APP, "x").manifest
    const upper = "0B6F5C1E-8D4A-5C0E-9A77-2F1D3B6A9E10"
    expect(stamped({ ...manifest, id: upper }, NOW, APP).id).toBe(upper.toLowerCase())
    expect(stamped({ ...manifest, id: "not an id" }, NOW, APP).id).toMatch(/^[0-9a-f]{8}-/)
    expect(stamped({ ...manifest, id: "not an id" }, NOW, APP).id).not.toBe("not an id")
  })

  it("a name with a byte-order mark in it is refused (a reader that strips it would read another name)", () => {
    expect(entryNameError("﻿note.mdwm")).toMatch(/control character/)
    expect(entryNameError("media/a﻿.png")).toMatch(/control character/)
  })
})

describe("22 and 23. a note that reads but cannot be written back opens read-only, with the reason, and nothing ever writes it", () => {
  const file = (extra: WmEntry[], text = "# T\n") => {
    const made = entriesToWrite(newWmFile(NOW, APP, text), null).entries
    return [...made, ...extra]
  }

  it("invalid UTF-8 in note.mdwm or drawing.json: shown lossily, never written back lossily", () => {
    const bad = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a])
    const text = openWm(file([]).map((entry) => (entry.name === "note.mdwm" ? { name: entry.name, data: bad } : entry)))
    expect(text.readOnly).toBe(true)
    expect(text.readOnlyWhy).toMatch(/note\.mdwm is not valid UTF-8/)
    expect(() => entriesToWrite(text, null)).toThrow(/note\.mdwm is not valid UTF-8/)
    const drawing = openWm(file([{ name: "drawing.json", data: bad }]))
    expect(drawing.readOnly).toBe(true)
    expect(drawing.readOnlyWhy).toMatch(/drawing\.json is not valid UTF-8/)
    // A note whose words and drawing are UTF-8 is as writable as ever.
    expect(openWm(file([{ name: "drawing.json", data: utf8("{\"items\":[]}") }])).readOnly).toBe(false)
  })

  it("media/A.png beside media/a.png, or a Manifest.json beside manifest.json: opens, read-only, instead of failing every save", () => {
    const twins = openWm(file([{ name: "media/A.png", data: new Uint8Array([1]) }, { name: "media/a.png", data: new Uint8Array([2]) }]))
    expect(twins.readOnly).toBe(true)
    expect(twins.readOnlyWhy).toMatch(/differ only by case/)
    expect(twins.entries.map((entry) => entry.name)).toContain("media/A.png")
    expect(() => entriesToWrite(twins, null)).toThrow(WmError)
    const stray = openWm(file([{ name: "Manifest.json", data: utf8("{}") }]))
    expect(stray.readOnly).toBe(true)
    expect(stray.readOnlyWhy).toMatch(/differ only by case/)
  })

  it("a newer version is read-only as before, with its own reason", () => {
    const entries = file([]).map((entry) => (entry.name === "manifest.json"
      ? { name: entry.name, data: utf8(JSON.stringify({ format: "writemind-note", version: 2 })) } : entry))
    const newer = openWm(entries)
    expect(newer).toMatchObject({ readOnly: true, readOnlyWhy: "a newer WriteMind wrote this note", version: 2 })
    expect(() => entriesToWrite(newer, null)).toThrow(/newer WriteMind wrote this note, so it is open read-only/)
  })
})

describe("18. unknown keys with the names of Object.prototype's members are kept", () => {
  const names = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]

  it("a drawing: top-level keys and an item's fields come back as they were", () => {
    const before = JSON.parse(`{"items":[{"kind":"stroke","id":"a","points":[{"x":0,"y":0}],`
      + names.map((name) => `"${name}":{"v":"item ${name}"}`).join(",") + `}],`
      + names.map((name) => `"${name}":{"v":"top ${name}"}`).join(",") + `}`)
    const next = JSON.stringify({ items: [{ kind: "stroke", id: "a", points: [{ x: 0, y: 0 }] }] })
    const kept = JSON.parse(keepUnknown(JSON.stringify(before), next)) as Record<string, unknown> & { items: Record<string, unknown>[] }
    for (const name of names) {
      expect(Object.hasOwn(kept, name), `top ${name}`).toBe(true)
      expect(Object.getOwnPropertyDescriptor(kept, name)!.value).toEqual({ v: `top ${name}` })
      expect(Object.hasOwn(kept.items[0]!, name), `item ${name}`).toBe(true)
      expect(Object.getOwnPropertyDescriptor(kept.items[0]!, name)!.value).toEqual({ v: `item ${name}` })
    }
  })

  it("a project file: an unknown key named __proto__ (or constructor) is written back", () => {
    const text = `{"version":1,"folders":[],"excluded":[],"files":[],"__proto__":{"a":1},"constructor":"c","x-future":2}`
    const parsed = parseProjectData(text)!
    expect(Object.keys(parsed.extra).sort()).toEqual(["__proto__", "constructor", "x-future"])
    const written = stringifyProjectData(parsed)
    expect(written).toContain(`"__proto__" : {`)
    expect(written).toContain(`"constructor" : "c"`)
    expect(Object.keys(JSON.parse(written) as object).sort()).toEqual(["__proto__", "constructor", "excluded", "files", "folders", "version", "x-future"])
    void emptyProjectData
  })
})
