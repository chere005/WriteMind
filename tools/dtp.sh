#!/bin/sh
# dtp — deploy, tag, push. The release gesture for WriteMind.
# tdtp — the same lane with the unit suite in front: tools/tdtp.sh, which
# calls this with --full. (Sean's shorthand, 2026-08-22: dtp = deploy, tag,
# push; tdtp = test, deploy, tag, push.)
#
# What a run does, in order:
#   0. refuse a non-main branch; refuse a tree with uncommitted TRACKED changes;
#      pull --autostash and check the tree AGAIN (a conflicted autostash pop
#      exits 0)
#   1. (--full only) sh tools/test.sh — the unit suite, before anything is touched
#   2. bump the MINOR version (x.y.0 → x.(y+1).0) — MARKETING_VERSION in
#      WriteMind.xcodeproj/project.pbxproj, every occurrence, verified — and
#      commit the bump. UNLESS the current version is still untagged, which
#      means a previous run bumped and then failed before tagging: that version
#      is reused, not skipped past, so re-running a failed dtp burns no number.
#   3. sh tools/deploy.sh — the Release bundle, smoked, installed into
#      /Applications. THE DEPLOY IS THE MAC BUNDLE: this app has no web export,
#      no server and no store, so "the platform build" and "the deploy" are one
#      step here, and it runs BEFORE the tag so a broken build leaves the
#      version untagged for the re-run to reuse.
#   4. tag X.Y.0 (BARE — no v), annotated
#   5. git push --atomic --follow-tags origin main — both refs or neither
#
# --web and --mac are accepted for CoreMind's bin/dtp.sh, which passes --web to
# a self-shipping lane when --platforms is unset and nothing when it is set.
# Here they change nothing: with the bundle being the deploy there is no
# "release without the platform build" to select.
set -e
cd "$(dirname "$0")/.."

FULL=0
for a in "$@"; do
  case "$a" in
    --full)      FULL=1 ;;
    --web|--mac) ;;
    --ios|--android) echo "refusing: WriteMind has no $a build — it is macOS-only" >&2; exit 1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

PBX=WriteMind.xcodeproj/project.pbxproj

# ---------------------------------------------------------------- the branch
# The push below names main explicitly, so a lane run from any other branch
# would deploy and tag a tree it then does not push — while printing
# "pushed" and exiting 0.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "refusing: this lane ships main, and HEAD is on '$BRANCH'" >&2
  exit 1
fi

# ------------------------------------------------------------- the status page
# A single-repo release is still a release: it reports to seancheren.com/status
# through CoreMind's bin/report-status.sh, which exits 0 on every failure path
# by design; the `|| true` here covers CoreMind not being checked out beside
# this repo at all. A status page must never be the thing that stops a release.
# Under CoreMind's `dtp all` the orchestrator has already opened ONE card for
# the whole batch and passes its id down as MIND_RUN_ID — this lane then
# reports nothing and lets that card stand.
REPORTER="${MIND_DIR:-$(cd .. && pwd)}/CoreMind/bin/report-status.sh"
RUN_ID=""
REPORT_DONE=0
BEAT_PID=""
if [ -f "$REPORTER" ] && [ -z "${MIND_RUN_ID:-}" ]; then
  KIND=dtp; [ "$FULL" = 1 ] && KIND=tdtp
  RUN_ID=$(sh "$REPORTER" start "$KIND" WriteMind 2>/dev/null || true)
  # ERREXIT-PROOF, as ChefMind's lane learned on 2026-09-15: `wait` on a
  # process just killed returns 143, and an AND-list ending in a brace group
  # is the one place `set -e` still applies. `if`, and `|| true` on both.
  beat_stop() {
    if [ -n "$BEAT_PID" ]; then
      kill "$BEAT_PID" >/dev/null 2>&1 || true
      wait "$BEAT_PID" 2>/dev/null || true
      BEAT_PID=""
    fi
    return 0
  }
  trap 'beat_stop; if [ -n "$RUN_ID" ] && [ "$REPORT_DONE" != 1 ]; then sh "$REPORTER" finish "$RUN_ID" failed 3 "stopped before finishing" >/dev/null 2>&1 || true; fi' EXIT INT TERM
  # A beat a minute keeps the card alive through a multi-minute xcodebuild.
  if [ -n "$RUN_ID" ]; then
    ( while :; do sleep 60; sh "$REPORTER" beat "$RUN_ID" "shipping — $KIND" >/dev/null 2>&1 || true; done ) &
    BEAT_PID=$!
  fi
fi

# ------------------------------------------------------- the tree, then a pull
refuse_dirty() {
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "refusing: $1" >&2
    git status --porcelain --untracked-files=no | sed 's/^/  /' >&2
    exit 1
  fi
}
refuse_dirty "uncommitted tracked changes — commit your work first, so the tag names exactly what shipped"

if git remote get-url origin >/dev/null 2>&1; then
  git pull --autostash --quiet
  refuse_dirty "the pull left the tree dirty — a conflicted autostash pop exits 0, so this is the check that catches it"
else
  echo "refusing: no origin remote — the lane ends in a push" >&2
  exit 1
fi

if [ "$FULL" = 1 ]; then
  echo "==> tdtp: the unit suite, before anything is touched"
  sh tools/test.sh || { echo "the suite failed — nothing shipped" >&2; exit 1; }
fi

# ------------------------------------------------------------------ the version
# The version lives in the pbxproj, once per build configuration (the app's
# Debug and Release, the test bundle's Debug and Release). They move together.
CUR=$(grep -m1 -oE 'MARKETING_VERSION = [0-9.]+;' "$PBX" | sed -E 's/MARKETING_VERSION = ([0-9.]+);/\1/')
printf '%s\n' "$CUR" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "$PBX MARKETING_VERSION '$CUR' is not x.y.z" >&2; exit 1; }
TOTAL=$(grep -c 'MARKETING_VERSION = ' "$PBX")
SAME=$(grep -c "MARKETING_VERSION = $CUR;" "$PBX")
[ "$TOTAL" = "$SAME" ] || { echo "guard: $PBX carries more than one version ($SAME of $TOTAL say $CUR)" >&2; exit 1; }

if git rev-parse -q --verify "refs/tags/$CUR" >/dev/null; then
  NEW=$(echo "$CUR" | awk -F. '{printf "%d.%d.0", $1, $2+1}')
  echo "==> version: $CUR (tagged) -> $NEW"
else
  NEW="$CUR"
  echo "==> version: $CUR is still untagged from an earlier run — reusing it"
fi

# A leftover $NEW would make `git tag -a` fail AFTER the bundle has shipped.
# Checked HERE, while nothing has been touched yet.
if git rev-parse -q --verify "refs/tags/$NEW" >/dev/null; then
  echo "refusing: the tag $NEW already exists — nothing has shipped yet." >&2
  echo "  It is the residue of an interrupted lane: look at it, then delete it" >&2
  echo "  or move the version on." >&2
  exit 1
fi

# Every occurrence, and VERIFIED — a sed that matches nothing reports success.
if [ "$NEW" != "$CUR" ]; then
  perl -i -pe "s|MARKETING_VERSION = \Q$CUR\E;|MARKETING_VERSION = $NEW;|g" "$PBX"
fi
[ "$(grep -c "MARKETING_VERSION = $NEW;" "$PBX")" = "$TOTAL" ] \
  || { echo "guard: $PBX does not carry $NEW in all $TOTAL places" >&2; exit 1; }

if ! git diff --quiet -- "$PBX"; then
  git add "$PBX"
  git commit -q -m "WriteMind $NEW"
  echo "==> committed the bump"
fi

# ------------------------------------------------------------------- the deploy
if ! sh tools/deploy.sh; then
  echo "" >&2
  echo "THE BUNDLE DID NOT SHIP — so nothing was tagged." >&2
  echo "  Fix it and re-run: the lane reuses ${NEW}." >&2
  exit 1
fi

# --------------------------------------------------------------- tag and push
git tag -a "$NEW" -m "WriteMind $NEW"
# --atomic, because `git push --follow-tags` is per-ref: when origin/main has
# moved, the TAG lands on the remote while main is REJECTED — a published tag
# for a commit nobody can fetch. Both or neither; and if neither, the local
# tag comes straight back off so the re-run reuses the version.
if ! git push --atomic --follow-tags origin main; then
  git tag -d "$NEW" >/dev/null
  echo "" >&2
  echo "THE BUNDLE IS INSTALLED, but the push was rejected — so nothing was tagged." >&2
  echo "  main has moved on the remote. Pull, then re-run: the lane reuses ${NEW}." >&2
  exit 1
fi
echo "==> pushed, tagged $NEW"

beat_stop 2>/dev/null || true
REPORT_DONE=1
if [ -n "$RUN_ID" ]; then
  sh "$REPORTER" finish "$RUN_ID" ok 0 "$NEW installed" >/dev/null 2>&1 || true
fi
echo "==> dtp done: WriteMind $NEW is installed and tagged"
