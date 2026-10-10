/**
 * WHAT THIS BUILD CAN DO, in one place.
 *
 * The app runs on macOS, Windows and Linux, and it runs the same: the
 * notebook, the drawing layer, the camera, the ink lifted off the paper,
 * reading handwriting and Export ▸ PDF are every platform's. Reading is ONE
 * engine everywhere (the reader bundled in the app, docs/OCR-BUNDLED.md), so
 * the only question left is not "which system is this" but "ARE ITS FILES
 * THERE": a build made offline without the models has no reader.
 *
 * So there is no table of operating systems here. There is one rule, asked
 * once, and the shell answers the helper part by looking for a file (the
 * reader's folder, main/helpers.ts `canRead`). With none there is no
 * handwriting reading and nothing is shown for it (no Aa on a picture, no
 * Text in the camera's box). Nothing else in the app asks `process.platform`.
 *
 * The rule for a build that cannot do something: SAY NOTHING AND SHOW
 * NOTHING. A button that is there but dead, or a dialog explaining what
 * this build cannot do, is worse than an app that simply does not offer
 * it — it should look like it was written for the machine it is on. The
 * one exception is the camera's box, which is dragged by hand everywhere
 * until the page-finding lands, because that changes what the user does.
 *
 * The one OS fact here is the name the OS gives a clipboard type
 * (`wolframClipboard`): not a capability but a spelling, spelled once.
 */

import { wolframClipboardFor, type WolframClipboard } from "../export/wolfram/clipboard"

export interface Capabilities {
  /**
   * Reading handwriting (and print, English and Japanese) off a picture into markdown: the bundled reader, the same
   * on every platform, true when its files are beside the app.
   */
  handwritingOCR: boolean
  /**
   * Finding the page in the camera's view by itself. EVERYWHERE since
   * 2026-10-03: `findPage` (capture/findPage.ts, plain arrays) does it, with the
   * perspective undone by `warpToPage` - so the page is found and squared up
   * with nothing installed.
   */
  findsThePage: boolean
  /** A camera at all. */
  camera: boolean
  /** Export ▸ PDF. Chromium prints the page, so everyone has it. */
  pdfExport: boolean
  /**
   * File ▸ Language Setup…'s Install Python… and Install Wolfram Engine… (port-only): the installer's own
   * `installer-tools.ps1` shipped beside the app AND winget on this machine, because winget is what installs. Where
   * either is missing the screen offers Get Python… / Get Wolfram Engine… (the download page) instead.
   */
  installsLanguages: boolean
  /** Its Activate… for the Wolfram Engine: the same script (it opens the engine's own sign-in), winget or not. */
  activatesWolfram: boolean
  /**
   * The raw clipboard types a drawing cell copied into Mathematica goes under (port-only, export/wolfram/clipboard.ts):
   * the front end's own cells (null where its name is not known) and the PNG (null: the standard `image/png`).
   */
  wolframClipboard: WolframClipboard
}

/** What the shell found on this machine. */
export interface Helpers {
  /** The bundled reader's files are beside the app. */
  ocr: boolean
  /** Language Setup's helpers (main/helpers.ts `toolsScript`, `winget`): the shipped script, and winget. */
  languageSetup?: { script: boolean; winget: boolean }
}

export function capabilitiesFor(platform: string, helpers: Helpers = { ocr: false }): Capabilities {
  const setup = helpers.languageSetup
  return {
    wolframClipboard: wolframClipboardFor(platform),
    handwritingOCR: helpers.ocr,
    findsThePage: true,
    camera: true,
    pdfExport: true,
    installsLanguages: setup?.script === true && setup.winget === true,
    activatesWolfram: setup?.script === true,
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
