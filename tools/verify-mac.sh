#!/usr/bin/env bash
# Checks the Mac dmg and the WriteMind.app inside it, after
# `npm -w @writemind/desktop run package:mac:adhoc` (or release.yml's mac job):
#
#   bash tools/verify-mac.sh [dist-folder]        (default: dist-electron)
#
# APPLE SILICON ONLY (Sean, 2026-10-10: nothing built for Intel ships on a Mac). What only a Mac can check, so CI runs
# it on its macOS runner (ci.yml's mac-package job, release.yml's mac job) before anything is uploaded:
#   - ONE dmg, WriteMind-<version>-mac-arm64.dmg, no dmg .blockmap, and no other dmg: a -mac-x64 or -mac-universal
#     dmg is a FAILURE. Signed (WRITEMIND_MAC_SIGNED=1): the arm64 zip and a latest-mac.yml naming it and nothing
#     else (the updater installs from those); ad hoc: neither (an ad-hoc copy only opens the release page);
#   - ONE app, dist-electron/mac-arm64/WriteMind.app; a mac/ (x64) or mac-universal/ folder is a FAILURE. Its main
#     executable is arm64; `codesign --verify --deep --strict` passes; the signature is AD HOC (there is no Developer
#     ID) and without the hardened runtime; Info.plist has the camera and Documents wording, LSMinimumSystemVersion
#     13.0 and the package's version; the tablet helper and the Vision helper (Contents/Resources/app.asar.unpacked/out/helpers/wm-pen, wm-vision)
#     are there, executable, signed, arm64 with minos 13.0;
#   - EVERY MACH-O in the app is arm64 and nothing else: the walk covers the whole bundle and the files inside
#     app.asar (extracted to a scratch folder), and fails on a slice that is not arm64 and on any universal binary.
#     koffi (the Windows pen's FFI, which carries every platform's prebuilt .node) is not packed on a Mac at all;
#     WebAssembly (onnxruntime-web's .wasm) is not a Mach-O and has no architecture, so the walk does not see it;
#   - the dmg passes `hdiutil verify`, and mounted read-only it holds a WriteMind.app whose signature verifies, whose
#     Mach-O files are all arm64 too, and an Applications link.
#
# Exits non-zero, saying what is missing, on any miss. Invoke it with bash
# (it is not marked executable).
set -u
cd "$(dirname "$0")/.."
dist="${1:-dist-electron}"
failures=0
# WRITEMIND_MAC_SIGNED=1: expect a Developer ID, the hardened runtime, the camera entitlement and a stapled ticket
# (release.yml's mac job, when the signing secrets are set); otherwise the ad-hoc dmgs.
signed="${WRITEMIND_MAC_SIGNED:-0}"

fail() { echo "verify-mac: FAIL: $*" >&2; failures=$((failures + 1)); }
ok() { echo "verify-mac: ok: $*"; }

if [ "$(uname)" != "Darwin" ]; then
  echo "verify-mac: this needs macOS (codesign, lipo, plutil, hdiutil); nothing was checked" >&2
  exit 2
fi
for tool in codesign lipo plutil hdiutil node; do
  command -v "$tool" > /dev/null 2>&1 || { echo "verify-mac: $tool is missing" >&2; exit 2; }
done

version="$(node -p "require('./apps/desktop/package.json').version")"
[ -n "$version" ] || { echo "verify-mac: no version in apps/desktop/package.json" >&2; exit 2; }
echo "verify-mac: WriteMind $version in $dist"

# The architectures of a Mach-O file, sorted, on one line ("arm64 x86_64").
archs() { lipo -archs "$1" 2> /dev/null | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ' | sed 's/ $//'; }

# The minimum macOS of one slice of a Mach-O file (LC_BUILD_VERSION's minos).
minos() {
  local file="$1" arch="$2" value=""
  if command -v vtool > /dev/null 2>&1; then
    value="$(vtool -arch "$arch" -show-build "$file" 2> /dev/null | awk '$1 == "minos" { print $2; exit }')"
  fi
  if [ -z "$value" ] && command -v otool > /dev/null 2>&1; then
    value="$(otool -arch "$arch" -l "$file" 2> /dev/null | awk '$1 == "minos" { print $2; exit }')"
  fi
  printf '%s' "$value"
}

# Every Mach-O file under a folder, one path per line: found by its first four bytes (the thin and fat magics, both
# byte orders), not by its name, so a binary with no extension or a renamed one is seen. A 0xCAFEBABE file that lipo
# cannot read (a Java class) is not a Mach-O and is dropped by the caller.
macho_files() {
  node -e '
    const fs = require("fs"), path = require("path")
    const magic = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"])
    const buf = Buffer.alloc(4)
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file)
        else if (entry.isFile()) {
          let fd
          try { fd = fs.openSync(file, "r"); if (fs.readSync(fd, buf, 0, 4, 0) === 4 && magic.has(buf.toString("hex"))) console.log(file) }
          catch {} finally { if (fd !== undefined) fs.closeSync(fd) }
        }
      }
    }
    walk(process.argv[1])
  ' "$1"
}

# Sets MACHO_SEEN / MACHO_BAD, and a line per architecture, for every Mach-O under $2 (named $1 in the messages).
# Anything that is not exactly "arm64" is a failure: x86_64, i386, arm64e, and a universal binary (two or more slices).
MACHO_SEEN=0
scan_macho() {
  local label="$1" root="$2" file got rel
  local seen=0 bad=0 tmp
  tmp="$(mktemp)"
  macho_files "$root" > "$tmp"
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    got="$(archs "$file")"
    [ -n "$got" ] || continue
    seen=$((seen + 1))
    rel="${file#"$root"/}"
    if [ "$got" != "arm64" ]; then
      bad=$((bad + 1))
      case "$got" in
        *" "*) fail "$label: $rel is a universal binary ($got); only a single arm64 slice ships" ;;
        *) fail "$label: $rel is $got, not arm64" ;;
      esac
    fi
  done < "$tmp"
  rm -f "$tmp"
  MACHO_SEEN=$seen
  if [ "$seen" -eq 0 ]; then
    fail "$label: no Mach-O file found at all (the scan itself is broken)"
  elif [ "$bad" -eq 0 ]; then
    ok "$label: all $seen Mach-O files are arm64 (no x86_64 slice, no universal binary)"
  fi
}

# The files INSIDE app.asar are Mach-O candidates too (a .node in an archive would hide from find): extract the
# archive to a scratch folder and walk that; koffi and its prebuilt binaries must not be in it, nor unpacked.
scan_asar() {
  local app="$1" label="$2" res="$1/Contents/Resources" scratch
  if [ ! -f "$res/app.asar" ]; then
    fail "$label: no Contents/Resources/app.asar"
    return
  fi
  if [ ! -x node_modules/.bin/asar ]; then
    fail "$label: node_modules/.bin/asar is missing, so the files inside app.asar were not checked (npm ci first)"
    return
  fi
  scratch="$(mktemp -d)"
  if node_modules/.bin/asar extract "$res/app.asar" "$scratch" > /dev/null 2>&1; then
    scan_macho "$label (inside app.asar)" "$scratch"
  else
    fail "$label: app.asar could not be extracted"
  fi
  [ ! -e "$scratch/node_modules/koffi" ] && [ ! -e "$res/app.asar.unpacked/node_modules/koffi" ] \
    && ok "$label: koffi (the Windows pen's FFI) is not packed" || fail "$label: node_modules/koffi is packed into the Mac app (electron-builder.yml mac.files)"
  [ ! -e "$scratch/node_modules/@koromix" ] && [ ! -e "$res/app.asar.unpacked/node_modules/@koromix" ] \
    && ok "$label: koffi's prebuilt binaries (@koromix) are not packed" || fail "$label: node_modules/@koromix is packed into the Mac app"
  rm -rf "$scratch"
}

plist_value() { plutil -extract "$2" raw -o - "$1" 2> /dev/null; }

check_app() {
  local app="$1" expected_arch="$2"
  local name="${app#"$dist"/}"
  local exe="$app/Contents/MacOS/WriteMind"
  local plist="$app/Contents/Info.plist"

  if [ -f "$exe" ]; then
    local got
    got="$(archs "$exe")"
    [ "$got" = "$expected_arch" ] && ok "$name runs on $got" || fail "$name: the main executable is '$got', expected $expected_arch"
  else
    fail "$name: no Contents/MacOS/WriteMind"
  fi

  if codesign --verify --deep --strict --verbose=2 "$app" > /dev/null 2>&1; then
    ok "$name: codesign --verify --deep --strict"
  else
    fail "$name: codesign --verify --deep --strict failed:"
    codesign --verify --deep --strict --verbose=2 "$app" 2>&1 | sed 's/^/    /' >&2
  fi

  local details
  details="$(codesign -dv --verbose=2 "$app" 2>&1)"
  local runtime=0
  printf '%s\n' "$details" | grep -E '^CodeDirectory .*flags=' | grep -q 'runtime' && runtime=1
  if [ "$signed" = 1 ]; then
    if printf '%s\n' "$details" | grep -q '^Authority=Developer ID Application:'; then
      ok "$name: signed with a Developer ID Application certificate"
    else
      fail "$name: not signed with a Developer ID Application certificate ($(printf '%s\n' "$details" | grep -E '^(Signature|Authority)=' | head -1))"
    fi
    [ "$runtime" = 1 ] && ok "$name: hardened runtime" || fail "$name: the hardened runtime is off (notarization needs it)"
    codesign -d --entitlements - "$app" 2> /dev/null | grep -q 'com.apple.security.device.camera' \
      && ok "$name: camera entitlement" || fail "$name: no camera entitlement"
    spctl -a -vv "$app" > /dev/null 2>&1 && ok "$name: spctl accepts it" || fail "$name: spctl -a -vv rejects it"
    xcrun stapler validate "$app" > /dev/null 2>&1 && ok "$name: notarization ticket stapled" || fail "$name: xcrun stapler validate failed"
  else
    if printf '%s\n' "$details" | grep -q '^Signature=adhoc$'; then
      ok "$name: signed ad hoc"
    else
      fail "$name: the signature is not ad hoc ($(printf '%s\n' "$details" | grep -E '^(Signature|Authority)=' | head -1))"
    fi
    [ "$runtime" = 1 ] && fail "$name: the hardened runtime is on (package:mac:adhoc turns it off)" || ok "$name: no hardened runtime"
  fi

  if [ -f "$plist" ]; then
    local camera documents minimum short
    camera="$(plist_value "$plist" NSCameraUsageDescription)"
    documents="$(plist_value "$plist" NSDocumentsFolderUsageDescription)"
    minimum="$(plist_value "$plist" LSMinimumSystemVersion)"
    short="$(plist_value "$plist" CFBundleShortVersionString)"
    [ -n "$camera" ] && ok "$name: NSCameraUsageDescription" || fail "$name: Info.plist has no NSCameraUsageDescription"
    [ -n "$documents" ] && ok "$name: NSDocumentsFolderUsageDescription" || fail "$name: Info.plist has no NSDocumentsFolderUsageDescription"
    [ "$minimum" = "13.0" ] && ok "$name: LSMinimumSystemVersion 13.0" || fail "$name: LSMinimumSystemVersion is '$minimum', expected 13.0"
    [ "$short" = "$version" ] && ok "$name: version $short" || fail "$name: CFBundleShortVersionString is '$short', expected $version"
  else
    fail "$name: no Contents/Info.plist"
  fi

  local pen="$app/Contents/Resources/app.asar.unpacked/out/helpers/wm-pen"
  if [ -x "$pen" ]; then
    [ "$(archs "$pen")" = "arm64" ] && ok "$name: wm-pen is arm64 (one slice)" \
      || fail "$name: wm-pen is '$(archs "$pen")', expected arm64 alone (tools/build-helpers.sh)"
    local m
    m="$(minos "$pen" arm64)"
    if [ -z "$m" ]; then
      echo "verify-mac: note: $name: no vtool / otool answer for wm-pen's minos; not checked"
    elif [ "$m" = "13.0" ]; then
      ok "$name: wm-pen minos 13.0"
    else
      fail "$name: wm-pen minos is $m, expected 13.0"
    fi
    codesign --verify --strict "$pen" > /dev/null 2>&1 && ok "$name: wm-pen is signed" || fail "$name: wm-pen's signature does not verify (Apple silicon will not run it)"
  else
    fail "$name: no executable tablet helper at Contents/Resources/app.asar.unpacked/out/helpers/wm-pen (was the build run on a Mac with swiftc?)"
  fi

  local vision="$app/Contents/Resources/app.asar.unpacked/out/helpers/wm-vision"
  if [ -x "$vision" ]; then
    [ "$(archs "$vision")" = "arm64" ] && ok "$name: wm-vision is arm64 (one slice)" \
      || fail "$name: wm-vision is '$(archs "$vision")', expected arm64 alone (tools/build-helpers.sh)"
    local mv
    mv="$(minos "$vision" arm64)"
    if [ -z "$mv" ]; then
      echo "verify-mac: note: $name: no vtool / otool answer for wm-vision's minos; not checked"
    elif [ "$mv" = "13.0" ]; then
      ok "$name: wm-vision minos 13.0"
    else
      fail "$name: wm-vision minos is $mv, expected 13.0"
    fi
    codesign --verify --strict "$vision" > /dev/null 2>&1 && ok "$name: wm-vision is signed" || fail "$name: wm-vision's signature does not verify (Apple silicon will not run it)"
  else
    fail "$name: no executable Vision helper (the Mac's OCR reader) at Contents/Resources/app.asar.unpacked/out/helpers/wm-vision (was the build run on a Mac with swiftc?)"
  fi

  # No Intel code anywhere in the bundle, and no universal binary.
  scan_macho "$name" "$app"
  scan_asar "$app" "$name"
}

# The apps electron-builder left: only mac-arm64/ (Apple silicon). mac/ is the Intel build, mac-universal/ a merged
# one: either is a failure, however good it is.
shopt -s nullglob
apps=("$dist"/mac*/WriteMind.app)
if [ "${#apps[@]}" -eq 0 ]; then
  fail "no $dist/mac-arm64/WriteMind.app"
else
  for app in "${apps[@]}"; do
    case "$(basename "$(dirname "$app")")" in
      mac-arm64) check_app "$app" "arm64" ;;
      *) fail "${app#"$dist"/}: this release is Apple silicon only; electron-builder must make mac-arm64/ and no other app folder ($(basename "$(dirname "$app")")/ is an Intel or universal build)" ;;
    esac
  done
  [ -d "$dist/mac-arm64/WriteMind.app" ] || fail "no $dist/mac-arm64/WriteMind.app"
fi

# The ONE dmg, and nothing an updater would read beside it.
# Mounted read-only under a temp folder; whatever is still mounted at the end is detached.
mounts=""
cleanup() {
  local m
  for m in $mounts; do
    hdiutil detach -quiet "$m" > /dev/null 2>&1
    rmdir "$m" 2> /dev/null
  done
  return 0
}
trap cleanup EXIT
dmg="$dist/WriteMind-$version-mac-arm64.dmg"
if [ ! -f "$dmg" ]; then
  fail "no $dmg"
else
  label="${dmg##*/}"
  ok "$label ($(du -h "$dmg" | cut -f1))"
  hdiutil verify -quiet "$dmg" > /dev/null 2>&1 && ok "$label: hdiutil verify" || fail "$label: hdiutil verify failed"
  mnt="$(mktemp -d)"
  mounts="$mounts $mnt"
  if hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" > /dev/null 2>&1; then
    if [ -d "$mnt/WriteMind.app" ]; then
      codesign --verify --deep --strict "$mnt/WriteMind.app" > /dev/null 2>&1 \
        && ok "$label: its WriteMind.app verifies" || fail "$label: the WriteMind.app inside does not verify"
      # The app a person drags out of the dmg is the one that must hold no Intel code.
      scan_macho "$label: its WriteMind.app" "$mnt/WriteMind.app"
    else
      fail "$label: no WriteMind.app inside"
    fi
    [ -L "$mnt/Applications" ] && ok "$label: Applications link" || fail "$label: no Applications link to drag onto"
    hdiutil detach -quiet "$mnt" > /dev/null 2>&1 || true
  else
    fail "$label: hdiutil attach failed"
  fi
fi
# Any other dmg is an Intel (or universal) one, or a stale one from another version: none may be made.
for extra in "$dist"/*.dmg; do
  [ "$extra" = "$dmg" ] || fail "${extra##*/} should not be here: Apple silicon only means one dmg, WriteMind-$version-mac-arm64.dmg"
done
for extra in "$dist"/*.dmg.blockmap; do
  [ -e "$extra" ] && fail "${extra##*/} should not be made (electron-builder.yml: dmg.writeUpdateInfo false)"
done
# Signed: the updater's files, the arm64 zip named in latest-mac.yml (and no Intel zip). Ad hoc: none of them.
if [ "$signed" = 1 ]; then
  zip="$dist/WriteMind-$version-mac-arm64.zip"
  [ -f "$zip" ] && ok "${zip##*/}" || fail "no $zip (the updater installs from it)"
  grep -q "WriteMind-$version-mac-arm64.zip" "$dist/latest-mac.yml" 2> /dev/null \
    && ok "latest-mac.yml names ${zip##*/}" || fail "latest-mac.yml does not name ${zip##*/}"
  grep -qE 'mac-(x64|universal)' "$dist/latest-mac.yml" 2> /dev/null && fail "latest-mac.yml names an Intel or universal file"
  for extra in "$dist"/*-mac*.zip; do
    [ "$extra" = "$zip" ] || fail "${extra##*/} should not be made (Apple silicon only: the one zip is ${zip##*/})"
  done
  grep -q "^version: $version\$" "$dist/latest-mac.yml" 2> /dev/null && ok "latest-mac.yml is $version" || fail "latest-mac.yml is not version $version"
else
  for extra in "$dist"/*-mac*.zip "$dist"/latest-mac.yml; do
    [ -e "$extra" ] && fail "${extra##*/} should not be made by an ad-hoc build (package:mac:adhoc: --mac dmg)"
  done
fi

if [ "$failures" -gt 0 ]; then
  echo "verify-mac: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-mac: every check passed"
