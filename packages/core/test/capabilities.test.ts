import { describe, expect, it } from "vitest"
import { capabilitiesFor, platformName } from "../src/platform/capabilities"

/**
 * WHAT A BUILD CAN DO IS WHAT IS INSTALLED, not which operating system it
 * is on. Every platform runs the notebook, the drawing layer and the
 * camera; the only thing any of them has to ask about is the helper that
 * reads handwriting, and the answer is whether that helper is there.
 */
describe("what this build can do", () => {
  const platforms = ["darwin", "linux", "win32"]

  it("gives every platform the notebook, the camera and the PDF", () => {
    for (const platform of platforms) {
      const able = capabilitiesFor(platform, { ocr: false })
      expect(able.camera).toBe(true)
      expect(able.pdfExport).toBe(true)
    }
  })

  it("makes reading handwriting a question about the helper, not the system", () => {
    for (const platform of platforms) {
      expect(capabilitiesFor(platform, { ocr: false }).handwritingOCR).toBe(false)
      expect(capabilitiesFor(platform, { ocr: true }).handwritingOCR).toBe(true)
    }
  })

  it("finds the page by itself nowhere yet, whatever is installed", () => {
    for (const platform of platforms) {
      expect(capabilitiesFor(platform, { ocr: true }).findsThePage).toBe(false)
    }
  })

  it("names the platform the way the app says it", () => {
    expect(platformName("darwin")).toBe("macOS")
    expect(platformName("linux")).toBe("Linux")
    expect(platformName("win32")).toBe("Windows")
    expect(platformName("freebsd")).toBe("freebsd")
  })
})
