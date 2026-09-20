#!/bin/sh
# Deploy WriteMind. There is no server and no store: THE DEPLOY IS THE MAC
# BUNDLE — the Release .app, smoked, copied into /Applications and verified.
#
#   sh tools/deploy.sh              build, smoke, install
#   sh tools/deploy.sh --dry-run    build and smoke; install nothing
#
# --quick is accepted because CoreMind's bin/deploy.sh hands it to lanes that
# have a fast gate; this one has none, so it changes nothing.
set -e
cd "$(dirname "$0")/.."
DRY=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --quick)   ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done
sh tools/build-platforms.sh --mac
sh tools/smoke.sh dist/WriteMind.app

DEST=/Applications/WriteMind.app
if [ "$DRY" = 1 ]; then
  echo "==> dry run: would install dist/WriteMind.app at $DEST"
  exit 0
fi
# A running copy keeps its old code until relaunched — the bundle underneath
# it is replaced anyway, so the NEXT launch is the new version. Told, not killed.
if pgrep -x WriteMind >/dev/null 2>&1; then
  echo "   (WriteMind is running — it stays on the old version until relaunched)"
fi
rm -rf "$DEST"
ditto dist/WriteMind.app "$DEST"
[ -x "$DEST/Contents/MacOS/WriteMind" ] || { echo "install failed: no executable at $DEST" >&2; exit 1; }
codesign --verify --deep --strict "$DEST"
VER=$(defaults read "$DEST/Contents/Info" CFBundleShortVersionString)
echo "==> installed WriteMind $VER at $DEST"
