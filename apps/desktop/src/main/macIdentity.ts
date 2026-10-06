/**
 * ON A MAC THE APP IS "WriteMind", never "Electron" (Sean, 2026-10-05: "macos
 * shows electron in the dock ... it should just show WriteMind with the
 * WriteMind logo").
 *
 * What a running app can say about itself, said before the menu is built:
 * - its NAME (`app.setName`), which the app menu's About / Hide / Quit items
 *   and the About panel read. The profile does NOT move with it: the userData
 *   folder was named after the package (`@writemind/desktop`) and stays there,
 *   so settings, sessions and the pen log are where they were.
 * - the ABOUT PANEL: WriteMind, the app's version (a dev run would otherwise
 *   show Electron's), the copyright.
 * - in a DEVELOPMENT run, the DOCK ICON: the WriteMind logo, from the build's
 *   out/icons (build.mjs copies it there) or the repo's packaging/. A packaged
 *   WriteMind.app already carries the icon in its bundle (electron-builder.yml),
 *   which macOS draws better than any picture set at run time, so it is left be.
 *
 * The Dock's LABEL comes from the bundle's Info.plist, which nothing at run time
 * changes: scripts/mac-dev-identity.mjs renames the dev Electron.app for that.
 *
 * Everything here is a no-op anywhere but macOS.
 */
import type { App, NativeImage } from "electron"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export const MAC_APP_NAME = "WriteMind"
export const MAC_COPYRIGHT = "Copyright © 2026 Shahean Cheren"
/** Apple's icon grid: the body of a macOS app icon is 824 of its 1024 px, centred. */
export const ICON_BODY = 824 / 1024

/**
 * Where the dock icon is, best first. `here` is the main bundle's folder
 * (out/main): out/icons is the build's copy (inside app.asar when packaged),
 * and a dev tree also has the repo's own packaging/icon.png.
 */
export function dockIconCandidates(here: string, packaged: boolean): string[] {
  const built = path.join(here, "..", "icons", "icon.png")
  return packaged ? [built] : [built, path.join(here, "..", "..", "..", "..", "packaging", "icon.png")]
}

/**
 * A square RGBA/BGRA bitmap (`size` px) centred on a transparent `canvas` px
 * square. The logo is drawn edge to edge, a macOS icon is not: without the
 * margin the dock tile would stand a fifth taller than its neighbours.
 */
export function padIntoCanvas(pixels: Uint8Array, size: number, canvas: number): Uint8Array {
  if (pixels.length !== size * size * 4) throw new Error(`padIntoCanvas: ${pixels.length} bytes is not ${size}x${size}x4`)
  if (size > canvas) throw new Error(`padIntoCanvas: ${size} px does not fit in ${canvas} px`)
  const out = new Uint8Array(canvas * canvas * 4)
  const offset = Math.floor((canvas - size) / 2)
  const row = size * 4
  for (let y = 0; y < size; y++) {
    out.set(pixels.subarray(y * row, (y + 1) * row), ((y + offset) * canvas + offset) * 4)
  }
  return out
}

type ImageMaker = {
  createFromBuffer(buffer: Buffer): NativeImage
  createFromBitmap(buffer: Buffer, options: { width: number; height: number; scaleFactor?: number }): NativeImage
}

export interface MacIdentityDeps {
  platform: NodeJS.Platform
  app: Pick<App, "getPath" | "setPath" | "setName" | "setAboutPanelOptions" | "getVersion" | "whenReady" | "isPackaged" | "dock">
  nativeImage: ImageMaker
  /** The main bundle's folder (out/main). */
  here: string
  exists?: (file: string) => boolean
  read?: (file: string) => Buffer
}

/** The logo as a dock tile: the first candidate that is there, set on Apple's grid. Null when there is none. */
export function dockIcon(deps: MacIdentityDeps): NativeImage | null {
  const exists = deps.exists ?? existsSync
  const read = deps.read ?? ((file: string) => readFileSync(file))
  const file = dockIconCandidates(deps.here, deps.app.isPackaged).find((one) => exists(one))
  if (!file) return null
  const logo = deps.nativeImage.createFromBuffer(read(file))
  if (logo.isEmpty()) return null
  const canvas = logo.getSize().width
  const body = Math.round(canvas * ICON_BODY)
  const small = logo.resize({ width: body, height: body, quality: "best" })
  const size = small.getSize()
  if (size.width !== body || size.height !== body) return logo
  const padded = padIntoCanvas(new Uint8Array(small.toBitmap()), body, canvas)
  return deps.nativeImage.createFromBitmap(Buffer.from(padded.buffer, padded.byteOffset, padded.byteLength), {
    width: canvas, height: canvas, scaleFactor: 1,
  })
}

/** Call once at startup, before the menu is built. */
export function applyMacIdentity(deps: MacIdentityDeps): void {
  if (deps.platform !== "darwin") return
  const { app } = deps
  // The profile is pinned first: a new name would otherwise move userData to ~/Library/Application Support/WriteMind.
  const userData = app.getPath("userData")
  app.setName(MAC_APP_NAME)
  app.setPath("userData", userData)
  app.setAboutPanelOptions({
    applicationName: MAC_APP_NAME,
    applicationVersion: app.getVersion(),
    // The build number in brackets after the version: a dev run's would be Electron's.
    version: "",
    copyright: MAC_COPYRIGHT,
  })
  if (app.isPackaged) return
  void app.whenReady().then(() => {
    try {
      const icon = dockIcon(deps)
      if (icon) app.dock?.setIcon(icon)
    } catch (error) {
      console.error(`[macIdentity] dock icon: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
