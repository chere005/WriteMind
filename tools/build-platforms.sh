#!/bin/sh
# The platform build: the macOS bundle — Release, ad-hoc signed, into
# dist/WriteMind.app. The name and flags follow the suite's convention
# (CoreMind's bin/build-platforms.sh is the origin) so bin/dtp.sh sees a
# self-shipping app and passes --platforms / --web through to tools/dtp.sh.
#
#   sh tools/build-platforms.sh --mac        the bundle
#   sh tools/build-platforms.sh --dry-run    print the plan and stop
#
# WriteMind is macOS-only, so --mac is the only platform. --ios and --android
# are REFUSED by name rather than ignored: a suite-wide flag that silently
# succeeded here would read as "the iOS build passed" on the status page.
set -e
cd "$(dirname "$0")/.."
DRY=0
for a in "$@"; do
  case "$a" in
    --mac)     ;;
    --dry-run) DRY=1 ;;
    --ios|--android) echo "refusing: WriteMind has no $a build — it is macOS-only" >&2; exit 1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done
if [ "$DRY" = 1 ]; then
  echo "plan: xcodebuild Release -> build/DerivedData -> dist/WriteMind.app (ad-hoc signed)"
  exit 0
fi
APP=$(sh tools/build.sh --release | tail -1)
mkdir -p dist
rm -rf dist/WriteMind.app
ditto "$APP" dist/WriteMind.app
# The copy is verified, not assumed: a bundle that fails its own signature
# check is refused by Gatekeeper on first launch with a dialog nobody reads.
codesign --verify --deep --strict dist/WriteMind.app
VER=$(defaults read "$(pwd)/dist/WriteMind.app/Contents/Info" CFBundleShortVersionString)
echo "==> dist/WriteMind.app is WriteMind $VER"
