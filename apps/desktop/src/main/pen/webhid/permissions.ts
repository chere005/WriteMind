/**
 * webhid/permissions.ts - what the WebHID helper's session may do. docs/spikes/DESIGN-pen-capture.md 4.4. Owner: IMPL-B.
 *
 * Three hooks make Chromium list and open the tablet without a prompt (measured on the real Wacom, webhid spike; the page's session is the
 * dedicated "pen-hid" partition, never the notes window's, so the grant cannot reach the notes window):
 *   1. setDevicePermissionHandler: the devices `navigator.hid.getDevices()` may list - HID devices of the allowed vendors, nothing else;
 *   2. setPermissionCheckHandler / setPermissionRequestHandler: the "hid" permission itself, and no other permission at all;
 *   3. "select-hid-device": the chooser of `requestDevice()` is answered by picking the first allowed device (never shown to the person).
 *
 * `installHidPermissions` returns a function that puts the session back (handlers cleared, listener removed); the backend calls it from stop().
 * The session is typed narrowly so tests pass a fake; the real `Electron.Session` is handed over by one cast at the call site.
 */

export interface HidDeviceDetails { deviceType: string; device: { vendorId: number; productId?: number } }
export interface HidChooserDetails { deviceList: { deviceId: string; vendorId: number; productId?: number }[] }
export type SelectHidDevice = (event: { preventDefault(): void }, details: HidChooserDetails, callback: (deviceId: string) => void) => void

export interface HidSessionLike {
  setDevicePermissionHandler(handler: ((details: HidDeviceDetails) => boolean) | null): void
  setPermissionCheckHandler(handler: ((contents: unknown, permission: string, ...rest: unknown[]) => boolean) | null): void
  setPermissionRequestHandler(handler: ((contents: unknown, permission: string, callback: (granted: boolean) => void, ...rest: unknown[]) => void) | null): void
  on(event: "select-hid-device", listener: SelectHidDevice): unknown
  removeListener(event: "select-hid-device", listener: SelectHidDevice): unknown
}

export interface HidPermissionOptions {
  vendorIds: readonly number[]
  /** Decisions for the log ("devicePermission vid=056a allowed"). */
  log?: (line: string) => void
}

export function installHidPermissions(session: HidSessionLike, options: HidPermissionOptions): () => void {
  const allowed = (vendorId: number): boolean => options.vendorIds.includes(vendorId)
  const log = options.log ?? (() => undefined)

  session.setDevicePermissionHandler((details) => {
    const ok = details.deviceType === "hid" && allowed(details.device.vendorId)
    log(`pen-hid devicePermission ${details.deviceType} vid=${details.device.vendorId.toString(16)} -> ${ok ? "allow" : "deny"}`)
    return ok
  })
  session.setPermissionCheckHandler((_contents, permission) => permission === "hid")
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "hid"))

  const choose: SelectHidDevice = (event, details, callback) => {
    event.preventDefault()
    const pick = details.deviceList.find((d) => allowed(d.vendorId))
    log(`pen-hid select-hid-device ${details.deviceList.length} listed -> ${pick ? pick.deviceId : "none"}`)
    callback(pick ? pick.deviceId : "")
  }
  session.on("select-hid-device", choose)

  let installed = true
  return () => {
    if (!installed) return
    installed = false
    try { session.removeListener("select-hid-device", choose) } catch { /* the session is gone */ }
    try { session.setDevicePermissionHandler(null) } catch { /* ignore */ }
    try { session.setPermissionCheckHandler(null) } catch { /* ignore */ }
    try { session.setPermissionRequestHandler(null) } catch { /* ignore */ }
  }
}
