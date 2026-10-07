# WriteMind

A markdown notebook, a live camera and a drawing layer over both, for macOS, Windows and Linux. Notes are plain `.md` files in a folder; nothing rewrites a file you did not type in.

## Install

Download from the [latest release](https://github.com/chere005/WriteMind/releases/latest). Installed copies update themselves (Help ▸ Check for Updates…).

- **macOS 13+:** `WriteMind-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel). Signed and notarized: drag it onto Applications. [Details](docs/INSTALL-MAC.md)
- **Windows:** `WriteMind-Setup-<version>.exe`. Per-user, no admin. It can install Python and the Wolfram Engine for runnable cells. Unsigned, so SmartScreen asks first (More info ▸ Run anyway). [Details](docs/INSTALL-WINDOWS.md)

Runnable cells use the Python, Wolfram, C, C++ and Rust you have installed; File ▸ Language Setup… shows and changes which.

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
