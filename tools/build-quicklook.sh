#!/bin/sh
# WriteMind's Quick Look preview extension (apps/desktop/quicklook: Spotlight's preview, Finder's space bar and column
# view show a .wm note as its rendered page), built if this machine can build it: a Mac with swiftc. Anywhere else this
# does nothing and says so, and the app is packaged without it (tools/verify-mac.sh fails a Mac package that lacks it).
#
#   sh tools/build-quicklook.sh        -> apps/desktop/build/quicklook/WriteMindPreview.appex
#
# The bundle: Contents/MacOS/WriteMindPreview (one arm64 slice, macOS 13+, linked as an app extension with
# NSExtensionMain as its entry point), Contents/Resources/preview.js (the core's page renderer, bundled by
# apps/desktop/scripts/build-quicklook.mjs) and Contents/Info.plist (apps/desktop/quicklook/Info.plist with the app's
# version). It is signed AD HOC here with its own sandbox entitlements so it can be tried before packaging; the package
# signs it again with the app's identity (apps/desktop/scripts/sign-mac.cjs) and electron-builder.yml's mac.extraFiles
# puts it in WriteMind.app/Contents/PlugIns.
#
# APPLE SILICON ONLY, as every Mach-O in the app (tools/build-helpers.sh).
set -e
cd "$(dirname "$0")/.."
out="apps/desktop/build/quicklook"
appex="$out/WriteMindPreview.appex"
min="13.0"

if [ "$(uname)" != "Darwin" ]; then
  echo "==> not macOS: no Quick Look extension to build"
  exit 0
fi
if ! command -v swiftc > /dev/null 2>&1; then
  echo "==> no swiftc: no Quick Look extension (the app still runs; Finder shows a .wm as a file)"
  exit 0
fi

version="$(node -p "require('./apps/desktop/package.json').version")"
rm -rf "$appex"
mkdir -p "$appex/Contents/MacOS" "$appex/Contents/Resources"
node apps/desktop/scripts/build-quicklook.mjs "$appex/Contents/Resources/preview.js"
# Swift 5 mode: QLPreviewProvider's async entry point is an Objective-C protocol's, and Swift 6's strict checking
# has nothing to add to a type that keeps no state between calls.
swiftc -O -swift-version 5 -target "arm64-apple-macos$min" -module-name WriteMindPreview -parse-as-library \
  -application-extension -Xlinker -application_extension -Xlinker -e -Xlinker _NSExtensionMain \
  -framework QuickLookUI -framework JavaScriptCore -lcompression -framework UniformTypeIdentifiers \
  -o "$appex/Contents/MacOS/WriteMindPreview" \
  apps/desktop/quicklook/PreviewProvider.swift apps/desktop/quicklook/PreviewRenderer.swift apps/desktop/quicklook/WmArchive.swift
sed "s/@VERSION@/$version/g" apps/desktop/quicklook/Info.plist > "$appex/Contents/Info.plist"
plutil -lint -s "$appex/Contents/Info.plist"
codesign --force --sign - --entitlements apps/desktop/quicklook/WriteMindPreview.entitlements "$appex"
echo "==> built $appex ($(lipo -archs "$appex/Contents/MacOS/WriteMindPreview"), macOS $min+, version $version)"
