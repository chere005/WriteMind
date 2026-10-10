/**
 * ONE icon set for every bar: 16px, a 1.5px line, round caps, the colour of the text around it
 * (`currentColor`), the way the Mac's SF Symbols sit in a toolbar. The sidebar's drawn icons were the
 * model; the toolbar, tab bar, camera header and handles used to be text characters (B ☰ ❝ {} ⇤ ⤒ ⟳ …),
 * which every system font draws with another weight, width and baseline, and some draw as an empty box.
 *
 * Why strings and not one component per icon: the paths are fixed data, written once, and the set is read
 * at a glance in the wireframes (docs/ui-2026-10/). Nothing here is user input.
 */

import type { CSSProperties } from "react"

const PATHS = {
  edit: "<path d=\"M7.5 2.75H3.75a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V8.5\"/><path d=\"m6.75 9.25.5-2.25 5.25-5.25 1.75 1.75L9 8.75z\"/>",
  secup: "<path d=\"M3 2.75h10\"/><path d=\"M8 13.5V5.75\"/><path d=\"m4.75 9 3.25-3.25L11.25 9\"/>",
  secdown: "<path d=\"M3 13.25h10\"/><path d=\"M8 2.5v7.75\"/><path d=\"m4.75 7 3.25 3.25L11.25 7\"/>",
  sidebar: "<rect x=\"1.75\" y=\"3\" width=\"12.5\" height=\"10\" rx=\"1.5\"/><path d=\"M6 3v10\"/>",
  chev: "<path d=\"M4.5 6.5 8 10l3.5-3.5\"/>",
  chevr: "<path d=\"M6.5 4.5 10 8l-3.5 3.5\"/>",
  chevl: "<path d=\"M9.5 4.5 6 8l3.5 3.5\"/>",
  search: "<circle cx=\"7\" cy=\"7\" r=\"4.25\"/><path d=\"m10.5 10.5 3.5 3.5\"/>",
  plus: "<path d=\"M8 3.5v9M3.5 8h9\"/>",
  chevu: "<path d=\"M4.5 9.5 8 6l3.5 3.5\"/>",
  replace: "<path d=\"M2.5 5.5h9.5M9.75 3 12.25 5.5 9.75 8\"/><path d=\"M13.5 10.5H4M6.25 8 3.75 10.5 6.25 13\"/>",
  more: "<circle cx=\"3.5\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"8\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"12.5\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  folder: "<path d=\"M1.75 4.5A1.5 1.5 0 0 1 3.25 3h3l1.5 1.5h5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z\"/>",
  doc: "<path d=\"M4 1.75h5.5L13 5.25v9H4z\"/><path d=\"M9.5 1.75v3.5H13\"/>",
  eye: "<path d=\"M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z\"/><circle cx=\"8\" cy=\"8\" r=\"2\"/>",
  camera: "<path d=\"M2 5.5h3l1-1.75h4l1 1.75h3v7H2z\"/><circle cx=\"8\" cy=\"9\" r=\"2.25\"/>",
  tablet: "<rect x=\"2\" y=\"2.5\" width=\"12\" height=\"11\" rx=\"1.5\"/><path d=\"m5.5 10.5.75-2.75L10 4l2 2-3.75 3.75z\"/>",
  link: "<path d=\"M6.5 9.5 9.5 6.5\"/><path d=\"M7 4.75 8.25 3.5a2.47 2.47 0 0 1 3.5 3.5L10.5 8.25\"/><path d=\"M9 11.25 7.75 12.5a2.47 2.47 0 0 1-3.5-3.5L5.5 7.75\"/>",
  list: "<path d=\"M5.5 4h8.5M5.5 8h8.5M5.5 12h8.5\"/><circle cx=\"2.5\" cy=\"4\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"2.5\" cy=\"8\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"2.5\" cy=\"12\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>",
  listnum: "<path d=\"M6 4h8M6 8h8M6 12h8\"/><path d=\"M2 3.25h1.25V5.5M2 10.25a1.1 1.1 0 1 1 2 .65L2 13h2.25\" stroke-width=\"1.2\"/>",
  listdash: "<path d=\"M6 4h8M6 8h8M6 12h8M1.5 4h2.5M1.5 8h2.5M1.5 12h2.5\"/>",
  listcheck: "<path d=\"M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5\"/><rect x=\"1.5\" y=\"2.5\" width=\"3\" height=\"3\" rx=\".6\"/><path d=\"m2.1 4 .7.7 1.3-1.5\" stroke-width=\"1.1\"/><rect x=\"1.5\" y=\"6.5\" width=\"3\" height=\"3\" rx=\".6\"/><rect x=\"1.5\" y=\"10.5\" width=\"3\" height=\"3\" rx=\".6\"/>",
  quote: "<path fill=\"currentColor\" stroke=\"none\" d=\"M3 8c0-2.4 1.4-4.1 3.6-4.6v1.4C5.4 5.2 4.9 6 4.8 7H6.5v4H3zM9.3 8c0-2.4 1.4-4.1 3.6-4.6v1.4c-1.2.4-1.7 1.2-1.8 2.2h1.7v4H9.3z\"/>",
  code: "<path d=\"m5.25 4.75-3.5 3.25 3.5 3.25M10.75 4.75l3.5 3.25-3.5 3.25\"/>",
  indent: "<path d=\"M2 3.25h12M7.5 7h6.5M7.5 10.5h6.5M2 13.75h12\"/><path d=\"m2.5 6.75 2 2-2 2\"/>",
  outdent: "<path d=\"M2 3.25h12M7.5 7h6.5M7.5 10.5h6.5M2 13.75h12\"/><path d=\"m4.5 6.75-2 2 2 2\"/>",
  textbox: "<rect x=\"2\" y=\"2.5\" width=\"12\" height=\"11\" rx=\"1\" stroke-dasharray=\"2 1.6\"/><path d=\"M5.25 6h5.5M8 6v5\"/>",
  image: "<rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" rx=\"1.5\"/><path d=\"m2.5 11.5 3.5-3.5 2.5 2.5 2-2 3 3\"/><circle cx=\"10.5\" cy=\"6\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/>",
  table: "<rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" rx=\"1\"/><path d=\"M2 6.5h12M2 9.75h12M6.25 3v10M9.75 3v10\" stroke-width=\"1.2\"/>",
  math: "<path d=\"M3.75 3.25h8.5L7.5 8l4.75 4.75h-8.5\"/>",
  drawcell: "<rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" rx=\"1.5\"/><path d=\"M4.5 10.25c1.4-3 2.4-3 3.5-1s2.1 1 3.5-2.25\"/>",
  cursor: "<path d=\"M4 2.5 12.5 8.5 8.75 9.25 10.75 13 9 13.75 7 10 4.5 12.5z\" fill=\"currentColor\" fill-opacity=\".15\"/>",
  pen: "<path d=\"m3 13 .75-3.25L10.5 3l2.5 2.5-6.75 6.75z\"/><path d=\"m9.25 4.25 2.5 2.5\"/>",
  select: "<rect x=\"2.5\" y=\"2.5\" width=\"11\" height=\"11\" rx=\"1\" stroke-dasharray=\"2.2 1.6\"/>",
  eraser: "<path d=\"m2.75 9.75 6-6a1.5 1.5 0 0 1 2.1 0l2.9 2.9a1.5 1.5 0 0 1 0 2.1l-3.75 3.75H6.5z\"/><path d=\"m6 7 4 4\"/><path d=\"M9.5 12.5h4\"/>",
  shapes: "<circle cx=\"6\" cy=\"6\" r=\"4\"/><rect x=\"7.5\" y=\"7.5\" width=\"6.5\" height=\"6.5\" rx=\"1\"/>",
  check: "<path d=\"m3 8.5 3 3 7-7\"/>",
  rotate: "<path d=\"M13.25 8A5.25 5.25 0 1 1 11.3 3.9\"/><path d=\"M13.25 2.5v3.25H10\"/>",
  rotl: "<path d=\"M2.75 8A5.25 5.25 0 1 0 4.7 3.9\"/><path d=\"M2.75 2.5v3.25H6\"/>",
  zoom: "<circle cx=\"7\" cy=\"7\" r=\"4.25\"/><path d=\"m10.5 10.5 3.5 3.5M5 7h4M7 5v4\"/>",
  pause: "<path d=\"M5.5 3.5v9M10.5 3.5v9\" stroke-width=\"2\"/>",
  straighten: "<path d=\"M3.75 3.5h8.5l1 9h-10.5z\"/><path d=\"M6.25 3.5 5.5 12.5M9.75 3.5l.75 9\" stroke-width=\"1\"/>",
  close: "<path d=\"m4 4 8 8M12 4l-8 8\"/>",
  undo: "<path d=\"M5.5 5.25H10a3 3 0 0 1 0 6H6.5\"/><path d=\"m7.5 2.75-2.5 2.5 2.5 2.5\"/>",
  para: "<path d=\"M12.25 2.5H6.75a3 3 0 0 0 0 6h1.5M9.75 2.5v11M12.25 2.5v11\"/>",
  find: "<circle cx=\"7\" cy=\"7\" r=\"4.25\"/><path d=\"m10.5 10.5 3.5 3.5\"/>",
  grip: "<circle cx=\"6\" cy=\"4\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"10\" cy=\"4\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"6\" cy=\"8\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"10\" cy=\"8\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"6\" cy=\"12\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"10\" cy=\"12\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>",
} as const

export type IconName = keyof typeof PATHS

interface Props {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}

/** A decorative icon: the button around it carries the name (aria-label / title). */
export function Icon({ name, size = 16, className, style }: Props) {
  return (
    <svg className={className ? `wm-icon ${className}` : "wm-icon"} width={size} height={size} viewBox="0 0 16 16"
         fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false" style={style}
         dangerouslySetInnerHTML={{ __html: PATHS[name] }} />
  )
}
