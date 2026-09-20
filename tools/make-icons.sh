#!/bin/sh
# Every raster in the project, from one vector.
#
#   sh tools/make-icons.sh
#
# assets/logo.svg is the only source of truth for the mark (assets/logo-square.svg
# is the same mark cut full-bleed for the app icon). No PNG in this repo is
# drawn or edited by hand — re-run this, so a change to the mark reaches every
# size at once and none of them drifts.
#
# Headless Chrome does the rasterising, as in AcctMind: it is on this Mac,
# renders SVG exactly as a browser does, and takes a precise pixel size. The
# page is the artwork with no margin, so the screenshot IS the icon.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SRC="$ROOT/assets/logo.svg"
SQ="$ROOT/assets/logo-square.svg"
SET="$ROOT/WriteMind/Assets.xcassets/AppIcon.appiconset"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -f "$SRC" ] && [ -f "$SQ" ] || { echo "assets/logo.svg or assets/logo-square.svg is missing" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME — needed to rasterise the SVG" >&2; exit 1; }

TMP="${TMPDIR:-/tmp}/writemind-icons-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# $1 = pixel size, $2 = destination, $3 = source svg
render() {
  size="$1"; dest="$2"; src="$3"
  mkdir -p "$(dirname "$dest")"
  cat > "$TMP/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${size}px;height:${size}px}
</style>
$(cat "$src")
HTML
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --screenshot="$TMP/out.png" --window-size="$size,$size" \
    "file://$TMP/page.html" > /dev/null 2>&1
  [ -f "$TMP/out.png" ] || { echo "Chrome produced nothing at ${size}px" >&2; exit 1; }
  mv "$TMP/out.png" "$dest"
  printf '  %-58s %s\n' "${dest#$ROOT/}" "${size}x${size}"
}

echo "==> app icon set (full-bleed cut — macOS applies its own mask)"
for size in 16 32 64 128 256 512 1024; do
  render "$size" "$SET/icon_$size.png" "$SQ"
done
# Xcode's macOS set: each point size at 1x and 2x, named by what it is.
cat > "$SET/Contents.json" <<JSON
{
  "images" : [
    { "filename" : "icon_16.png",   "idiom" : "mac", "scale" : "1x", "size" : "16x16" },
    { "filename" : "icon_32.png",   "idiom" : "mac", "scale" : "2x", "size" : "16x16" },
    { "filename" : "icon_32.png",   "idiom" : "mac", "scale" : "1x", "size" : "32x32" },
    { "filename" : "icon_64.png",   "idiom" : "mac", "scale" : "2x", "size" : "32x32" },
    { "filename" : "icon_128.png",  "idiom" : "mac", "scale" : "1x", "size" : "128x128" },
    { "filename" : "icon_256.png",  "idiom" : "mac", "scale" : "2x", "size" : "128x128" },
    { "filename" : "icon_256.png",  "idiom" : "mac", "scale" : "1x", "size" : "256x256" },
    { "filename" : "icon_512.png",  "idiom" : "mac", "scale" : "2x", "size" : "256x256" },
    { "filename" : "icon_512.png",  "idiom" : "mac", "scale" : "1x", "size" : "512x512" },
    { "filename" : "icon_1024.png", "idiom" : "mac", "scale" : "2x", "size" : "512x512" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
echo "  ${SET#$ROOT/}/Contents.json"

echo "==> picture cut (rounded — nothing masks this)"
render 512 "$ROOT/assets/logo-512.png" "$SRC"

echo "==> done"
