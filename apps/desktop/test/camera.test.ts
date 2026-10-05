import { beforeEach, describe, expect, it } from "vitest"
import { describeCameraError, idleProblem, unpluggedProblem } from "../src/renderer/cameraDevices"
import {
  normalRotation, rememberedRotation, rememberedShape, rememberedZoom, rememberRotation, rememberShape, rememberZoom,
} from "../src/renderer/cameraSettings"

/**
 * No Swift original (the Mac's pane shows four stand-ins and knows its own errors); these are the port's
 * mapping from a browser's camera errors to the same stand-ins, and the small memory the pane keeps.
 */

describe("what a camera error says", () => {
  it("access refused is 'Camera access is off', and says where Windows keeps the switch", () => {
    const refused = describeCameraError({ name: "NotAllowedError", message: "Permission denied" }, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    expect(refused.kind).toBe("denied")
    expect(refused.title).toBe("Camera access is off")
    expect(refused.detail).toMatch(/Settings . Privacy . Camera/)
    const system = describeCameraError({ name: "NotAllowedError", message: "Permission denied by system" }, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    expect(system.detail).toMatch(/Windows is blocking the camera/)
    // On a Mac it is the Mac's own wording; elsewhere, no promise about where the switch is.
    expect(describeCameraError({ name: "NotAllowedError" }, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)").detail).toMatch(/System Settings . Privacy & Security . Camera/)
    expect(describeCameraError({ name: "NotAllowedError" }, "Mozilla/5.0 (X11; Linux x86_64)").detail).toMatch(/permission settings/)
    expect(describeCameraError({ name: "SecurityError" }).kind).toBe("denied")
  })

  it("a camera another program holds is 'busy', one that is not there 'No camera found'", () => {
    expect(describeCameraError({ name: "NotReadableError" }).title).toBe("The camera is busy")
    expect(describeCameraError({ name: "TrackStartError" }).kind).toBe("busy")
    expect(describeCameraError({ name: "NotFoundError" }).title).toBe("No camera found")
    expect(describeCameraError({ name: "DevicesNotFoundError" }).kind).toBe("missing")
  })

  it("a remembered camera that has gone is said to be gone (its id no longer satisfies the constraint)", () => {
    const gone = describeCameraError({ name: "OverconstrainedError", message: "deviceId" })
    expect(gone.kind).toBe("gone")
    expect(gone.title).toBe("That camera is no longer available")
  })

  it("anything else keeps the engine's own words, and an empty error still says something", () => {
    expect(describeCameraError(new Error("Could not start video source"))).toMatchObject({
      kind: "other", title: "Camera unavailable", detail: "Could not start video source",
    })
    expect(describeCameraError(null).detail).toBe("The camera could not be started.")
    expect(describeCameraError("plain text").detail).toBe("plain text")
  })

  it("the placeholders for no camera selected and for an unplugged one", () => {
    expect(idleProblem().title).toBe("No camera selected")
    expect(idleProblem().detail).toMatch(/Input Devices/)
    expect(unpluggedProblem().kind).toBe("unplugged")
  })
})

describe("what the pane remembers", () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    }
  })

  it("only quarter turns, and only clockwise degrees in 0, 90, 180, 270", () => {
    expect(normalRotation(90)).toBe(90)
    expect(normalRotation(-90)).toBe(270)
    expect(normalRotation(360)).toBe(0)
    expect(normalRotation(450)).toBe(90)
    expect(normalRotation(7)).toBe(0)       // seven degrees off is a mistake, not a choice
    expect(normalRotation(100)).toBe(90)
  })

  it("the turn survives, and a damaged one reads as none", () => {
    expect(rememberedRotation()).toBe(0)
    rememberRotation(270)
    expect(rememberedRotation()).toBe(270)
    store.set("writemind.cameraRotation", "\"sideways\"")
    expect(rememberedRotation()).toBe(0)
    store.set("writemind.cameraRotation", "not json")
    expect(rememberedRotation()).toBe(0)
  })

  it("the notebook's page shape is kept only when it is a shape (long over short, at least 1)", () => {
    expect(rememberedShape()).toBeNull()
    rememberShape(1.414)
    expect(rememberedShape()).toBeCloseTo(1.414, 3)
    store.set("writemind.notebookPageShape", "0.5")
    expect(rememberedShape()).toBeNull()
  })

  it("the zoom box is kept as four numbers, or not at all", () => {
    expect(rememberedZoom()).toBeNull()
    rememberZoom({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
    expect(rememberedZoom()).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
    rememberZoom(null)
    expect(rememberedZoom()).toBeNull()
    store.set("writemind.cameraZoom", JSON.stringify({ x: 0.1, y: "no" }))
    expect(rememberedZoom()).toBeNull()
  })

  it("works without storage at all (a private window)", () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") },
    }
    expect(rememberedRotation()).toBe(0)
    expect(() => rememberRotation(90)).not.toThrow()
    expect(rememberedShape()).toBeNull()
  })
})
