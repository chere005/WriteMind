import "./penGateBoot"   // FIRST: the pen gate's listeners must be the first capture listeners on window (penGate.ts)
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./app.css"
import "./chrome.css"
import "./bars.css"
import "./sidebar.css"
import "./tabs.css"
import { watchPen } from "./penSettings"
import { installPenCursor } from "./penCursor"
import { installPenFeed } from "./penFeed"
import { installDropGuard } from "./dropGuard"

watchPen()
installPenCursor()
installPenFeed()
installDropGuard()

// An app that silently does nothing is the worst kind: anything thrown in
// the renderer says so on screen, where it can be read, rather than in a
// console nobody has open. The note goes away by itself after a while and has
// a close button, and it sits over the top corner rather than the footers: one
// stray exception used to scar the window until a restart, over the project's
// Folder menu.
let hideTimer: number | undefined
function shout(message: string): void {
  // Chromium's report that a size observer settled over two frames: nothing is wrong.
  if (/ResizeObserver loop/.test(message)) return
  let bar = document.getElementById("wm-error")
  if (!bar) {
    const note = document.createElement("div")
    note.id = "wm-error"
    note.setAttribute("role", "alert")
    const text = document.createElement("span")
    text.className = "text"
    const close = document.createElement("button")
    close.type = "button"
    close.className = "close"
    close.title = "Dismiss"
    close.setAttribute("aria-label", "Dismiss")
    close.textContent = "×"
    close.addEventListener("click", () => note.remove())
    note.append(text, close)
    document.body.appendChild(note)
    bar = note
  }
  const text = bar.querySelector(".text")
  if (text) text.textContent = message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "")
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => document.getElementById("wm-error")?.remove(), 15000)
}

window.addEventListener("error", (event) => shout(`${event.message}`))
window.addEventListener("unhandledrejection", (event) =>
  shout(`${(event.reason as Error)?.message ?? event.reason}`))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
