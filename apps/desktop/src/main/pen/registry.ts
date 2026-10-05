/**
 * main/pen/registry.ts - the ONE place that names concrete backends (docs/spikes/DESIGN-pen-capture.md 12.4), owned by IMPL-D.
 *
 * It builds the backend for a name from the factories the other lanes export, and it reads the KILL SWITCH before anything is created
 * (design 5.8): `WRITEMIND_PEN=off` in the environment, or an (empty) file named `pen-off` in the userData folder, makes the pen subsystem
 * unavailable. Nothing native is loaded or created then, no chip is shown and the sheet behaves as it did before this feature.
 *
 * Everything the factories need from the app (Electron's screen, sessions, windows) arrives through `RegistryDeps`, so this file imports
 * no Electron and a test can fake the lot; main.ts supplies the real ones. The factories are injectable for the same reason.
 */

import type { BackendName, PenBackend } from "../../shared/pen"
import { createDomBackend } from "./domBackend"
import { InjectBackend, inertBackend } from "./fake"
import { createOverlayBackend } from "./overlay"
import { createRawInputBackend } from "./rawinputBackend"
import type {
  CreateDomBackend, CreateOverlayBackend, CreateRawInputBackend, CreateWebHidBackend, CreateWintabBackend, DomDeps, DomIngest,
  OverlayDeps, PenPaths, WebHidDeps,
} from "./types"
import { createWebHidBackend } from "./webhid/webhidBackend"
import { createWintabBackend } from "./wintabBackend"

export interface Factories {
  wintab: CreateWintabBackend
  rawinput: CreateRawInputBackend
  webhid: CreateWebHidBackend
  overlay: CreateOverlayBackend
  dom: CreateDomBackend
}

export const REAL_FACTORIES: Factories = {
  wintab: createWintabBackend,
  rawinput: createRawInputBackend,
  webhid: createWebHidBackend,
  overlay: createOverlayBackend,
  dom: createDomBackend,
}

/** The name of the empty file in userData that switches the pen subsystem off (design 5.8, runbook 16.2 #7). */
export const KILL_FILE = "pen-off"

/**
 * Why the pen subsystem must not exist right now, or null when it may. Pure: the caller passes the environment and a file check.
 * Order: not Windows (the whole feed is Windows-only, invariant 8), the environment switch, the file.
 */
export function penDisabledReason(input: {
  platform: string
  env: Record<string, string | undefined>
  userData: string
  exists(path: string): boolean
  join(...parts: string[]): string
}): string | null {
  if (input.platform !== "win32") return "native pen capture is Windows only"
  if ((input.env.WRITEMIND_PEN ?? "").trim().toLowerCase() === "off") return "pen capture is switched off (pen-off / WRITEMIND_PEN)"
  try {
    if (input.exists(input.join(input.userData, KILL_FILE))) return "pen capture is switched off (pen-off / WRITEMIND_PEN)"
  } catch { /* a file check that throws is not a reason to refuse */ }
  return null
}

export interface RegistryDeps {
  /** null = the pen subsystem may exist; a string is the kill-switch / platform reason (then NO factory is ever called). */
  disabled: string | null
  paths: PenPaths
  dom: DomDeps
  /** Lazy: the WebHID host window and its session are only made when the backend is. */
  webhid(): WebHidDeps | null
  overlay(): OverlayDeps | null
  factories?: Partial<Factories>
}

export interface Registry {
  /** False when the kill switch (or the platform) says there is no pen subsystem. */
  available: boolean
  reason: string | null
  makeBackend(name: BackendName): PenBackend
  /** The window pen, for `pen:dom` (null when the subsystem is off). */
  dom(): (PenBackend & DomIngest) | null
  /** The names of the backends created so far (diagnostics and tests). */
  created(): BackendName[]
}

export function createRegistry(deps: RegistryDeps): Registry {
  const factories: Factories = { ...REAL_FACTORIES, ...deps.factories }
  const made = new Map<BackendName, PenBackend>()

  const build = (name: BackendName): PenBackend => {
    if (deps.disabled) return inertBackend(name, name === "dom" || name === "overlay" || name === "inject" ? "screen" : "device", deps.disabled)
    try {
      switch (name) {
        case "inject": return new InjectBackend()
        case "dom": return factories.dom(deps.dom)
        case "wintab-data": return factories.wintab("data", deps.paths)
        case "wintab-system": return factories.wintab("system", deps.paths)
        case "rawinput": return factories.rawinput()
        case "webhid": {
          const host = deps.webhid()
          return host ? factories.webhid(host) : inertBackend("webhid", "device", "the WebHID host is not available")
        }
        case "overlay": {
          const host = deps.overlay()
          return host ? factories.overlay(host) : inertBackend("overlay", "screen", "the pen sink is not available")
        }
      }
    } catch (error) {
      // A factory that throws leaves that backend unavailable with the reason, never the app down (design 14.1 #19).
      return inertBackend(name, name === "dom" || name === "overlay" ? "screen" : "device", `could not be created: ${(error as Error).message}`)
    }
  }

  const registry: Registry = {
    available: deps.disabled === null,
    reason: deps.disabled,
    makeBackend(name) {
      let backend = made.get(name)
      if (!backend) { backend = build(name); made.set(name, backend) }
      return backend
    },
    dom() {
      if (deps.disabled) return null
      const backend = registry.makeBackend("dom")
      return typeof (backend as Partial<DomIngest>).ingest === "function" ? (backend as PenBackend & DomIngest) : null
    },
    created: () => [...made.keys()],
  }
  return registry
}
