# Mac session: to do

For the session on the Mac (Sean, 2026-10-06). This app is now `chere005/WriteMind`, and the Swift app is
`chere005/WriteMindSwift`, kept as a read-only reference.

## 1. Clones

- Repoint the Swift clone. Without this it pulls this repo:
  `git -C <swift clone> remote set-url origin https://github.com/chere005/WriteMindSwift.git`
- Repoint this app's clone (the old URL redirects, but set it anyway):
  `git -C <WriteMindCross clone> remote set-url origin https://github.com/chere005/WriteMind.git`
- Rename the local folders to match, if you like: `WriteMind` → `WriteMindSwift`, `WriteMindCross` → `WriteMind`.
- Then `git pull` and `npm ci` in this app's clone.

## 2. Signing and notarization (Apple Developer account)

1. Make a **Developer ID Application** certificate. Use Xcode ▸ Settings ▸ Accounts ▸ Manage Certificates, or
   developer.apple.com. Export it as a `.p12` with a password.
2. Make a notarization credential, either one:
   - an App Store Connect API key (`.p8`, its key ID and issuer ID); or
   - an app-specific password for your Apple ID, plus your Team ID.
3. In `apps/desktop/electron-builder.yml`, `mac:`:
   - Replace the old Apple Development hash in `identity` with the Developer ID (or leave it out and let CI pick
     it from the certificate).
   - Set `hardenedRuntime: true` and `notarize: true`.
   - Add `packaging/entitlements.mac.plist` with:
     - `com.apple.security.device.camera`;
     - Electron's `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation`.
4. Add GitHub secrets (you enter them; nobody else sees them):
   - `CSC_LINK`: the `.p12` as base64.
   - `CSC_KEY_PASSWORD`.
   - Either `APPLE_API_KEY_P8` (the `.p8` file's contents), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, or
     `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

   For example (`gh` asks for any value not piped in):

   ```sh
   base64 -i DeveloperID.p12 | gh secret set CSC_LINK --repo chere005/WriteMind
   gh secret set CSC_KEY_PASSWORD --repo chere005/WriteMind
   gh secret set APPLE_API_KEY_P8 --repo chere005/WriteMind < AuthKey_XXXXXXXXXX.p8
   gh secret set APPLE_API_KEY_ID --repo chere005/WriteMind
   gh secret set APPLE_API_ISSUER --repo chere005/WriteMind
   ```
5. In `.github/workflows/release.yml` and `ci.yml` (the mac jobs):
   - Drop the ad-hoc overrides: `-c.mac.identity=-`, `-c.mac.timestamp=none` and `-c.mac.notarize=false`.
   - Pass the secrets as env. electron-builder wants `APPLE_API_KEY` as a PATH to the `.p8`, so a step writes
     `APPLE_API_KEY_P8` to `$RUNNER_TEMP/AuthKey.p8` and sets `APPLE_API_KEY` to that path.
6. In `tools/verify-mac.sh`, expect a Developer ID signature instead of an ad-hoc one. Also check that
   `spctl -a -vv` accepts the app and that `xcrun stapler validate` passes on the dmg.
7. **Mac auto-update**, once signed:
   - add the `zip` target, which writes `latest-mac.yml` for the updater;
   - in `shared/update.ts` and `main/updater.ts`, switch the packaged Mac from download mode to install mode
     (electron-updater's MacUpdater);
   - update the tests that pin download mode (`updater.test.ts`, `macRelease.test.ts`).
8. Build with `npm run build`, then `npx electron-builder --mac dmg --arm64` locally. Open the dmg and check that
   Gatekeeper accepts it with no Open Anyway step.

## Release v2.0.0 (from the Mac)

The version is already 2.0.0 and the notes are in `docs/RELEASE-NOTES-2.0.0.md`. Once signing works (or straight
away, ad-hoc signed like 1.0.0), tag on main and push. If you signed, delete the notes' last line about Open Anyway
first.

```sh
git pull
git tag -a v2.0.0 -F docs/RELEASE-NOTES-2.0.0.md
git push origin v2.0.0
gh run watch --repo chere005/WriteMind
gh release view v2.0.0 --repo chere005/WriteMind --json isDraft,assets
```

The release must be Latest, with `WriteMind-Setup-2.0.0.exe`, its `.blockmap`, `latest.yml` and both Mac dmgs.

## 3. Things only the Mac can settle

- **Notes folder.** The renamed app's default is `~/Documents/WriteMind`, which is also the Swift app's folder.
  If `~/Documents/WriteMindCross` exists too, the app keeps using it and says so. Decide whether to merge the two
  folders into `~/Documents/WriteMind`.
- **`/Applications/WriteMind.app`.** The dmg's app has the same name as the Swift app and replaces it. Keep the
  Swift app elsewhere if you still want to open it.
- **Camera.** The camera permission is per app. If it stays blocked after reinstalling:
  `tccutil reset Camera com.seancheren.writemind`.

## 4. Camera: Zoom goes to the selection

Sean, 2026-10-06: "pressing zoom after find page should zoom to the selection". Today Zoom (the camera bar,
`CameraPane.tsx`: `zooming` / `setZoom`, a `ZoomBox`) only arms a drag for you to draw the zoom box. When a page
has been found (the finder's page or Straighten's four corners) or a box is drawn, Zoom should zoom straight to that
selection. Use its bounding box, fitted to the pane's aspect (`fitAspect`), and remember it (`rememberZoom`). With
nothing selected, Zoom keeps today's drag. A second press zooms back out, as it does now.
