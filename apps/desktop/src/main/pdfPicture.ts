/**
 * A Mac notebook's traced capture, as a picture this app can draw.
 *
 * The Mac turns the writing lifted off a photographed page into a VECTOR graphic — a one-page PDF in
 * `.drawings/media` (`InkVector.pdf`, `DrawingStore.importVector`) — and the drawing's sidecar names it like any
 * other picture. Chromium's `<img>` does not draw a PDF, so on Windows such a picture was a dashed empty box with
 * "could not load the picture TRACE-1.pdf" over the window, and the PDF export printed nothing for it.
 *
 * What the Mac writes is paths and nothing else: a fill colour, a flip into the trace's pixel coordinates, and the
 * loops of the writing filled even-odd. So this reads page 1 of a PDF and writes it out as an SVG — the same paths,
 * which stay vectors at any size — without a PDF engine: it finds the objects, inflates the page's content stream,
 * and walks the path, colour and matrix operators. Text, images, shadings and clipping are not drawn (a traced
 * capture has none); a file that has nothing to draw, or is not a PDF, answers null and the caller says so.
 *
 * It takes bytes and gives a string, and touches nothing else, so it is tested on PDFs built in the test (and on
 * the shape CoreGraphics writes).
 */

import zlib from "node:zlib"

// MARK: - PDF objects

type Obj = null | boolean | number | string | Name | Ref | Obj[] | Dict
class Name { constructor(readonly name: string) {} }
class Ref { constructor(readonly num: number) {} }
type Dict = { [key: string]: Obj }
interface Stream { dict: Dict; raw: Buffer }

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37

/** Reads PDF syntax from a latin1 string. */
class Lexer {
  constructor(readonly s: string, public i = 0) {}

  skip(): void {
    for (;;) {
      const c = this.s.charCodeAt(this.i)
      if (isWhite(c)) this.i++
      else if (c === 37) { while (this.i < this.s.length && this.s.charCodeAt(this.i) !== 10 && this.s.charCodeAt(this.i) !== 13) this.i++ }
      else return
    }
  }

  /** The next object, or a keyword (an operator, `R`, `obj`…) as a `Word`. */
  next(): Obj | Word | typeof END {
    this.skip()
    if (this.i >= this.s.length) return END
    const c = this.s.charCodeAt(this.i)
    if (c === 47) { // /Name
      this.i++
      let name = ""
      while (this.i < this.s.length) {
        const d = this.s.charCodeAt(this.i)
        if (isWhite(d) || isDelim(d)) break
        if (d === 35 && /^[0-9A-Fa-f]{2}$/.test(this.s.slice(this.i + 1, this.i + 3))) {
          name += String.fromCharCode(parseInt(this.s.slice(this.i + 1, this.i + 3), 16)); this.i += 3
        } else { name += this.s[this.i]; this.i++ }
      }
      return new Name(name)
    }
    if (c === 40) return this.string()
    if (c === 60) {
      if (this.s.charCodeAt(this.i + 1) === 60) { this.i += 2; return this.dict() }
      const close = this.s.indexOf(">", this.i)
      const hex = this.s.slice(this.i + 1, close < 0 ? this.s.length : close).replace(/\s+/g, "")
      this.i = close < 0 ? this.s.length : close + 1
      let out = ""
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16))
      return out
    }
    if (c === 91) { // [
      this.i++
      const list: Obj[] = []
      for (;;) {
        const item = this.next()
        if (item === END) return list
        if (item instanceof Word) {
          if (item.word === "]") return list
          if (item.word === "R" && list.length >= 2 && typeof list[list.length - 1] === "number" && typeof list[list.length - 2] === "number") {
            const gen = list.pop(); const num = list.pop()
            void gen
            list.push(new Ref(num as number))
            continue
          }
          if (item.word === "true") { list.push(true); continue }
          if (item.word === "false") { list.push(false); continue }
          if (item.word === "null") { list.push(null); continue }
          continue
        }
        list.push(item)
      }
    }
    if (c === 93) { this.i++; return new Word("]") }
    if (c === 62) { this.i += this.s.charCodeAt(this.i + 1) === 62 ? 2 : 1; return new Word(">>") }
    if (c === 123 || c === 125 || c === 41) { this.i++; return new Word(String.fromCharCode(c)) }
    // a number or a keyword
    const start = this.i
    while (this.i < this.s.length) {
      const d = this.s.charCodeAt(this.i)
      if (isWhite(d) || isDelim(d)) break
      this.i++
    }
    const token = this.s.slice(start, this.i)
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) return Number(token)
    return new Word(token)
  }

  private string(): string {
    this.i++
    let depth = 1
    let out = ""
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i]!
      this.i++
      if (ch === "\\") {
        const n = this.s[this.i]!
        this.i++
        if (n === "n") out += "\n"; else if (n === "r") out += "\r"; else if (n === "t") out += "\t"
        else if (n === "b") out += "\b"; else if (n === "f") out += "\f"
        else if (/[0-7]/.test(n)) {
          let oct = n
          while (oct.length < 3 && /[0-7]/.test(this.s[this.i] ?? "")) { oct += this.s[this.i]; this.i++ }
          out += String.fromCharCode(parseInt(oct, 8))
        } else if (n === "\r") { if (this.s[this.i] === "\n") this.i++ }
        else if (n !== "\n") out += n
      } else if (ch === "(") { depth++; out += ch }
      else if (ch === ")") { depth--; if (depth > 0) out += ch }
      else out += ch
    }
    return out
  }

  private dict(): Dict {
    const out: Dict = {}
    for (;;) {
      const key = this.next()
      if (key === END) return out
      if (key instanceof Word) { if (key.word === ">>") return out; continue }
      if (!(key instanceof Name)) continue
      out[key.name] = this.value()
    }
  }

  /** A value, with `n g R` folded into a reference. */
  value(): Obj {
    const before = this.i
    const first = this.next()
    if (first === END) return null
    if (first instanceof Word) {
      if (first.word === "true") return true
      if (first.word === "false") return false
      // (the close of the dictionary this value was missing from is not this value's to take)
      if (first.word === ">>" || first.word === "]") this.i = before
      return null
    }
    if (typeof first === "number" && Number.isInteger(first) && first >= 0) {
      const mark = this.i
      const second = this.next()
      if (typeof second === "number" && Number.isInteger(second) && second >= 0) {
        const third = this.next()
        if (third instanceof Word && third.word === "R") return new Ref(first)
      }
      this.i = mark
    }
    return first
  }
}
class Word { constructor(readonly word: string) {} }
const END = Symbol("end")

// MARK: - The file

interface Objects { get(num: number): Obj; stream(num: number): Stream | null; all(): number[] }

/** Finds every `n g obj … endobj` in the file (no cross-reference table is trusted) and the ones inside object streams. */
function readObjects(data: Buffer): Objects {
  const s = data.toString("latin1")
  const bodies = new Map<number, { dict: Obj; streamAt: number; streamLen: number | Ref | null }>()
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const num = Number(m[1])
    const lexer = new Lexer(s, m.index + m[0].length)
    const dict = lexer.value()
    lexer.skip()
    let streamAt = -1
    let streamLen: number | Ref | null = null
    if (dict && typeof dict === "object" && !Array.isArray(dict) && !(dict instanceof Name) && !(dict instanceof Ref) && s.startsWith("stream", lexer.i)) {
      let at = lexer.i + 6
      if (s[at] === "\r") at++
      if (s[at] === "\n") at++
      streamAt = at
      const length = (dict as Dict)["Length"]
      streamLen = typeof length === "number" ? length : length instanceof Ref ? length : null
    }
    bodies.set(num, { dict, streamAt, streamLen })
    if (streamAt >= 0) {
      // (binary data can hold anything, "1 0 obj" included: the scan goes on after the stream)
      const direct = typeof streamLen === "number" && s.startsWith("endstream", skipEol(s, streamAt + streamLen)) ? streamAt + streamLen : -1
      const found = direct >= 0 ? direct : s.indexOf("endstream", streamAt)
      re.lastIndex = found >= 0 ? found : streamAt
    }
  }

  const inner = new Map<number, Obj>()
  const api: Objects = {
    get(num) { return bodies.get(num)?.dict ?? inner.get(num) ?? null },
    stream(num) {
      const body = bodies.get(num)
      if (!body || body.streamAt < 0) return null
      let length = typeof body.streamLen === "number" ? body.streamLen : null
      if (body.streamLen instanceof Ref) { const len = api.get(body.streamLen.num); if (typeof len === "number") length = len }
      let end = -1
      if (length !== null && s.startsWith("endstream", skipEol(s, body.streamAt + length))) end = body.streamAt + length
      if (end < 0) {
        const found = s.indexOf("endstream", body.streamAt)
        if (found < 0) return null
        end = found
        if (s[end - 1] === "\n") end--
        if (s[end - 1] === "\r") end--
      }
      return { dict: body.dict as Dict, raw: data.subarray(body.streamAt, end) }
    },
    all() { return [...bodies.keys(), ...inner.keys()] },
  }

  // Objects inside object streams (PDF 1.5): their numbers come from the stream's own header.
  for (const num of [...bodies.keys()]) {
    const dict = bodies.get(num)!.dict
    if (!dict || typeof dict !== "object" || Array.isArray(dict) || dict instanceof Name || dict instanceof Ref) continue
    const type = (dict as Dict)["Type"]
    if (!(type instanceof Name) || type.name !== "ObjStm") continue
    const stream = api.stream(num)
    const bytes = stream && decode(stream, api)
    if (!bytes) continue
    const text = bytes.toString("latin1")
    const count = Number((dict as Dict)["N"])
    const first = Number((dict as Dict)["First"])
    if (!Number.isFinite(count) || !Number.isFinite(first)) continue
    const head = new Lexer(text)
    const entries: [number, number][] = []
    for (let k = 0; k < count; k++) {
      const a = head.next(); const b = head.next()
      if (typeof a === "number" && typeof b === "number") entries.push([a, b])
    }
    for (const [objNum, offset] of entries) {
      if (!inner.has(objNum) && !bodies.has(objNum)) inner.set(objNum, new Lexer(text, first + offset).value())
    }
  }
  return api
}

const skipEol = (s: string, at: number): number => {
  let i = at
  if (s[i] === "\r") i++
  if (s[i] === "\n") i++
  return i
}

const isDict = (o: Obj): o is Dict => typeof o === "object" && o !== null && !Array.isArray(o) && !(o instanceof Name) && !(o instanceof Ref)
const nameOf = (o: Obj): string | null => (o instanceof Name ? o.name : null)

/** A stream's bytes with its filters undone; null for one this cannot undo. */
function decode(stream: Stream, objects: Objects): Buffer | null {
  const resolve = (o: Obj): Obj => (o instanceof Ref ? objects.get(o.num) : o)
  let filters = resolve(stream.dict["Filter"])
  if (filters === null || filters === undefined) return Buffer.from(stream.raw)
  if (!Array.isArray(filters)) filters = [filters]
  let bytes = Buffer.from(stream.raw)
  for (const one of filters) {
    const name = nameOf(resolve(one))
    if (name === "FlateDecode" || name === "Fl") {
      try {
        bytes = zlib.inflateSync(bytes, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
      } catch {
        return null
      }
    } else if (name === "ASCIIHexDecode" || name === "AHx") {
      const hex = bytes.toString("latin1").replace(/[^0-9A-Fa-f]/g, "")
      bytes = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex")
    } else {
      return null
    }
  }
  return bytes
}

// MARK: - The page

interface Page { box: [number, number, number, number]; contents: Buffer[]; resources: Dict }

function findPage(objects: Objects): Page | null {
  const resolve = (o: Obj): Obj => (o instanceof Ref ? objects.get(o.num) : o)
  const numbers = (o: Obj): number[] | null => {
    const list = resolve(o)
    if (!Array.isArray(list) || list.length < 4) return null
    const values = list.map((one) => resolve(one))
    return values.every((v) => typeof v === "number") ? (values as number[]) : null
  }
  // The first leaf of the page tree from the catalog; else the first object that says it is a page.
  const hold: { page: Dict | null } = { page: null }
  const inherited: { box?: number[] | null; resources?: Obj } = {}
  const walk = (node: Obj, depth: number): boolean => {
    const dict = resolve(node)
    if (!isDict(dict) || depth > 32) return false
    const box = numbers(dict["MediaBox"]); if (box) inherited.box = box
    if (dict["Resources"] !== undefined) inherited.resources = dict["Resources"]
    const type = nameOf(dict["Type"] as Obj)
    if (type === "Page" || (dict["Kids"] === undefined && dict["Contents"] !== undefined)) { hold.page = dict; return true }
    const kids = resolve(dict["Kids"])
    if (Array.isArray(kids)) for (const kid of kids) { if (walk(kid, depth + 1)) return true }
    return false
  }
  let root: Obj = null
  for (const num of objects.all()) {
    const obj = objects.get(num)
    if (isDict(obj) && nameOf(obj["Type"] as Obj) === "Catalog") { root = obj["Pages"] ?? null; break }
  }
  if (root) walk(root, 0)
  if (!hold.page) {
    for (const num of objects.all()) {
      const obj = objects.get(num)
      if (isDict(obj) && nameOf(obj["Type"] as Obj) === "Page") {
        const box = numbers(obj["MediaBox"]); if (box) inherited.box = box
        if (obj["Resources"] !== undefined) inherited.resources = obj["Resources"]
        hold.page = obj
        break
      }
    }
  }
  const leaf = hold.page
  if (!leaf) return null
  const box = numbers(leaf["MediaBox"]) ?? inherited.box ?? null
  if (!box) return null
  const contents = resolve(leaf["Contents"] ?? null)
  const refs: Obj[] = Array.isArray(contents) ? contents : [leaf["Contents"] ?? null]
  const pieces: Buffer[] = []
  for (const ref of refs) {
    if (!(ref instanceof Ref)) continue
    const stream = objects.stream(ref.num)
    const bytes = stream && decode(stream, objects)
    if (!bytes) return null
    pieces.push(bytes)
  }
  const resources = resolve(leaf["Resources"] ?? inherited.resources ?? null)
  return {
    box: [Math.min(box[0]!, box[2]!), Math.min(box[1]!, box[3]!), Math.max(box[0]!, box[2]!), Math.max(box[1]!, box[3]!)],
    contents: pieces,
    resources: isDict(resources) ? resources : {},
  }
}

// MARK: - The content stream

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** `a` then `b` (PDF order: a point goes through `a` first). */
const times = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]

interface State {
  ctm: Matrix
  fill: string
  stroke: string
  fillAlpha: number
  strokeAlpha: number
  width: number
  cap: number
  join: number
  miter: number
  dash: number[]
  dashPhase: number
}

const num = (value: number): string => {
  const rounded = Math.round(value * 10000) / 10000
  return Object.is(rounded, -0) ? "0" : String(rounded)
}
const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0")
const gray = (g: number): string => `#${hex2(g)}${hex2(g)}${hex2(g)}`
const rgb = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`
const cmyk = (c: number, m: number, y: number, k: number): string => rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
function colour(operands: number[]): string | null {
  const v = operands.filter((o) => typeof o === "number")
  if (v.length === 1) return gray(v[0]!)
  if (v.length === 3) return rgb(v[0]!, v[1]!, v[2]!)
  if (v.length === 4) return cmyk(v[0]!, v[1]!, v[2]!, v[3]!)
  return null
}

interface Drawn { svg: string; unsupported: number; painted: number }

/** The path, colour and matrix operators of a content stream, as SVG elements. */
function interpret(content: string, page: Page, objects: Objects, depth = 0): Drawn {
  const out: string[] = []
  let unsupported = 0
  let painted = 0
  const resolve = (o: Obj): Obj => (o instanceof Ref ? objects.get(o.num) : o)
  const states = (() => {
    const group = resolve(page.resources["ExtGState"])
    return isDict(group) ? group : {}
  })()
  const xobjects = (() => {
    const group = resolve(page.resources["XObject"])
    return isDict(group) ? group : {}
  })()

  let state: State = {
    ctm: IDENTITY, fill: "#000000", stroke: "#000000", fillAlpha: 1, strokeAlpha: 1,
    width: 1, cap: 0, join: 0, miter: 10, dash: [], dashPhase: 0,
  }
  const stack: State[] = []
  let d = ""
  let current: [number, number] = [0, 0]
  let start: [number, number] = [0, 0]

  const lexer = new Lexer(content)
  let operands: Obj[] = []
  const numbers = (): number[] => operands.filter((o): o is number => typeof o === "number")

  const emit = (fill: boolean, stroke: boolean, evenOdd: boolean): void => {
    if (d === "") return
    painted++
    const attrs: string[] = [`d="${d}"`]
    if (fill) {
      attrs.push(`fill="${state.fill}"`)
      if (evenOdd) attrs.push('fill-rule="evenodd"')
      if (state.fillAlpha < 1) attrs.push(`fill-opacity="${num(state.fillAlpha)}"`)
    } else attrs.push('fill="none"')
    if (stroke) {
      attrs.push(`stroke="${state.stroke}"`, `stroke-width="${num(state.width)}"`)
      if (state.cap) attrs.push(`stroke-linecap="${state.cap === 1 ? "round" : "square"}"`)
      if (state.join) attrs.push(`stroke-linejoin="${state.join === 1 ? "round" : "bevel"}"`)
      if (state.miter !== 10) attrs.push(`stroke-miterlimit="${num(state.miter)}"`)
      if (state.dash.length) attrs.push(`stroke-dasharray="${state.dash.map(num).join(" ")}"`, `stroke-dashoffset="${num(state.dashPhase)}"`)
      if (state.strokeAlpha < 1) attrs.push(`stroke-opacity="${num(state.strokeAlpha)}"`)
    }
    const [a, b, c, dd, e, f] = state.ctm
    if (a !== 1 || b !== 0 || c !== 0 || dd !== 1 || e !== 0 || f !== 0) {
      attrs.push(`transform="matrix(${[a, b, c, dd, e, f].map(num).join(" ")})"`)
    }
    out.push(`<path ${attrs.join(" ")}/>`)
  }
  const endPath = (): void => { d = "" }
  const line = (x: number, y: number): void => { d += `L${num(x)} ${num(y)}`; current = [x, y] }

  for (;;) {
    const token = lexer.next()
    if (token === END) break
    if (!(token instanceof Word)) { operands.push(token); continue }
    const op = token.word
    const n = numbers()
    switch (op) {
      case "q": stack.push({ ...state, dash: [...state.dash] }); break
      case "Q": { const back = stack.pop(); if (back) state = back; break }
      case "cm": if (n.length >= 6) state.ctm = times(n.slice(-6) as Matrix, state.ctm); break
      case "w": if (n.length) state.width = n[n.length - 1]!; break
      case "J": if (n.length) state.cap = n[n.length - 1]!; break
      case "j": if (n.length) state.join = n[n.length - 1]!; break
      case "M": if (n.length) state.miter = n[n.length - 1]!; break
      case "d": {
        const list = operands.find((o): o is Obj[] => Array.isArray(o))
        state.dash = (list ?? []).filter((o): o is number => typeof o === "number" && o >= 0)
        state.dashPhase = n[n.length - 1] ?? 0
        if (state.dash.every((v) => v === 0)) state.dash = []
        break
      }
      case "gs": {
        const name = nameOf(operands[operands.length - 1] ?? null)
        const set = name ? resolve(states[name] ?? null) : null
        if (isDict(set)) {
          const ca = resolve(set["ca"] ?? null); const CA = resolve(set["CA"] ?? null)
          if (typeof ca === "number") state.fillAlpha = ca
          if (typeof CA === "number") state.strokeAlpha = CA
          const lw = resolve(set["LW"] ?? null)
          if (typeof lw === "number") state.width = lw
        }
        break
      }
      case "g": case "rg": case "k": { const c = colour(n); if (c) state.fill = c; break }
      case "G": case "RG": case "K": { const c = colour(n); if (c) state.stroke = c; break }
      case "sc": case "scn": { const c = colour(n); if (c) state.fill = c; break }
      case "SC": case "SCN": { const c = colour(n); if (c) state.stroke = c; break }
      case "cs": case "CS": break
      case "m": if (n.length >= 2) { const [x, y] = n.slice(-2) as [number, number]; d += `M${num(x)} ${num(y)}`; current = [x, y]; start = [x, y] } break
      case "l": if (n.length >= 2) { const [x, y] = n.slice(-2) as [number, number]; line(x, y) } break
      case "c": if (n.length >= 6) {
        const [x1, y1, x2, y2, x3, y3] = n.slice(-6) as number[]
        d += `C${num(x1!)} ${num(y1!)} ${num(x2!)} ${num(y2!)} ${num(x3!)} ${num(y3!)}`; current = [x3!, y3!]
      } break
      case "v": if (n.length >= 4) {
        const [x2, y2, x3, y3] = n.slice(-4) as number[]
        d += `C${num(current[0])} ${num(current[1])} ${num(x2!)} ${num(y2!)} ${num(x3!)} ${num(y3!)}`; current = [x3!, y3!]
      } break
      case "y": if (n.length >= 4) {
        const [x1, y1, x3, y3] = n.slice(-4) as number[]
        d += `C${num(x1!)} ${num(y1!)} ${num(x3!)} ${num(y3!)} ${num(x3!)} ${num(y3!)}`; current = [x3!, y3!]
      } break
      case "h": d += "Z"; current = start; break
      case "re": if (n.length >= 4) {
        const [x, y, w, h] = n.slice(-4) as number[]
        d += `M${num(x!)} ${num(y!)}L${num(x! + w!)} ${num(y!)}L${num(x! + w!)} ${num(y! + h!)}L${num(x!)} ${num(y! + h!)}Z`
        current = [x!, y!]; start = [x!, y!]
      } break
      case "f": case "F": emit(true, false, false); endPath(); break
      case "f*": emit(true, false, true); endPath(); break
      case "S": emit(false, true, false); endPath(); break
      case "s": d += "Z"; emit(false, true, false); endPath(); break
      case "B": emit(true, true, false); endPath(); break
      case "B*": emit(true, true, true); endPath(); break
      case "b": d += "Z"; emit(true, true, false); endPath(); break
      case "b*": d += "Z"; emit(true, true, true); endPath(); break
      case "n": endPath(); break
      case "W": case "W*": break // (clipping: a traced capture clips to its own page box, which the picture's box already is)
      case "Do": {
        const name = nameOf(operands[operands.length - 1] ?? null)
        // A form could hold more paths; the Mac's captures are flat. Counted so a picture made only of these says so.
        const form = name ? xobjects[name] : null
        if (form instanceof Ref && depth < 4) {
          const stream = objects.stream(form.num)
          const dict = stream?.dict
          if (stream && dict && nameOf(dict["Subtype"] as Obj) === "Form") {
            const bytes = decode(stream, objects)
            if (bytes) {
              const matrix = Array.isArray(dict["Matrix"]) && (dict["Matrix"] as Obj[]).length === 6 && (dict["Matrix"] as Obj[]).every((v) => typeof v === "number")
                ? (dict["Matrix"] as number[]) as Matrix : IDENTITY
              const inner = interpret(bytes.toString("latin1"), { ...page, resources: isDict(resolve(dict["Resources"] as Obj)) ? resolve(dict["Resources"] as Obj) as Dict : page.resources }, objects, depth + 1)
              if (inner.svg) out.push(`<g transform="matrix(${times(matrix, state.ctm).map(num).join(" ")})">${inner.svg}</g>`)
              painted += inner.painted; unsupported += inner.unsupported
              break
            }
          }
        }
        unsupported++
        break
      }
      case "BI": { // an inline image: skipped to its EI
        const end = content.indexOf("EI", lexer.i)
        lexer.i = end < 0 ? content.length : end + 2
        unsupported++
        break
      }
      case "sh": case "Tj": case "TJ": case "'": case '"': unsupported++; break
      default: break
    }
    operands = []
  }
  return { svg: out.join(""), unsupported, painted }
}

// MARK: - The picture

export interface PdfPicture {
  svg: string
  width: number
  height: number
}

/**
 * Page 1 of a PDF as an SVG, or null when the bytes are not a PDF this can read, or there is nothing on the
 * page it can draw. The SVG is the page's size in its own units (a traced capture's are the capture's pixels),
 * y running down.
 */
export function pdfToSvg(bytes: Uint8Array): PdfPicture | null {
  try {
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (!data.subarray(0, 1024).toString("latin1").includes("%PDF-")) return null
    const objects = readObjects(data)
    const page = findPage(objects)
    if (!page) return null
    const [x0, y0, x1, y1] = page.box
    const width = x1 - x0
    const height = y1 - y0
    if (!(width > 0) || !(height > 0)) return null
    const drawn = interpret(page.contents.map((piece) => piece.toString("latin1")).join("\n"), page, objects)
    if (drawn.painted === 0 && drawn.unsupported > 0) return null
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`
      + `<g transform="matrix(1 0 0 -1 ${num(-x0)} ${num(y1)})">${drawn.svg}</g></svg>`
    return { svg, width, height }
  } catch {
    return null
  }
}

/** A URL a page can load the SVG from without a file. */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`

/** Whether a media file is one of these (a traced capture from the Mac). */
export const isPdfPicture = (file: string): boolean => /\.pdf$/i.test(file)

// MARK: - From a file, remembered

const remembered = new Map<string, PdfPicture | null>()

/**
 * The picture in a PDF file, read once for as long as the file stays as it is (a page draws the same capture on every
 * repaint of its note, and an export reads it again). Null: it is not a PDF this can draw.
 */
export async function readPdfPicture(file: string): Promise<PdfPicture | null> {
  const { promises: fs } = await import("node:fs")
  const stat = await fs.stat(file)
  const key = `${file}|${stat.mtimeMs}|${stat.size}`
  if (remembered.has(key)) return remembered.get(key) ?? null
  const picture = pdfToSvg(await fs.readFile(file))
  if (remembered.size >= 24) remembered.delete(remembered.keys().next().value as string)
  remembered.set(key, picture)
  return picture
}
