#!/bin/sh
# The macOS helper, compiled if this machine can compile it. On Windows —
# or on a Mac with no Swift — this does nothing and says so, and the app
# simply does not offer what the helper would have done.
#
# UNIVERSAL (arm64 + x86_64), for macOS 13 and newer: each slice is compiled
# for its own target and lipo joins them. The build runs once and BOTH dmgs
# (Apple silicon and Intel) pack the same out/helpers/wm-vision, so the helper
# must run on either chip; tools/verify-mac.sh checks the two slices and their
# minimum macOS in every packaged WriteMind.app.
set -e
cd "$(dirname "$0")/.."
out="apps/desktop/out/helpers"
min="13.0"

if [ "$(uname)" != "Darwin" ]; then
  echo "==> not macOS: no Vision helper, and the app will not offer what it does"
  exit 0
fi
if ! command -v swiftc > /dev/null 2>&1; then
  echo "==> no swiftc: no Vision helper (the app still runs, without OCR)"
  exit 0
fi

mkdir -p "$out"
slices="$(mktemp -d)"
trap 'rm -rf "$slices"' EXIT
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos$min" -o "$slices/wm-vision-$arch" \
    tools/vision/wm-vision.swift -framework Vision -framework AppKit
done
lipo -create -output "$out/wm-vision" "$slices/wm-vision-arm64" "$slices/wm-vision-x86_64"
chmod +x "$out/wm-vision"
echo "==> built $out/wm-vision ($(lipo -archs "$out/wm-vision"), macOS $min+)"
