// @e2e isolated
// A NOTE IS A .wm FILE (docs/SPEC-WM.md), in the real app:
//   1. a folder of 2.15.0 notes (.md, .drawings) is converted on launch: the sidebar lists the .wm files, the originals are
//      MOVED to a backup folder beside the notes, a notice says so;
//   2. typing is saved into the .wm (read back here by lib/wm.mjs, and by the system's `unzip -t` / `python3 -m zipfile -t`);
//   3. a pen stroke and a pasted picture land inside it too, in one file;
//   4. an app restart brings the note, its drawing and its picture back;
//   5. exports and the Copy Cell clipboard path still read the note (a PDF is written; the picture file is served).
// The unit side: apps/desktop/test/{convert,wmStore,zip,notes}.test.ts.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  ok, skip, finish, js, sleep, until, notesDir, resetNotes, writeNoteFile, restartApp, openNote, focus, typeText, doc, setDoc, saved,
  readNoteWm, setPen, canvasBox, dragPath, line, pickNext, menuClick, freshNote, shot,
} from "../../lib/harness.mjs"
import { readWm } from "../../lib/wm.mjs"

const notes = await notesDir()
const INK = "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f1a90"
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const put = (rel, data) => { const file = path.join(notes, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file }
const have = (tool, args) => spawnSync(tool, args, { stdio: "ignore" }).status !== null
const sha1 = (text) => spawnSync("shasum", ["-a", "1"], { input: text, encoding: "utf8" }).stdout.slice(0, 12)

// ---- 1. a legacy folder converts on launch -----------------------------------------------------------------------------
await resetNotes({ reload: false })
put("Alpha.md", `# Alpha\n\nSee [Bravo](Bravo.md#wm-12ab34cd) and the picture.\n\n![](.drawings/media/3f9c2a7e5b1d4c80.png)\n\n![ink](.drawings/media/ink-${INK}.svg)\n\n\`\`\`\n.drawings/media/x.png\n\`\`\`\n`)
put("Sec/Bravo.md", "# Bravo\n\n<a id=\"wm-12ab34cd\"></a>The anchored paragraph.\n")
put(`.drawings/Alpha-${sha1("Alpha.md")}.json`, JSON.stringify({ items: [
  { kind: "image", id: "i1", file: "3f9c2a7e5b1d4c80.png", center: { x: 0.5, y: 0.5 }, width: 0.35, aspect: 1, transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, hidden: false, group: null },
  { kind: "cell", id: INK, aspect: 0.2778, items: [] },
] }))
put(".drawings/media/3f9c2a7e5b1d4c80.png", PNG)
put(`.drawings/media/ink-${INK}.svg`, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"720\" height=\"200\"/>")
put(".writemind/order.json", JSON.stringify({ folders: { "": ["Alpha.md", "Sec"], Sec: ["Bravo.md"] } }))
const aBefore = fs.readFileSync(path.join(notes, "Alpha.md"))

await restartApp()
await sleep(1500)
const rows = await js(`[...document.querySelectorAll('.note-row')].map(r => r.dataset.path.replace(/\\\\/g, '/').split('/').slice(-2).join('/')).sort()`)
ok("the sidebar lists the two .wm notes", rows.includes("Alpha.wm") || rows.some((row) => row.endsWith("Alpha.wm")), JSON.stringify(rows))
ok("...and Bravo in its section", rows.some((row) => row.endsWith("Sec/Bravo.wm")), JSON.stringify(rows))
ok("the folder has the two .wm files and no .md", fs.existsSync(path.join(notes, "Alpha.wm")) && fs.existsSync(path.join(notes, "Sec", "Bravo.wm"))
  && !fs.existsSync(path.join(notes, "Alpha.md")) && !fs.existsSync(path.join(notes, "Sec", "Bravo.md")))
ok("the old .drawings folder is gone from the notes folder", !fs.existsSync(path.join(notes, ".drawings")))
const parent = path.dirname(notes)
const backup = fs.readdirSync(parent).find((name) => name.startsWith(`${path.basename(notes)} legacy backup `))
ok("a backup folder is beside the notes folder", !!backup, JSON.stringify(fs.readdirSync(parent)))
if (backup) {
  ok("the original Alpha.md is in it, byte for byte", fs.readFileSync(path.join(parent, backup, "Alpha.md")).equals(aBefore))
  ok("...with the .drawings folder", fs.existsSync(path.join(parent, backup, ".drawings", "media", "3f9c2a7e5b1d4c80.png")))
}
const alpha = readWm(path.join(notes, "Alpha.wm"))
ok("Alpha.wm: the links and pictures follow, the fence is untouched", alpha.text.includes("[Bravo](Bravo.wm#wm-12ab34cd)") && alpha.text.includes("![](media/3f9c2a7e5b1d4c80.png)")
  && alpha.text.includes(`![ink](snapshots/ink-${INK}.svg)`) && alpha.text.includes("```\n.drawings/media/x.png\n```"), JSON.stringify(alpha.text))
ok("...and holds the picture, the snapshot and the drawing", alpha.entries["media/3f9c2a7e5b1d4c80.png"]?.equals(PNG) && !!alpha.entries[`snapshots/ink-${INK}.svg`] && JSON.parse(alpha.drawing).items.length === 2)
ok("the page said what was converted and where", await js(`document.querySelector('[data-footer=conversion-notice]')?.textContent.includes('converted')`),
  await js(`document.querySelector('[data-footer=conversion-notice]')?.textContent ?? 'no notice'`))
await shot("converted")

// ---- 2. typing is saved into the .wm -----------------------------------------------------------------------------------
await openNote("Alpha")
await sleep(700)
ok("the note opened from its .wm", (await doc()).includes("The picture") || (await doc()).includes("See [Bravo](Bravo.wm"), JSON.stringify((await doc()).slice(0, 60)))
await focus()
await js(`(() => { const v = document.querySelector('.cm-content').cmView?.view; })()`)
await setDoc("# Alpha\n\nTyped into the container.\n", 0)
await focus()
await typeText(" More.")
await sleep(1600)
const typed = readWm(path.join(notes, "Alpha.wm"))
ok("the typing is in note.wmdm of the .wm", typed.text.includes("More."), JSON.stringify(typed.text))
ok("the file is a valid archive: the mimetype is first, and the picture is still inside", typed.names[0] === "mimetype" && !!typed.entries["media/3f9c2a7e5b1d4c80.png"], typed.names.join(","))
ok("...with nothing left beside it (no .tmp)", !fs.readdirSync(notes).some((name) => name.endsWith(".tmp")), JSON.stringify(fs.readdirSync(notes)))
if (have("unzip", ["-v"])) {
  const test = spawnSync("unzip", ["-t", path.join(notes, "Alpha.wm")], { encoding: "utf8" })
  ok("the system's unzip -t finds no error in what the app wrote", test.status === 0 && /No errors detected/.test(test.stdout), test.stdout + test.stderr)
} else skip("unzip -t", "unzip is not installed")
if (have("python3", ["-c", "import zipfile"])) {
  const test = spawnSync("python3", ["-m", "zipfile", "-t", path.join(notes, "Alpha.wm")], { encoding: "utf8" })
  ok("python3 -m zipfile -t is satisfied too", test.status === 0, test.stdout + test.stderr)
} else skip("python3 -m zipfile -t", "python3 is not installed")

// ---- 3. a pen stroke and a pasted picture land inside it ----------------------------------------------------------------
const file = await freshNote()
await setDoc("# Drawn\n\nwords\n", 0)
await sleep(900)
await setPen(true)
const cb = await canvasBox()
await dragPath(line([cb.x + 120, cb.y + 200], [cb.x + 360, cb.y + 260], 12), { pen: true })
await sleep(300)
await setPen(false)
await js(`(async () => {
  const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d');
  x.fillStyle = '#e03030'; x.fillRect(0, 0, 60, 40); x.fillStyle = '#3030e0'; x.fillRect(60, 40, 60, 40)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }))
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})()`)
const drawn = await saved(file, (d) => d.items.some((i) => i.kind === "stroke") && d.items.some((i) => i.kind === "image"), 8000)
ok("the page has a stroke and a picture", drawn.items.some((i) => i.kind === "stroke") && drawn.items.some((i) => i.kind === "image"), JSON.stringify(drawn.items.map((i) => i.kind)))
const picture = drawn.items.find((i) => i.kind === "image")?.file
const rel = path.relative(notes, file)
await sleep(600)
const inside = readWm(file)
ok("drawing.json of the .wm holds the stroke and the picture", !!inside.drawing && JSON.parse(inside.drawing).items.some((i) => i.kind === "stroke") && JSON.parse(inside.drawing).items.some((i) => i.kind === "image"), rel)
ok("the picture's bytes are in media/ of the same file, and are a real PNG", !!picture && inside.entries[`media/${picture}`]?.subarray(0, 4).toString("hex") === "89504e47", `${picture} ${inside.names.join(",")}`)
ok("the words came along in that file too", inside.text.includes("# Drawn"))
ok("there is no .drawings folder anywhere: the notes folder holds only .wm files and the app's own bookkeeping",
  !fs.existsSync(path.join(notes, ".drawings")) && fs.readdirSync(notes).every((name) => name.endsWith(".wm") || name === "Sec" || name.startsWith(".")), JSON.stringify(fs.readdirSync(notes)))
const served = await js(`new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(picture)}) })`)
ok("wm://media serves the picture out of the .wm", served && served[0] === 120 && served[1] === 80, JSON.stringify(served))

// ---- 4. a restart brings it back -----------------------------------------------------------------------------------------
const wordsBefore = await doc()
await restartApp()
await sleep(1500)
ok("after a restart the note is open with its words", (await doc()).includes("# Drawn"), JSON.stringify((await doc()).slice(0, 40)))
void wordsBefore
const again = await saved(file)
ok("...its drawing is back", again.items.some((i) => i.kind === "stroke") && again.items.some((i) => i.kind === "image"))
const backAgain = await js(`new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = 'wm://media/' + encodeURIComponent(${JSON.stringify(picture)}) })`)
ok("...and its picture is served again", backAgain && backAgain[0] === 120, JSON.stringify(backAgain))
const unchanged = readWm(file)
ok("opening and closing changed nothing in the file (same id, same entries)", unchanged.manifest.id === inside.manifest.id && unchanged.names.join() === inside.names.join())

// ---- 5. export reads the note out of the .wm -----------------------------------------------------------------------------
const pdf = path.join(notes, "..", "Drawn export.pdf")
await pickNext(pdf)
await menuClick("export")
const wrote = await until(() => fs.existsSync(pdf) && fs.statSync(pdf).size > 500, 60000, 300)
ok("File ▸ Export… writes a PDF of the note, its picture in it", wrote && fs.readFileSync(pdf).subarray(0, 4).toString() === "%PDF")
fs.rmSync(pdf, { force: true })
void readNoteWm; void writeNoteFile; void openNote
finish()
