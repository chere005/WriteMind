// Shared by the sidebar scripts: a notes folder to look at, and the page's state read in one call.
import fs from "node:fs"
import { js, sleep, notesDir, resetNotes, writeNoteFile, reloadApp, menuClick } from "../../lib/harness.mjs"

/** ⌘ on a Mac, Ctrl elsewhere: the chord's modifier for the keys the page owns. */
export const MOD = process.platform === "darwin" ? { meta: true } : { ctrl: true }

/** The folder the scripts search and edit: notes in the root, in sections and in a subsection, with ages so the order is known. */
export async function seed() {
  await resetNotes({ reload: false })
  const now = Date.now() / 1000
  const make = async (rel, text, age) => { const file = await writeNoteFile(rel, text); fs.utimesSync(file, now - age, now - age) }
  await make("Demo note.wm", "# Demo note\nA paragraph of bold and italic words, with code.\nthe gauge was read twice\n", 10)
  await make("Short.wm", "# Short\nTiny snippet.\n", 20)
  await make("Sections/A very long note title number two that keeps going past the width of the sidebar.wm", "# A very long note title number two that keeps going past the width of the sidebar\nText here.\n", 30)
  await make("Sections/Second note.wm", "# Second note\nText here. The Gauge reads low in the morning.\n", 40)
  await make("Research Projects/Reading list.wm", "# Reading list\n- [ ] Paper one\n- [x] Paper two\n", 50)
  await make("Research Projects/Quantum Computing Notes/Qubits.wm", "# Qubits\nCafé notes about gauge theory\nsecond line with CAFÉ again\n", 60)
  await make("Gauge basics.wm", "# Gauge basics\nnothing else\n", 70)
  await reloadApp()
  // The video pane may start open; the commands close it on any build (the tab row's button is another branch's).
  if (await js(`!!document.querySelector('.camera')`)) { await menuClick("toggleCamera"); await sleep(300) }
  return notesDir()
}

/** What the sidebar shows right now. */
export const side = async () => JSON.parse(await js(`JSON.stringify((() => {
  const q = (s) => document.querySelector(s)
  const rows = [...document.querySelectorAll('.hit-row')].map((r) => ({
    path: r.dataset.hit, title: r.querySelector('.title').textContent, mark: r.querySelector('.title mark')?.textContent ?? null,
    snippet: r.querySelector('.snippet')?.textContent ?? null, snippetMark: r.querySelector('.snippet mark')?.textContent ?? null,
    where: r.querySelector('.where')?.textContent ?? null, active: r.classList.contains('active'),
  }))
  return {
    sidebar: !!q('.sidebar'), results: !!q('.results'), hits: rows, tree: document.querySelectorAll('.note-row').length,
    field: q('[data-sidebar=search]')?.value ?? null, focused: document.activeElement?.dataset?.sidebar ?? document.activeElement?.className ?? '',
    status: q('[data-sidebar=no-matches]')?.textContent ?? q('[data-sidebar=searching]')?.textContent ?? null,
    bar: (() => { const b = q('.sidebar-bar'); if (!b) return null; const r = b.getBoundingClientRect(); return { h: r.height, kids: [...b.querySelectorAll('[data-bar],[data-sidebar=search]')].map((e) => e.dataset.bar ?? e.dataset.sidebar) } })(),
    find: (() => { const f = q('[data-bar=find]'); return f ? { value: f.querySelector('input').value } : null })(),
  }
})())`))
