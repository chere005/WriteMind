/**
 * Help ▸ About WriteMind (AboutDialog.tsx, main/about.ts): what the dialog shows, and the two questions the page may
 * ask the main process. Port-only; the Mac's About was Apple's panel.
 *
 * WHAT IT SHOWS comes from `notices.json`, which the build writes beside the main bundle (apps/desktop/scripts/
 * build.mjs, from tools/gen-notices.mjs - the generator that also writes THIRD-PARTY-NOTICES.md, so the dialog and the
 * file are one list): the app's licence, the Wolfram statement, and every library that ships with its licence text.
 * The page never names a file or a URL: it asks for the information, and asks for the project page to be opened.
 */

export const ABOUT_CHANNELS = {
  info: "about:info",
  openProject: "about:openProject",
} as const

/** One thing that ships, with the text of its licence. */
export interface AboutLibrary {
  name: string
  version: string
  license: string
  copyright: string
  url: string
  /** The full licence text (or, for Chromium, where its licences are). */
  text: string
  /** A line about the text, when it is not the package's own file. */
  note?: string
}

export interface AboutInfo {
  name: string
  /** The running app's version (`app.getVersion()`), not the build file's. */
  version: string
  /** The licence's SPDX name. */
  license: string
  /** "Copyright (c) 2026, Shahean Cheren". */
  copyright: string
  /** The project page: what the Project page button opens. */
  url: string
  /** WriteMind's own licence, in full. */
  licenseText: string
  wolfram: { short: string; full: string[] }
  libraries: AboutLibrary[]
  /** True when the build has no notices.json: the list is empty and the dialog says where the file is. */
  missing?: boolean
}

export interface AboutApi {
  info(): Promise<AboutInfo>
  /** Open the project page in the browser. */
  openProject(): Promise<void>
}

/** What the dialog says when a build has no list. */
export const NOTICES_MISSING = "The list of libraries is not part of this build. THIRD-PARTY-NOTICES.md, beside the app, has it."

/** Part of what an About dialog always says, for a build that has no notices.json at all. */
export const ABOUT_FALLBACK = {
  license: "BSD-3-Clause",
  copyright: "Copyright (c) 2026, Shahean Cheren",
  url: "https://github.com/chere005/WriteMind",
}

const isString = (value: unknown): value is string => typeof value === "string"
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** One library as read from the file, or null when it is not one. */
function library(raw: unknown): AboutLibrary | null {
  if (!isRecord(raw)) return null
  const { name, version, license, copyright, url, text, note } = raw
  if (![name, version, license, copyright, url, text].every(isString)) return null
  return {
    name: name as string, version: version as string, license: license as string, copyright: copyright as string,
    url: url as string, text: text as string, ...(isString(note) ? { note } : {}),
  }
}

/**
 * The parsed notices.json as the dialog's information, or null when it is not a notices file. Anything in it that is
 * not the right shape is dropped rather than shown: the file is the build's own, but it is read as data.
 */
export function aboutFromNotices(raw: unknown, version: string): AboutInfo | null {
  if (!isRecord(raw) || !isRecord(raw.app) || !isRecord(raw.wolfram) || !Array.isArray(raw.libraries)) return null
  const { app, wolfram } = raw
  if (![app.license, app.copyright, app.url, app.text].every(isString)) return null
  if (!isString(wolfram.short) || !Array.isArray(wolfram.full) || !wolfram.full.every(isString)) return null
  return {
    name: "WriteMind", version, license: app.license as string, copyright: app.copyright as string, url: app.url as string,
    licenseText: app.text as string,
    wolfram: { short: wolfram.short, full: wolfram.full as string[] },
    libraries: raw.libraries.map(library).filter((one): one is AboutLibrary => one !== null),
  }
}

/** What a build without a usable notices.json shows: the app's own line, and nothing invented about anyone else. */
export function aboutMissing(version: string): AboutInfo {
  return {
    name: "WriteMind", version, ...ABOUT_FALLBACK, licenseText: "", wolfram: { short: "", full: [] }, libraries: [], missing: true,
  }
}
