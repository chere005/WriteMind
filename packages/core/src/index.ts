/**
 * WriteMind's model, with no platform in it at all.
 *
 * Everything here was ported from the macOS app's pure layer — the parser,
 * the formatting commands, the cell and seam arithmetic, the note rows —
 * and the tests beside it were transcribed with it. That is what made the
 * port tractable: the rules already had no AppKit in them, and the suite
 * says so on both sides.
 */

export * from "./text/range"
// The parser re-exports `Range` from there; everything else is its own.
export {
  blocks, positioned, heading, isRule, todoItem, bulletItem, dashItem, numberedItem,
  type Block, type PositionedBlock, type TodoItem,
} from "./markdown/parser"
export * from "./markdown/formatting"
export * from "./markdown/code"
export * from "./markdown/spans"
export * from "./cells/selection"
export * from "./cells/outline"
export * from "./cells/folding"
export * from "./cells/editing"
export * from "./cells/types"
export * from "./cells/seams"
export * from "./cells/commands"
export * from "./notes/note"
export * from "./notes/order"
export * from "./notes/writing"
export * from "./notes/session"
export * from "./notes/linking"
export * from "./drawing/shapes"
export * from "./drawing/model"
export * from "./drawing/geometry"
export * from "./drawing/groups"
export * from "./drawing/placement"
export * from "./drawing/pen"
export * from "./drawing/routing"
export * from "./drawing/textBox"
export * from "./capture/page"
export * from "./capture/warp"
export * from "./capture/ink"
export * from "./capture/rects"
export * from "./capture/shapeInk"
export * from "./capture/flowGrouping"
export * from "./capture/flowChart"
export * from "./math/expression"
export * from "./math/typesetter"
export * from "./math/templates"
export * from "./platform/capabilities"
