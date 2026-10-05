/**
 * Real readings of real pictures, for the tests that must not depend on an OCR engine being on the machine.
 *
 * Each file in `fixtures/ocr/` is a picture drawn by Chromium (typed prose in some face, a tilted page, a page
 * with a pen line through a word...) and what Windows' own OCR engine (`Windows.Media.Ocr`, through
 * `apps/desktop/src/helpers/wm-ocr.ps1`) answered for it - every line and word box, the engine's `TextAngle` - plus
 * the grey picture the marks are read from, at the size the app reads it (`prepareForReading`). With those two the
 * rules that put a reading together (`composeLines`) can be run offline on exactly what the app is given.
 *
 * Not a test file: shared by ocrPictures.test.ts.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"
import { readingPageOf, type OcrReading, type ReadingPage } from "../src/capture/textRecognition"

export interface OcrFixture {
  name: string
  /** The mask-sized grey picture. */
  gray: Uint8Array
  width: number
  height: number
  reading: OcrReading
  page: ReadingPage
}

const folder = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ocr")

export function loadOcrFixture(name: string): OcrFixture {
  const file = JSON.parse(readFileSync(join(folder, `${name}.json`), "utf8")) as {
    mw: number; mh: number; gray: string; reading: OcrReading
  }
  const gray = new Uint8Array(inflateSync(Buffer.from(file.gray, "base64")))
  const page = readingPageOf(gray, file.mw, file.mh)
  if (!page) throw new Error(`fixture ${name} has no page`)
  return { name, gray, width: file.mw, height: file.mh, reading: file.reading, page }
}
