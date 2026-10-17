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
# Quick Look runs a page's script and does NOT enforce its Content-Security-Policy, so the hostile sample's drawing
# carries colours that try to run script and to load from a probe server this script listens on (127.0.0.1, a port the
# system picks, stopped at the end): a page that comes back marked by a script, or any request at the probe, fails it.
# And slow.wm (lines crafted to be slow, tens of seconds each before the renderer read them in one pass) must be drawn
# in under SLOW_MS.
#
# It never touches /Applications/WriteMind.app or ~/Library/Application Support/@writemind. Exit 1 when a note that
# should have a page has none, the Windows Media file got one, a script ran, the probe was reached, or slow.wm was.
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
SLOW_MS=10000
probe_pid=""

cleanup() {
  [ -n "$probe_pid" ] && kill "$probe_pid" 2> /dev/null
  pluginkit -r "$appex" > /dev/null 2>&1
  "$lsregister" -u "$app" > /dev/null 2>&1
  qlmanage -r > /dev/null 2>&1
  pkill -x quicklook-shot 2> /dev/null
  pkill -x WriteMindPreview 2> /dev/null
  rm -rf "$work/notes" "$work/quicklook-shot" "$work/warm.png" "$work/probe.mjs" "$work/probe.port" "$work/probe.log"
  if pluginkit -m -i com.seancheren.writemind.quicklook 2> /dev/null | grep -q "$root"; then
    echo "check-quicklook: the extension in $root is STILL registered: pluginkit -r \"$appex\"" >&2
  fi
}
trap cleanup EXIT INT TERM

echo "==> the probe a crafted note would reach"
cat > "$work/probe.mjs" << 'PROBE'
import http from "node:http"
import { appendFileSync } from "node:fs"
const server = http.createServer((request, response) => {
  appendFileSync(process.argv[2], `${request.method} ${request.url} ${request.headers["user-agent"] ?? ""}\n`)
  response.writeHead(404)
  response.end()
})
server.listen(0, "127.0.0.1", () => console.log(server.address().port))
PROBE
: > "$work/probe.log"
node "$work/probe.mjs" "$work/probe.log" > "$work/probe.port" &
probe_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$work/probe.port" ] && break; sleep 0.5; done
port="$(head -1 "$work/probe.port")"
[ -n "$port" ] || { echo "check-quicklook: the probe server did not start" >&2; exit 1; }
echo "    listening on 127.0.0.1:$port"

echo "==> sample notes"
QUICKLOOK_PROBE="http://127.0.0.1:$port" npx vite-node apps/desktop/scripts/quicklook-samples.ts "$work/notes" > /dev/null || exit 1
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
    *INJECTED*) echo "check-quicklook: FAIL: $1 ($4, $2 wide): a script in the note RAN: $result" >&2; failures=$((failures + 1)) ;;
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
shot hostile 900 700 dark page
shot slow 900 700 light page
took="$(printf '%s' "$result" | sed -n 's/.* in \([0-9][0-9]*\) ms.*/\1/p')"
if [ -z "$took" ] || [ "$took" -gt "$SLOW_MS" ]; then
  echo "check-quicklook: FAIL: slow.wm took ${took:-too long} ms (at most $SLOW_MS)" >&2; failures=$((failures + 1))
fi
shot newer 700 300 light page
shot broken 700 300 dark page
shot evil-name 700 300 light page
shot media 700 300 light none
sleep 1
if [ -s "$work/probe.log" ]; then
  echo "check-quicklook: FAIL: a preview reached out to the probe:" >&2
  sed 's/^/    /' "$work/probe.log" >&2
  failures=$((failures + 1))
else
  echo "check-quicklook: ok: nothing reached the probe"
fi
echo "check-quicklook: the photographs are in $out"
[ "$failures" -eq 0 ] || { echo "check-quicklook: $failures failed" >&2; exit 1; }
