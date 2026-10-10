/**
 * The ONE kernel run an export or a copy makes, as data: the script, the files it may be handed, the cache key of a
 * job, and what the outcome means. The process is the main process's (`Runner.wolframJob`).
 *
 * Port-only: the Mac has no Wolfram export (docs/PARITY.md).
 *
 * THE SCRIPT IS FIXED, and a note's text is never code in it. Drawings and pictures go in as FILES and are imported;
 * maths is parsed HELD (`ToExpression[…, InputForm, HoldComplete]`) and only turned into boxes, never evaluated. Each
 * answer is written beside its job and renamed into place whole, and `done` comes last: a run cut short by the timeout
 * leaves every answer it finished, and a job with no answer falls back on its own (plan.ts). One run per export or
 * copy, because wolframscript takes a second and a half to start.
 *
 * WHAT IT ANSWERS WITH is the boxes as the front end keeps them in a file: an Image's boxes hold a NumericArray of
 * its pixels, which `InputForm` writes as a megabyte of plain numbers for a 400 × 200 drawing; each is `Compress`-ed
 * into `CompressedData["…"]` instead (about 15 KB), which the front end and `Get` both read. The PNG beside it (for a
 * copy: what other apps paste) carries its 144 dpi in its pHYs, so it pastes at its real size.
 */

import type { Refusal } from "../../eval/evaluator"
import type { EvalResult } from "../../eval/output"
import type { EngineState } from "./notebook"
import type { KernelJob } from "./plan"

/** `wolframscript -file <this> <job folder>`. Tested as written (apps/desktop/scripts/check-wolfram.ts). */
export const WOLFRAM_KERNEL_SCRIPT = `(* WriteMind's ONE kernel run for an export or a copy: wolframscript -file <this> <job folder>.
   In:  ink-<n>.svg, band-<n>.svg, pdf-<n>.svg (a drawing on white; its width attribute is the width it is shown at),
        pic-<n>.txt ({"<file>", <shown width>} for a picture cell), wl-<n>.wl (maths source, kernel spelling),
        an empty file "png" when a copy wants PNGs too, and "remove-background" when a clipboard copy wants
        Wolfram's RemoveBackground applied to its images.
   Out: <name>.boxes (the boxes, as the front end keeps them in a file) and <name>.png, each renamed into place
        whole, and "done" last. A name with no answer is one WriteMind writes its own cell for.
   Nothing here evaluates a note's text: drawings and pictures are imported, maths is parsed held. *)
SetDirectory[$ScriptCommandLine[[2]]];
read[f_] := ByteArrayToString[ReadByteArray[f], "UTF-8"];
put[f_, s_String] := (Export[f <> ".part", s, "Text", CharacterEncoding -> "ASCII"];
  RenameFile[f <> ".part", f, OverwriteTarget -> True]);
(* The way the front end keeps an image in a file: each NumericArray Compress-ed. Box heads hold their
   arguments, so the replacements are worked out first and put in after. *)
boxText[b_] := Module[{rules = (# -> wmCD[Compress[#]]) & /@ Cases[b, _NumericArray, Infinity]},
  StringReplace[ToString[b /. rules, InputForm, PageWidth -> Infinity, CharacterEncoding -> "ASCII"],
    "wmCD[" -> "CompressedData["]];
answer[f_, img_] := Module[{result = If[FileExistsQ["remove-background"], Quiet@RemoveBackground[img], img]},
  put[f <> ".boxes", boxText[ToBoxes[result]]];
  If[FileExistsQ["png"], Export[f <> ".png", Image[result, ImageResolution -> 144], "PNG"]]];
Do[With[{raw = Quiet@ImportByteArray[ReadByteArray[f], {"SVG", "Image"}, ImageResolution -> 144]},
    If[ImageQ[raw], answer[f, Image[RemoveAlphaChannel[raw, White], ImageSize -> Round[ImageDimensions[raw]/2]]]]],
  {f, FileNames["*.svg"]}];
Do[With[{job = Quiet@ToExpression[read[f], InputForm, HoldComplete]},
    If[MatchQ[job, HoldComplete[{_String, _Integer | _Real}]], With[{raw = Quiet@Import[job[[1, 1]], "Image"]},
      If[ImageQ[raw], With[{shown = Min[job[[1, 2]], First@ImageDimensions[raw]]},
        answer[f, Image[ImageResize[RemoveAlphaChannel[raw, White], Min[2 shown, First@ImageDimensions[raw]]],
          ImageSize -> shown]]]]]]],
  {f, FileNames["pic-*.txt"]}];
Do[With[{held = Quiet@ToExpression[read[f], InputForm, HoldComplete]},
    If[MatchQ[held, HoldComplete[_]],
      put[f <> ".boxes", boxText[held /. HoldComplete[e_] :> MakeBoxes[e, StandardForm]]]]],
  {f, FileNames["wl-*.wl"]}];
put["done", ToString[$VersionNumber]];
`

/** The script's file in the job folder. */
export const KERNEL_SCRIPT_FILE = "writemind.wls"

/** The only names a job folder's inputs may have (anything else is refused before anything starts). */
export const KERNEL_INPUT = /^(?:(?:ink|band|pdf)-\d+\.svg|pic-\d+\.txt|wl-\d+\.wl|png|remove-background)$/

/** What a job's name says it is, without its number: two jobs of one kind and one text are one answer. */
const kindOf = (name: string): string => name.replace(/-\d+\./, ".")

/**
 * The cache key of a job: what kind it is, what is in it, and `stamp` — for a picture, which names a file rather
 * than holding it, the file's `mtimeMs:size`, so a picture changed on disk is made again.
 */
export function jobKey(job: KernelJob, stamp = "", removeBackground = false): string {
  return sha1(`${kindOf(job.name)}\u0000${job.text}\u0000${stamp}\u0000${removeBackground ? "RemoveBackground" : ""}`)
}

/** What the runner's one kernel run came to (main/eval/runner.ts `wolframJob`). */
export type WolframJobOutcome =
  /** It ran: `finished` when the script wrote `done`; the answers it wrote, by file name, either way. */
  | { kind: "ran"; finished: boolean; timedOut: boolean; result: EvalResult; answers: Map<string, Uint8Array> }
  /** No engine where WriteMind looks, or Language Setup's choice is not there: nothing was started. */
  | { kind: "refused"; refusal: Refusal }
  | { kind: "couldNotStart"; why: string }
  /** Taken back (a newer copy, the app quitting) — or a test host, which starts nothing. */
  | { kind: "cancelled" }

/** The outcome as what an export says about it (`exportNotice`). `toolPath` is the wolframscript that was used. */
export function engineState(outcome: WolframJobOutcome, toolPath: string | null, timeoutMs = 120_000): EngineState {
  switch (outcome.kind) {
    case "ran":
      if (outcome.finished) return { kind: "answered" }
      if (outcome.timedOut) return { kind: "timedOut", seconds: Math.round(timeoutMs / 1000) }
      return { kind: "silent", path: toolPath ?? "wolframscript", result: outcome.result }
    case "refused": return { kind: "missing", refusal: outcome.refusal }
    case "couldNotStart": return { kind: "failed", why: outcome.why }
    case "cancelled": return { kind: "cancelled" }
  }
}

// MARK: - SHA-1, for the cache key (no platform here to ask for one)

/** SHA-1 of the UTF-8 bytes of `text`, in hex. */
export function sha1(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const length = bytes.length
  const words = new Uint32Array((((length + 8) >> 6) + 1) * 16)
  for (let i = 0; i < length; i++) words[i >> 2] |= bytes[i]! << (24 - (i % 4) * 8)
  words[length >> 2] |= 0x80 << (24 - (length % 4) * 8)
  words[words.length - 1] = (length * 8) >>> 0
  words[words.length - 2] = Math.floor(length / 0x20000000)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[block + t]!
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!
      w[t] = (x << 1) | (x >>> 31)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const next = (((a << 5) | (a >>> 27)) + f + e + k + w[t]!) >>> 0
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, "0")).join("")
}
