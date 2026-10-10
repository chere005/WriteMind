/**
 * WHAT THE PEN IS DOING, SAID IN WORDS (docs/PLAN-bars-2026-10.md, P6): the footer's chip, the chip floating on the page, and
 * the Escape that stops what it names.
 *
 * A pane that swallows every click comes up in whichever mode it was left in, so something on screen has to say why (the
 * Mac names the mode in its footer whenever it is not the notebook's: AGENTS.md, "THE PANE HAS ONE MODE"). The footer chip is
 * the short form, `Pen · 3 px`, a live region a screen reader hears when it changes; the page's chip adds how to stop it,
 * `Pen · 3 px · Esc to stop`. They read the pen state the toolbar owns — the mode, the width, the two one-gesture tools
 * (`penSettings`) and an armed shape (App's `placing`) — and own none of it. Pure, so the text is tested.
 */

import { placementTitle, shapeTitle, type Placement } from "@writemind/core"

export interface ModeFacts {
  /** The pen is down: the layer takes the pane (the pen button lit). */
  pen: boolean
  penWidth: number
  /** The Erase tool is on. */
  eraser: boolean
  /** The Select tool is on. */
  selectTool: boolean
  /** A shape or an arrow is armed: the next click or drag puts it down. */
  placing: Placement | null
}

export interface ModeChip {
  kind: "placing" | "select" | "eraser" | "pen"
  /** The short form: "Pen · 3 px". */
  text: string
  /** How it stops: "Esc to stop" (a tool) or "Esc to cancel" (a placement). */
  hint: string
}

/** A width as a person says it: 3, 2.5, never 2.50 or 3.0. */
export const widthText = (width: number): string => `${Math.round(width * 10) / 10} px`

/**
 * What is on, or null when the pane is the notebook's. A placement outranks a tool (arming one puts the tools down, and
 * the page says what the next click does), the Select tool and the Eraser outrank the pen they are used with.
 */
export function modeChip(facts: ModeFacts): ModeChip | null {
  if (facts.placing) {
    const name = facts.placing.kind === "shape" ? shapeTitle(facts.placing.shape) : placementTitle(facts.placing)
    return { kind: "placing", text: `Placing: ${name}`, hint: "Esc to cancel" }
  }
  if (facts.selectTool) return { kind: "select", text: "Select tool", hint: "Esc to stop" }
  if (facts.eraser) return { kind: "eraser", text: "Eraser", hint: "Esc to stop" }
  if (facts.pen) return { kind: "pen", text: `Pen · ${widthText(facts.penWidth)}`, hint: "Esc to stop" }
  return null
}

/** The page chip's whole line: "Pen · 3 px · Esc to stop". */
export const chipLine = (chip: ModeChip): string => `${chip.text} · ${chip.hint}`

export interface EscapeFacts {
  /** The press was already used by something that said so (`defaultPrevented`): a menu, a dialog, the layer's own pick. */
  handled: boolean
  /** The press is in a field (a rename, a label, the find box) or in another pane (the camera, the tablet sheet): theirs. */
  elsewhere: boolean
  /** The pen, a tool or a placement is on. */
  on: boolean
}

/**
 * Whether Escape puts the pen, the tool or the placement down: only when the press was nobody else's. (One Escape is one
 * thing: a menu closes, or a pick lets go, or a crop is dropped, or — nothing else wanting it — the pen goes up, and the
 * chip's own "Esc to stop" is true.)
 */
export function escapeStops(facts: EscapeFacts): boolean {
  return facts.on && !facts.handled && !facts.elsewhere
}
