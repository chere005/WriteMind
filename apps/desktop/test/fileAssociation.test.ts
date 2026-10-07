// A .wm is a WriteMind note the system knows (docs/SPEC-WM.md 1.1): the association in the packaging files. What the system
// does with it (a double click in Finder, Explorer, a Linux file manager) can only be seen on those systems; this holds the
// declarations that make it happen, and holds the three places that name the media type to the one in the spec.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { WM_MIME } from "@writemind/core"

const root = path.resolve(__dirname, "../../..")
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8")

describe("the .wm file association", () => {
  it("is declared for every platform in electron-builder.yml, with the media type of the spec", () => {
    const yml = read("apps", "desktop", "electron-builder.yml")
    expect(yml).toMatch(/^fileAssociations:\n\s+- ext: wm\n(?:.*\n)*?\s+mimeType: application\/vnd\.writemind\.note\+zip\n/m)
    expect(yml).toContain("role: Editor")
    // The Mac declares the type itself (a UTI Finder can show), the Linux desktop entry offers it first.
    expect(yml).toContain("UTTypeIdentifier: com.seancheren.writemind.note")
    expect(yml).toContain("public.filename-extension: [wm]")
    expect(yml).toMatch(/MimeType: application\/vnd\.writemind\.note\+zip;/)
    expect(WM_MIME).toBe("application/vnd.writemind.note+zip")
  })

  it("is in the Arch package: the desktop entry, and a shared-mime-info file that knows the name and the first bytes", () => {
    expect(read("packaging", "arch", "writemind.desktop")).toMatch(/^MimeType=application\/vnd\.writemind\.note\+zip;/m)
    const xml = read("packaging", "arch", "writemind-mime.xml")
    expect(xml).toContain(`type="${WM_MIME}"`)
    expect(xml).toContain('<glob pattern="*.wm"')
    expect(xml).toContain('<sub-class-of type="application/zip"/>')
    expect(xml).toContain(`value="${WM_MIME}" offset="38"`)
    expect(xml).toContain('value="mimetype" offset="30"')
    expect(read("packaging", "arch", "PKGBUILD")).toContain("writemind-mime.xml")
  })
})
