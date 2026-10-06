// Real typing and the formatting keys: list continuation, bold / italic / underline / strike, headings, fences,
// split and merge, Tab, undo / redo, Alt-D, the inline styles. (Was tour/t01, t02, p3.)
import { ok, finish, js, sleep, freshNote, setDoc, doc, sel, ranges, setSel, key, typeKeys, focus, shot } from "../../lib/harness.mjs"

await freshNote()
const eq = async (name, want) => { const d = await doc(); ok(name, d === want, `${JSON.stringify(d)} want ${JSON.stringify(want)}`) }

// ---- typing a page: what is typed into a text cell is literal (docs/PLAN-text-cells.md, 2026-10-05), its markup
// written with backslashes; a title is made with Ctrl-1, a list carries on from one that is there
await setDoc(""); await focus()
await typeKeys("# My Title\n\nHello world. This is body.\n\n- one\ntwo\n\n")
await eq("typed markup stays literal in a text cell", "\\# My Title\n\nHello world. This is body.\n\n\\- one\ntwo\n\n")
await shot("typed")

// ---- lists carry on, an empty item ends the list (the empty item Return leaves is the list's, not a text cell's)
await setDoc("- one"); await setSel(5); await focus()
await typeKeys("\ntwo\nthree\n\n")
await eq("a bullet list carries on and an empty item ends it", "- one\n- two\n- three\n")
await setDoc("1. a"); await setSel(4); await focus()
await typeKeys("\nb\nc\n")
await eq("a numbered list counts on", "1. a\n2. b\n3. c\n4. ")
await setDoc("- [ ] task"); await setSel(10); await focus()
await typeKeys("\nnext\n")
await eq("a to-do list carries on with an open box", "- [ ] task\n- [ ] next\n- [ ] ")

// ---- the formatting keys (a text cell formatted becomes a markdown cell: its marker goes in above the words)
const MD = "<!-- markdown -->\n"
await setDoc("hello world"); await setSel(0, 5); await focus()
await key("b", { ctrl: true }); await eq("Ctrl-B wraps in **", MD + "**hello** world")
await key("b", { ctrl: true }); await eq("Ctrl-B again unwraps", MD + "hello world")
await key("i", { ctrl: true }); await eq("Ctrl-I wraps in _", MD + "_hello_ world")
await setDoc("hello world"); await setSel(0, 5)
await key("u", { ctrl: true }); await eq("Ctrl-U wraps in <u>", MD + "<u>hello</u> world")
await setDoc("hello world"); await setSel(0, 5)
await key("x", { ctrl: true, shift: true }); await eq("Ctrl-Shift-X strikes through", MD + "~~hello~~ world")
await setDoc("hello"); await setSel(2)
await key("1", { ctrl: true }); await eq("Ctrl-1 makes a title", "# hello")
await key("7", { ctrl: true }); await eq("Ctrl-7 makes it body text again", "hello")
await key("8", { ctrl: true })
ok("Ctrl-8 opens a code fence", (await doc()).includes("```\n"), JSON.stringify(await doc()))

// ---- split and merge a cell
await setDoc("ab\n\ncd"); await setSel(1)
await key("d", { ctrl: true }); await eq("Ctrl-D splits the cell at the caret", "a\n\nb\n\ncd")
await key("m", { ctrl: true }); await eq("Ctrl-M merges the next cell into this one", "a\n\nb\ncd")

// ---- Tab indents a list item
await setDoc("- a"); await setSel(3); await focus()
await key("Tab"); await eq("Tab indents a list item four spaces", "    - a")
await key("Tab", { shift: true }); await eq("Shift-Tab takes it out again", "- a")

// ---- undo and redo
await setDoc(""); await focus()
await typeKeys("hello there"); await sleep(600); await typeKeys(" friend")
await key("z", { ctrl: true }); await eq("Ctrl-Z takes back the last burst of typing", "hello there")
await key("z", { ctrl: true, shift: true }); await eq("Ctrl-Shift-Z puts it back", "hello there friend")
await key("z", { ctrl: true })
await key("y", { ctrl: true }); await eq("Ctrl-Y redoes too", "hello there friend")

// ---- Alt-D picks the word, then the next one like it
await setDoc("foo bar foo baz foo"); await setSel(1); await focus()
await key("d", { alt: true })
ok("Alt-D takes the word under the caret", JSON.stringify(await ranges()) === "[[0,3]]", JSON.stringify(await ranges()))
await key("d", { alt: true })
ok("and again adds the next occurrence", JSON.stringify(await ranges()) === "[[0,3],[8,11]]", JSON.stringify(await ranges()))

// ---- code: brackets type through, Tab indents inside a fence
await setDoc("```ts\n\n```"); await setSel(6); await focus()
await typeKeys("f()")
await eq("brackets typed in a code block stay as typed", "```ts\nf()\n```")
await key("Tab")
// (CodeTyping.swift: Tab in a fence puts the unit WHERE THE CARET IS, four spaces in the markdown pane; it used to
// indent the line from its start, the markdown command. Changed 2026-10-03, e2-editor-polish.)
ok("Tab inside a code block puts four spaces at the caret", (await doc()).includes("f()    \n"), JSON.stringify(await doc()))

// ---- inline styles read the way Markdown does (not snake_case_name, not 2 * 3 * 4)
await setDoc("a *it* b _it2_ c **bo** __bo2__ d snake_case_name e 2 * 3 * 4 `**x**` ~~s~~ [l_a_b](u_r_l.md)"); await sleep(300)
const toks = JSON.parse(await js(`JSON.stringify(Object.fromEntries(['wm-italic','wm-bold','wm-code','wm-strike','wm-link'].map(c=>[c,[...document.querySelectorAll('.'+c)].map(e=>e.textContent)])))`))
ok("*it* and _it2_ are italic, snake_case_name is not", JSON.stringify(toks["wm-italic"]) === '["it","it2"]', JSON.stringify(toks["wm-italic"]))
ok("**bo** and __bo2__ are bold", JSON.stringify(toks["wm-bold"]) === '["bo","bo2"]', JSON.stringify(toks["wm-bold"]))
ok("code keeps its stars to itself", JSON.stringify(toks["wm-code"]) === '["**x**"]', JSON.stringify(toks["wm-code"]))
ok("~~s~~ is struck through", JSON.stringify(toks["wm-strike"]) === '["s"]')
ok("a link's text keeps its underscores", JSON.stringify(toks["wm-link"]) === '["l_a_b"]', JSON.stringify(toks["wm-link"]))
finish()
