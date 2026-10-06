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

`helpers.ts`: `readerFor` / `readWords` / `canRead` ask the bundled reader FIRST on every platform when its files are
beside the app; Vision, Windows' engine and tesseract are unchanged and are the fallback when it is missing or fails
(a cancel is not a failure). `OcrEngine` gained `"bundled"`.

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

macOS and Linux runs (the code is platform-free: Node worker threads and WASM; CI's macOS job runs the unit tests,
including the real reads); a camera photo of a notebook page at full resolution (the e2e camera suite reads its
synthetic chart through the bundled reader); Japanese handwriting.
