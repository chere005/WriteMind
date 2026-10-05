import { describe, expect, it } from "vitest"
import { readDrawing } from "@writemind/core"
import { fromMacDrawing, pictureFiles } from "../src/main/macDrawing"

// The JSON below is what the Swift tests feed `JSONDecoder().decode(Drawing.self, …)`
// (CanvasGroupTests.swift `GroupCodingTests`, DrawingObjectTests.swift): the Mac's sidecar spelling.
const MAC_PLAIN = `{"items":[
  {"kind":"stroke","stroke":{"colorHex":"#2FBF71","width":2,"points":[[0.1,0.1],[0.2,0.2]]}},
  {"kind":"image","image":{"file":"a.png","width":0.3,"aspect":1}},
  {"kind":"shape","shape":{"kind":"rectangle","center":[0.5,0.5],"width":0.2,"aspect":0.6,
                           "colorHex":"#000000","lineWidth":2,"label":"hi"}}
]}`

const MAC_ANCHORED = `{"items": [
  {"kind": "stroke", "stroke": {"colorHex": "#F2542D", "width": 3,
                                "points": [[0.2, 0.3], [0.4, 0.5]], "anchor": 12}},
  {"kind": "image", "image": {"file": "page.jpg", "width": 0.5, "aspect": 1.5, "anchor": 12}},
  {"kind": "shape", "shape": {"kind": "rectangle", "colorHex": "#1C1C1E",
                              "width": 0.18, "aspect": 0.6, "lineWidth": 2,
                              "label": "Start", "anchor": 40}}
]}`

// A drawing as the Mac encodes one with ids, groups, a transform and a connector between two nodes.
const MAC_FULL = `{"items":[
  {"kind":"shape","shape":{"id":"11111111-1111-1111-1111-111111111111","kind":"oval","center":[0.25,0.5],"width":0.2,"aspect":0.6,
    "colorHex":"#000000","lineWidth":2,"label":"A","transform":{"dx":0.1,"dy":-0.2,"scale":1.4,"rotation":0.6}}},
  {"kind":"shape","shape":{"id":"22222222-2222-2222-2222-222222222222","kind":"diamond","center":[0.75,0.5],"width":0.2,"aspect":0.7,
    "colorHex":"#000000","lineWidth":2,"label":"B","group":"33333333-3333-3333-3333-333333333333"}},
  {"kind":"connector","connector":{"id":"44444444-4444-4444-4444-444444444444","start":[0.35,0.5],"end":[0.65,0.5],
    "startNode":"11111111-1111-1111-1111-111111111111","endNode":"22222222-2222-2222-2222-222222222222",
    "startHead":"arrow","endHead":"arrow","line":"dashed","colorHex":"#FF0000","lineWidth":3,
    "bends":[[0.5,0.4]],"overrides":[{"index":1,"vertical":true,"value":0.5}]}},
  {"kind":"stroke","stroke":{"id":"55555555-5555-5555-5555-555555555555","colorHex":"#2FBF71","width":6,
    "points":[[0.1,0.1],[0.3,0.3],[0.5,0.2]],"group":"33333333-3333-3333-3333-333333333333"}}
]}`

describe("a drawing the Mac wrote, read here", () => {
  it("turns the Mac's nested objects and [x, y] points into this app's, and the core reads them", () => {
    const drawing = readDrawing(fromMacDrawing(MAC_PLAIN))
    expect(drawing.items.map((item) => item.kind)).toEqual(["stroke", "image", "shape"])
    const [stroke, image, shape] = drawing.items
    expect(stroke).toMatchObject({ kind: "stroke", stroke: { colorHex: "#2FBF71", width: 2, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] } })
    expect(image).toMatchObject({ kind: "image", image: { file: "a.png", width: 0.3, aspect: 1 } })
    expect(shape).toMatchObject({ kind: "shape", shape: { kind: "rectangle", center: { x: 0.5, y: 0.5 }, label: "hi" } })
  })

  it("opens a sidecar that still carries anchors (the key nothing asks for)", () => {
    const drawing = readDrawing(fromMacDrawing(MAC_ANCHORED))
    expect(drawing.items).toHaveLength(3)
    expect(drawing.items[0]).toMatchObject({ stroke: { colorHex: "#F2542D", points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }] } })
    expect(drawing.items[1]).toMatchObject({ image: { file: "page.jpg", aspect: 1.5 } })
    expect(drawing.items[2]).toMatchObject({ shape: { kind: "rectangle", label: "Start" } })
  })

  it("keeps the ids, the groups, the transform, the connector's ends, bends and overrides", () => {
    const drawing = readDrawing(fromMacDrawing(MAC_FULL))
    expect(drawing.items).toHaveLength(4)
    const [oval, diamond, connector, stroke] = drawing.items
    expect(oval).toMatchObject({
      shape: { id: "11111111-1111-1111-1111-111111111111", kind: "oval", transform: { dx: 0.1, dy: -0.2, scale: 1.4, rotation: 0.6 } },
    })
    expect(diamond).toMatchObject({ shape: { kind: "diamond", group: "33333333-3333-3333-3333-333333333333" } })
    expect(connector).toMatchObject({
      connector: {
        start: { x: 0.35, y: 0.5 }, end: { x: 0.65, y: 0.5 },
        startNode: "11111111-1111-1111-1111-111111111111", endNode: "22222222-2222-2222-2222-222222222222",
        line: "dashed", endHead: "arrow", lineWidth: 3, bends: [{ x: 0.5, y: 0.4 }],
        overrides: [{ index: 1, vertical: true, value: 0.5 }],
      },
    })
    expect(stroke).toMatchObject({ stroke: { group: "33333333-3333-3333-3333-333333333333", points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }, { x: 0.5, y: 0.2 }] } })
  })

  it("reads the oldest Mac sidecars, a bare list of strokes", () => {
    const drawing = readDrawing(fromMacDrawing('{"strokes":[{"colorHex":"#000000","width":2,"points":[[0.1,0.2]]}]}'))
    expect(drawing.items).toHaveLength(1)
    expect(drawing.items[0]).toMatchObject({ stroke: { points: [{ x: 0.1, y: 0.2 }] } })
  })

  it("passes this app's own spelling through untouched, so a mixed file loses nothing", () => {
    const ours = JSON.stringify({ items: [{ kind: "stroke", id: "s1", colorHex: "#000000", width: 3, points: [{ x: 0.5, y: 0.5 }], pressures: [0.4] }] })
    const drawing = readDrawing(fromMacDrawing(ours))
    expect(drawing.items[0]).toMatchObject({ stroke: { id: "s1", points: [{ x: 0.5, y: 0.5 }], pressures: [0.4] } })
  })

  it("is null for text that is not a drawing at all", () => {
    expect(fromMacDrawing("not json")).toBeNull()
    expect(fromMacDrawing("[1,2]")).toBeNull()
    expect(readDrawing(fromMacDrawing("{}")).items).toEqual([])
  })

  it("names the pictures a sidecar uses, in either spelling", () => {
    expect(pictureFiles(MAC_PLAIN)).toEqual(["a.png"])
    expect(pictureFiles(MAC_ANCHORED)).toEqual(["page.jpg"])
    expect(pictureFiles(JSON.stringify({ items: [{ kind: "image", file: "flat.png" }, { kind: "stroke" }] }))).toEqual(["flat.png"])
    expect(pictureFiles("junk")).toEqual([])
  })
})
