/**
 * What went wrong, in a person's words.
 *
 * A call to the main process that fails arrives here as "Error invoking
 * remote method 'note:write': Error: EPERM: operation not permitted, open
 * 'C:\…\one.md'" — which is what the red bar used to show. The code in it
 * ("EPERM") is the part that means something, and these are the few that
 * happen to a notes folder.
 */

const REASONS: Record<string, string> = {
  EPERM: "it is read-only or open in another program",
  EACCES: "it is read-only or open in another program",
  EBUSY: "it is open in another program",
  EROFS: "the disk is read-only",
  ENOSPC: "the disk is full",
  ENOENT: "it is no longer there",
  ENAMETOOLONG: "the name is too long",
  EEXIST: "something with that name is already there",
  EINVAL: "the system does not accept that name",
  EMFILE: "too many files are open",
  ETIMEDOUT: "the drive did not answer",
  ENOTDIR: "a folder in the way is a file",
}

/** The sentence fragment for an error: "it is read-only or open in another program". */
export function friendly(error: unknown): string {
  const text = String((error as { message?: unknown } | null)?.message ?? error ?? "")
  const code = /\b(E[A-Z]{3,11})\b/.exec(text)?.[1]
  if (code && REASONS[code]) return REASONS[code]!
  const plain = text.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "").trim()
  return plain === "" ? "something went wrong" : plain.slice(0, 160)
}

/** The file's name in a message. */
export const leaf = (file: string): string => file.split(/[\\/]/).pop() ?? file
