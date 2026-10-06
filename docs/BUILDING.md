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
npm -w @writemind/desktop run package:mac      # two dmgs: arm64 and x64 (signed with Sean's certificate)
npm -w @writemind/desktop run package:win      # nsis + portable
npm -w @writemind/desktop run package:linux    # pacman + AppImage + deb
```

On a Mac, `package:mac:adhoc` is what a release ships: the same two dmgs
(`WriteMind-<version>-mac-arm64.dmg`, `-mac-x64.dmg`), signed ad hoc, never
published. It packages the existing build, so:

```sh
npm run build                                   # with the universal Vision helper (tools/build-vision.sh)
npm -w @writemind/desktop run package:mac:adhoc
bash tools/verify-mac.sh                        # the signature, the chips, the helper, Info.plist, the dmgs
```

They land in `dist-electron/`. `apps/desktop/electron-builder.yml` is the
whole configuration. On Windows, `tools\build-installer.ps1` builds just the
installer (NSIS, x64, never published); the installer itself, its tools page
and its silent options are in `docs/INSTALL-WINDOWS.md`.

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

**The released dmgs are signed AD HOC, not with that certificate.** There is
no Apple Developer ID, so nothing can be notarized; an Apple Development
certificate would not get past Gatekeeper either. `package:mac:adhoc` (and
release.yml's mac job, the same line) passes `-c.mac.identity=-
-c.forceCodeSigning=true -c.mac.timestamp=none -c.mac.notarize=false`:
`codesign -s -` over the whole bundle, a build that fails rather than ships
unsigned, no timestamp (an ad-hoc signature cannot have one) and no
notarization. `mac.identity` in `electron-builder.yml` stays Sean's
certificate, for his own `package:mac`. `hardenedRuntime` is false, as in
the Swift app: only notarization needs it. `minimumSystemVersion` is 13.0
(Electron 44). The Vision helper is universal (`lipo` of an arm64 and an
x86_64 build for macOS 13), so the one build serves both dmgs; the dmgs are
not one universal app because koffi's darwin `.node` files and the helper
defeat `@electron/universal`. (koffi is Windows-only at run time:
`main/pen/win32.ts` never loads it on a Mac, so the x64 dmg built on an
Apple silicon runner carrying koffi's arm64 prebuilt is harmless.) A first
open needs the user's yes: docs/INSTALL-MAC.md.

## "WriteMind" in the Dock, not "Electron" (macOS)

A dev run (`npm run dev`, `npm start`) runs inside
`node_modules/electron/dist/Electron.app`, and the Dock's label, the menu bar's
bold first title and the icon come from THAT bundle's `Info.plist`. So:

- `apps/desktop/scripts/mac-dev-identity.mjs` (run by `dev` and `start`; by
  hand: `node apps/desktop/scripts/mac-dev-identity.mjs`) renames the dev bundle
  WriteMind (`CFBundleName`, `CFBundleDisplayName`, bundle id
  `com.seancheren.writemind.dev`, WriteMind's camera wording), puts WriteMind's
  `.icns` in place of Electron's, re-signs the bundle ad hoc (`codesign -s -`)
  and re-registers it with LaunchServices. A no-op on Windows / Linux and when
  the bundle already says WriteMind; an `npm ci` undoes it and the next dev
  run redoes it. The new bundle id means macOS asks for the camera once more.
- `main/macIdentity.ts` names the running app WriteMind before the menu is
  built (About / Hide / Quit WriteMind; the profile stays in
  `~/Library/Application Support/@writemind/desktop`), fills the About panel
  (version, "Copyright © 2026 Shahean Cheren") and, in a dev run, sets the
  dock tile to the logo (`out/icons/icon.png`).
- The `.icns` (`out/icons/WriteMind.icns`, built by `scripts/build.mjs` with
  `scripts/icns.mjs`, no `iconutil` needed) is the Mac app's own icon set
  (`WriteMind/Assets.xcassets/AppIcon.appiconset`), and `electron-builder.yml`
  gives it to the packaged `WriteMind.app` too (`mac.icon`). Linux and Windows
  keep `packaging/icon.png`.

If the Dock still shows Electron's icon after the first patched run, it is
macOS's icon cache: quit the app, `killall Dock`, and start it again.

## The version

`apps/desktop/package.json` holds it, and electron-builder reads it from
there. The Swift app's `MARKETING_VERSION` is its own and is not this one.

## Releases and updates

WriteMind for Windows and macOS is released as this repo's own GitHub
Releases (the repo is public), both systems on ONE release per version. An
installed Windows copy updates itself from them — `electron-updater`
reading the feed electron-builder writes into the install (`publish:` in
`apps/desktop/electron-builder.yml`: provider github,
chere005/WriteMind). A Mac copy only tells you and opens the release's
page (an ad-hoc signed app cannot be updated in place by Squirrel.Mac): see
"On a Mac" below. Linux builds do not look.

### Cutting a release (what Sean does)

```sh
npm version 0.5.1 --no-git-tag-version -w @writemind/desktop   # or edit apps/desktop/package.json
git commit -am "WriteMind 0.5.1: <what changed>"                # the message can be the release notes
git tag -a v0.5.1 -m "WriteMind 0.5.1"                          # the tag is the version with a v
git push origin main v0.5.1
```

The pushed tag starts `.github/workflows/release.yml`, four jobs:

1. **prepare** (ubuntu): the tag must be `v` + `apps/desktop/package.json`'s
   version, or the run stops at once and says so; the notes are the tag's
   annotation — or, when the annotation is only a title line, the tagged
   commit's message (Co-Authored-By lines left out); `gh release create
   --draft --verify-tag` makes a **draft** release for the tag, named
   "WriteMind 0.5.1". A draft an earlier run left is reused; a release
   already published for the tag stops the run (a new version needs a new
   tag).
2. **windows** (windows-latest, after prepare): `npm ci`, typecheck, the
   unit tests, the build; `electron-builder --win nsis --x64 --publish
   always` uploads the installer, its `.blockmap` and `latest.yml` into
   the draft.
3. **mac** (macos-15, after prepare, beside windows): `npm ci`, the build
   (the universal Vision helper), `electron-builder --mac dmg --arm64 --x64
   --publish never` signed ad hoc (the line `package:mac:adhoc` runs),
   `bash tools/verify-mac.sh`, then `gh release upload` puts
   `WriteMind-0.5.1-mac-arm64.dmg` and `-mac-x64.dmg` into the draft.
4. **publish** (ubuntu, after both): the five files (`latest.yml`, the
   `.exe`, its `.blockmap`, the two dmgs) are checked and the draft is
   published (marked Latest; a version with a `-`, like
   `0.6.0-preview.1`, is a pre-release, which installed copies of a normal
   version do not take).

The workflow uses the repo's own `GITHUB_TOKEN` (`contents: write`): no
secret to add, and no Apple one either (there is no Developer ID). A failed
windows or mac job leaves the release a draft that no installed copy sees:
fix it, then re-run the failed job (publish follows), or Actions ▸ Release ▸
Run workflow with the tag (it reuses the draft). Never `--publish always`
by hand from a local machine.

`ci.yml`'s **mac-package** job (pushes to main and a manual run, macos-15)
builds the same two dmgs with `package:mac:adhoc`, runs `verify-mac.sh`
and keeps the dmgs as an artifact for 14 days; it never publishes. Its unit
test step blocks, as on Windows (the tests that took Windows paths for
granted use the system's own since 2026-10-05). So a
release's mac job has been rehearsed by the last push to main.

### What an installed copy does (Windows)

- **Check on startup** (on unless unticked): a few seconds after launch it
  asks GitHub for the newest release, once. With it off it looks only when
  asked (Help ▸ Check for Updates…). The setting is
  `%APPDATA%\@writemind\desktop\update.json` (`{"checkOnStartup": true}`),
  changed from the dialog's box or Help ▸ **Check for Updates on Startup**.
- A newer release brings up WriteMind's own small dialog (the page's sheet,
  like Rename; not a system box): **Updates available** — "WriteMind 0.5.1
  is available (you have 0.5.0). Update now?", a **Check on startup** box,
  **Later** and **Update now** (the default). Nothing is downloaded before
  Update now.
- **Update now** downloads with a quiet "Downloading… n%" line in the
  dialog (Later becomes Cancel; the sha512 is checked against
  `latest.yml`), then saves what the page holds (the same handshake as
  closing the window), runs the installer silently over the install and
  opens the new version.
- **Later** (or Escape, or Cancel during the download) closes it; that
  version is not asked about again until the next launch.
- **Help ▸ Check for Updates…** looks now: the same dialog when there is a
  newer release (one put off with Later included), else "You're up to date
  (0.5.1)." or "Couldn't check for updates: no internet connection." (or
  "the update server did not answer", "no release was found", GitHub's
  rate limit). In a copy that does not update itself: "Updates come with
  the installed app." and why.
- The launch look's failures (offline, rate limit, no release yet) go to
  `%APPDATA%\@writemind\desktop\update.log` and are shown to nobody. The
  download waits in `%LOCALAPPDATA%\@writeminddesktop-updater`.

Only an INSTALLED copy looks (`src/shared/update.ts`, `updateEligibility`):
the installer's uninstaller is beside the exe and `resources\app-update.yml`
is in the install. A development run, an end-to-end run (`WRITEMIND_E2E`),
the portable exe, `dist-electron\win-unpacked`, and the repo's Electron
running a build folder (like `C:\CLAUDIO\try-build`) never do. Linux
builds do not look and have no Help item for it.

### On a Mac

A Mac copy never downloads, installs or restarts anything (an ad-hoc signed
app cannot be replaced by Squirrel.Mac, so `electron-updater` is never
loaded on macOS; there is no zip and no `latest-mac.yml`). A packaged
WriteMind.app (not a dev run, not an end-to-end run) asks GitHub's
`releases/latest` once at launch when **Check on startup** is on, and when
asked (Help ▸ Check for Updates…). A newer published release (not a
pre-release) that carries this Mac's dmg (`-mac-arm64.dmg` or
`-mac-x64.dmg`, by the running app's architecture) brings up the same
**Updates available** dialog with **Download** in place of Update now and
one line: "Drag the new WriteMind into Applications to replace this one."
Download opens `https://github.com/chere005/WriteMind/releases/tag/v<version>`
in the browser (the address is built from the version, never taken from
GitHub's answer). The user drags the new copy over the old one and opens it
once with Open Anyway (docs/INSTALL-MAC.md).

### Installing on Windows, unsigned

Download `WriteMind-Setup-<version>.exe` from the repo's Releases page. It
is **not signed yet**, so Windows SmartScreen says "Windows protected your
PC": **More info ▸ Run anyway**. Its first page is the licence (the repo's
`LICENSE`: BSD 3-Clause, "Copyright (c) 2026, Shahean Cheren"); Next waits
for **I accept the terms of the License Agreement**. It installs for the current Windows user
only, with no administrator: `%LOCALAPPDATA%\Programs\WriteMind`, a Start
menu and a desktop shortcut (named "WriteMind", so they replace the ones
`tools\setup-windows.ps1` made for a development build), and an entry in
Settings ▸ Apps. Its own data stays in `%APPDATA%\@writemind\desktop` and
the notes in `Documents\WriteMind`; uninstalling touches neither.
The updater's own downloads are not browser downloads, so SmartScreen
should not ask again for an update.

The installer's own page offers to install and activate these with winget
(docs/INSTALL-WINDOWS.md, "Optional tools"). The runnable cells' tools are
found on their own once installed (Python via `py` / `python` or python.org's
own folders; `wolframscript.exe`, including
`C:\Program Files\Wolfram Research\Wolfram Engine\<version>\`):

```powershell
winget install --id Python.Python.3.14 -e      # or Python.Python.3.13
winget install --id WolframResearch.WolframEngine -e
wolframscript.exe -activate                     # signs in with YOUR Wolfram ID; nothing types it for you
```

### Installing on a Mac

`WriteMind-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg`
(Intel), macOS 13 or newer: drag WriteMind onto Applications, then the
first open's Open Anyway (Privacy & Security on macOS 15 / 26,
Control-click ▸ Open on 13 / 14). docs/INSTALL-MAC.md has the whole of it,
the camera's repeated question after each version included.

### Trying an update without GitHub

`WRITEMIND_UPDATE_FEED=http://127.0.0.1:<port>/` points an installed copy
at a folder served over HTTP (a `latest.yml` and the installer it names).
Only a loopback address is taken, and under it Update now installs without
starting the new version, so a test that runs the copy with its own
`--user-data-dir` can start it again itself. The updater lane's check
(two test-identity builds, 0.5.0 → 0.5.1, installed silently into a
scratch folder and uninstalled afterwards) is
`C:\CLAUDIO\agents\instances\upd-test\{package,install,launch,after-restart,uninstall}.ps1`
with `C:\CLAUDIO\agents\e2e\updater\0{1,2,3}-*.mjs` (written for the
earlier footer line). The dialog's check (release-ui lane, "WriteMind
RelUI" 0.5.0 → 0.5.1: the launch dialog, Later, the box off and a relaunch
that does not look, the menu's look, Update now with its progress, Cancel,
the up-to-date and could-not-check answers, the licence page) is
`C:\CLAUDIO\agents\instances\relui-upd\*.ps1` with
`C:\CLAUDIO\agents\e2e\release-ui\0{1..6}-*.mjs`. Under a product name with
a space the feed must also serve the installer under the dashed name
`latest.yml` gives it (`WriteMind-RelUI-Setup-0.5.1.exe`); "WriteMind"
itself has no space.
