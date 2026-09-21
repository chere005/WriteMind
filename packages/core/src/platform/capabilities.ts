/**
 * WHAT THIS PLATFORM CAN DO, in one place.
 *
 * The app runs on macOS and on Windows, and three of its features lean on
 * frameworks only one of them has. Every one of those is asked for HERE,
 * once, by name — never `process.platform === "darwin"` at the point of use,
 * which is how a port ends up with the same question answered differently in
 * nine places.
 *
 * The rule for the side that cannot do it: SAY NOTHING AND SHOW NOTHING. A
 * button that is there but dead, or a dialog that explains what this build
 * cannot do, is worse than an app that simply does not offer it — the app
 * should look like it was written for the machine it is on. Only the ONE
 * place where the absence changes what the user has to do says so, in a
 * line: the camera's box, which is dragged by hand where the Mac finds the
 * page itself.
 */

export interface Capabilities {
  /**
   * Reading handwriting off a captured page (Vision on macOS). Nothing in a
   * browser is good enough at handwriting to be worth offering, so on
   * Windows the words stay a picture.
   */
  handwritingOCR: boolean
  /**
   * Finding the page in the camera's view by itself (Vision's document
   * segmentation). Without it the box is dragged by hand — which the app
   * has always supported, and which is the one absence the user is told
   * about, because it changes what they do.
   */
  findsThePage: boolean
  /** A camera at all. */
  camera: boolean
  /** Export ▸ PDF. Both platforms have it: the page is printed by Chromium. */
  pdfExport: boolean
}

export const macCapabilities: Capabilities = {
  handwritingOCR: true,
  findsThePage: true,
  camera: true,
  pdfExport: true,
}

export const windowsCapabilities: Capabilities = {
  handwritingOCR: false,
  findsThePage: false,
  camera: true,
  pdfExport: true,
}

/** What the platform string Node reports means here. */
export function capabilitiesFor(platform: string): Capabilities {
  switch (platform) {
    case "darwin": return macCapabilities
    // Linux gets what Windows gets: the pure pipeline, no Vision.
    default: return windowsCapabilities
  }
}
