# WriteMind

A markdown notebook, a live camera and a drawing layer over both, for macOS, Windows and Linux. A note is a markdown file in a folder; its drawings and pictures live beside it in `.drawings/`.

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
- [docs/FEATURES.md](docs/FEATURES.md) · [docs/KEYS.md](docs/KEYS.md) · [docs/TODO.md](docs/TODO.md)

`WriteMind/` is a read-only copy of the old Swift Mac app, kept as a reference.
