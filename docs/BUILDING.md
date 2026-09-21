# Building and shipping WriteMind

One codebase, three platforms. Nothing below is different per platform
except the last step, which is what a package IS.

```sh
npm install
npm test        # the ported model, against the transcribed Swift suite
npm run dev     # vite + electron, the window reloading on save
```

## The build

```sh
npm -w @writemind/desktop run build
```

Three things, in order: the renderer (vite → `apps/desktop/out/renderer`),
the shell (esbuild → `out/main/main.mjs` and `out/preload/preload.cjs`), and
`tools/build-vision.sh`, which compiles the macOS Vision helper when it is
run on a Mac and **does nothing anywhere else** — that is not a failure, it
is the capability rule: see `docs/PORT.md`.

## Packages

```sh
npm -w @writemind/desktop run package:mac      # dmg + zip
npm -w @writemind/desktop run package:win      # nsis + portable
npm -w @writemind/desktop run package:linux    # pacman + AppImage + deb
```

They land in `dist-electron/`. `apps/desktop/electron-builder.yml` is the
whole configuration.

**A package is built on the platform it is for.** An AppImage can be
cross-built from a Mac; a `.pkg.tar.zst` cannot, and a package nobody has
installed is not one to ship.

## Arch Linux

Arch is a first-class target, and there are two ways to install on it.

**The package electron-builder makes** — self-contained, its own Chromium:

```sh
sh tools/build-linux.sh pacman
sudo pacman -U dist-electron/writemind-*.pkg.tar.zst
```

**The Arch way** — built from source against the system `electron`, which
is smaller and updates with Arch's own:

```sh
cd packaging/arch
makepkg -si
```

`packaging/arch/PKGBUILD` declares `electron gtk3 nss alsa-lib glib2
xdg-utils`, and `tesseract` + `tesseract-data-eng` as OPTIONAL — they are
what "Read the words out of this picture" needs, and with neither installed
the app runs the same and simply does not offer it.

Two Arch things worth knowing:

- **Wayland.** The app sets `--ozone-platform-hint=auto` itself, so a
  Wayland session gets a Wayland window rather than a blurry Xwayland one.
  Nothing to pass.
- **The sandbox.** Electron's `chrome-sandbox` must be setuid root. Both
  packages install it that way; running `electron out/main/main.mjs`
  straight out of a source tree on a kernel with unprivileged user
  namespaces off needs `--no-sandbox`.

## Trashing a note

`shell.trashItem` is the desktop's own trash — Finder's, Explorer's, and on
Linux `gio trash` (glib2). Without it a trash would be a delete, so glib2
is a dependency rather than an optional one.

## Signing the Mac build

`codesign` picks a certificate BY NAME, and it refuses when two in the
keychain share one. Sean's login keychain held two "Apple Development:
seancheren@gmail.com (UN3PQ6VWGN)" certificates — the first revoked on
2026-08-09 and reissued seven minutes later — and the build failed with
`ambiguous`, having chosen the revoked one.

The two have different key pairs, so taking the dead one out cannot touch
the live one:

```sh
security find-identity -v -p codesigning     # look first: the revoked one says CSSMERR_TP_CERT_REVOKED
security delete-identity -Z 90E9251F3FCE40DF8583E0715118BABB456DD6B2
```

macOS asks for the keychain password, which is why this is not in a
script. Afterwards `security find-identity -v -p codesigning` should show
one Apple Development identity, and `npm -w @writemind/desktop run
package:mac` signs without being told anything.

`CSC_IDENTITY_AUTO_DISCOVERY=false` builds unsigned in the meantime, which
is what a local check needs.

## The version

`apps/desktop/package.json` holds it, and electron-builder reads it from
there. The Swift app's `MARKETING_VERSION` is its own and is not this one.
