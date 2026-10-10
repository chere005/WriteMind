/**
 * The platform the keys on screen are printed for: "darwin" on a Mac, "win32" for a PC (Linux's command key is Ctrl too).
 * Components that are not handed one by the page (the maths palette, the drawing cell's menu) ask here, so no label types
 * "Ctrl" by hand — on a Mac that is a key that does nothing (docs/PLAN-bars-2026-10.md, P6). The page's own `platform`
 * (App.tsx) says the same thing from Electron; this is for the leaves that have no prop for it.
 */
let cached: string | null = null

export function hostPlatform(): string {
  if (cached === null) cached = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent) ? "darwin" : "win32"
  return cached
}
