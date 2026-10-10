/**
 * The Paper menu in the sheet's header: the kind of paper, its spacing and its colour (tabletPaper.ts). One icon
 * button with the menu's corner triangle, one page menu (FloatingMenu: arrows, Escape, clamped to the window, the
 * keyboard handed back); a choice applies at once and the menu stays up, so the three can be tried together.
 */

import { Icon } from "./icons"
import { MenuButton } from "./MenuButton"
import type { MenuItem } from "./FloatingMenu"
import { PAPER_COLOURS, PAPER_KINDS, PAPER_SPACINGS, pitchOf, setPaper, usePaper } from "./tabletPaper"

export function PaperMenu() {
  const paper = usePaper()
  const kind = PAPER_KINDS.find((one) => one.value === paper.kind)?.label ?? "Paper"
  const items: MenuItem[] = [
    ...PAPER_KINDS.map((one): MenuItem => ({
      label: one.label, checked: paper.kind === one.value, keepOpen: true, dataBar: `paper-${one.value}`,
      onClick: () => setPaper({ kind: one.value }),
    })),
    "-",
    { header: "Spacing" },
    {
      custom: (
        <span className="paper-chips" role="radiogroup" aria-label="Spacing">
          {PAPER_SPACINGS.map((one) => (
            <button key={one.value} type="button" role="radio" aria-checked={paper.spacing === one.value} data-paper-spacing={one.value}
                    disabled={pitchOf(paper.kind, one.value) === 0} onClick={() => setPaper({ spacing: one.value })}>{one.label}</button>
          ))}
        </span>
      ),
    },
    { header: "Colour" },
    {
      custom: (
        <span className="paper-chips" role="radiogroup" aria-label="Paper colour">
          {PAPER_COLOURS.map((one) => (
            <button key={one.value} type="button" role="radio" aria-checked={paper.colour === one.value} data-paper-colour={one.value}
                    onClick={() => setPaper({ colour: one.value })}>
              <span className="swatch" style={{ background: one.paper }} />{one.label}
            </button>
          ))}
        </span>
      ),
    },
  ]
  return (
    <MenuButton className="menu" data={{ tablet: "paper" }} title={`Paper: ${kind}. Dot grid, lines, squares, isometric dots, Cornell notes; spacing; white, cream or dark.`}
                items={items}>
      <Icon name="doc" />
    </MenuButton>
  )
}
