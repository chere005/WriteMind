/**
 * WHAT THIS BUILD CAN DO, in one place.
 *
 * The app runs on macOS, Windows and Linux, and it runs the same: the
 * notebook, the drawing layer, the camera, the ink lifted off the paper and
 * Export ▸ PDF are every platform's. What is NOT every platform's is the
 * one thing that needs a program the app did not write — reading
 * handwriting — and the honest question there is not "which system is
 * this" but "IS THE HELPER INSTALLED".
 *
 * So there is no table of operating systems here. There is one rule, asked
 * once, and the shell answers the helper part by looking for a file:
 * `wm-vision` (built by `tools/build-vision.sh`) on macOS, `tesseract`
 * anywhere. Nothing else in the app asks `process.platform`.
 *
 * The rule for a build that cannot do something: SAY NOTHING AND SHOW
 * NOTHING. A button that is there but dead, or a dialog explaining what
 * this build cannot do, is worse than an app that simply does not offer
 * it — it should look like it was written for the machine it is on. The
 * one exception is the camera's box, which is dragged by hand everywhere
 * until the page-finding lands, because that changes what the user does.
 */

/**
 * Which reader is behind `handwritingOCR`. "bundled" is the one shipped inside the app (PP-OCRv5 on onnxruntime's
 * WebAssembly build, docs/OCR-BUNDLED.md), used on every platform when its files are there.
 */
export type OcrEngine = "bundled" | "vision" | "windows" | "tesseract"

export interface Capabilities {
  /** Reading handwriting off a captured page into markdown. */
  handwritingOCR: boolean
  /**
   * WHICH reader: Vision on a Mac, `Windows.Media.Ocr` on Windows (nothing to
   * install for the user's own languages), tesseract if it is on the PATH.
   * Null when there is none.
   */
  ocrEngine: OcrEngine | null
  /** Whether that reader can read Japanese here (Windows needs its optional Japanese OCR capability). */
  japaneseOCR: boolean
  /**
   * Finding the page in the camera's view by itself. EVERYWHERE since
   * 2026-10-03: the Mac's Vision does it for the Mac app, and `findPage`
   * (capture/findPage.ts, plain arrays) does it on every platform, with the
   * perspective undone by `warpToPage` - so the page is found and squared up
   * with nothing installed.
   */
  findsThePage: boolean
  /** A camera at all. */
  camera: boolean
  /** Export ▸ PDF. Chromium prints the page, so everyone has it. */
  pdfExport: boolean
}

/** What the shell found on this machine. */
export interface Helpers {
  /** `wm-vision` on macOS, Windows' own OCR engine on Windows, `tesseract` anywhere. */
  ocr: boolean
  /** Which of them answered. */
  engine?: OcrEngine | null
  /** Whether the reader has Japanese. */
  japanese?: boolean
}

export function capabilitiesFor(_platform: string, helpers: Helpers = { ocr: false }): Capabilities {
  return {
    handwritingOCR: helpers.ocr,
    ocrEngine: helpers.ocr ? (helpers.engine ?? null) : null,
    japaneseOCR: helpers.ocr && helpers.japanese === true,
    findsThePage: true,
    camera: true,
    pdfExport: true,
  }
}

/** The app's own word for a platform, for the one place that shows it. */
export function platformName(platform: string): string {
  switch (platform) {
    case "darwin": return "macOS"
    case "win32": return "Windows"
    case "linux": return "Linux"
    default: return platform
  }
}
