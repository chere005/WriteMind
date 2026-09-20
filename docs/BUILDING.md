# Building, shipping, and where things live

## Building

Xcode 26 on macOS 14 or later. No dependencies, no package manager.

```sh
sh tools/run.sh          # Debug build, then open it
sh tools/test.sh         # the unit suite (WriteMindTests)
sh tools/build.sh --release
```

Or open `WriteMind.xcodeproj` and press Run.

Run this once, first:

```sh
sh tools/setup-signing.sh
```

The mark — the one-stroke WM in `assets/logo.svg`, cousin to CalMind's CM
and AcctMind's AM — is the only source of the app icon; `sh tools/make-icons.sh`
renders every size from it.

It puts a local code-signing certificate in your login keychain (the keychain
asks for your password — that dialog is macOS's, and only you can answer it).
macOS remembers "allow the camera" and "allow this folder" against an app's
signature, so without a stable one every rebuild looks like a new app and asks
again. With it, you allow each once and they stay allowed. Builds work without
it; they just say so. If the folder permission is ever refused anyway, the
sidebar offers **Choose Folder…** — a folder you pick is granted then and
there.

## The layout

```
WriteMind/          the app: WriteMindApp, AppState, Notes/, Camera/,
                    Editor/, Drawing/, Views/, Support/, Assets.xcassets
WriteMindTests/     XCTest — formatting, parsing, titles, colours, sidecars
WriteMind.xcodeproj synchronized root groups: a file on disk is in the target
tools/              the scripts, all `sh tools/<name>.sh`
AGENTS.md           how to work in here; imports the AgentSuite baseline
```

`AGENTS.md` has the file-by-file map and the standing rules.

## Releasing

```sh
sh tools/dtp.sh      # deploy, tag, push
sh tools/tdtp.sh     # the unit suite first, then the same
```

There is no server and no store: **the deploy is the Mac bundle.** The lane
bumps the minor version in the pbxproj, builds Release into
`dist/WriteMind.app`, smokes it (launches and stays up), installs it at
`/Applications/WriteMind.app`, tags a bare `x.y.0`, and pushes atomically.
A failed build leaves the version untagged and the re-run reuses it. Each
run reports to seancheren.com/status through CoreMind's `bin/report-status.sh`
when CoreMind is checked out beside this repo, and CoreMind's
`npm run dtp -- all` ships WriteMind in turn, as an independent target.

## Where things are on disk

| what | where |
|---|---|
| notes | `~/Documents/WriteMind/<name>.md`, in section folders |
| sidebar order | `~/Documents/WriteMind/.writemind/order.json` |
| drawing objects | `~/Documents/WriteMind/.drawings/<name>.json` |
| pictures | `~/Documents/WriteMind/.drawings/media/<uuid>.png` |
| settings (panes, pen, text style, last camera) | `defaults read com.seancheren.WriteMind` |
| the installed app | `/Applications/WriteMind.app` |
