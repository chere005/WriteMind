# WriteMind

<img src="assets/logo-512.png" width="80" alt="The WriteMind mark: a one-stroke WM">

A macOS writing app: markdown notes on the left, a live camera on the right.
Photograph a notebook page and the writing comes onto the page as ink, as a
picture, or as text; draw over it, sketch a flow chart, and the notes stay
plain `.md` files in `~/Documents/WriteMind`.

- [What it does](docs/FEATURES.md) — the whole tour
- [AGENTS.md](AGENTS.md) — how the code is put together, and the rules for
  working in it
- [docs/TODO.md](docs/TODO.md) — what is next

macOS 14 or later. No dependencies, no package manager.

```sh
sh tools/setup-signing.sh   # once: a local signing certificate
sh tools/run.sh             # Debug build, then open it
sh tools/test.sh            # the unit suite
sh tools/deploy.sh          # Release into /Applications
```

[Building and shipping](docs/BUILDING.md)
