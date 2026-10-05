import { describe, expect, it } from "vitest"
import { endInkScope, inkScope, scopedPress, scopePenTo, subscribeInkScope } from "../src/renderer/inkScope"

/** A pen for one new ink cell (Sean, 2026-10-05): what a press does while the pen is scoped to a cell. */
describe("inkScope", () => {
  it("holds one cell and tells its listeners once per change", () => {
    let heard = 0
    const stop = subscribeInkScope(() => { heard++ })
    scopePenTo("cell-1")
    scopePenTo("cell-1")
    expect(inkScope()).toBe("cell-1")
    endInkScope()
    expect(inkScope()).toBeNull()
    expect(heard).toBe(2)
    stop()
  })

  it("a press in the cell draws; anywhere else ends the scope, and a stroke from a pen that always draws is swallowed", () => {
    expect(scopedPress("c", false, "c", false)).toBe("draw")
    expect(scopedPress("c", false, null, false)).toBe("end")
    expect(scopedPress("c", false, "other", false)).toBe("end")
    expect(scopedPress("c", false, null, true)).toBe("end-swallow-stroke")
  })

  it("does nothing with no scope, or with the pen down for the whole page", () => {
    expect(scopedPress(null, false, "c", true)).toBe("none")
    expect(scopedPress("c", true, null, true)).toBe("none")
  })
})
