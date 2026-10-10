import { mkdtempSync, mkdirSync, truncateSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { makeNote } from "@writemind/core"
import { MAX_HITS, NotesSearch, diskSearchPorts, whereOf, type SearchPorts, type SearchSection } from "../src/main/notesSearch"
import { projectTree, setProjectFolders, setExcluded, setWatched, writeNote } from "../src/main/notes"
import { loadNote, lookText } from "../src/main/wmStore"
import { writeWm } from "./wmFiles"

/**
 * The sidebar's search over the real note files (the text entry of a `.wm`, read through the note store), and over a fake
 * disk where what is being asked — how often the disk was read, whether the event loop got its turns, a search stopped half
 * way — needs a disk that can be counted.
 */

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wm-search-"))
afterEach(() => { setProjectFolders([]); setExcluded([]); setWatched([]) })

const treeOf = (folder: string) => projectTree([folder], folder, "Project")
const titles = (found: { hits: { title: string }[] }) => found.hits.map((hit) => hit.title)

/** The disk's ports with a count of what was asked of them. */
function counting(): { ports: SearchPorts; reads: string[]; stats: number } {
  const log = { reads: [] as string[], stats: 0 }
  return {
    reads: log.reads,
    get stats() { return log.stats },
    ports: {
      stat: (file) => { log.stats++; return diskSearchPorts.stat(file) },
      text: (file) => { log.reads.push(path.basename(file)); return diskSearchPorts.text(file) },
    },
  }
}

describe("searching real notes", () => {
  it("finds a note by its title, by its words, and by the file's name, and says where each is", async () => {
    const home = scratch()
    writeWm(path.join(home, "Heat.wm"), "# Heat flow\nthe gauge reads low\n")
    writeWm(path.join(home, "Ideas", "Spring.wm"), "# Spring plan\nplant the gauge seeds\n")
    writeWm(path.join(home, "Ideas", "2026", "Gauge notes.wm"), "just words\n")
    const found = await new NotesSearch().run(1, await treeOf(home), "gauge")
    expect(found.searched).toBe(3)
    const byTitle = Object.fromEntries(found.hits.map((hit) => [hit.title, hit]))
    // title "Gauge notes" is the file name's (the note has no heading) — a title match, first
    expect(found.hits[0]!.title).toBe("Gauge notes")
    expect(byTitle["Gauge notes"]!.where).toBe("Ideas › 2026")
    expect(byTitle["Heat flow"]!.where).toBe(path.basename(home))
    expect(byTitle["Heat flow"]!.snippet).toEqual({ text: "the gauge reads low", mark: { from: 4, to: 9 } })
    expect(byTitle["Spring plan"]!.where).toBe("Ideas")
    expect(byTitle["Spring plan"]!.matched).toBe("gauge")
  })

  it("is case-blind and accent-blind, in the words and in the title", async () => {
    const home = scratch()
    writeWm(path.join(home, "a.wm"), "# Le Café\nUne ÉCOLE de musique\n")
    const tree = await treeOf(home)
    const search = new NotesSearch()
    expect(titles(await search.run(1, tree, "CAFE"))).toEqual(["Le Café"])
    const school = await search.run(2, tree, "ecole")
    expect(school.hits[0]!.matched).toBe("ÉCOLE")
    expect(school.hits[0]!.snippet.mark).toEqual({ from: 4, to: 9 })
    expect((await search.run(3, tree, "école")).hits).toHaveLength(1)
  })

  it("ranks a title that starts with the words, then one that has them, then the file name, then the words; newest first within each", async () => {
    const home = scratch()
    const old = Date.now() / 1000 - 5000
    const make = (name: string, text: string, age: number) => {
      const file = writeWm(path.join(home, name), text)
      utimesSync(file, old + age, old + age)
    }
    make("body.wm", "# Zeta\nsome kiwi here\n", 4)
    make("named kiwi.wm", "# Plain\nnothing\n", 3)
    make("contains.wm", "# Big kiwi pie\n", 2)
    make("starts old.wm", "# Kiwi old\n", 0)
    make("starts new.wm", "# Kiwi new\n", 1)
    const found = await new NotesSearch().run(1, await treeOf(home), "kiwi")
    expect(titles(found)).toEqual(["Kiwi new", "Kiwi old", "Big kiwi pie", "Plain", "Zeta"])
    expect(found.hits.map((hit) => hit.tier)).toEqual([0, 0, 1, 2, 3])
  })

  it("is nothing for a blank query and for a project with no tree", async () => {
    const home = scratch()
    writeWm(path.join(home, "a.wm"), "words\n")
    const search = new NotesSearch()
    expect((await search.run(1, await treeOf(home), "   ")).hits).toEqual([])
    expect((await search.run(2, null, "words")).hits).toEqual([])
  })

  it("does not search a note's pictures, ink or markup", async () => {
    const home = scratch()
    writeWm(path.join(home, "a.wm"), "# A\n![shot](media/screenshot.png)\n<!-- markdown -->\n[home](https://example.com/page)\n")
    const search = new NotesSearch()
    const tree = await treeOf(home)
    expect((await search.run(1, tree, "screenshot")).hits).toEqual([])
    expect((await search.run(2, tree, "markdown")).hits).toEqual([])
    expect((await search.run(3, tree, "example")).hits).toEqual([])
    expect((await search.run(4, tree, "home")).hits).toHaveLength(1)
  })

  it("names the folders of a project of several: the folder first", async () => {
    const one = path.join(scratch(), "Work")
    const two = path.join(scratch(), "Home")
    writeWm(path.join(one, "a.wm"), "# A\nshared word\n")
    writeWm(path.join(two, "Sub", "b.wm"), "# B\nshared word\n")
    setProjectFolders([one, two])
    const tree = await projectTree([one, two], one, "Both")
    const found = await new NotesSearch().run(1, tree, "shared")
    expect(Object.fromEntries(found.hits.map((hit) => [hit.title, hit.where]))).toEqual({ A: "Work", B: "Home › Sub" })
  })

  it("finds a note that is in the tree twice (a project folder inside another) once", async () => {
    const outer = scratch()
    const inner = path.join(outer, "Inner")
    writeWm(path.join(inner, "n.wm"), "# N\nfindme\n")
    setProjectFolders([outer, inner])
    const tree = await projectTree([outer, inner], outer, "P")
    const found = await new NotesSearch().run(1, tree, "findme")
    expect(found.hits).toHaveLength(1)
    expect(found.searched).toBe(1)
  })

  it("is not fooled by a note's drawing or pictures being most of the file (only the words are read)", async () => {
    const home = scratch()
    writeWm(path.join(home, "big.wm"), "# Big\nneedle in here\n", {
      entries: { "media/huge.png": new Uint8Array(3_000_000).fill(7) },
      drawing: JSON.stringify({ items: [] }),
    })
    const found = await new NotesSearch().run(1, await treeOf(home), "needle")
    expect(found.hits).toHaveLength(1)
  })
})

describe("what the search reads", () => {
  it("is each note once: a second search asks the disk only whether the file moved", async () => {
    const home = scratch()
    for (let i = 0; i < 20; i++) writeWm(path.join(home, `n${i}.wm`), `# Note ${i}\nword${i}\n`)
    const tree = await treeOf(home)
    const disk = counting()
    const search = new NotesSearch(disk.ports)
    await search.run(1, tree, "word3")
    expect(disk.reads).toHaveLength(20)
    await search.run(2, tree, "word4")
    await search.run(3, tree, "word5")
    expect(disk.reads).toHaveLength(20)
    expect(disk.stats).toBe(60)
  })

  it("reads again only the note whose time or size moved", async () => {
    const home = scratch()
    writeWm(path.join(home, "a.wm"), "# A\nalpha\n")
    const b = writeWm(path.join(home, "b.wm"), "# B\nbeta\n")
    const tree = await treeOf(home)
    const disk = counting()
    const search = new NotesSearch(disk.ports)
    await search.run(1, tree, "alpha")
    disk.reads.length = 0
    // another program changes b (new words, so a new size and time)
    writeWm(b, "# B\nbeta and gamma and more\n")
    const found = await search.run(2, tree, "gamma")
    expect(disk.reads).toEqual(["b.wm"])
    expect(titles(found)).toEqual(["B"])
  })

  it("forgets a note that is gone, and does not find it", async () => {
    const home = scratch()
    writeWm(path.join(home, "a.wm"), "# A\nalpha\n")
    const gone = writeWm(path.join(home, "gone.wm"), "# Gone\nalpha too\n")
    const tree = await treeOf(home)
    const search = new NotesSearch()
    expect((await search.run(1, tree, "alpha")).hits).toHaveLength(2)
    const { rmSync } = await import("node:fs")
    rmSync(gone)
    const found = await search.run(2, tree, "alpha")
    expect(titles(found)).toEqual(["A"])
    expect(found.unreadable).toBe(0)
    expect(search.held.notes).toBe(1)
  })

  it("keeps its cache to a bound, the oldest read first out", async () => {
    const home = scratch()
    for (let i = 0; i < 6; i++) writeWm(path.join(home, `n${i}.wm`), `# N${i}\n${"x".repeat(400)}\n`)
    const search = new NotesSearch(diskSearchPorts, 2500)
    await search.run(1, await treeOf(home), "x")
    expect(search.held.chars).toBeLessThanOrEqual(2500)
    expect(search.held.notes).toBeGreaterThan(0)
    expect(search.held.notes).toBeLessThan(6)
  })
})

describe("a note that is being written, damaged or gone", () => {
  it("is read whole, old or new, while the app is writing it", async () => {
    const home = scratch()
    const file = writeWm(path.join(home, "live.wm"), "# Live\nfirst words\n")
    await loadNote(file)
    const tree = await treeOf(home)
    for (let round = 0; round < 12; round++) {
      const text = `# Live\nround ${round} ${"padding ".repeat(2000)}\n`
      const search = new NotesSearch()
      const [found] = await Promise.all([search.run(round, tree, "words round"), writeNote(file, text)])
      expect(found.unreadable).toBe(0)
      expect(found.searched).toBe(1)
      // (the first look is of the words as they were or as they became, never of half of either)
      const now = await new NotesSearch().run(100 + round, tree, `round ${round}`)
      expect(now.hits).toHaveLength(1)
      await loadNote(file)
    }
  })

  it("is found by its title and file name when its zip is damaged, and counted as unreadable", async () => {
    const home = scratch()
    writeWm(path.join(home, "fine.wm"), "# Fine\nbroken is a word here\n")
    writeFileSync(path.join(home, "broken one.wm"), Buffer.from("this is not a zip file at all"))
    writeFileSync(path.join(home, "empty.wm"), "")
    const cut = writeWm(path.join(home, "cut.wm"), "# Cut\nbroken words\n", { entries: { "media/x.bin": new Uint8Array(5000).fill(3) } })
    truncateSync(cut, 120)
    const found = await new NotesSearch().run(1, await treeOf(home), "broken")
    // the fine note by its words, the damaged one by its file name (its title is its file name: nothing could be read)
    expect(titles(found).sort()).toEqual(["Fine", "broken one"].sort())
    expect(found.unreadable).toBe(3)
    const another = await new NotesSearch().run(2, await treeOf(home), "nothing like it")
    expect(another.hits).toEqual([])
  })

  it("rejects, in the note store, a file that has no text entry with a message that names the note", async () => {
    const home = scratch()
    const file = path.join(home, "no text.wm")
    writeFileSync(file, Buffer.alloc(40, 1))
    await expect(lookText(file)).rejects.toThrow(/no text\.wm cannot be opened as a WriteMind note/)
  })

  it("skips a note moved away between the tree and the search, without calling it unreadable", async () => {
    const home = scratch()
    const a = writeWm(path.join(home, "a.wm"), "# A\nsame\n")
    writeWm(path.join(home, "b.wm"), "# B\nsame\n")
    const tree = await treeOf(home)
    const { renameSync } = await import("node:fs")
    renameSync(a, path.join(home, "moved.wm"))
    const found = await new NotesSearch().run(1, tree, "same")
    expect(titles(found)).toEqual(["B"])
    expect(found.unreadable).toBe(0)
  })
})

describe("a lot of notes", () => {
  /** A tree of `n` notes in a few sections, with a disk that is a Map. */
  function fake(n: number, delay = 0) {
    const files = new Map<string, string>()
    const sections: SearchSection[] = Array.from({ length: 6 }, (_, s) => ({ path: `/p/s${s}`, name: `s${s}`, depth: 1, notes: [], sections: [] }))
    for (let i = 0; i < n; i++) {
      const file = `/p/s${i % 6}/n${i}.wm`
      files.set(file, `# Note ${i}\nfiller words ${"lorem ".repeat(30)}\ntoken${i} end\n`)
      sections[i % 6]!.notes.push(makeNote(file, i, files.get(file)!))
    }
    const root: SearchSection = { path: "/p", name: "p", depth: 0, notes: [], sections }
    const asked = { reads: 0 }
    const ports: SearchPorts = {
      stat: async () => ({ mtimeMs: 1, size: 1 }),
      text: async (file) => {
        asked.reads++
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        const text = files.get(file)
        if (text === undefined) throw Object.assign(new Error("gone"), { code: "ENOENT" })
        return text
      },
    }
    return { root, ports, asked, files }
  }

  it("searches three thousand and finds the one, and the event loop is given a turn all the way through", async () => {
    const { root, ports } = fake(3000)
    const search = new NotesSearch(ports)
    let turns = 0
    const timer = setInterval(() => { turns++ }, 1)
    const started = performance.now()
    const found = await search.run(1, root, "TOKEN2999")
    const first = performance.now() - started
    clearInterval(timer)
    expect(found.searched).toBe(3000)
    expect(titles(found)).toEqual(["Note 2999"])
    // never one long block: the timer, which needs the loop, ran while the notes were being looked at
    expect(turns).toBeGreaterThan(5)
    // and from the cache the next is fast
    const again = performance.now()
    await search.run(2, root, "token7")
    expect(performance.now() - again).toBeLessThan(Math.max(500, first))
  }, 30_000)

  it("stops when it is cancelled, between two batches, and says so", async () => {
    const { root, ports, asked } = fake(2000, 1)
    const search = new NotesSearch(ports)
    const running = search.run(7, root, "token")
    await new Promise((resolve) => setTimeout(resolve, 30))
    search.cancel(7)
    const found = await running
    expect(found.cancelled).toBe(true)
    expect(found.hits).toEqual([])
    expect(asked.reads).toBeLessThan(2000)
    // a search is not stopped by the cancel of one that has ended, and a later one with the same id runs
    search.cancel(7)
    const next = await search.run(7, fake(5).root, "note")
    expect(next.cancelled).toBe(false)
    expect(next.hits.length).toBeGreaterThan(0)
  })

  it("sends the best two hundred and says there were more", async () => {
    const { root, ports } = fake(MAX_HITS + 50)
    const found = await new NotesSearch(ports).run(1, root, "filler")
    expect(found.hits).toHaveLength(MAX_HITS)
    expect(found.more).toBe(true)
  })
})

describe("where a note is", () => {
  it("is the project folder's name for a note in it, and its sections below that", () => {
    expect(whereOf([{ name: "Notes", depth: 0 }], false)).toBe("Notes")
    expect(whereOf([{ name: "Notes", depth: 0 }, { name: "A", depth: 1 }, { name: "B", depth: 2 }], false)).toBe("A › B")
  })
  it("leads with the folder when the project has several", () => {
    expect(whereOf([{ name: "Project", depth: -1 }, { name: "Work", depth: 0 }, { name: "Sub", depth: 1 }], true)).toBe("Work › Sub")
  })
})
