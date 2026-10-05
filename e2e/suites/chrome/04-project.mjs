import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { js, menu, menuClick, pickNext, notesDir, ok, finish, sleep, shot, reloadApp } from "../../lib/harness.mjs"
const J = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-project-"))
const extra = path.join(scratch, "chrome-extra")
const file = path.join(scratch, "chrome-extra-project.writemind-project")
fs.mkdirSync(extra, { recursive: true }); fs.writeFileSync(path.join(extra, "elsewhere.md"), "# Elsewhere\n\nA note in another folder.\n")
const project = async () => (await menu()).find((t) => t.label === "Project").submenu
const pick = pickNext
const click = menuClick
const rows = () => J(`[...document.querySelectorAll('.sidebar .rows > *')].map(r => r.className.split(' ')[0] + ':' + r.textContent.trim().slice(0, 24))`)

await reloadApp()
await menuClick("newProject"); await sleep(1200)
let p = await project()
ok("starts as Untitled Project with one folder", p[0].label === "Untitled Project" && p[3].submenu.length === 1)
ok("the last folder cannot be removed", p[3].submenu[0].enabled === false)

await pick(extra); await menuClick("addFolder"); await sleep(1500)
p = await project()
ok("Add Folder to Project adds it", p[3].submenu.length === 2 && p[3].submenu.every((i) => i.enabled))
const tops = await rows()
ok("the sidebar shows each folder as a section", tops.filter((r) => r.startsWith("section-row")).length >= 2, tops.join(" | "))
ok("the other folder's note is there, opened", await js(`[...document.querySelectorAll('.section-row')].some(r => r.dataset.path === ${JSON.stringify(extra)})`))
await shot("project")

await pick(file); await menuClick("saveProjectAs"); await sleep(1200)
p = await project()
ok("Save Project As writes the file", fs.existsSync(file))
ok("and the menu names the project after it", p[0].label === "chrome-extra-project", p[0].label)
const saved = JSON.parse(fs.readFileSync(file, "utf8"))
ok("the file lists both folders", saved.folders.length === 2 && saved.folders.includes(extra), JSON.stringify(saved))

await menuClick("removeFolder:" + extra); await sleep(1500)
p = await project()
ok("Remove Folder takes it out again", p[3].submenu.length === 1)
ok("and the saved project reads as edited", p[0].label === "chrome-extra-project — edited", p[0].label)
await menuClick("saveProject"); await sleep(800)
p = await project()
ok("Save Project clears 'edited'", p[0].label === "chrome-extra-project")
ok("and writes the one folder", JSON.parse(fs.readFileSync(file, "utf8")).folders.length === 1)

fs.writeFileSync(file, JSON.stringify({ version: 1, folders: [await notesDir(), extra], excluded: [] }))
await pick(file); await menuClick("openProject"); await sleep(1500)
p = await project()
ok("Open Project reads the folders from the file", p[3].submenu.length === 2 && p[0].label === "chrome-extra-project", p[0].label + " " + p[3].submenu.length)
await menuClick("newProject"); await sleep(1200)
p = await project()
ok("New Project goes back to one folder", p[0].label === "Untitled Project" && p[3].submenu.length === 1)
fs.rmSync(scratch, { recursive: true, force: true })
finish()
