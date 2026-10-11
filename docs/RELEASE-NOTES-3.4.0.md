WriteMind 3.4.0

- **One OCR engine on every platform.** Reading words out of a picture is now done by the same engine on macOS, Windows and Linux: PaddleOCR's PP-OCRv5 models running on onnxruntime-web (WebAssembly), bundled in the app. Apple Vision, Windows' own OCR engine and Tesseract are gone, so a picture reads the same wherever the note is opened, Japanese included, with nothing to install. It adds about 28 MB to the download.
- Where the reader's files are missing (a development build made offline) there is no reader and no Aa / read / text control is shown; nothing falls back to another engine.
- The measurements that chose it, against Apple Vision, are in docs/OCR-BUNDLED.md.
- **The Quick Reference** has a line for reading words (Aa on a picked picture, Text in the video box), held by a test to the buttons it names.
