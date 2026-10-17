/**
 * The script inside WriteMind's Quick Look extension (apps/desktop/quicklook, docs/FEATURES.md "Quick Look"): the core's
 * own page renderer, bundled by apps/desktop/scripts/build-quicklook.mjs into one classic script that the extension
 * evaluates in a JavaScriptCore context. It defines one global, `WriteMindPreview`, and the Swift side calls it with
 * JSON strings both ways (`render`), so nothing crosses the bridge but text.
 *
 * Everything the page IS lives in the core (`renderQuickLook`, packages/core/src/export/quickLook.ts) with its tests;
 * this file only hands it over.
 */

import "./environment"
import { previewMessageHtml, previewNamesRefusal, renderQuickLook, type QuickLookInput } from "../../../../packages/core/src/export/quickLook"

export interface PreviewApi {
  /** `QuickLookInput` as JSON in; `QuickLookPage` as JSON out. Never throws. */
  render(input: string): string
  /** Why these entry names (a JSON array) make the note one that cannot be shown, or null. Asked before anything is unpacked. */
  refusal(names: string): string | null
  /** A page that says `message`. */
  message(message: string): string
}

export const api: PreviewApi = {
  render(input) {
    let parsed: QuickLookInput
    try { parsed = JSON.parse(input) as QuickLookInput } catch {
      return JSON.stringify({ html: previewMessageHtml("This note could not be shown."), attachments: [], cut: false, message: true })
    }
    return JSON.stringify(renderQuickLook(parsed))
  },
  refusal(names) {
    try {
      const list = JSON.parse(names) as unknown
      if (!Array.isArray(list) || !list.every((one) => typeof one === "string")) return "This note cannot be shown."
      return previewNamesRefusal(list as string[])
    } catch {
      return "This note cannot be shown."
    }
  },
  message: (message) => previewMessageHtml(message),
}

;(globalThis as unknown as { WriteMindPreview: PreviewApi }).WriteMindPreview = api
