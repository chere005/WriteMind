#!/bin/sh
# Give WriteMind a STABLE code-signing identity, so macOS remembers "allow"
# for the camera and for the notes folder across rebuilds.
#
#   sh tools/setup-signing.sh            create it if it is missing
#   sh tools/setup-signing.sh --check    say whether it is there, change nothing
#
# WHY THIS EXISTS. TCC — the thing that shows "WriteMind would like to use the
# camera" / "…to access files in your Documents folder" — remembers a grant
# against the app's CODE SIGNATURE, not its path. An ad-hoc signature ("-") is
# a different signature every single build, so every rebuild looked like a
# brand-new app and asked again. A self-signed certificate that stays in the
# login keychain is the same signature every build, so the first "Allow" is
# the last one.
#
# It is a LOCAL certificate: it makes this Mac trust these builds, nothing
# more. It is not a Developer ID, it notarises nothing, and it says nothing
# about anyone else's machine. A real Apple Development identity works here
# too — set WRITEMIND_SIGN_IDENTITY to its name and skip this script.
#
# THE KEYCHAIN WILL ASK FOR A PASSWORD, at least once, in a dialog. That is
# macOS asking whether this certificate may be trusted and whether codesign
# may use its key; nobody can answer it for you, which is the point of it.
set -e
cd "$(dirname "$0")/.."

NAME="${WRITEMIND_SIGN_IDENTITY:-WriteMind Local Signing}"
CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

if security find-identity -v -p codesigning | grep -qF "$NAME"; then
  echo "==> signing identity present: $NAME"
  echo "    builds use it automatically; the camera and folder grants stick."
  exit 0
fi

if [ "$CHECK" = 1 ]; then
  echo "==> no signing identity called '$NAME'"
  echo "    builds fall back to ad-hoc signing, and macOS re-asks for the"
  echo "    camera and the notes folder after every rebuild."
  echo "    Run: sh tools/setup-signing.sh"
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

echo "==> creating a self-signed code-signing certificate: $NAME"
cat > "$TMP/openssl.cnf" <<CNF
[ req ]
distinguished_name = dn
x509_extensions    = v3
prompt             = no
[ dn ]
CN = $NAME
[ v3 ]
basicConstraints       = critical,CA:false
keyUsage               = critical,digitalSignature
extendedKeyUsage       = critical,codeSigning
subjectKeyIdentifier   = hash
CNF

# /usr/bin/openssl is LibreSSL; Homebrew's is OpenSSL 3, whose PKCS#12
# defaults (AES-256 + SHA-256 MAC) macOS's Security framework CANNOT read —
# `security import` fails with "MAC verification failed (wrong password?)",
# which sounds like a password problem and is not one. So: the system openssl
# by preference, the old PBE algorithms spelled out, and a real (temporary)
# password, because an EMPTY one fails the same way on some releases.
OPENSSL=/usr/bin/openssl
[ -x "$OPENSSL" ] || OPENSSL=$(command -v openssl)
P12PASS="writemind-$$"

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/openssl.cnf" >/dev/null 2>&1 \
  || { echo "could not create the certificate (openssl: $OPENSSL)" >&2; exit 1; }

"$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -name "$NAME" -passout "pass:$P12PASS" -out "$TMP/identity.p12" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 >/dev/null 2>&1 \
  || "$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
       -name "$NAME" -passout "pass:$P12PASS" -out "$TMP/identity.p12" -legacy >/dev/null 2>&1 \
  || { echo "could not package the certificate for the keychain" >&2; exit 1; }

LOGIN_KEYCHAIN=$(security default-keychain | tr -d ' "')
# -T /usr/bin/codesign lets codesign use the key without a dialog per build;
# the keychain still asks once, when this runs.
security import "$TMP/identity.p12" -k "$LOGIN_KEYCHAIN" -P "$P12PASS" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null \
  || { echo "the keychain refused the certificate" >&2; exit 1; }

# Trust it for code signing in the USER domain. `-d` would mean the ADMIN
# domain and the System keychain, which needs sudo and is not this script's
# business — a certificate for running your own builds on your own Mac belongs
# to you, not to the machine.
security add-trusted-cert -r trustRoot -p codeSign -k "$LOGIN_KEYCHAIN" "$TMP/cert.pem" >/dev/null 2>&1 \
  || echo "   (trust was not set automatically — see the note at the end)" >&2
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$LOGIN_KEYCHAIN" >/dev/null 2>&1 || true

if security find-identity -v -p codesigning | grep -qF "$NAME"; then
  echo "==> done: $NAME is in $LOGIN_KEYCHAIN"
  echo "    Rebuild once (sh tools/run.sh). Allow the camera and the folder"
  echo "    that one time — the grants hold from then on."
else
  echo "" >&2
  echo "the certificate was imported but is not a valid codesigning identity yet." >&2
  echo "  Open Keychain Access › login › Certificates, double-click '$NAME'," >&2
  echo "  open Trust, and set 'Code Signing' to 'Always Trust'." >&2
  exit 1
fi
