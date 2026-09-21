#!/bin/sh
# Smoke a built bundle: it launches, it is still running eight seconds later.
#   sh tools/smoke.sh [path/to/WriteMind.app]     default dist/WriteMind.app
#
# The same honest bar as the suite's Mac smokes: a window showing an error is
# still a running process, so this catches a bundle that cannot start (a bad
# signature, a missing framework, a crash on launch) and nothing subtler.
#
# IT RUNS AGAINST A SCRATCH NOTES FOLDER, NEVER SEAN'S. This copy of the app
# opens whatever note the session says was last open, and the `kill` below is
# a SIGTERM it answers by flushing a save — so on 2026-09-20 the smoke wrote
# over ~/Documents/WriteMind/Untitled.md and it lost two cells. The baseline
# rule in AgentSuite/AGENTS.md is the same one: a check that can reach the
# real thing is not a check. WRITEMIND_SCRATCH_NOTES is what TestHost reads.
set -e
cd "$(dirname "$0")/.."
APP="${1:-dist/WriteMind.app}"
BIN="$APP/Contents/MacOS/WriteMind"
[ -x "$BIN" ] || { echo "smoke: no executable at $BIN" >&2; exit 1; }
WRITEMIND_SCRATCH_NOTES=1 "$BIN" >/dev/null 2>&1 &
PID=$!
sleep 8
if ! kill -0 "$PID" 2>/dev/null; then
  wait "$PID" || RC=$?
  echo "smoke: WriteMind exited within 8 seconds (code ${RC:-?})" >&2
  exit 1
fi
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
echo "==> smoke ok: $APP launched and stayed up"
