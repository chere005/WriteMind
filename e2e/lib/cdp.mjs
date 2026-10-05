// A small Chrome DevTools Protocol client for the WriteMind test instances.
//
//   const page = await connectCdp({ port: 9400 })              // the main window
//   const grab = await connectCdp({ port: 9400, match: "grab=1" })   // another page
//   await page.js("document.title")
//
// Node 22+ has WebSocket and fetch built in, so there are no dependencies.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The list of debuggable targets on a port (the pages of every window). */
export async function targetsOf(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  return res.json()
}

/**
 * Connect to one page of a running instance.
 * @param {{port:number, match?:string, exclude?:string, timeoutMs?:number}} o
 *   match: a substring of the page URL (default: the main window, which is any page that is not the grab overlay).
 */
export async function connectCdp({ port, match, exclude = "grab=1", timeoutMs = 30000 }) {
  const end = Date.now() + timeoutMs
  let pick = null
  let lastError = null
  while (Date.now() < end) {
    try {
      const all = await targetsOf(port)
      const pages = all.filter((t) => t.type === "page")
      pick = match ? pages.find((t) => t.url.includes(match)) : pages.find((t) => !t.url.includes(exclude)) ?? null
      if (pick) break
    } catch (error) { lastError = error }
    await sleep(250)
  }
  if (!pick) throw new Error(`no page target on port ${port}${match ? ` matching ${match}` : ""}${lastError ? ` (${lastError.message})` : ""}`)

  const ws = new WebSocket(pick.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error("websocket to the page failed"))
  })
  let id = 0
  const waiting = new Map()
  const listeners = new Map()
  let closed = false
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.id !== undefined) {
      waiting.get(data.id)?.(data)
      waiting.delete(data.id)
    } else if (data.method) {
      for (const fn of listeners.get(data.method) ?? []) fn(data.params)
    }
  }
  ws.onclose = () => {
    closed = true
    for (const [, resolve] of waiting) resolve({ error: { message: "page closed" } })
    waiting.clear()
  }

  /** Raw CDP call; resolves with the whole reply ({result} or {error}). */
  const send = (method, params = {}) => new Promise((resolve) => {
    if (closed) return resolve({ error: { message: "page closed" } })
    const n = ++id
    waiting.set(n, resolve)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  /** Subscribe to a CDP event (Runtime.exceptionThrown, ...). Returns an unsubscribe function. */
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set())
    listeners.get(method).add(fn)
    return () => listeners.get(method)?.delete(fn)
  }
  /** Evaluate an expression in the page; resolves with the JSON-able value. Throws on a page exception. */
  const js = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (reply.error) throw new Error(`CDP: ${reply.error.message}`)
    if (reply.result?.exceptionDetails) {
      const d = reply.result.exceptionDetails
      throw new Error((d.exception?.description || d.text || "page exception") + " in: " + expression.slice(0, 160))
    }
    return reply.result?.result?.value
  }
  const screenshot = async (file) => {
    const { writeFileSync, mkdirSync } = await import("node:fs")
    const { dirname } = await import("node:path")
    const reply = await send("Page.captureScreenshot", { format: "png" })
    if (!reply.result?.data) throw new Error("screenshot failed: " + JSON.stringify(reply.error))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(reply.result.data, "base64"))
    return file
  }
  const close = () => { try { ws.close() } catch { /* already gone */ } }
  return { send, js, on, screenshot, close, url: pick.url, title: pick.title, port }
}

/** Retry `fn` until it returns something truthy (or time runs out). */
export async function until(fn, ms = 8000, every = 100) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    await sleep(every)
  }
  return false
}

export { sleep }
