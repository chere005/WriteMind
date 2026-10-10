// Helpers for the overlay scripts (docs/PLAN-bars-2026-10.md, P6): find, the link picker, the dialogs, the popovers.
// `mod` is the platform's command key as a harness modifier (Cmd on a Mac, Ctrl elsewhere): the app's key table is
// CmdOrCtrl, so a script that types Ctrl on a Mac presses a key that does nothing.
import { js, sleep, waitFor } from "./harness.mjs"

export const MAC = process.platform === "darwin"
export const mod = MAC ? { meta: true } : { ctrl: true }
/** The "Find and Replace…" chord: Ctrl+H on a PC, ⌥⌘F on a Mac (Cmd+H hides the app there). */
export const replaceChord = MAC ? { key: "f", opts: { meta: true, alt: true } } : { key: "h", opts: { ctrl: true } }

/** The element's rect, or null. */
export const box = async (selector) => JSON.parse(await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,r:r.right,b:r.bottom})})()`))
/** Whether the page behind a dialog is inert (nothing in it takes a click, a key or a Tab). */
export const rootInert = () => js(`document.getElementById('root')?.hasAttribute('inert') === true`)
/** Where the keyboard is: the dialog it is in (its data-modal), "editor", or "other". */
export const keyboardIn = () => js(`(()=>{const a=document.activeElement;if(!a)return 'none';const m=a.closest('.modal-backdrop');if(m)return m.dataset.modal;if(a.closest('.cm-content'))return 'editor';return 'other:'+(a.tagName+'.'+(a.className||'')).slice(0,40)})()`)
/** Set a React-controlled input's value the way a user's typing would, from the page. */
export const typeInto = (selector, value) => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return i.value})()`)
export { sleep, waitFor }
