#!/bin/sh
# The unit suite: WriteMindTests, run by xcodebuild against a Debug build.
# The full xcodebuild transcript goes to build/xcodebuild-test.log; what is
# printed is the per-test verdict and the summary, so a failure names itself.
#
# Signed the same way as build.sh (tools/signing.sh): the test host IS the
# Debug WriteMind.app, re-signed by this run, and an ad-hoc signature here
# would turn the app macOS had just been told to allow back into a stranger.
set -e
cd "$(dirname "$0")/.."
. tools/signing.sh
mkdir -p build
LOG="build/xcodebuild-test.log"
echo "==> xcodebuild test (log: $LOG)"
RC=0
signed_xcodebuild test -project WriteMind.xcodeproj -scheme WriteMind -configuration Debug \
  -derivedDataPath build/DerivedData -destination 'platform=macOS' > "$LOG" 2>&1 || RC=$?
grep -E '^(Test Case .* (passed|failed)|Test Suite .* (passed|failed)|Executed .* tests?)' "$LOG" \
  | sed -E 's/^Test Case .-\[[A-Za-z]+\.([A-Za-z]+) ([A-Za-z]+)\]. (passed|failed).*/  \3  \1.\2/' \
  | grep -v '^Test Suite' || true
grep -E '^Executed [0-9]+ tests?' "$LOG" | tail -1
if [ "$RC" != 0 ]; then
  # Only the compiler's and XCTest's own lines: the host app's stderr also
  # says "error:" (linkd, TCC) and drowned the one line that mattered.
  grep -E '\.swift:[0-9]+: error:|^Test Case .* failed|\*\* TEST FAILED' "$LOG" | head -40 >&2
  echo "tests failed (exit $RC) — see $LOG" >&2
  exit "$RC"
fi
grep -q '\*\* TEST SUCCEEDED \*\*' "$LOG" || { echo "xcodebuild exited 0 without TEST SUCCEEDED — see $LOG" >&2; exit 1; }
