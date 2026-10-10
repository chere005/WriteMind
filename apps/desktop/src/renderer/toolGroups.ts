/**
 * The sections of the bar over the note: four, since 2026-10-10 (docs/PLAN-bars-2026-10.md P1). The Mac's six
 * (Style, Structure, Insert, Maths, Flow Chart, Pen) became Text, Blocks, Insert and Pen when the inserts stopped being
 * collapsed into one button and the maths and the shapes became two of them (Sean: "don't collapse the inserts into one
 * button.. it should have text box, picture, table, maths"). A section is put away in the Customize toolbar… checklist
 * (right-click the bar, or ⋯), and a put-away section is shown nowhere else: no grip, no stand-in icon.
 */

export const TOOL_GROUPS = [
  { id: "text", title: "Text" },
  { id: "blocks", title: "Blocks" },
  { id: "insert", title: "Insert" },
  { id: "pen", title: "Pen" },
] as const
export type ToolGroupId = typeof TOOL_GROUPS[number]["id"]

/** The old id of each of the six sections → the new one that took it over. */
const WAS: Record<string, ToolGroupId> = {
  style: "text", structure: "blocks", insert: "insert", maths: "insert", flowchart: "insert", capture: "pen",
}

/**
 * What was remembered as put away by the six old sections (`collapsedGroups`), brought to the four: an old id puts away the
 * section that took it over — but Insert took three (Insert, Maths, Flow Chart), so it is away only when all three were:
 * one of them put away must not take the whole of the new Insert section with it. Unknown ids go. (The four are
 * remembered under their own key, `toolSections`, so an old "insert" is never mistaken for the new one.)
 */
export function migrateCollapsed(old: readonly string[]): ToolGroupId[] {
  const was = new Set(old)
  return TOOL_GROUPS.map((group) => group.id).filter((id) =>
    Object.entries(WAS).filter(([, to]) => to === id).every(([from]) => was.has(from)))
}

/** The four sections as remembered: a list of ids put away, ignoring anything that is not one of them. */
export const sectionsAway = (kept: unknown): ToolGroupId[] =>
  Array.isArray(kept) ? TOOL_GROUPS.map((group) => group.id).filter((id) => kept.includes(id)) : []
