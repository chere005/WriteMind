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

export interface Capabilities {
  /** Reading handwriting off a captured page into markdown. */
  handwritingOCR: boolean
  /**
   * Finding the page in the camera's view by itself. Nowhere yet: the
   * macOS helper answers the question, but nothing undoes the perspective
   * with the answer, so the box is dragged by hand on every platform.
   */
  findsThePage: boolean
  /** A camera at all. */
  camera: boolean
  /** Export ▸ PDF. Chromium prints the page, so everyone has it. */
  pdfExport: boolean
}

/** What the shell found on this machine. */
export interface Helpers {
  /** `wm-vision` on macOS, `tesseract` anywhere. */
  ocr: boolean
}

export function capabilitiesFor(_platform: string, helpers: Helpers = { ocr: false }): Capabilities {
  return {
    handwritingOCR: helpers.ocr,
    findsThePage: false,
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
