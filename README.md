# WriteMind

A markdown notebook, a live camera and a drawing layer over both, for macOS, Windows and Linux. A note is a markdown file with its drawings and pictures beside it (a `.md` plus a `.drawings/` folder). The `.wm` format below is specified and being built: when it lands, notes convert on first launch and the originals are kept in a backup folder.

## The `.wm` format (specified, not yet in the app)

- The **Note** format, `.wm`, is a ZIP archive: `note.mdwm` (the note itself), `drawing.json` (the drawing layer), `media/` (pictures), `snapshots/` (ink-cell pictures) and `manifest.json`.
- The **MarkdownNote** format, `.mdwm`, is the note's underlying representation: markdown extended with WriteMind's cell markers, text-cell escapes, anchors, maths and runnable cells. It is not markdown or plain text, and it is not meant to be read or edited outside WriteMind.
- A project is a small JSON file, `.writemind-project`, that lists its folders and the `.wm` files open in it. The rest of the session (the caret, folds, unsaved text) is kept outside it.
- Identifiers:

  | | Extension | Media type | macOS UTI (conforms to) |
  |---|---|---|---|
  | Note | `.wm` | `application/vnd.writemind.note+zip` | `com.seancheren.writemind.note` (`public.zip-archive`) |
  | MarkdownNote | `.mdwm` | `application/vnd.writemind.markdownnote` | `com.seancheren.writemind.mdwm` (`public.data`) |
  | Project | `.writemind-project` | `application/json` | none |

  A `.wm` file is recognised by its first ZIP entry, `mimetype`, stored uncompressed and holding the note's media type. The `vnd.` types are not registered with IANA.
- Every save writes a new archive beside the note and renames it over: a note is never edited in place. The exact format is in [docs/SPEC-WM.md](docs/SPEC-WM.md).

## Install

Download from the [latest release](https://github.com/chere005/WriteMind/releases/latest). Installed copies update themselves (Help ▸ Check for Updates…).

- **macOS 13+:** `WriteMind-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel). Signed and notarized: drag it onto Applications. [Details](docs/INSTALL-MAC.md)
- **Windows:** `WriteMind-Setup-<version>.exe`. Per-user, no admin. It can install Python and the Wolfram Engine for runnable cells. Unsigned, so SmartScreen asks first (More info ▸ Run anyway). [Details](docs/INSTALL-WINDOWS.md)

Runnable cells use the Python, Wolfram, C, C++ and Rust you have installed; File ▸ Language Setup… shows and changes which.

## Credits

WriteMind is BSD 3-Clause licensed ([LICENSE](LICENSE)). [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists every library it ships with and their licences, and Help ▸ About WriteMind shows the same list.

WriteMind is independent of Wolfram Research, Inc. and uses Wolfram software only as a user of it, by running the Wolfram Engine or Mathematica you have installed and licensed; Wolfram, Mathematica, the Wolfram logo and the spikey are trademarks and/or copyrights of Wolfram Research, Inc., and all Wolfram software and logos belong to Wolfram Research.

## Develop

```sh
npm ci
npm run dev        # the app
npm test           # unit tests
npm run e2e        # end-to-end suites
```

- [AGENTS.md](AGENTS.md): how the code is put together and the rules for working in it
- [docs/BUILDING.md](docs/BUILDING.md): builds, packaging, releases
- [docs/TESTING.md](docs/TESTING.md): typecheck, unit and end-to-end tests
- [docs/FEATURES.md](docs/FEATURES.md) · [docs/KEYS.md](docs/KEYS.md) · [docs/TODO.md](docs/TODO.md) · [docs/SPEC-WM.md](docs/SPEC-WM.md): the `.wm` note format

`WriteMind/` is a read-only copy of the old Swift Mac app, kept as a reference.
