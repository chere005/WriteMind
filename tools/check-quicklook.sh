#!/bin/sh
# Quick Look drawing WriteMind's preview of a note, checked by hand on a Mac (docs/TESTING.md, "Quick Look"):
#
#   npm run build && npm -w @writemind/desktop run package:mac:adhoc     (the app this checks)
#   sh tools/check-quicklook.sh [out-folder]
#
#   1. writes the sample notes (apps/desktop/scripts/quicklook-samples.ts) into a scratch folder;
#   2. registers THIS BUILD's extension for the run - the app in dist-electron with LaunchServices, its extension with
#      pluginkit - and resets Quick Look's list of generators;
#   3. shows each sample in Quick Look's own preview view, light and dark, and photographs Quick Look's web view
#      (tools/quicklook/quicklook-shot.swift) into out-folder: LOOK AT THEM;
#   4. unregisters what it registered (pluginkit -r, lsregister -u), resets Quick Look again and stops the extension's
#      processes, so that the extension macOS uses afterwards is the installed app's.
#
# It never touches /Applications/WriteMind.app or ~/Library/Application Support/@writemind. Exit 1 when a note that
# should have a page has none, or the Windows Media file got one.
set -u
cd "$(dirname "$0")/.."
root="$PWD"
app="$root/dist-electron/mac-arm64/WriteMind.app"
appex="$app/Contents/PlugIns/WriteMindPreview.appex"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ "$(uname)" = "Darwin" ] || { echo "check-quicklook: this needs macOS" >&2; exit 2; }
[ -d "$appex" ] || { echo "check-quicklook: no $appex (package:mac:adhoc first)" >&2; exit 2; }
work="$(mktemp -d)"
out="${1:-$work/shots}"
mkdir -p "$out"

cleanup() {
  pluginkit -r "$appex" > /dev/null 2>&1
  "$lsregister" -u "$app" > /dev/null 2>&1
  qlmanage -r > /dev/null 2>&1
  pkill -x quicklook-shot 2> /dev/null
  pkill -x WriteMindPreview 2> /dev/null
  rm -rf "$work/notes" "$work/quicklook-shot" "$work/warm.png"
  if pluginkit -m -i com.seancheren.writemind.quicklook 2> /dev/null | grep -q "$root"; then
    echo "check-quicklook: the extension in $root is STILL registered: pluginkit -r \"$appex\"" >&2
  fi
}
trap cleanup EXIT INT TERM

echo "==> sample notes"
npx vite-node apps/desktop/scripts/quicklook-samples.ts "$work/notes" > /dev/null || exit 1
# A Windows Media file (an ASF header): macOS calls it what it calls every .wm, and the extension must hand it back.
printf '\060\046\262\165\216\146\317\021\246\331\000\252\000\142\316\154' > "$work/notes/media.wm"
head -c 200 /dev/zero >> "$work/notes/media.wm"

echo "==> the snapshot tool"
swiftc -O -o "$work/quicklook-shot" tools/quicklook/quicklook-shot.swift || exit 1

echo "==> registering $appex (for this run only)"
"$lsregister" -f "$app"
pluginkit -a "$appex"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pluginkit -m -i com.seancheren.writemind.quicklook 2> /dev/null | grep -q "$root" && break
  sleep 1
done
qlmanage -r > /dev/null 2>&1
# A new registration reaches Quick Look's own list a little later than pluginkit says so: the first preview asked for
# straight after it falls back on the generic one. So the first note is asked for until it has a page (or two minutes).
echo "==> waiting for Quick Look to use it"
ready=0
for _ in 1 2 3 4 5 6 7 8; do
  case "$("$work/quicklook-shot" "$work/notes/plain.wm" "$work/warm.png" 900 600 light 15 2>&1 | tail -1)" in
    wrote*) ready=1; break ;;
  esac
  qlmanage -r > /dev/null 2>&1
done
[ "$ready" = 1 ] || { echo "check-quicklook: FAIL: Quick Look never drew the extension's page (is it registered? pluginkit -m -v -i com.seancheren.writemind.quicklook)" >&2; exit 1; }

failures=0
shot() { # note width height appearance want(page|none)
  name="$1-$4-$2"
  result="$("$work/quicklook-shot" "$work/notes/$1.wm" "$out/$name.png" "$2" "$3" "$4" 60 2>&1 | tail -1)"
  case "$5:$result" in
    page:wrote*|none:no\ page*) echo "check-quicklook: ok: $1 ($4, $2 wide): $result" ;;
    *) echo "check-quicklook: FAIL: $1 ($4, $2 wide): $result" >&2; failures=$((failures + 1)) ;;
  esac
}
for appearance in light dark; do
  shot plain 900 1000 "$appearance" page
  shot rich 900 1300 "$appearance" page
done
shot rich 450 700 light page
shot plain 320 700 dark page
shot big 900 1200 light page
shot hostile 900 700 light page
shot newer 700 300 light page
shot broken 700 300 dark page
shot evil-name 700 300 light page
shot media 700 300 light none
echo "check-quicklook: the photographs are in $out"
[ "$failures" -eq 0 ] || { echo "check-quicklook: $failures failed" >&2; exit 1; }
