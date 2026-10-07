// Help ▸ About WriteMind (AboutDialog.tsx, main/about.ts, out/notices.json): ONE dialog, opened by the menu command
// "about" - Help's item on every platform and the Mac's app-menu item. It shows the app and its version, the licence
// line, the Wolfram statement (independent, used as a user, the trademarks) and the libraries that ship, each
// expanding to its licence text. Escape, a click outside and Done close it, Tab stays inside it. Screenshots in the
// light and the dark theme go into the run's shots folder.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ok, finish, js, sleep, waitFor, menu, menuClick, key, centerOf, click, send, shot, seedNotes, openNote, VIEW } from "../../lib/harness.mjs"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const version = JSON.parse(fs.readFileSync(path.join(repo, "apps/desktop/package.json"), "utf8")).version
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const open = () => js(`!!document.querySelector('[data-modal="about"]')`)
const text = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`)
const library = (name) => `[data-modal="about"] [data-library=${JSON.stringify(name)}]`

await sleep(500)
await seedNotes({ "About.md": "# About\n\nA note.\n" }, { clean: true })
await openNote("About")

// 1. Where the command is: Help ▸ About WriteMind everywhere, and the app menu's own item on a Mac.
const top = await menu()
const help = top.find((t) => t.label === "Help")?.submenu ?? []
ok("Help has About WriteMind", help.some((i) => i.label === "About WriteMind" && i.id === "about"))
if (process.platform === "darwin") {
  const app = top[0].submenu
  ok("the Mac's app menu has its own About item (not the system panel)", app[0].label === "About WriteMind" && app[0].id === "aboutApp" && !app[0].role, JSON.stringify(app[0]))
}

// 2. The command opens the dialog.
ok("nothing is up to begin with", !(await open()))
ok("the command is there", await menuClick("about"))
await waitFor(`!!document.querySelector('[data-modal="about"] [data-about="libraries"]')`, 10000)
ok("the About dialog is up", await open())
ok("it is a dialog with a name", await js(`document.querySelector('[data-modal="about"] [role="dialog"]')?.getAttribute('aria-label') === "About WriteMind"`))
ok("the name and the running version", (await text('[data-about="name"]')) === "WriteMind" && (await text('[data-about="version"]')) === `Version ${version}`,
  await text('[data-about="version"]'))
ok("the licence line: BSD 3-Clause, Shahean Cheren", /Copyright \(c\) 2026, Shahean Cheren/.test(await text('[data-about="license"]')) && /BSD 3-Clause/.test(await text('[data-about="license"]')))
ok("the icon is drawn", await js(`(() => { const i = document.querySelector('[data-modal="about"] img.about-icon'); return !!i && i.complete && i.naturalWidth > 0 })()`))
ok("Done has the keyboard", await js(`document.activeElement?.dataset.modal === "ok"`))

// 3. The Wolfram statement.
const wolfram = await text('[data-about="wolfram"]')
for (const phrase of ["Wolfram", "independent of Wolfram Research, Inc.", "not affiliated with, endorsed by or sponsored by", "only as a user", "Wolfram Engine or Mathematica you have installed and licensed yourself",
  "ships none of it", "trademarks and/or copyrights of Wolfram Research, Inc.", "all Wolfram software and logos belong to Wolfram Research"]) {
  ok(`the Wolfram statement says "${phrase}"`, wolfram.includes(phrase), wolfram)
}

// 4. The libraries.
const names = await J(`[...document.querySelectorAll('[data-modal="about"] .about-list > details')].map((d) => d.dataset.library)`)
ok("at least thirty components are listed", names.length >= 30, String(names.length))
for (const name of ["react", "react-dom", "@codemirror/view", "@lezer/lr", "crelt", "electron-updater", "koffi", "Electron", "Chromium"]) ok(`${name} is listed`, names.includes(name))
ok("no development tool is listed", !names.some((n) => ["vite", "esbuild", "vitest", "typescript", "electron-builder"].includes(n)))
const reactRow = await text(`${library("react")} summary`)
ok("a row says name, version, licence and copyright", /react/.test(reactRow) && /\d+\.\d+\.\d+/.test(reactRow) && /MIT/.test(reactRow) && /Meta Platforms/.test(reactRow), reactRow)
ok("the licence texts start closed", !(await js(`document.querySelector('${library("react")}').open`)))
ok("the list scrolls and the dialog fits the window", await js(`(() => {
  const list = document.querySelector('[data-modal="about"] .about-list'), dialog = document.querySelector('[data-modal="about"] .modal')
  const r = dialog.getBoundingClientRect()
  return list.scrollHeight > list.clientHeight && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
})()`))

// 5. A real click on a row opens its text; another closes it; the keyboard does it too.
await js(`document.querySelector('${library("react")} summary').scrollIntoView({ block: 'center' })`)
const summary = await centerOf(`${library("react")} summary`)
await click(summary.x, summary.y); await sleep(150)
ok("clicking react shows its licence text", await js(`document.querySelector('${library("react")}').open`))
const licence = await text(`${library("react")} [data-license-text]`)
ok("the full MIT text, with the copyright holder", /Permission is hereby granted, free of charge/.test(licence) && /Meta Platforms, Inc\. and affiliates/.test(licence) && /THE SOFTWARE IS PROVIDED "AS IS"/.test(licence), licence.slice(0, 80))
ok("and where the source is", /https:\/\/github\.com\/react\/react/.test(await text(`${library("react")} .about-library-url`)))
await click(summary.x, summary.y); await sleep(150)
ok("clicking again puts it away", !(await js(`document.querySelector('${library("react")}').open`)))
await js(`document.querySelector('${library("@codemirror/view")} summary').focus()`)
await key("Enter"); await sleep(150)
ok("Enter on a focused row opens it", await js(`document.querySelector('${library("@codemirror/view")}').open`))
ok("a text of a grouped package is the shared one", /Marijn Haverbeke/.test(await text(`${library("@codemirror/view")} [data-license-text]`)))
await key("Enter"); await sleep(150)
ok("and Enter again closes it", !(await js(`document.querySelector('${library("@codemirror/view")}').open`)))
await js(`document.querySelector('${library("Chromium")} summary').click()`); await sleep(100)
ok("Chromium's row points at LICENSES.chromium.html", /LICENSES\.chromium\.html/.test(await text(`${library("Chromium")} [data-license-text]`)))
await js(`document.querySelector('${library("Chromium")} summary').click()`); await sleep(100)
await js(`document.querySelector('${library("WriteMind")} summary').click()`); await sleep(100)
ok("WriteMind's own licence is there in full", /BSD 3-Clause License/.test(await text(`${library("WriteMind")} [data-license-text]`)) && /Neither the name of the copyright holder/.test(await text(`${library("WriteMind")} [data-license-text]`)))
await js(`document.querySelector('${library("WriteMind")} summary').click()`)

// 6. The project button is there (pressing it would open the real browser).
ok("a Project Page button", await js(`!!document.querySelector('[data-modal="about"] [data-about-action="project"]')`))

// 7. Screenshots, light and dark, with the Wolfram statement and a library open.
await js(`document.querySelector('${library("react")} summary').click()`)
await js(`document.querySelector('[data-modal="about"] .about-list').scrollTop = 0`)
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }); await sleep(250)
await shot("about-light")
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); await sleep(250)
await shot("about-dark")
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] })
await js(`document.querySelector('${library("react")} summary').click()`)

// 8. The keyboard stays in the sheet, and Escape, a click outside and Done put it away.
let outside = 0
for (let i = 0; i < 60; i++) {
  await key("Tab")
  if (!(await js(`document.querySelector('[data-modal="about"]').contains(document.activeElement)`))) outside++
}
ok("Tab never leaves the dialog (60 presses)", outside === 0, String(outside))
await key("Tab", { shift: true })
ok("Shift+Tab stays in too", await js(`document.querySelector('[data-modal="about"]').contains(document.activeElement)`))
await key("Escape"); await sleep(250)
ok("Escape closes it", !(await open()))
ok("and the notes have the keyboard back", await js(`document.activeElement === document.querySelector('.cm-content')`))

await menuClick("about"); await waitFor(`!!document.querySelector('[data-modal="about"] [data-about="libraries"]')`, 10000)
await click(8, 8); await sleep(250)
ok("a click outside closes it", !(await open()))
await menuClick("about"); await waitFor(`!!document.querySelector('[data-modal="about"] [data-about="libraries"]')`, 10000)
await js(`document.querySelector('[data-modal="about"] [data-modal="ok"]').click()`); await sleep(250)
ok("Done closes it", !(await open()))
// The page behind kept working: it is still the same note, and the dialog opens again.
ok("it opens again", await menuClick("about") && (await waitFor(`!!document.querySelector('[data-modal="about"]')`, 5000), await open()))
await key("Escape"); await sleep(200)
ok("the editor is still the note's", await js(`!!${VIEW}`))
finish()
