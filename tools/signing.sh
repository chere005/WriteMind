#!/bin/sh
# Sourced by build.sh and test.sh — not run on its own. Decides how the app
# is signed, and gives both scripts the one xcodebuild to call.
#
# A STABLE SIGNATURE KEEPS THE GRANTS. macOS remembers "allow the camera" and
# "allow the Documents folder" against the app's code signature, so an ad-hoc
# one — a different signature every build — makes every rebuild ask again.
# If tools/setup-signing.sh has put a local identity in the keychain, use it;
# otherwise fall back to ad-hoc and say so once.
#
# EVERY xcodebuild that touches build/DerivedData must sign the same way.
# `xcodebuild test` rebuilds and RE-SIGNS the very same Debug bundle, and
# while it did that ad-hoc and build.sh used the certificate, the two took
# turns at being "a new app" — and the prompts never stopped (Sean,
# 2026-09-18: "still keeps asking for camera and documents access").
IDENTITY="${WRITEMIND_SIGN_IDENTITY:-WriteMind Local Signing}"
SIGNED=0
if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$IDENTITY"; then
  SIGNED=1
  KEYCHAIN=$(security default-keychain | tr -d ' "')
else
  echo "   (ad-hoc signing: macOS will re-ask for the camera and the notes" >&2
  echo "    folder after each rebuild — sh tools/setup-signing.sh fixes that)" >&2
fi

# xcodebuild, with the signing settings added when there is an identity. The
# identity's name HAS SPACES IN IT, so it goes in as one quoted argument and
# is never assembled into a string a shell would split ("WriteMind Local
# Signing" once arrived as the build action 'Local').
signed_xcodebuild() {
  if [ "$SIGNED" = 1 ]; then
    xcodebuild "$@" CODE_SIGN_IDENTITY="$IDENTITY" OTHER_CODE_SIGN_FLAGS="--keychain=$KEYCHAIN"
  else
    xcodebuild "$@"
  fi
}
