/**
 * File ▸ Language Setup…, the pure half (main/eval/languages.ts is the Electron half; test/languages.test.ts holds
 * this one). Port-only: the Mac's override is `defaults write com.seancheren.WriteMind evalTool.<name> <path>`, read
 * by `Evaluator.tool()` (WriteMind/Eval/Evaluator.swift), with no screen in front of it.
 */

/**
 * WHETHER A PATH IS A FULL ONE on that platform: a drive and a separator (`C:\`, `C:/`) or a UNC share
 * (`\\server\share`) on Windows, a leading `/` everywhere else. `C:x` is NOT full: it means "x in drive C's current
 * folder", which is whatever folder the app last looked in there.
 */
export function isAbsolutePath(file: string, platform: string): boolean {
  if (platform === "win32") return /^[A-Za-z]:[\\/]/.test(file) || /^\\\\[^\\]+\\[^\\]+/.test(file)
  return file.startsWith("/")
}
