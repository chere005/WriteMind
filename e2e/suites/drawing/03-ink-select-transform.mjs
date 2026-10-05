// Ink with the pen (real pen pointer events through the input pipeline): strokes are saved, undo / redo take them
// back, a click on a stroke picks it, drag moves it, the Resize and Turn handles change it, a Ctrl-drag marquee
// picks many, Ctrl+G groups, Backspace deletes, Ctrl+Z restores. (Was tour/t10 and t11.)
import { ok, finish, js, sleep, freshNote, setPen, canvasBox, saved, handles, key, click, dragPath, line, shot, footer, CTRL } from "../../lib/harness.mjs"

const file = await freshNote()
const cb = await canvasBox()
const X = (dx) => cb.x + dx, Y = (dy) => cb.y + dy
const items = async () => (await saved(file)).items
const strokes = async () => (await items()).filter((i) => i.kind === "stroke")

// ---- draw three strokes with the pen
await setPen(true)
const wave = Array.from({ length: 40 }, (_, i) => [X(160 + i * 10), Y(220 + Math.sin(i / 3) * 40)])
await dragPath(wave, { pen: true })
let s = await strokes()
ok("a pen drag made one stroke", s.length === 1, JSON.stringify((await items()).map((i) => i.kind)))
await dragPath(line([X(180), Y(320)], [X(460), Y(400)], 30), { pen: true })
await dragPath(line([X(460), Y(320)], [X(180), Y(400)], 30), { pen: true })
s = await strokes()
ok("three strokes are saved", s.length === 3, String(s.length))
ok("the footer counts three objects", /3 objects/.test(await footer() ?? ""), await footer())
await shot("three-strokes")

// ---- undo / redo through the keyboard
await key("z", { ctrl: true }); await sleep(200)
ok("Ctrl+Z takes the last stroke back", (await strokes()).length === 2)
await key("z", { ctrl: true, shift: true }); await sleep(200)
ok("Ctrl+Shift+Z puts it back", (await strokes()).length === 3)

// ---- pick, move, resize, turn
await setPen(false)
await click(X(320), Y(360))                       // where the two diagonals cross
await sleep(200)
let hs = await handles()
ok("a click on the crossing picks a stroke and shows handles", hs.length >= 3, JSON.stringify(hs.map((h) => h.t)))
ok("with a Resize and a Turn handle", hs.some((h) => h.t === "Resize") && hs.some((h) => h.t === "Turn"), JSON.stringify(hs.map((h) => h.t)))
const before = (await strokes()).map((x) => x.transform ?? null)
// the picked stroke is whichever the click found; move it by dragging on it
await dragPath(line([X(320), Y(360)], [X(320), Y(500)], 15)); await sleep(200)
const afterMove = await strokes()
const moved = afterMove.filter((x, i) => JSON.stringify(x.transform ?? null) !== JSON.stringify(before[i]))
ok("dragging the picked stroke moves exactly one stroke", moved.length === 1, `${moved.length} changed`)
hs = await handles()
const resize = hs.find((h) => h.t === "Resize")
const w0 = (() => { const xs = hs.map((h) => h.x); return Math.max(...xs) - Math.min(...xs) })()
await dragPath(line([resize.x, resize.y], [resize.x + 100, resize.y + 60], 15)); await sleep(200)
hs = await handles()
const w1 = (() => { const xs = hs.map((h) => h.x); return Math.max(...xs) - Math.min(...xs) })()
ok("dragging Resize makes the selection bigger", w1 > w0 + 20, `${w0} -> ${w1}`)
const turn = hs.find((h) => h.t === "Turn")
const turnAt = { x: turn.x, y: turn.y }
await dragPath(line([turn.x, turn.y], [turn.x + 80, turn.y - 80], 15)); await sleep(200)
hs = await handles()
const turn2 = hs.find((h) => h.t === "Turn")
ok("dragging Turn swings the selection round (the handle moves)", turn2 && (Math.abs(turn2.x - turnAt.x) > 5 || Math.abs(turn2.y - turnAt.y) > 5), `${JSON.stringify(turnAt)} -> ${JSON.stringify(turn2)}`)
await shot("transformed")

// ---- a Ctrl-drag marquee picks everything, Ctrl+G groups, Backspace deletes, Ctrl+Z restores
await click(X(900), Y(700)); await sleep(100)
await dragPath(line([X(60), Y(120)], [X(cb.w - 80), Y(cb.h - 120)], 20), { modifiers: CTRL }); await sleep(250)
hs = await handles()
ok("a Ctrl-drag marquee over everything picks all three", hs.length >= 3, JSON.stringify(hs.map((h) => h.t)))
await key("g", { ctrl: true }); await sleep(250)
const groups = (await strokes()).map((x) => x.group ?? null)
ok("Ctrl+G holds them together (all three share one group id)", groups.length === 3 && groups[0] !== null && groups.every((x) => x === groups[0]), JSON.stringify(groups))
await key("Backspace"); await sleep(300)
ok("Backspace deletes the picked strokes", (await strokes()).length === 0, String((await strokes()).length))
await key("z", { ctrl: true }); await sleep(300)
ok("Ctrl+Z brings them back", (await strokes()).length === 3, String((await strokes()).length))
finish()
