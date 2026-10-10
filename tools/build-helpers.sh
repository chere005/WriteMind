#!/bin/sh
# The macOS native helpers, compiled if this machine can compile them. On Windows, Linux — or on a Mac with no
# Swift — this does nothing and says so, and the app simply does not offer what the helper would have done.
#
# APPLE SILICON ONLY (Sean, 2026-10-10: nothing built for Intel ships on a Mac): one arm64 slice per helper,
# compiled for macOS 13 and newer, no x86_64 slice and no lipo. The helpers are wm-vision (tools/vision/wm-vision.swift,
# the Mac's Vision reader of words in a picture) and wm-pen (tools/pen/wm-pen.swift, which seizes the Wacom tablet's HID
# device while the Tablet sheet is in front). tools/verify-mac.sh checks that every packaged Mach-O is arm64 and that each
# helper's minimum macOS is 13.0.
set -e
cd "$(dirname "$0")/.."
out="apps/desktop/out/helpers"
min="13.0"

if [ "$(uname)" != "Darwin" ]; then
  echo "==> not macOS: no native helper to build"
  exit 0
fi
if ! command -v swiftc > /dev/null 2>&1; then
  echo "==> no swiftc: no helpers (the app still runs, without OCR and without the Tablet sheet's Mac pen)"
  exit 0
fi

mkdir -p "$out"
# Helpers left in out/ by a build from before 2026-10-10 are universal (x86_64 + arm64) binaries, and electron-builder
# packs whatever is in out/helpers: they are rebuilt here, one arm64 slice each, and never ride along as they were.
rm -f "$out/wm-vision" "$out/wm-pen"
swiftc -O -target "arm64-apple-macos$min" -o "$out/wm-vision" tools/vision/wm-vision.swift -framework Vision -framework AppKit
chmod +x "$out/wm-vision"
echo "==> built $out/wm-vision ($(lipo -archs "$out/wm-vision"), macOS $min+)"
swiftc -O -target "arm64-apple-macos$min" -o "$out/wm-pen" tools/pen/wm-pen.swift -framework IOKit
chmod +x "$out/wm-pen"
echo "==> built $out/wm-pen ($(lipo -archs "$out/wm-pen"), macOS $min+)"
