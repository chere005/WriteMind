#!/bin/sh
# Build WriteMind.app with xcodebuild into build/DerivedData.
#   sh tools/build.sh             Debug
#   sh tools/build.sh --release   Release
# Prints the path of the bundle it built. Signed with the local certificate
# when tools/setup-signing.sh has made one — see tools/signing.sh, which
# test.sh shares — and ad-hoc otherwise: no team, no profile, runs on this Mac.
set -e
cd "$(dirname "$0")/.."
. tools/signing.sh

CONFIG=Debug
for a in "$@"; do
  case "$a" in
    --release) CONFIG=Release ;;
    --debug)   CONFIG=Debug ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done
mkdir -p build
LOG="build/xcodebuild-$CONFIG.log"
echo "==> xcodebuild $CONFIG (log: $LOG)"
if ! signed_xcodebuild -project WriteMind.xcodeproj -scheme WriteMind -configuration "$CONFIG" \
    -derivedDataPath build/DerivedData -destination 'platform=macOS' build > "$LOG" 2>&1; then
  grep -E 'error:|\*\* BUILD FAILED' "$LOG" | head -40 >&2
  echo "build failed — see $LOG" >&2
  exit 1
fi
APP="build/DerivedData/Build/Products/$CONFIG/WriteMind.app"
[ -d "$APP" ] || { echo "xcodebuild exited 0 but $APP is not there" >&2; exit 1; }
echo "$APP"
