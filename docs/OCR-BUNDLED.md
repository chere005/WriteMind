# The bundled reader: one OCR engine inside WriteMind

Sean, 2026-10-06: "start cross platform ocr with minimal changes to existing code", and of the options, **one
bundled reader** - an engine shipped inside the app, so macOS, Windows and Linux read a picture the same way with
nothing to install. Branch `ocr-bundled`.

## The choice: PaddleOCR PP-OCRv5 (mobile) on onnxruntime-web (WebAssembly)

| | |
|---|---|
| Detector | PP-OCRv5 mobile text-line detector (DB), `ch_PP-OCRv5_det_mobile.onnx`, 4.8 MB |
| English recogniser | PP-OCRv5 mobile English (CTC, 436 characters), `en_PP-OCRv5_rec_mobile.onnx`, 7.9 MB |
| Japanese recogniser | PP-OCRv5 mobile multilingual (CTC, 18 383 characters: kana, kanji, Chinese, Latin), `ch_PP-OCRv5_rec_mobile.onnx`, 16.6 MB |
| Runtime | onnxruntime-web 1.30.0, its Node build: `ort-wasm-simd-threaded.wasm` (14.2 MB) + `.mjs` loader, bundled into the worker |
| Added to the app | 44 MB on disk (`out/helpers/bundled-ocr`), about 28 MB compressed (xz -9 of the folder) |

Why this one:

- **Handwriting** is what matters most, and PP-OCRv5's release says handwriting is where it improved most over v4.
  Measured below: it reads pen handwriting that Windows' own engine turns into noise.
- **Licences are permissive for code and weights**: PaddleOCR and its PP-OCRv5 weights are Apache-2.0; the ONNX
  conversions are RapidOCR's (Apache-2.0); onnxruntime is MIT. No GPL, nothing non-commercial.
- **One binary for every platform**: WebAssembly needs no per-platform native build. (onnxruntime-node 1.30 was
  checked and rejected: 113 MB packed, DirectML and CUDA payloads, and **no macOS x64 binary at all**.) In Node the
  WASM build runs multi-threaded (worker threads), about 3x faster than single-threaded here.
- **Small**: the mobile models; the server models (88 + 85 MB) read handwriting no better on our samples and
  recognise about 40x slower in WASM (14 s for one small picture).
- **Japanese**: the multilingual PP-OCRv5 recogniser reads Japanese in the same pass. Rejected: tesseract.js (weak
  on handwriting), TrOCR (hundreds of MB per model, one language per model, no detector).

## How it reads (apps/desktop/src/main/bundledOcr*)

`bundledOcr/pipeline.ts`: picture -> detector (longest side scaled to <= 1600, a small picture up to >= 640, sides
multiples of 32) -> probability map -> lines (eight-connected blobs, minimum-area rectangles, DB's unclip) -> each
line cut out upright at 48 px -> **English recogniser, and the multilingual one** -> CTC greedy decode -> the same
`Words` every reader returns: lines and **words with boxes** (from the CTC timesteps), fractions of the picture, y down,
with the recogniser's own confidence (lines under 0.5 are dropped). A line's reading is the multilingual one only when
it found Japanese and is about as confident (`pickReading`): the English model reads English handwriting markedly
better, and reads Japanese as the digits beside it. Asking with `languages` that leave Japanese out skips that pass.

`bundledOcr.ts` runs it in worker threads (`bundledOcr/worker.ts`), one per picture being read (ocr.ts runs two), kept
warm for two minutes. **Cancel terminates the worker** (a WASM run cannot be stopped otherwise); the next picture
gets a fresh one. PNGs are decoded in the worker (`bundledOcr/png.ts`); other formats by Electron's `nativeImage`.

`helpers.ts`: the order the readers are asked in is ONE table, `OCR_ORDER` - bundled, Vision, Windows' engine, tesseract - and
`readerFor` / `readWords` walk it: the first reader that is on this machine (a file being there; Windows' by a probe that
works) reads, and one that FAILS stands aside for the next (a cancel is not a failure; when every reader there is has
failed the last one's error is thrown, so the page can say the reader failed rather than that nothing was written).
`OcrEngine` gained `"bundled"`. On a Mac the table puts the bundled reader before Vision: "Against Vision" below is why, and
`WRITEMIND_OCR_ORDER=vision,bundled` (names left out follow in the table's order) tries the other way round with no rebuild.

## Where the files come from (nothing is downloaded at runtime)

`apps/desktop/scripts/ocr-models.json` pins each file to RapidOCR's model release **v3.9.2** on ModelScope with its
SHA-256; `scripts/fetch-ocr-models.mjs` downloads, verifies and caches them in `apps/desktop/.cache/ocr-models`
(git-ignored); `scripts/build.mjs` bundles the worker and copies the runtime and the models into
`out/helpers/bundled-ocr`, which `asarUnpack: out/helpers/**` already takes out of the archive. A dev build offline
with an empty cache warns and leaves the folder out (the app then uses the platform's reader);
`WM_REQUIRE_OCR_MODELS=1` (the release jobs) makes that fatal. CI caches the folder by the manifest's hash.

| File | SHA-256 | Source |
|---|---|---|
| `ch_PP-OCRv5_det_mobile.onnx` | `4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae` | modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ |
| `en_PP-OCRv5_rec_mobile.onnx` | `c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8` | .../v3.9.2/onnx/PP-OCRv5/rec/ |
| `ch_PP-OCRv5_rec_mobile.onnx` | `5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5` | .../v3.9.2/onnx/PP-OCRv5/rec/ |

The recognisers carry their own dictionaries in the ONNX metadata (`character`), read by `bundledOcr/onnxMeta.ts`,
so no separate dictionary file can drift from its model. The checksums are RapidOCR's own (`default_models.yaml`) and
were re-verified on download.

## Measured (2026-10-06, Windows 10, 4 WASM threads)

| Picture | Bundled | Windows.Media.Ocr |
|---|---|---|
| Printed Arial (`test/fixtures/ocr-english.png`) | exact | exact |
| Handwriting, felt-tip print (`ocr-handwriting.png`, public domain, Wikimedia Commons "Handwriting.png") | exact, all three lines | "The quick brown FOX / ivmps over+e lazy dog. / 01234-66789" |
| Same picture, biro cursive | "The quich broungox / jumps over the lazy / dog. / 0123456789" | "Thu quich / J Urnps / Clog" |
| Handwritten recipe card, print (Commons, CC BY-SA, not committed) | 12 of 12 lines, nearly exact | 11 fragments, many words missing |
| Handwritten recipe card, cursive (same) | every line, about half the words right | two lines of noise |
| Japanese, printed Yu Gothic (`ocr-japanese.png`) | exact (会議メモ2026 / こんにちはhello / 東京へ行く) | "2026", "hello" (no Japanese OCR installed here) |
| Printed maths line "x = 2y + 1", "E = mc^2" | exact | only the third line |

About 0.3-0.7 s a picture once the worker is warm (load: 0.3 s).

## Against Vision, on a Mac (2026-10-10)

TODO item 4 asked whether the bundled reader stays first on a Mac, where Vision is also there. Measured on an Apple M1 Pro
(8 cores), macOS 26, both readers forced through the app's own `readWords` (`apps/desktop/scripts/ocr-compare/compare.ts`; it gives
`readWords` an app folder with only one reader beside it, so the path is the app's, the Vision helper is `out/helpers/wm-vision`
and the bundled one is `main/bundledOcr.ts` with its worker). The pictures are read **as the app hands them to a reader**: the
real `prepareForReading` ran in the real app (`prepare-pictures.e2e.mjs`: flattened on white, no side over 3200, a printed dot
grid painted out). Score = characters wrong per character of the ground truth written beside each picture (CER; both folded:
lower case, no `^`, white space squeezed; the app's own `composeLines` tidy of the lines); "(n/m)" is lines read exactly.
Time = median of five warm reads. Cold start (first read of a run): Vision 0.7 s, bundled 1.0 s.

| Picture | Vision as it shipped (en-US only) | **Vision now** | **Bundled** |
|---|---|---|---|
| `ocr-english` printed Arial, 800x240 (real) | 0% (2/2) 0.54 s | 0% (2/2) 0.70 s | 0% (2/2) 0.34 s |
| `ocr-handwriting` felt-tip print + biro, 701x580 (**real hands**) | 1.8% (7/7) 0.59 s | 1.8% (7/7) 0.91 s | 3.6% (7/7) 0.37 s |
| ...its felt-tip print only (real) | 0% (3/3) 0.55 s | 0% (3/3) 0.74 s | 0% (3/3) 0.29 s |
| ...its biro cursive only (real) | 3.6% (3/4) 0.55 s | 3.6% (3/4) 0.75 s | 10.9% (2/4) 0.31 s |
| `ocr-japanese` printed Yu Gothic (real) | **88%** (0/3) 0.54 s | 12.0% (1/3) 0.52 s | **0%** (3/3) 0.28 s |
| a ruled notebook page, 3000x4000 photo-like, tilted, shaded (font: Bradley Hand), 2400x3200 as read | 0% (8/8) 0.64 s | 0% (8/8) 1.03 s | 0% (8/8) 1.32 s |
| the tablet sheet's Page picture, 1848x1200, drawn with the e2e pen (skeleton of Bradley Hand) | 0% (2/2) 0.59 s | 0% (2/2) 0.82 s | 2.9% (1/2) 0.76 s |
| cursive (font: Snell Roundhand) | 0% (3/3) 0.60 s | 0% (3/3) 0.89 s | 0% (3/3) 0.55 s |
| Japanese, Hiragino Maru Gothic with jitter (font) | 86% (0/4) 0.60 s | 2.9% (3/4) 0.60 s | 0% (4/4) 0.67 s |
| Japanese, Hiragino Mincho with jitter (font) | 83% (0/4) 0.62 s | 0% (4/4) 0.60 s | 2.9% (3/4) 0.67 s |
| maths on a line: `x = 2y + 1`, `E = mc^2` (raised 2), `3 + 4 = 7` (font) | 46% (0/3) 0.59 s | 39% (0/3) 0.55 s | **21%** (0/3) 0.46 s |
| a struck-through word (font) | 0% (2/2) 0.58 s | 0% (2/2) 0.79 s | 0% (2/2) 0.33 s |

The same pictures read WITHOUT the app's preparation (the dot grid still on the sheet, the page at 3000x4000) differ in two
places only: the sheet's picture, where the bundled reader reads the dots as lines (35% wrong, 4.6 s; Vision 0%), and the full-size
page (bundled 1.97 s, Vision 1.04 s). Both are what `prepareForReading` is for, and every reader gets it.

**Read this with its limits.** Only ONE picture is a real hand (the Commons scan: a felt-tip print and a biro scrawl, 111
characters in all), so "Vision is better on English handwriting" is two characters wrong against four in 111 (two against six in
the 55 of the biro half): a handful of characters, not a trend; the other handwriting pictures are fonts (and a font's skeleton drawn by the e2e pen), which are one hand's letter shapes
repeated and do not stand for a person's. No Wacom-written sheet of a real person, no real notebook photo and no real Japanese
handwriting was available, so the comparison is silent on exactly the cases Sean cares about most.

What it does say:

- **English handwriting: Vision a hair ahead** on the one real hand (1.8% against 3.6%; the biro half 3.6% against 10.9%); a tie on
  the printed, felt-tip, cursive-font, notebook-page and struck-word pictures; the bundled reader a few characters behind on the
  sheet (2.9%).
- **Japanese: the bundled reader is ahead**, 0% against 12% on the real printed picture (Vision reads "hello" as "nello" and puts a
  space in "2026"); on the two fonts they are within 3%. **Vision as the app shipped it read Japanese as noise (83-88%)**:
  `wm-vision` asked for en-US only, while `readerFor` told the page Vision could read Japanese. Fixed in this change
  (tools/vision/wm-vision.swift now does what the Mac app's `readBest` does: ja-JP first, kept only when it found Japanese);
  the "Vision now" column is the fixed helper, which costs it a second pass on every English picture (0.55 -> 0.75 s).
- **Maths on a line:** both fail `E = mc^2` (Vision "mo", bundled "mc" and a stray "2" line); the bundled reader gets the other two
  lines nearly right and is clearly ahead (21% against 39%).
- **Speed:** a capture box is a small picture, and there the bundled reader is the faster (0.3 s against 0.55-0.9 s, Vision's
  process start and second pass included); on a 2400x3200 page it is slower (1.3 s against 1.0 s).

**The decision: the bundled reader stays first on a Mac, and Vision fills in where the bundled one is missing or fails.** The
data is mixed (a little behind on English handwriting, ahead on Japanese and maths, a tie everywhere else, one real hand), so the
safe default is the one engine that every platform shares: a note read on the Mac and on Windows gives the same words, and that
was the point of the branch. Vision is not the safer first choice either, since without the fix above it could not read Japanese
at all. What Sean can flip, and where: `OCR_ORDER` in `apps/desktop/src/main/helpers.ts` (one line, tested in
`apps/desktop/test/ocrOrder.test.ts`), or for a try without a rebuild, launch with `WRITEMIND_OCR_ORDER=vision` (Vision, then
the bundled reader, then the rest). Worth doing once there is a real Wacom sheet and a real notebook photo to read both ways:
`ocr-compare/compare.ts` takes any `.png` with a `.txt` beside it.

How to re-run: `WM_REQUIRE_OCR_MODELS=1 npm run build`; `npm run e2e -- --file apps/desktop/scripts/ocr-compare/sheet-capture.e2e.mjs`
(the sheet) and `.../prepare-pictures.e2e.mjs` (every picture as the app hands it over); then
`node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/ocr-compare/compare.ts --prepared`. `make-pictures.swift` draws
the made pictures with the Mac's own fonts (nothing downloaded) into `apps/desktop/.cache/ocr-compare`.

## In the merged UI, and with no models (Mac, 2026-10-10)

Every place the app reads words from a picture was run in the real app against the bundled reader after the UI merge (head
34764b3 + this branch's changes); none asked for an old engine name or an old DOM hook. Scripts in `apps/desktop/scripts/ocr-compare/`
(`npm run e2e -- --snapshot --file <script>`):

| Path | Script | Result |
|---|---|---|
| Camera box ▸ **Text**: the words into the note as a cell, the toast under the header ("✓ Text added to Untitled · 7 lines"), the standing footer line unchanged (the fake camera plays the real handwriting fixture, `e2e/lib/fixtures.mjs` `text.y4m`) | `camera-text.e2e.mjs` | 7 / 7 |
| Drawing inspector **Aa** (`data-insp=read`) on a pasted picture of the handwriting fixture: the footer's "Read 7 lines into the note.", the words in the note, the picture kept, one Ctrl+Z takes the words out | `aa-picture.e2e.mjs` | 8 / 8; engine "bundled" |
| Flow-chart labels (`wordsForChart`) on the tablet sheet, three boxes with a word written in each: "Start", "Check", "Done" on the three nodes, the toast "Read a flow chart: 3 nodes, 3 labelled" | `tablet-chart-words.e2e.mjs` | 6 / 6 |
| The sheet's Page picture ("Sheet as Picture") read with Aa: "Buy milke and eggs / call the plumber" | same | (in the 6) |
| camera, drawing, tablet suites | `npm run e2e -- --suite camera` (then `drawing`, `tablet`) `--snapshot` | camera 153 pass, 1 fail; drawing 265 pass, 3 fail; tablet 131 pass, 1 fail. The 5 fails are the known portability ones, none in OCR: camera/01 "arrows routed with right angles" (its chart nodes read and labelled count pass), drawing/03 Ctrl+G and Backspace, drawing/06 "next fresh press is the note's", tablet/01 the hint says Cmd+Alt+2 where the script expects "Ctrl+Alt+2" |

Seen in the screenshots: the words land in the note where the UI says (the camera's toast at the header's right edge, the Aa notice at the
footer's right). One thing the OCR did not cause: in an EMPTY note a picture floats over the note's first lines, and an Aa reading
goes to the first line "under the picture", which is the top of the note, so the words sit behind the picture until it is moved.

**A build without the models** (a dev build offline: `WM_OCR_MODELS_CACHE` an empty folder, `WM_REQUIRE_OCR_MODELS` unset, the network refused
with `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9`, in a scratch copy): the three downloads fail three times each, the
build warns "goes on WITHOUT the bundled reader" and leaves `out/helpers/bundled-ocr` out; the app then reads with Vision
(`aa-picture.e2e.mjs`: engine "vision", 8 / 8). With the Vision helper taken away too (what a Linux machine with no tesseract is),
`no-reader.e2e.mjs` passes: capabilities say no reader, a picked picture's bar has no Aa, the camera's box row has no Text.

## Maths

Linear maths written on a line ("x = 2y + 1", "E = mc^2") already comes through the text recogniser and the app's own
`looksLikeMaths` / `wolfram()` rules. Two-dimensional maths (stacked fractions, raised powers, roots) needs a formula
recogniser, and none is shipped: the best permissively licensed, offline candidate found is **Pix2Text MFR 1.5**
(breezedeus/pix2text-mfr-1.5 on Hugging Face, MIT, a TrOCR encoder-decoder trained on printed AND handwritten
formulas, ONNX: encoder 87.5 MB + decoder 32.0 MB = 119.5 MB fp32), which outputs LaTeX that would need a
LaTeX -> Wolfram Language translation. At 120 MB it alone is twice the size budget; int8 quantisation might bring it
near 30 MB (a third-party quantised v1, Brian314/pix2text-mfr-quantized, is 53 MB with only the encoder quantised)
and would need its accuracy measured on handwriting before it earns a place. RapidLatexOCR (pix2tex, MIT, 179 MB,
mainly printed) is larger and weaker on handwriting.

## Not verified here

Linux runs (the code is platform-free: Node worker threads and WASM; CI's macOS job runs the unit tests, including the real
reads); a real notebook photo and a real Wacom sheet written by a person (the Mac comparison above used fonts and a synthetic
pen except for one scan); real Japanese handwriting (the Japanese pictures are printed or a font); a Mac with an Intel chip.
