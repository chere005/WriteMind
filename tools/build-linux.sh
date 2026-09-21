#!/bin/sh
# The Linux build, for Arch first.
#
# Run this ON a Linux box (an Arch box for the pacman package): a
# cross-build from macOS can make the AppImage but not a .pkg.tar.zst, and
# a package nobody has installed is not a package anybody should ship.
#
#   sh tools/build-linux.sh          the lot: pacman, AppImage, deb
#   sh tools/build-linux.sh pacman   just the Arch package
set -e
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Linux" ]; then
  echo "==> not Linux. The AppImage can be cross-built from here:"
  echo "    npm -w @writemind/desktop run package:linux -- --linux AppImage"
  echo "    The pacman package needs an Arch box (or a container)."
fi

want="${1:-}"
npm install --no-audit --no-fund
npm -w @writemind/desktop run build
if [ -n "$want" ]; then
  npx electron-builder --linux "$want" --config apps/desktop/electron-builder.yml \
    --project apps/desktop
else
  npx electron-builder --linux --config apps/desktop/electron-builder.yml \
    --project apps/desktop
fi
echo "==> built into dist-electron/"
