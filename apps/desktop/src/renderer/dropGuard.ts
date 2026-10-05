/**
 * A file let go anywhere in the window that does not take it must not become the window.
 * Chromium's answer to a drop nobody handled is to NAVIGATE to the file: drop a note, or
 * a picture, on the sidebar or the tab row and the whole app is replaced by that file.
 * The places that take a drop (the page takes a picture, the sidebar takes a row) handle
 * the event and have prevented it already; this is the last listener, and it only
 * prevents the default for a drag that carries files, and shows it as a drop that will
 * not happen.
 */

const carriesFiles = (event: DragEvent): boolean => {
  const types = event.dataTransfer?.types
  return types !== undefined && Array.from(types).includes("Files")
}

export function installDropGuard(target: Window = window): () => void {
  const over = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    // (a place that takes the drop has called preventDefault already, and keeps its effect)
    if (!event.defaultPrevented && event.dataTransfer) event.dataTransfer.dropEffect = "none"
    event.preventDefault()
  }
  const drop = (event: DragEvent) => { if (carriesFiles(event)) event.preventDefault() }
  target.addEventListener("dragover", over)
  target.addEventListener("drop", drop)
  return () => {
    target.removeEventListener("dragover", over)
    target.removeEventListener("drop", drop)
  }
}
