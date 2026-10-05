# Reading words out of a picture on Windows

The Mac reads a picture with Vision. Windows has an OCR engine of its own,
`Windows.Media.Ocr`, which needs **nothing installed** for the languages in
the user's profile. WriteMind uses it (Vision first on a Mac, then this, then
`tesseract` if one is on the PATH) and shows the Aa handle only when a reader
that works is there.

## What is where

| | |
|---|---|
| `apps/desktop/src/helpers/wm-ocr.ps1` | Windows PowerShell 5.1 script, copied to `out/helpers/` by the build and unpacked out of the asar by `asarUnpack`. `wm-ocr.ps1 probe` says which languages the engine has; `wm-ocr.ps1 read <image> [-Languages ja,en-US]` reads a picture. ONE line of pure-ASCII JSON on stdout (every non-ASCII character is a `\uXXXX` escape, so the console code page cannot mangle Japanese); an `error` key when it could not. |
| `apps/desktop/src/main/helpers.ts` | finds the script, probes it once, runs it (`readerFor`, `readWords`, `probeWindowsOcr`, `readWithWindowsOcr`); `ADD_JAPANESE_OCR` is the sentence below |
| `apps/desktop/src/main/ocr.ts` | the queue (two engines at once), the cache (keyed by a hash of the picture's BYTES and the languages asked for), and cancel (`ocr:cancel` kills the PowerShell when nobody else wants the same picture) |
| `packages/core/src/capture/textRecognition.ts` + `handwritingMarks.ts` | the Mac's rules, ported: the reading turned into markdown |
| `apps/desktop/src/renderer/ocrClient.ts` | what the page asks for: `readPictureLines` (Aa), `wordsForChart` (labels for the flow-chart reader) |

## Languages

The engine reads a language only if Windows has its OCR capability. English
(and whatever else is in the user's profile languages) is there on a normal
install. **Japanese is an optional Windows capability** and this machine
(checked 2026-10-03) does not have it: `wm-ocr.ps1 probe` says
`"installed":["en-US"],"japanese":false`.

To add it (nothing in WriteMind installs anything for you), in an
**elevated** PowerShell:

```powershell
Get-WindowsCapability -Online -Name 'Language.OCR*ja-JP*'      # State : NotPresent
Add-WindowsCapability -Online -Name 'Language.OCR~~~ja-JP~0.0.1.0'
```

or Settings > Time & Language > Language & region > (add) Japanese >
Language options > *Optical character recognition*. Then restart WriteMind
(the probe is asked once per run). `window.wm.ocrStatus()` (and the
`ocrEngine` / `japaneseOCR` capabilities) report what was found.

**Which language is used** follows the Mac's rule (`TextRecognition.readBest`):
Japanese first when installed, and that reading is KEPT only when it found
any Japanese (kana, kanji, half-width katakana) - an English page read
Japanese-first comes back as nonsense; otherwise the profile's languages.
The engine returns Japanese one character to a "word"; the port puts runs of
Japanese characters back together (`wordsOf`, `joinWords`) so a line reads
`会議メモ 2026` and a struck-out Japanese word gets one `~~` pair, not one
per character.

## What it can and cannot do

- It is a **printed-text** engine. Printed and handwriting-like fonts read
  well (measured: Arial, Times, Courier and Segoe Print, ~100-550 ms for a
  4-line picture); real pen handwriting reads much worse than Vision. That
  is the price of "nothing to install" and it is why Vision stays first on a Mac.
- It answers NOTHING, not wrong words, for some very short lines (a lone
  `x = 2y + 1` at large size, measured); the script retries a picture that
  comes back empty at smaller sizes, which does not always help. A line with
  a few more words in it reads.
- A thick pen line round a box defeats it (the box and the words inside it
  read as nothing), so the chart-label reader sends it the picture with the
  drawn outlines rubbed out (`withoutOutlines`).
- No per-character boxes, so the Mac's "raised digit becomes a power" rule
  cannot fire here (`superscripted` is ported, used when a reader gives
  character boxes). No confidence either: every line counts as read (1.0),
  as tesseract's do; doodle filtering is `looksLikeText`'s job.
- The engine takes images up to `OcrEngine.MaxImageDimension` on a side
  (10000 here); the script scales anything bigger down, and a small picture up.

## Not verified here

Japanese OCR itself (not installed on the development machine). The parts
that are plumbing - the script's language plan, `ja`-tagged JSON, the
per-character merge, the spacing - are unit-tested with stand-in output
(`packages/core/test/textRecognition.test.ts`, `apps/desktop/test/ocr.test.ts`),
and `ocr.test.ts` draws a real Japanese picture and reads it when the
machine has the capability, so the first run on a machine with Japanese OCR
verifies it.
