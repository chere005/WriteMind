/**
 * Find in the note: the bar the Mac's text view puts over its pane (`usesFindBar`), with
 * Find and Replace. Ctrl+F opens it, Enter / F3 go to the next match and Shift+Enter /
 * Shift+F3 to the previous (it wraps round), Esc puts it away and gives the note back
 * its caret. Every match is lit while it is open and the count says where you are.
 * The model is the core's `text/find`; the highlights and the moves are the editor
 * package's `find`.
 */

import { useEffect, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import { findCount, findFromSelection, findNextMatch, replaceEvery, replaceMatch, setFind } from "@writemind/editor"
import { findSession } from "./findSession"

export interface FindRequest {
  /** "replace" also shows the replace row. */
  mode: "find" | "replace"
  /** Words to start from (the selection), or null to keep what the bar has. */
  seed: string | null
  /** Bumps when the bar is asked for again, so an open bar takes the focus back. */
  tick: number
}

interface Props {
  view: EditorView | null
  request: FindRequest
  /** The words last looked for, kept by the page for Find Next with the bar away. */
  onQuery(query: string): void
  onClose(): void
}

export function FindBar({ view, request, onQuery, onClose }: Props) {
  // (What it held when it was last closed, until the app quits: findSession.ts.)
  const [query, setQuery] = useState(request.seed ?? findSession.query)
  const [replacement, setReplacement] = useState(findSession.replacement)
  const [caseSensitive, setCaseSensitive] = useState(findSession.caseSensitive)
  const [wholeWord, setWholeWord] = useState(findSession.wholeWord)
  const [replacing, setReplacing] = useState(request.mode === "replace")
  const [count, setCount] = useState({ total: 0, index: 0 })
  useEffect(() => { findSession.replacement = replacement }, [replacement])
  // Typing (or a switch) moves the selection to the first match as it goes; opening the bar on words it remembers does not.
  const typed = useRef(false)
  const input = useRef<HTMLInputElement | null>(null)
  const replaceInput = useRef<HTMLInputElement | null>(null)

  // Asked for again (Ctrl+F on an open bar, Ctrl+H): take the words and the focus.
  useEffect(() => {
    if (request.seed !== null) setQuery(request.seed)
    if (request.mode === "replace") setReplacing(true)
    const target = request.mode === "replace" && request.seed !== null ? replaceInput.current : input.current
    ;(target ?? input.current)?.focus()
    ;(target ?? input.current)?.select()
  }, [request.tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // The highlights follow the words typed and the switches; a different note (a different view) gets them too.
  useEffect(() => {
    if (!view) return
    view.dispatch({ effects: setFind.of({ query, caseSensitive, wholeWord }) })
    onQuery(query)
    Object.assign(findSession, { query, caseSensitive, wholeWord })
    // Incremental, as the Mac's bar is: the first match from where the selection starts is selected as it is typed.
    if (query.length > 0 && typed.current) findFromSelection(view)
    typed.current = false
    setCount(findCount(view.state))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, query, caseSensitive, wholeWord])

  // The count follows edits and moves made in the note itself.
  useEffect(() => {
    if (!view) return
    const tick = window.setInterval(() => {
      const now = findCount(view.state)
      setCount((was) => (was.total === now.total && was.index === now.index ? was : now))
    }, 150)
    return () => window.clearInterval(tick)
  }, [view])

  // Away: no highlights left behind.
  useEffect(() => () => { view?.dispatch({ effects: setFind.of(null) }) }, [view])

  const go = (backwards: boolean) => {
    if (!view) return
    findNextMatch(view, backwards)
    setCount(findCount(view.state))
  }
  const close = () => {
    onClose()
    view?.focus()
  }

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return }
    const control = event.ctrlKey || event.metaKey
    if (event.key === "Enter" && !control && event.target === input.current) { event.preventDefault(); go(event.shiftKey); return }
    if (event.key === "F3") { event.preventDefault(); go(event.shiftKey); return }
    if (event.key === "Enter" && event.target === replaceInput.current) {
      event.preventDefault()
      if (view) { if (event.ctrlKey || event.altKey) replaceEvery(view, replacement); else replaceMatch(view, replacement) }
      setCount(view ? findCount(view.state) : count)
    }
  }

  const label = query.length === 0 ? "" : count.total === 0 ? "Not found" : count.index > 0 ? `${count.index} of ${count.total}` : `${count.total} found`

  return (
    <div className="find-bar" role="search" onKeyDown={keys} data-bar="find">
      <div className="find-row">
        <input ref={input} className="find-input" placeholder="Find" value={query} spellCheck={false}
               aria-label="Find" onChange={(event) => { typed.current = true; setQuery(event.target.value) }} />
        <button className={`find-toggle${caseSensitive ? " on" : ""}`} aria-pressed={caseSensitive} title="Match case"
                data-find="case" onClick={() => { typed.current = true; setCaseSensitive((was) => !was) }}>Aa</button>
        <button className={`find-toggle${wholeWord ? " on" : ""}`} aria-pressed={wholeWord} title="Whole words"
                data-find="word" onClick={() => { typed.current = true; setWholeWord((was) => !was) }}>ab</button>
        <span className={`find-count${query.length > 0 && count.total === 0 ? " none" : ""}`} data-find="count">{label}</span>
        <button className="find-step" title="Previous match (Shift+Enter)" aria-label="Previous match" data-find="prev"
                onClick={() => go(true)} disabled={count.total === 0}>↑</button>
        <button className="find-step" title="Next match (Enter)" aria-label="Next match" data-find="next"
                onClick={() => go(false)} disabled={count.total === 0}>↓</button>
        <button className={`find-toggle${replacing ? " on" : ""}`} aria-pressed={replacing} title="Replace" data-find="replace-toggle"
                onClick={() => setReplacing((was) => !was)}>⇄</button>
        <button className="find-step" title="Close (Esc)" aria-label="Close find" data-find="close" onClick={close}>×</button>
      </div>
      {replacing && (
        <div className="find-row">
          <input ref={replaceInput} className="find-input" placeholder="Replace with" value={replacement} spellCheck={false}
                 aria-label="Replace with" onChange={(event) => setReplacement(event.target.value)} />
          <button className="find-action" data-find="replace" disabled={count.total === 0}
                  onClick={() => { if (view) { replaceMatch(view, replacement); setCount(findCount(view.state)) } }}>Replace</button>
          <button className="find-action" data-find="replace-all" disabled={count.total === 0}
                  onClick={() => { if (view) { replaceEvery(view, replacement); setCount(findCount(view.state)) } }}>Replace All</button>
        </div>
      )}
    </div>
  )
}
