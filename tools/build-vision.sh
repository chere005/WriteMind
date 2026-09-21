#!/bin/sh
# The macOS helper, compiled if this machine can compile it. On Windows —
# or on a Mac with no Swift — this does nothing and says so, and the app
# simply does not offer what the helper would have done.
set -e
cd "$(dirname "$0")/.."
out="apps/desktop/out/helpers"

if [ "$(uname)" != "Darwin" ]; then
  echo "==> not macOS: no Vision helper, and the app will not offer what it does"
  exit 0
fi
if ! command -v swiftc > /dev/null 2>&1; then
  echo "==> no swiftc: no Vision helper (the app still runs, without OCR)"
  exit 0
fi

mkdir -p "$out"
swiftc -O -o "$out/wm-vision" tools/vision/wm-vision.swift \
  -framework Vision -framework AppKit
echo "==> built $out/wm-vision"
