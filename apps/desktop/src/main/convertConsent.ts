/**
 * THE PERSON'S YES, PER FOLDER (convert.ts `confirm`). The notes root converts without asking; any other folder of a
 * project (one somebody added: a vault, a shared drive, a folder of somebody else's markdown) is rearranged only after
 * the person has said yes to THAT folder once. The answer, either way, is remembered in the user-data folder
 * (`convert-consent.json`), so the question is never asked twice and a no stays a no: the folder is left alone and is
 * not mentioned again.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic"
import { realPlace } from "./convertGuard"

export const CONSENT_FILE = "convert-consent.json"

interface Answers { yes: string[]; no: string[] }

const keyOf = (place: string, platform: string): string => (platform === "win32" || platform === "darwin" ? place.toLowerCase() : place)

async function read(file: string): Promise<Answers> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Answers>
    const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [])
    return { yes: list(parsed.yes), no: list(parsed.no) }
  } catch { return { yes: [], no: [] } }
}

/**
 * Whether `folder` may be converted: the remembered answer, else `ask()` (and its answer is remembered). An answer that
 * cannot be written down is still honoured for this run, and asked again at the next.
 */
export async function consentFor(userData: string, folder: string, ask: () => Promise<boolean>, platform: string = process.platform):
  Promise<boolean> {
  const file = path.join(userData, CONSENT_FILE)
  const key = keyOf(await realPlace(folder), platform)
  const answers = await read(file)
  if (answers.yes.includes(key)) return true
  if (answers.no.includes(key)) return false
  const said = await ask()
  const next: Answers = said ? { yes: [...answers.yes, key], no: answers.no } : { yes: answers.yes, no: [...answers.no, key] }
  try {
    await fs.mkdir(userData, { recursive: true })
    await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
  } catch { /* asked again next time */ }
  return said
}
