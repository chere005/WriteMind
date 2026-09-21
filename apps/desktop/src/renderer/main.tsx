import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./app.css"

// An app that silently does nothing is the worst kind: anything thrown in
// the renderer says so on screen, where it can be read, rather than in a
// console nobody has open.
function shout(message: string): void {
  let bar = document.getElementById("wm-error")
  if (!bar) {
    bar = document.createElement("div")
    bar.id = "wm-error"
    document.body.appendChild(bar)
  }
  bar.textContent = message
}

window.addEventListener("error", (event) => shout(`${event.message}`))
window.addEventListener("unhandledrejection", (event) =>
  shout(`${(event.reason as Error)?.message ?? event.reason}`))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
