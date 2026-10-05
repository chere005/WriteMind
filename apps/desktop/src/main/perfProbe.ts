/**
 * Measuring the MAIN process (WRITEMIND_E2E only): which IPC channels are called, how often and for how long, and a
 * sampling profile of the shell's own JavaScript. The page's side is measured over the DevTools protocol
 * (Performance.getMetrics, Profiler); the shell has no such door, so this is it — reached through
 * `window.wm.e2ePerf(...)` and used by `e2e/perf/*.mjs` (docs/PERF.md). Nothing here runs in a normal launch.
 */

import { Session } from "node:inspector"
import type { IpcMain } from "electron"

interface Stat { n: number; ms: number; max: number }

interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  children?: number[]
}

export function installPerfProbe(ipc: IpcMain): void {
  const stats = new Map<string, Stat>()
  // Wrap what is registered already (the handlers are added before this runs), and count what is added later.
  const handlers = (ipc as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
  const wrap = (channel: string, fn: (...args: unknown[]) => unknown) => async (...args: unknown[]) => {
    const t = performance.now()
    try { return await fn(...args) } finally {
      const ms = performance.now() - t
      const s = stats.get(channel) ?? { n: 0, ms: 0, max: 0 }
      s.n++
      s.ms += ms
      s.max = Math.max(s.max, ms)
      stats.set(channel, s)
    }
  }
  if (handlers) for (const [channel, fn] of [...handlers]) if (!channel.startsWith("e2e:")) handlers.set(channel, wrap(channel, fn))

  let session: Session | null = null
  const post = (method: string, params?: object): Promise<unknown> => new Promise((resolve, reject) => {
    session!.post(method, params, (error, result) => (error ? reject(error) : resolve(result)))
  })

  ipc.handle("e2e:perf", async (_event, command: string, arg?: unknown) => {
    switch (command) {
      case "stats": {
        const out = Object.fromEntries([...stats].map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms * 100) / 100, max: Math.round(v.max * 100) / 100 }]))
        if (arg === "reset") stats.clear()
        return out
      }
      case "reset": stats.clear(); return true
      case "cpu": return process.cpuUsage()
      case "mem": return process.memoryUsage()
      case "profile:start": {
        session = new Session()
        session.connect()
        await post("Profiler.enable")
        await post("Profiler.setSamplingInterval", { interval: 200 })
        await post("Profiler.start")
        return true
      }
      case "profile:stop": {
        if (!session) return null
        const { profile } = await post("Profiler.stop") as {
          profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }
        }
        session.disconnect()
        session = null
        const byId = new Map(profile.nodes.map((n) => [n.id, n]))
        const self = new Map<string, number>()
        let total = 0
        for (let i = 0; i < profile.samples.length; i++) {
          const cf = byId.get(profile.samples[i]!)!.callFrame
          const key = `${cf.functionName || "(anon)"} ${cf.url.split(/[\\/]/).pop()}:${cf.lineNumber + 1}`
          const dt = profile.timeDeltas[i] ?? 0
          self.set(key, (self.get(key) ?? 0) + dt)
          total += dt
        }
        const top = [...self].filter(([k]) => !k.startsWith("(idle)")).sort((a, b) => b[1] - a[1]).slice(0, Number(arg) || 25)
          .map(([k, v]) => ({ at: k, ms: Math.round(v / 10) / 100 }))
        const idle = self.get("(idle) :0") ?? 0
        return { sampledMs: Math.round(total / 1000), idleMs: Math.round(idle / 1000), top }
      }
      default: return null
    }
  })
}
