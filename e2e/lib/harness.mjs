// The suite-side toolkit. Every e2e script starts with
//
//   import { ok, finish, js, ... } from "../../lib/harness.mjs"
//
// Importing it connects to the instance the runner started for the suite (env WM_PORT) and waits for the app.
// A script then prints one line per check:
//
//   PASS <name>        FAIL <name>  <detail>        SKIP <name>  <why>        NOTE <text>
//
// and ends with finish(). The runner reads those lines (and the exit code). Run a script by hand against an
// instance you started yourself with
//
//   WM_PORT=9416 node e2e/suites/cells/brackets.mjs
//
// (the notes folder is then read from the app itself; screenshots go to e2e/.results/manual/).

import fs from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { connectCdp, sleep, until } from "./cdp.mjs"
import { restartInstance, stopInstance } from "./instance.mjs"
import { readWm, writeWm } from "./wm.mjs"

export { sleep, until }

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "..", "..")

// ---------------------------------------------------------------------------------------------------------------
// Where we are
// ---------------------------------------------------------------------------------------------------------------
export const PORT = Number(process.env.WM_PORT || 9333)
export const SUITE = process.env.WM_SUITE || "manual"
export const SCRIPT = process.env.WM_SCRIPT || path.basename(process.argv[1] || "script", ".mjs")
export const SHOTS = process.env.WM_SHOTS || path.join(repo, "e2e", ".results", "manual")
export const INSTANCE_DIR = process.env.WM_INSTANCE_DIR || ""
export const FIXTURES = {
  chart: process.env.WM_FIXTURE_CHART || "",
  tilted: process.env.WM_FIXTURE_TILTED || "",
  tiltedQuad: process.env.WM_FIXTURE_TILTED_QUAD || "",
}

// ---------------------------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------------------------
let failed = 0
let passed = 0
let xfailed = 0
// Known issues (e2e/known-issues.json, passed in by the runner): checks that fail today because of a bug that is
// tracked elsewhere. They print XFAIL (not counted as failures) and, once they pass again, XPASS.
let known = []
try { known = JSON.parse(process.env.WM_KNOWN || "[]") } catch { known = [] }
const knownFor = (name) => known.find((k) => name.includes(k.check))
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").slice(0, 700)

/** One check. `extra` is shown only when it fails. Returns the condition so scripts can branch on it. */
export function ok(name, cond, extra = "") {
  const issue = knownFor(name)
  if (issue) {
    if (cond) { passed++; console.log("XPASS " + name + "  (fixed? remove it from e2e/known-issues.json)") }
    else { xfailed++; console.log("XFAIL " + name + "  " + oneLine(issue.reason) + (extra === "" ? "" : "  | " + oneLine(typeof extra === "string" ? extra : JSON.stringify(extra)))) }
    return !!cond
  }
  if (cond) { passed++; console.log("PASS " + name) }
  else { failed++; console.log("FAIL " + name + (extra === "" ? "" : "  " + oneLine(typeof extra === "string" ? extra : JSON.stringify(extra)))) }
  return !!cond
}
export function skip(name, why = "") { console.log("SKIP " + name + (why ? "  " + why : "")) }
export function note(text) { console.log("NOTE " + oneLine(text)) }
/** Run a block as one named check; a throw is a FAIL for that block alone, and the script goes on. */
export async function test(name, fn) {
  try { await fn() } catch (error) { failed++; console.log("FAIL " + name + "  threw: " + oneLine(error?.message ?? error)) }
}
/** Exit once everything printed so far has really been written (a pipe on Windows can be asynchronous). */
const exitAfterFlush = (code) => { process.stdout.write("", () => process.exit(code)) }
export function finish() {
  console.log(failed ? `${failed} FAILED, ${passed} passed` : `ALL PASSED (${passed}${xfailed ? `, ${xfailed} known issue(s)` : ""})`)
  try { page.close() } catch { /* closed */ }
  exitAfterFlush(failed ? 1 : 0)
}
process.on("uncaughtException", (error) => {
  console.log("FAIL " + SCRIPT + " crashed  " + oneLine(error?.stack ?? error))
  exitAfterFlush(1)
})
process.on("unhandledRejection", (error) => {
  console.log("FAIL " + SCRIPT + " rejected  " + oneLine(error?.stack ?? error))
  exitAfterFlush(1)
})

// ---------------------------------------------------------------------------------------------------------------
// The connection (swapped in place when the app is restarted)
// ---------------------------------------------------------------------------------------------------------------
let page = await connectCdp({ port: PORT })
let pageErrors = 0
const watch = (p) => {
  p.send("Runtime.enable")
  p.on("Runtime.exceptionThrown", (e) => {
    pageErrors++
    if (pageErrors <= 5) console.log("NOTE page exception: " + oneLine(e.exceptionDetails?.exception?.description || e.exceptionDetails?.text))
  })
}
watch(page)

export const send = (method, params) => page.send(method, params)
export const js = (expression) => page.js(expression)
export const closePage = () => page.close()
export const pageErrorCount = () => pageErrors
/** A second page of the same instance (the grab overlay: target("grab=1")). */
export const target = (match) => connectCdp({ port: PORT, match })

/** Wait for the app's bridge and the first render. */
export async function appReady(ms = 20000) {
  const good = await until(() => js(`!!window.wm && document.readyState === 'complete' && !!document.querySelector('#root > *')`), ms, 150)
  if (!good) throw new Error("the app did not come up (no window.wm / #root)")
  await sleep(300)
}
await appReady()

/** Give the window a known size (offscreen, never full screen) so layouts and coordinates are the same every run. */
export async function setWindowSize(width = 1440, height = 900) {
  const w = await js(`window.wm.e2eWindow()`)
  if (w.fullScreen) throw new Error("the test window is full screen; refusing to continue")
  await js(`window.wm.e2eSetBounds(${JSON.stringify({ x: w.bounds.x, y: w.bounds.y, width, height })})`)
  await sleep(400)
}
if (!process.env.WM_KEEP_WINDOW) {
  try { await setWindowSize() } catch (error) { if (/full screen/.test(String(error))) throw error }
}

// ---------------------------------------------------------------------------------------------------------------
// Files: the notes folder of this instance
// ---------------------------------------------------------------------------------------------------------------
let notesRoot = process.env.WM_NOTES || ""
export async function notesDir() {
  if (!notesRoot) notesRoot = await js(`window.wm.capabilities().then(c => c.root)`)
  return notesRoot
}
// A NOTE IS A .wm FILE (docs/SPEC-WM.md): the helpers below take the name a script has always written, "Name.md", and mean the
// note "Name.wm" (a script that says "Name.wm" gets the same). The text is the note's `note.mdwm`; what else is inside (the
// drawing, the pictures, the snapshots) is read with `readNoteWm`. Any other file name is a plain file, as before.
const noteName = (rel) => rel.replace(/\.(md|markdown)$/i, ".wm")
const isNoteFile = (rel) => /\.wm$/i.test(noteName(rel))
const abs = async (rel) => path.join(await notesDir(), noteName(rel))
/** Write a note (`extras`: { drawing, entries, manifest }, see lib/wm.mjs) or, for any other name, a plain file. */
export async function writeNoteFile(rel, text, extras) {
  const file = await abs(rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (isNoteFile(rel)) writeWm(file, text, extras)
  else fs.writeFileSync(file, text)
  return file
}
/** The words of a note (its `note.mdwm`), or the text of a plain file. */
export async function readNoteFile(rel) { const file = await abs(rel); return isNoteFile(rel) ? readWm(file).text : fs.readFileSync(file, "utf8") }
/** A note read whole, from disk: { text, drawing, entries, names, manifest }. Throws when it is not a valid .wm. */
export async function readNoteWm(rel) { return readWm(await abs(rel)) }
export async function noteFileExists(rel) { return fs.existsSync(await abs(rel)) }
export async function removeNoteFile(rel) { fs.rmSync(await abs(rel), { recursive: true, force: true }) }
/** Empty the notes folder (the instance's own temp folder, never anyone's real one) and reload the page. */
export async function resetNotes({ reload = true } = {}) {
  const root = await notesDir()
  if (!root || !/wm-e2e|instances|e2e/i.test(root) && process.env.WM_ALLOW_RESET !== "1") {
    throw new Error(`refusing to clear a notes folder that does not look like a test one: ${root}`)
  }
  for (const name of fs.readdirSync(root)) fs.rmSync(path.join(root, name), { recursive: true, force: true })
  if (reload) await reloadApp()
}
/** Write notes ({ "Name.md": "text", "Sec/In.md": "text" }) and reload so the sidebar shows them. */
export async function seedNotes(files, { reload = true, clean = false } = {}) {
  if (clean) await resetNotes({ reload: false })
  for (const [rel, text] of Object.entries(files)) await writeNoteFile(rel, text)
  if (reload) await reloadApp()
}

// ---------------------------------------------------------------------------------------------------------------
// Input: real events through the browser's own input pipeline
// ---------------------------------------------------------------------------------------------------------------
export const CTRL = 2, SHIFT = 8, ALT = 1, META = 4
/** The platform's command modifier as `key` options: ⌘ on a Mac, Ctrl elsewhere (the app's `CmdOrCtrl`). */
export const MOD = process.platform === "darwin" ? { meta: true } : { ctrl: true }
const modBits = (o = {}) => (o.modifiers ?? 0) | (o.ctrl ? CTRL : 0) | (o.shift ? SHIFT : 0) | (o.alt ? ALT : 0) | (o.meta ? META : 0)

export const mouse = (type, x, y, o = {}) => send("Input.dispatchMouseEvent", {
  type, x, y, button: o.button ?? "left",
  buttons: o.buttons ?? (type === "mouseReleased" ? 0 : (o.button === "right" ? 2 : 1)),
  clickCount: o.clickCount ?? (type === "mouseMoved" ? 0 : 1), modifiers: modBits(o),
  ...(o.pen ? { pointerType: "pen", force: 0.5 } : {}),
})
export const hover = (x, y, o = {}) => mouse("mouseMoved", x, y, { buttons: 0, ...o })
export async function click(x, y, o = {}) {
  await hover(x, y, o)
  await mouse("mousePressed", x, y, o)
  await mouse("mouseReleased", x, y, o)
  await sleep(o.wait ?? 60)
}
export async function dblclick(x, y, o = {}) {
  await click(x, y, { ...o, clickCount: 1, wait: 0 })
  await mouse("mousePressed", x, y, { ...o, clickCount: 2 })
  await mouse("mouseReleased", x, y, { ...o, clickCount: 2 })
  await sleep(o.wait ?? 100)
}
export async function rightClick(x, y, o = {}) {
  await hover(x, y)
  await mouse("mousePressed", x, y, { ...o, button: "right" })
  await mouse("mouseReleased", x, y, { ...o, button: "right" })
  await sleep(o.wait ?? 150)
}
/** Press at (x1,y1), move in `steps` to (x2,y2), release. */
export async function drag(x1, y1, x2, y2, o = {}) {
  const steps = o.steps ?? 8
  await dragPath(Array.from({ length: steps + 1 }, (_, i) => [x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps]), o)
}
/** Press on the first point of a path, move through the rest, release on the last. */
export async function dragPath(pts, o = {}) {
  await hover(pts[0][0], pts[0][1], o)
  await mouse("mousePressed", pts[0][0], pts[0][1], o)
  for (const p of pts.slice(1)) { await mouse("mouseMoved", p[0], p[1], o); if (o.pause) await sleep(o.pause) }
  const end = pts[pts.length - 1]
  await mouse("mouseReleased", end[0], end[1], o)
  await sleep(o.wait ?? 120)
}
/** Interpolated points from a to b (for dragPath / pen strokes). */
export const line = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n])
export const seg = (x0, y0, x1, y1, n = 10) => line([x0, y0], [x1, y1], n)
export const rectPts = (x, y, w, h, n = 8) => [...seg(x, y, x + w, y, n), ...seg(x + w, y, x + w, y + h, n).slice(1), ...seg(x + w, y + h, x, y + h, n).slice(1), ...seg(x, y + h, x, y, n).slice(1)]

const VK = {
  Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, Insert: 45, " ": 32, Space: 32,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  Control: 17, Shift: 16, Alt: 18, Meta: 91,
  ".": 190, ",": 188, "/": 191, ";": 186, "=": 187, "-": 189, "[": 219, "]": 221, "\\": 220, "'": 222, "`": 192,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
}
const CODE = { ".": "Period", ",": "Comma", "/": "Slash", ";": "Semicolon", "=": "Equal", "-": "Minus", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "'": "Quote", "`": "Backquote", " ": "Space" }
const keyInfo = (k, o) => {
  // shifted symbols such as ( or ! have no virtual key of their own (their char code would read as another key)
  const vk = o.vk ?? VK[k] ?? (/^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0)
  const code = o.code ?? (k.length === 1 ? (/[a-z]/i.test(k) ? "Key" + k.toUpperCase() : /\d/.test(k) ? "Digit" + k : CODE[k] ?? "") : k)
  return { vk, code }
}
/**
 * One key press, as the physical key would deliver it (modifiers go down first and up after).
 *   key("Enter")   key("d", { ctrl: true })   key("ArrowDown", { ctrl: true, shift: true })   key("z", { modifiers: CTRL })
 */
export async function key(k, o = {}) {
  const mods = modBits(o)
  const { vk, code } = keyInfo(k, o)
  const chord = [[mods & CTRL, "Control", "ControlLeft", 17, CTRL], [mods & SHIFT, "Shift", "ShiftLeft", 16, SHIFT], [mods & ALT, "Alt", "AltLeft", 18, ALT]].filter((m) => m[0])
  let acc = 0
  for (const [, name, c, v, bit] of chord) { acc |= bit; await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: c, windowsVirtualKeyCode: v, modifiers: acc }) }
  const text = o.text ?? (k === "Enter" ? "\r" : k.length === 1 && !(mods & (CTRL | ALT)) ? k : undefined)
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, text, autoRepeat: !!o.autoRepeat })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
  for (const [, name, c, v, bit] of [...chord].reverse()) { acc &= ~bit; await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: c, windowsVirtualKeyCode: v, modifiers: acc }) }
  await sleep(o.wait ?? 80)
}
/** Real typing: one keyDown with text per character ("\n" is Enter). */
export async function typeText(s, o = {}) {
  for (const ch of s) {
    if (ch === "\n") { await key("Enter", { wait: 10 }); continue }
    const { vk, code } = keyInfo(ch, {})
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch, code, windowsVirtualKeyCode: vk })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk })
    if (o.delay) await sleep(o.delay)
  }
  await sleep(80)
}
export const typeKeys = typeText
/** Insert text as one input event (what an IME or paste-by-typing does). */
export const insertText = async (text) => { await send("Input.insertText", { text }); await sleep(120) }
export const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] })

// ---- the synthetic pen: PointerEvents with pointerType "pen" on whatever lies under the point ----
export const pe = (type, x, y, o = {}) => js(`(()=>{const el=document.elementFromPoint(${x},${y});if(!el)return 'none';
 el.dispatchEvent(new PointerEvent('${type}',{bubbles:true,cancelable:true,composed:true,clientX:${x},clientY:${y},pointerId:${o.id ?? 7},pointerType:'${o.type ?? "pen"}',isPrimary:true,button:${o.button ?? 0},buttons:${o.buttons ?? (type === "pointerup" ? 0 : 1)},pressure:${o.pressure ?? (type === "pointerup" ? 0 : 0.5)},ctrlKey:${!!o.ctrl},altKey:${!!o.alt},shiftKey:${!!o.shift}}));return el.className||el.tagName})()`)
export const penHover = (x, y, o = {}) => pe("pointermove", x, y, { buttons: 0, pressure: 0, ...o })
/** A polyline stroke with rising pressure; pts = [[x,y],...] in client px. */
export async function penStroke(pts, o = {}) {
  await pe("pointermove", pts[0][0], pts[0][1], { ...o, buttons: 0, pressure: 0 })
  await pe("pointerdown", pts[0][0], pts[0][1], { ...o, pressure: o.p0 ?? 0.2 })
  for (let i = 1; i < pts.length; i++) await pe("pointermove", pts[i][0], pts[i][1], { ...o, pressure: (o.p0 ?? 0.2) + (i / pts.length) * 0.6 })
  await pe("pointerup", pts.at(-1)[0], pts.at(-1)[1], { ...o, buttons: 0, pressure: 0 })
  await sleep(30)
}

// ---------------------------------------------------------------------------------------------------------------
// Looking at the page
// ---------------------------------------------------------------------------------------------------------------
/** Take a screenshot into the run's shots folder; returns the path (look at it with the Read tool). */
export async function shot(name) {
  const file = path.isAbsolute(name) ? name : path.join(SHOTS, `${SUITE}__${SCRIPT}__${name.replace(/\.png$/, "")}.png`)
  return page.screenshot(file)
}
export const waitFor = (expr, ms = 8000) => until(() => js(expr), ms, 100)
/** Centre of the first element matching the selector, in client px (null when absent). */
export const centerOf = async (selector) => JSON.parse(await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height})})()`))
export const rectOf = async (selector) => JSON.parse(await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,r:r.right,b:r.bottom})})()`))
/** Click the centre of the first element matching the selector with a real mouse. */
export async function clickEl(selector, o = {}) {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`)
  const c = await centerOf(selector)
  if (!c) throw new Error("no element " + selector)
  await click(c.x, c.y, o)
}
/** A synthetic .click() on an element (for buttons whose position does not matter). */
export const press = (selector) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`)
/** Set a <select> the way React sees it. `titleStart` finds the select by the start of its title. */
export const pick = (titleStart, value) => js(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>(s.title||'').startsWith(${JSON.stringify(titleStart)}));if(!s)return null;const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`)
export const setSelect = (selector, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});if(!s)return null;const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`)
export const setInput = (selector, value) => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return i.value})()`)
export const footer = () => js(`document.querySelector('.footer')?.innerText.split(String.fromCharCode(10)).join(' | ')`)

// ---------------------------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------------------------
export const VIEW = `document.querySelector('.cm-content').cmTile.view`
export const doc = () => js(`${VIEW}.state.doc.toString()`)
export const setDoc = async (text, caret = 0) => {
  await js(`${VIEW}.dispatch({changes:{from:0,to:${VIEW}.state.doc.length,insert:${JSON.stringify(text)}},selection:{anchor:${caret}}})`)
  await sleep(150)
}
export const sel = async () => JSON.parse(await js(`(()=>{const s=${VIEW}.state.selection.main;return JSON.stringify([s.anchor,s.head])})()`))
export const ranges = async () => JSON.parse(await js(`JSON.stringify(${VIEW}.state.selection.ranges.map(r=>[r.from,r.to]))`))
export const setSel = (anchor, head = anchor) => js(`${VIEW}.dispatch({selection:{anchor:${anchor},head:${head}}})`)
export const selText = () => js(`${VIEW}.state.selection.ranges.map(r=>${VIEW}.state.sliceDoc(r.from,r.to)).join('|')`)
export const focus = () => js(`${VIEW}.focus()`)
export const lineTexts = () => js(`[...document.querySelectorAll('.cm-line')].map(l=>l.textContent)`)
/** Geometry of every .cm-line: [top, bottom, text] in client px. */
export const lineBoxes = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.cm-line')].map(l=>{const r=l.getBoundingClientRect();return [Math.round(r.top),Math.round(r.bottom),l.textContent]}))`))
export const armed = () => js(`document.querySelector('.cm-editor').classList.contains('wm-armed')`)
/** The cell brackets (not the section ones) as client-space points. */
export const brackets = async (sel = ".wm-bracket:not(.wm-bracket-group)") => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(b=>{const r=b.getBoundingClientRect();return {x:r.x+r.width/2,right:r.right-2,y:r.y+r.height/2,h:r.height,top:r.top,bottom:r.bottom}}))`))

// ---------------------------------------------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------------------------------------------
export async function reloadApp() {
  await send("Page.reload")
  await sleep(1500)
  await appReady()
  await sleep(500)
}
/** Make sure an editor is on screen (opens the first note, or makes one). */
export async function ready() {
  for (let i = 0; i < 30; i++) {
    if (await js(`!!document.querySelector('.cm-content')`)) return
    await js(`(document.querySelector('.note-row')||[...document.querySelectorAll('button')].find(b=>b.textContent.includes('New note')))?.click()`)
    await sleep(600)
  }
  throw new Error("no editor")
}
export async function openNote(name) {
  await js(`[...document.querySelectorAll('.note-row')].find(r=>r.dataset.path?.replace(/\\\\/g,'/').endsWith('/'+${JSON.stringify(name + ".wm")})||r.textContent.includes(${JSON.stringify(name)}))?.click()`)
  await sleep(700)
}
export const noteRows = () => js(`[...document.querySelectorAll('.note-row')].map(r=>r.dataset.path)`)

// ---- the pen button of the top bar
// The bar's ONE pen button (Sean, 2026-10-10): lit while the pen is down (or, when the button is the eraser, while it erases).
const penButton = `document.querySelector('[data-bar=pen]')`
export const penIsDown = () => js(`(()=>{const b=${penButton};return !!b&&b.classList.contains('on')})()`)
/** Put the pen down (true: it draws) or up (false: the cursor/mouse). */
export async function setPen(want) {
  if ((await penIsDown()) === want) return
  await js(`${penButton}?.click()`)
  await sleep(250)
}

/** Open the pen button's menu from its caret (Pen / Eraser, colour, width, the tablet). */
export async function penMenu() {
  await js(`document.querySelector('[data-bar=pen-menu]').click()`)
  await sleep(150)
}
/** The pen button is the eraser (its tool), and whether that eraser is on. */
export const eraserState = () => js(`(()=>{const b=document.querySelector('[data-bar=pen]');return {tool:/^Eraser/.test(b.title)?'eraser':'pen',lit:b.classList.contains('on')}})()`)
/** Turn the notebook's Erase tool on or off through the bar: the menu's Eraser the first time, then the button itself. */
export async function setEraserTool(want) {
  const now = await eraserState()
  if (now.tool === 'eraser' && now.lit === want) return
  if (want && now.tool !== 'eraser') { await penMenu(); await js(`document.querySelector('.float-menu [data-bar=erase]').click()`) }
  else await js(`document.querySelector('[data-bar=pen]').click()`)
  await sleep(200)
}
/** Pick a language for the Code button from its menu (its right-click), which also writes a block of it. */
export async function pickCodeLanguage(language) {
  await js(`document.querySelector('[data-bar=code]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`)
  await sleep(150)
  await js(`document.querySelector('.float-menu [data-bar="code-${language}"]').click()`)
  await sleep(250)
}

// ---- drawings (drawing.json inside a note)
/** A fresh note, open, with the pen up. Returns its path. */
export async function freshNote({ video = false } = {}) {
  await waitFor(`!!window.wm`)
  // The video pane may start open; editor and drawing tests want the whole width unless they ask for it.
  if (!video && (await js(`!!document.querySelector('.camera')`))) { await js(`document.querySelector('[data-bar=video]')?.click()`); await sleep(300) }
  const root = await js(`window.wm.capabilities().then(c => c.root)`)
  const file = await js(`window.wm.createNote(${JSON.stringify(root)})`)
  await sleep(900)
  const name = file.split(/[\\/]/).pop().replace(/\.wm$/, "")
  await js(`(() => { const r=[...document.querySelectorAll('.note-row')]; const m=r.find(x=>x.dataset.path===${JSON.stringify(file)})||r.find(x=>x.textContent.includes(${JSON.stringify(name)}))||r[0]; m.click() })()`)
  await waitFor(`!!document.querySelector('.wm-canvas')`)
  await setPen(false)
  await sleep(500)
  return file
}
export const sidecar = async (file) => JSON.parse((await js(`window.wm.readDrawing(${JSON.stringify(file)})`)) ?? '{"items":[]}')
/**
 * Wait for the 500 ms debounced save, then read the drawing back from disk. A slow machine (CI, a cold first save)
 * can take longer than that: the drawing is read again until it exists, and with `until` (a test of the drawing read)
 * until it holds, for up to `ms` in all; then the last read is returned and the check that uses it fails as before.
 */
export const saved = async (file, until = null, ms = 5000) => {
  const stop = Date.now() + ms
  await sleep(900)
  for (;;) {
    const raw = await js(`window.wm.readDrawing(${JSON.stringify(file)})`)
    const drawing = JSON.parse(raw ?? '{"items":[]}')
    if ((raw != null && (!until || until(drawing))) || Date.now() >= stop) return drawing
    await sleep(150)
  }
}
export const canvasBox = async () => JSON.parse(await js(`(()=>{const b=document.querySelector('.wm-canvas').getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})})()`))
/**
 * Arm a placement from the bar: a shape kind ("rectangle", "check"...), "arrow" / "both" / "line", "tool" (the arrow tool) from
 * the Shapes menu, or "text" (the Text box button), so the next drag places it. Returns null when there is no such entry.
 */
export const arm = async (value) => {
  if (value === "text") return js(`(()=>{const b=document.querySelector('[data-bar=textbox]');if(!b)return null;b.click();return true})()`)
  const opened = await js(`(()=>{const b=document.querySelector('[data-bar=shapes]');if(!b)return false;b.click();return true})()`)
  if (!opened) return null
  await sleep(120)
  const hook = `shape-${value}`
  const done = await js(`(()=>{const r=document.querySelector('.float-menu [data-bar="${hook}"]');if(!r)return null;r.click();return true})()`)
  if (!done) await key("Escape")
  return done
}
export const handles = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-handle')].map(h=>{const r=h.getBoundingClientRect();return {t:h.title,x:r.x+r.width/2,y:r.y+r.height/2,w:r.width}}))`))
/** Select everything on the drawing layer with a Ctrl-drag marquee and delete it. */
export async function clearDrawing() {
  await setPen(false)
  await js(`document.querySelector('.cm-content')?.blur()`)
  const b = await canvasBox()
  await dragPath(line([b.x + 10, b.y + 10], [b.x + b.w - 10, b.y + b.h - 10], 10), { modifiers: CTRL })
  await sleep(150)
  await key("Backspace")
  await sleep(150)
}

// ---- the application menu (WRITEMIND_E2E hooks)
export const menu = async () => JSON.parse(await js(`window.wm.e2eMenu().then(JSON.stringify)`))
export const menuClick = (id) => js(`window.wm.e2eMenuClick(${JSON.stringify(id)})`)
/** Name the answer the next native open/save dialog gets. */
export const pickNext = (p) => js(`window.wm.e2ePick(${JSON.stringify(p)})`)
export const windowInfo = () => js(`window.wm.e2eWindow()`)
export const menuItem = async (top, label) => (await menu()).find((t) => t.label === top)?.submenu.find((i) => typeof label === "string" ? i.label === label : label.test(i.label))

// ---- the camera / tablet video pane
export async function showVideoPane() {
  await js(`!document.querySelector('.camera') && document.querySelector('[data-bar=video]')?.click()`)
  await waitFor(`!!document.querySelector('.camera')`)
}
/** Choose the pen tablet as the video pane's source. */
export async function pickTablet() {
  await js(`document.querySelector('[data-bar=video-options]').click()`)
  await sleep(150)
  await js(`document.querySelector('.video-pop [data-source=tablet]').click()`)
  await waitFor(`!!document.querySelector('.camera .tablet')`)
  await sleep(300)
}
/** Choose the (fake) camera as the video pane's source. */
export async function pickCamera() {
  await js(`document.querySelector('[data-bar=video-options]').click()`)
  await sleep(150)
  await js(`document.querySelector('.video-pop button:not([data-source])').click()`)
}
export const tabletBox = async () => JSON.parse(await js(`(()=>{const b=document.querySelector('.camera .tablet').getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})})()`))
export const barBtn = (k) => js(`document.querySelector('.camera-bar [data-tablet=${k}]').click()`)
export const takeBtn = (title) => js(`[...document.querySelectorAll('.camera-bar button')].find(b=>b.title.startsWith(${JSON.stringify(title)})).click()`)

// ---- restarting the whole app (same profile, same notes), e.g. to check that a session comes back
export async function restartApp(overrides = {}) {
  if (!INSTANCE_DIR) throw new Error("restartApp needs the runner (WM_INSTANCE_DIR)")
  try { page.close() } catch { /* gone */ }
  const inst = await restartInstance(INSTANCE_DIR, overrides)
  page = await connectCdp({ port: inst.port })
  watch(page)
  await appReady()
  await sleep(500)
  return inst
}
export { stopInstance }

// ---- the system clipboard, for the few tests that go through the shell's real clipboard (right-click menu)
/** Remember the text on the system clipboard; call the returned function to put it back (also done on exit). */
export function guardClipboard() {
  if (process.platform !== "win32") return () => {}
  const read = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" })
  const saved = read.status === 0 ? String(read.stdout ?? "") : null
  let done = false
  const restore = () => {
    if (done) return
    done = true
    if (saved === null) return
    if (saved.trim() === "") spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ''"])
    else spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], { input: saved.replace(/\r?\n$/, "") })
  }
  process.on("exit", restore)
  return restore
}

// ---- PEN CAPTURE (the native pen feed; docs/spikes/DESIGN-pen-capture.md)
/**
 * Historical name, kept so the tablet and pen scripts need no edit. Under WRITEMIND_E2E pen capture starts OFF (a test turns it on
 * with `wm.pen.e2e.config({ capture: true })`, see e2e/lib/penfeed.mjs), so the page takes the synthetic pen events the scripts
 * dispatch, as a plain pointer, and nothing covers the display. It only reloads the page for a clean start, as it always did.
 */
export async function noGrab() {
  await reloadApp()
}
/** Kept for old callers: there is no grab overlay any more (the pen sink only exists in the desktop suite). */
export const grabActive = async () => false

/** Close every open tab (a restored session may have brought some back). */
export async function closeAllTabs() {
  for (let i = 0; i < 20 && (await js(`document.querySelectorAll('.tab .close').length`)) > 0; i++) {
    await js(`document.querySelector('.tab .close').click()`)
    await sleep(200)
  }
}

/** Switch the rendered page on or off with the sidebar's markdown button and wait until it has really changed. */
export async function setRendered(want) {
  const is = () => js(`document.querySelector('.cm-editor')?.classList.contains('wm-rendered') ?? false`)
  if ((await is()) !== want) await js(`document.querySelector('[data-bar=markdown]')?.click()`)
  await until(async () => (await is()) === want, 5000, 100)
  await sleep(500)
}
