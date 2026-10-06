#!/usr/bin/env bash
# Checks the two Mac dmgs and the WriteMind.app inside each, after
# `npm -w @writemind/desktop run package:mac:adhoc` (or release.yml's mac job):
#
#   bash tools/verify-mac.sh [dist-folder]        (default: dist-electron)
#
# What only a Mac can check, so CI runs it on its macOS runner (ci.yml's
# mac-package job, release.yml's mac job) before anything is uploaded:
#   - both dmgs are there (WriteMind-<version>-mac-arm64.dmg, -mac-x64.dmg),
#     and no zip, .blockmap or latest-mac.yml beside them (a Mac copy never
#     downloads an update: docs/BUILDING.md);
#   - every dist-electron/mac*/WriteMind.app: its main executable is the
#     chip its folder says; `codesign --verify --deep --strict` passes; the
#     signature is AD HOC (there is no Developer ID) and without the
#     hardened runtime; Info.plist has the camera and Documents wording,
#     LSMinimumSystemVersion 13.0 and the package's version; the Vision
#     helper (Contents/Resources/app.asar.unpacked/out/helpers/wm-vision) is
#     there, executable, signed, universal (x86_64 + arm64) with minos 13.0;
#   - each dmg passes `hdiutil verify`, and mounted read-only it holds a
#     WriteMind.app whose signature verifies and an Applications link.
#
# Exits non-zero, saying what is missing, on any miss. Invoke it with bash
# (it is not marked executable).
set -u
cd "$(dirname "$0")/.."
dist="${1:-dist-electron}"
failures=0

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

plist_value() { plutil -extract "$2" raw -o - "$1" 2> /dev/null; }

check_app() {
  local app="$1" expected_arch="$2"
  local name="${app#"$dist"/}"
  local exe="$app/Contents/MacOS/WriteMind"
  local plist="$app/Contents/Info.plist"
  local helper="$app/Contents/Resources/app.asar.unpacked/out/helpers/wm-vision"

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
  if printf '%s\n' "$details" | grep -q '^Signature=adhoc$'; then
    ok "$name: signed ad hoc"
  else
    fail "$name: the signature is not ad hoc ($(printf '%s\n' "$details" | grep -E '^(Signature|Authority)=' | head -1))"
  fi
  if printf '%s\n' "$details" | grep -E '^CodeDirectory .*flags=' | grep -q 'runtime'; then
    fail "$name: the hardened runtime is on (electron-builder.yml says hardenedRuntime: false)"
  else
    ok "$name: no hardened runtime"
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

  if [ -f "$helper" ]; then
    [ -x "$helper" ] && ok "$name: wm-vision is executable" || fail "$name: wm-vision is not executable"
    local helper_archs
    helper_archs="$(archs "$helper")"
    [ "$helper_archs" = "arm64 x86_64" ] && ok "$name: wm-vision is universal (x86_64 arm64)" \
      || fail "$name: wm-vision is '$helper_archs', expected x86_64 and arm64 (tools/build-vision.sh)"
    local arch m
    for arch in arm64 x86_64; do
      m="$(minos "$helper" "$arch")"
      if [ -z "$m" ]; then
        echo "verify-mac: note: $name: no vtool / otool answer for wm-vision's $arch minos; not checked"
      elif [ "$m" = "13.0" ]; then
        ok "$name: wm-vision $arch minos 13.0"
      else
        fail "$name: wm-vision $arch minos is $m, expected 13.0"
      fi
    done
    codesign --verify --strict "$helper" > /dev/null 2>&1 && ok "$name: wm-vision is signed" \
      || fail "$name: wm-vision's signature does not verify (Apple silicon will not run it)"
  else
    fail "$name: no Vision helper at Contents/Resources/app.asar.unpacked/out/helpers/wm-vision (was the build run on a Mac with swiftc?)"
  fi
}

# The apps electron-builder left: mac/ is the Intel build, mac-arm64/ Apple silicon's.
shopt -s nullglob
apps=("$dist"/mac*/WriteMind.app)
if [ "${#apps[@]}" -eq 0 ]; then
  fail "no $dist/mac*/WriteMind.app"
else
  for app in "${apps[@]}"; do
    case "$(basename "$(dirname "$app")")" in
      mac-arm64) check_app "$app" "arm64" ;;
      mac | mac-x64) check_app "$app" "x86_64" ;;
      *) fail "${app#"$dist"/}: a folder this release does not make (only mac/ and mac-arm64/)" ;;
    esac
  done
fi

# The two dmgs, and nothing an updater would read beside them.
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
for arch in arm64 x64; do
  dmg="$dist/WriteMind-$version-mac-$arch.dmg"
  if [ ! -f "$dmg" ]; then
    fail "no $dmg"
    continue
  fi
  label="${dmg##*/}"
  ok "$label ($(du -h "$dmg" | cut -f1))"
  hdiutil verify -quiet "$dmg" > /dev/null 2>&1 && ok "$label: hdiutil verify" || fail "$label: hdiutil verify failed"
  mnt="$(mktemp -d)"
  mounts="$mounts $mnt"
  if hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" > /dev/null 2>&1; then
    if [ -d "$mnt/WriteMind.app" ]; then
      codesign --verify --deep --strict "$mnt/WriteMind.app" > /dev/null 2>&1 \
        && ok "$label: its WriteMind.app verifies" || fail "$label: the WriteMind.app inside does not verify"
    else
      fail "$label: no WriteMind.app inside"
    fi
    [ -L "$mnt/Applications" ] && ok "$label: Applications link" || fail "$label: no Applications link to drag onto"
    hdiutil detach -quiet "$mnt" > /dev/null 2>&1 || true
  else
    fail "$label: hdiutil attach failed"
  fi
done
for extra in "$dist"/*-mac*.zip "$dist"/*.dmg.blockmap "$dist"/latest-mac.yml; do
  [ -e "$extra" ] && fail "${extra##*/} should not be made (electron-builder.yml: dmg only, dmg.writeUpdateInfo false)"
done

if [ "$failures" -gt 0 ]; then
  echo "verify-mac: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-mac: every check passed"
