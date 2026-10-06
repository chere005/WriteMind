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

  it("says which reader is behind the capability, and whether it has Japanese", () => {
    const windows = capabilitiesFor("win32", { ocr: true, engine: "windows", japanese: false })
    expect(windows.ocrEngine).toBe("windows")
    expect(windows.japaneseOCR).toBe(false)
    expect(capabilitiesFor("win32", { ocr: true, engine: "windows", japanese: true }).japaneseOCR).toBe(true)
    // No reader: no engine, and no Japanese however the helper was asked.
    const none = capabilitiesFor("win32", { ocr: false, engine: "windows", japanese: true })
    expect(none.ocrEngine).toBeNull()
    expect(none.japaneseOCR).toBe(false)
  })

  // CHANGED 2026-10-03 (it was "finds the page by itself nowhere yet"): the port's own page finder
  // (capture/findPage.ts) does it in plain arrays, so it is true on every platform and needs nothing installed.
  it("finds the page by itself everywhere, whatever is installed", () => {
    for (const platform of platforms) {
      expect(capabilitiesFor(platform, { ocr: true }).findsThePage).toBe(true)
      expect(capabilitiesFor(platform, { ocr: false }).findsThePage).toBe(true)
    }
  })

  // Port-only: File ▸ Language Setup…'s Install and Activate buttons. Off unless the shell found what does the work.
  it("installs languages only with the shipped script AND winget, and activates Wolfram with the script alone", () => {
    for (const platform of platforms) {
      const none = capabilitiesFor(platform, { ocr: false })
      expect(none.installsLanguages).toBe(false)
      expect(none.activatesWolfram).toBe(false)
    }
    const both = capabilitiesFor("win32", { ocr: false, languageSetup: { script: true, winget: true } })
    expect([both.installsLanguages, both.activatesWolfram]).toEqual([true, true])
    const noWinget = capabilitiesFor("win32", { ocr: false, languageSetup: { script: true, winget: false } })
    expect([noWinget.installsLanguages, noWinget.activatesWolfram]).toEqual([false, true])
    const noScript = capabilitiesFor("win32", { ocr: false, languageSetup: { script: false, winget: true } })
    expect([noScript.installsLanguages, noScript.activatesWolfram]).toEqual([false, false])
  })

  it("names the platform the way the app says it", () => {
    expect(platformName("darwin")).toBe("macOS")
    expect(platformName("linux")).toBe("Linux")
    expect(platformName("win32")).toBe("Windows")
    expect(platformName("freebsd")).toBe("freebsd")
  })
})
