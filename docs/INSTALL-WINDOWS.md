# WriteMind on Windows: the installer

`WriteMind-Setup-<version>.exe` is a per-user NSIS installer made by electron-builder
(`apps/desktop/electron-builder.yml`, `win` / `nsis`) with one page of WriteMind's own
(`packaging/installer.nsh`, which runs `packaging/installer-tools.ps1`). Updates come from this
repo's own GitHub Releases; how an installed copy updates itself is in docs/BUILDING.md,
"Releases and updates (Windows)".

## Installing

1. Download `WriteMind-Setup-<version>.exe` from the repo's Releases page.
2. It is **not signed yet**: Windows SmartScreen says "Windows protected your PC". Click
   **More info**, then **Run anyway**.
3. **License Agreement** (the first page): the repo's `LICENSE`, BSD 3-Clause, "Copyright (c)
   2026, Shahean Cheren" (`electron-builder.yml` `nsis.license`). Tick **I accept the terms of
   the License Agreement**; Next stays greyed until then. Updates (`/S --updated`) skip it.
   The installer, the app and the uninstaller say Shahean Cheren in their file properties
   (Company, Copyright), and so does Settings ▸ Apps (Publisher).
4. **Choose Install Location**: `%LOCALAPPDATA%\Programs\WriteMind` unless you change it.
   It installs for **this Windows user only**: no administrator prompt, no "for all users"
   choice.
5. **Tools for runnable cells (optional)**: see below. Leave it all unticked to skip.
6. **Install**, then **Finish** (ticked "Run WriteMind" starts it).
7. **The pen's button (Wacom):** in **Wacom Tablet Properties ▸ Pen**, set the pen's first
   button to **Middle Click**. On Pan/Scroll the driver keeps the button for itself and WriteMind
   never hears it. Then hold the button to **erase** strokes, and **double-tap** it to **undo**.

Once installed, WriteMind looks for a newer release a few seconds after each launch ("Check on
startup", on unless you untick it) and asks in its own small dialog: **Updates available** —
Update now / Later. Help ▸ Check for Updates… looks any time. Details: docs/BUILDING.md,
"What an installed copy does".

What it puts on the computer: the app folder, a **WriteMind** shortcut in the Start menu and on
the desktop (the same name as the ones `tools\setup-windows.ps1` makes for a development build,
so it replaces those), an entry in Settings ▸ Apps (HKCU), and a copy of the installer in
`%LOCALAPPDATA%\@writeminddesktop-updater` (the updater's base for small differential
downloads). The notes stay in `Documents\WriteMind` and the app's own data (settings,
sessions, `pen.log`, `update.log`) in `%APPDATA%\@writemind\desktop`. Notes kept by an older copy in
`Documents\WriteMindCross` (the folder's name until 2026-10-06) are moved to `Documents\WriteMind` on the
first launch; if both folders exist, WriteMind keeps using `WriteMindCross` and says so.

That data folder is the same one a development build (`npm start`, `C:\CLAUDIO\try-build`)
uses, so settings carry over, and **only one of them runs at a time**: starting the installed
WriteMind while a development build is open brings the open window forward instead (one writer
per notes folder, `main.ts` "ONE WINDOW PER PROFILE").

## Optional tools: Python and Wolfram

The installer's own page has three tick boxes:

| Box | What it does |
| --- | --- |
| Install Python (for Python cells) | `winget install --id Python.Python.3.14 --exact --source winget --scope user --override "/passive /norestart InstallAllUsers=0 InstallLauncherAllUsers=0 PrependPath=1"` (python.org's installer, for this user, no administrator: the `py` launcher goes in `%LOCALAPPDATA%\Programs\Python\Launcher` too, where left to its default it would be installed for all users and ask for an administrator) |
| Install Wolfram Engine (for Wolfram cells; free for developers, about 3 GB download) | `winget install --id WolframResearch.WolframEngine --exact --source winget`. Ticking it accepts the [Wolfram Engine licence](https://www.wolfram.com/legal/terms/wolfram-engine.html). Windows asks to allow it: the engine installs in Program Files. |
| Activate the Wolfram Engine after install | Opens a PowerShell window running `& "<engine folder>\wolframscript.exe" -activate`. **You** sign in there with your own Wolfram ID (a free account at wolfram.com); the installer never sees it. |

- What is already on the computer shows as "already installed" / "already activated" and cannot
  be ticked. The page looks where WriteMind itself looks (`apps/desktop/src/main/eval/tools.ts`),
  in the same order, so the one it names is the one WriteMind will use: `py` / `python` on the
  PATH, every copy on it (the Microsoft Store's placeholder only when it is a real Python),
  `%LOCALAPPDATA%\Programs\Python\...`, `Program Files\Python3*` (the newest version, 64-bit
  before 32-bit), `wolframscript` on the PATH, `Program Files\Wolfram Research\{WolframScript,
  Wolfram Engine\<version>}` (the newest version, 14.10 after 14.9); "activated" means a
  `mathpass` licence file in `%APPDATA%\Wolfram\Licensing` (Wolfram's place since 14.1) or
  `%APPDATA%\WolframEngine\Licensing` (or the Mathematica / ProgramData equivalents).
  `apps/desktop/test/installerTools.test.ts` holds the page's lookup and WriteMind's to one set
  of folders. Looking runs `py -3 --version` and the like; each gets ten seconds, and if the whole
  look takes more than a minute the page offers every box (the install step looks again first).
- The activation box is available only when an engine is there or ticked; ticking the engine
  ticks it too (an engine that is not activated runs nothing).
- The ticked tools install **after** WriteMind's own files are in place, in a console window of
  their own that shows winget's progress (`--accept-package-agreements --accept-source-agreements`
  only for what was ticked). The installer waits for it, then goes on to Finish.
- **Nothing here can fail WriteMind's install.** No winget, a failed download, a cancelled
  administrator prompt: the console says what happened, the installer says it once more at the
  end with a link here, and the log is `%LOCALAPPDATA%\Programs\WriteMind\tools-setup.log`. What
  the end says is one short line per tool, the common winget outcomes in words: installed
  (restart needed), already installed, the installer stopped or its prompt to allow it was
  declined (winget's `0x8A150006`: a declined prompt ends the installer with 1223, which winget
  has no word for, so it never shows as "cancelled"; the installer's own exit code is in the
  console, `Installer failed with exit code: ...`), cancelled (the installer's own Cancel),
  winget is too old (update App Installer from the Microsoft Store), not available for this PC,
  the download did not finish; anything else as `failed: winget exit code 0x...`, the code to
  search for. If the tools step stopped before it could say anything (its console closed with
  the X, say), the end says that it did not finish and points at the log.
- "Configured" means nothing more to do: WriteMind finds a Python or a Wolfram Engine installed
  this way at the next cell run, without a restart of Windows or of WriteMind, even though the
  PATH of an already-running program does not change (it looks in the install folders above).

### Adding them later: File ▸ Language Setup…

**File ▸ Language Setup…** in WriteMind is the same page, any time after the install. Each language's
row says which program its cells run with and where it came from:

- **Install Python…** and **Install Wolfram Engine…** (shown when the language is not found and
  winget is there) run the installer's own script (`installer-tools.ps1`, which ships beside the
  app) in a window of its own, exactly as the installer's tick boxes do; Install Wolfram Engine…
  opens the sign-in window afterwards. WriteMind looks again when that window closes and says what
  happened in the row. Without winget the rows offer **Get Python…** / **Get Wolfram Engine…** (the
  download pages) instead. **A Windows with no Python counts as not found** even though it has a
  `python3.exe`: the one in `%LOCALAPPDATA%\Microsoft\WindowsApps` is only the Microsoft Store's
  shortcut, and a `py.exe` left behind after Python was uninstalled has nothing to start. The row
  says which it found, in amber, and offers Install Python… all the same — as the installer's own
  page does, which does not count either of them.
- **Activate…** (the Wolfram row, when there is no licence file yet) opens the engine's own sign-in
  window for the `wolframscript.exe` your cells use. You type your Wolfram ID there; WriteMind never
  sees it.
- **Choose…** points a language at another program — a virtual environment's
  `Scripts\python.exe`, a conda environment's `python.exe`, a MinGW `gcc.exe` — and **Also on this
  computer** lists the copies WriteMind found, each with **Use**. A chosen program is the only one
  that language uses (its folder goes first on the cells' PATH); if it goes, the cell says so until
  you choose another or press **Find Automatically**. `.cmd` and `.bat` shims are refused: nothing
  is started through a shell. **Test** runs a small program with it.

The choices are kept in `%APPDATA%\@writemind\desktop\languages.json` (the app's own data folder); the
log of a setup window started from there is `tools-setup.log` beside it.

By hand, the same thing:

```powershell
winget install --id Python.Python.3.14 -e --scope user --override "/passive /norestart InstallAllUsers=0 InstallLauncherAllUsers=0 PrependPath=1"
winget install --id WolframResearch.WolframEngine -e
& "C:\Program Files\Wolfram Research\Wolfram Engine\15.0\wolframscript.exe" -activate   # your own Wolfram ID
```

No winget? It is "App Installer" in the Microsoft Store (part of Windows 10 1809+ and 11). Or use
python.org's installer and wolfram.com/engine directly. A cell whose tool is missing says what it
looked for when it runs.

## Silent and scripted installs

| Command | Does |
| --- | --- |
| `WriteMind-Setup-x.exe /S` | installs with no window and **nothing extra** (no tools page, no winget) |
| `... /S --updated` | what the updater runs; the same, and the `/WM-*` flags are ignored |
| `... /S /WM-PYTHON /WM-WOLFRAM /WM-ACTIVATE` | also the tools, as if ticked (each flag on its own) |
| `... /WM-DRYRUN` | the tools step only says what it would run (in `tools-setup.log`), and runs nothing |
| `... /D=C:\Some\Folder` | another install folder; it must be the LAST argument |

The tools helper can be tried on its own (it changes nothing with `-Detect` or `-DryRun`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\installer-tools.ps1 -Detect -Out $env:TEMP\tools.ini
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\installer-tools.ps1 -Python -Wolfram -Activate -DryRun -NoWait
```

`WRITEMIND_TOOLS_PRETEND=missing` in the environment makes it (and the installer it runs from)
report nothing found, to see the page and the dry run as on a bare machine. A dry run never
fails (exit 0): what a real run would stop at, it says.

## Uninstalling

Settings ▸ Apps ▸ WriteMind ▸ Uninstall (or `Uninstall WriteMind.exe` in the install folder;
`/S` for silent). It removes the app folder, both shortcuts, the Settings entry and the updater's
folder in `%LOCALAPPDATA%`. It leaves the notes and `%APPDATA%\@writemind\desktop`; run the
uninstaller with `--delete-app-data` to remove that folder too (the notes are never touched).
Python and the Wolfram Engine are separate programs with their own uninstallers.

## Building the installer

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-installer.ps1
```

`npm run build`, then `electron-builder --win nsis --x64 --publish never`: `dist-electron\WriteMind-Setup-<version>.exe`
(about 110 MB), its `.blockmap` and `latest.yml`. `-NoBuild` packages the existing build,
`-Portable` adds the portable exe, and `-ShortcutName "WriteMind (test)"` makes a test installer
whose shortcuts do not replace, and on uninstall delete, a development build's `WriteMind.lnk`.
`npm -w @writemind/desktop run package:win` builds every Windows target in the config (NSIS and
portable). A clean clone needs nothing else: the icon is made from `packaging/icon.png` (the
git-ignored `packaging/writemind.ico` is only for `setup-windows.ps1`'s dev shortcuts), and the
NSIS binaries are electron-builder's own download. Local builds never publish.

## Releasing (what Sean does)

```sh
npm version 0.6.0 --no-git-tag-version -w @writemind/desktop   # or edit apps/desktop/package.json
git commit -am "WriteMind 0.6.0: <what changed>"
git tag -a v0.6.0 -m "WriteMind 0.6.0"
git push origin main v0.6.0
```

The pushed tag runs `.github/workflows/release.yml`: a first job checks that the tag is `v` + the
app's version and makes a draft release for the tag (notes from the tag's annotation); on
windows-latest the typecheck, the unit tests and the build run and electron-builder makes this
installer and uploads it with its `.blockmap` and `latest.yml` into the draft; beside it, on
macos-15, the Mac job uploads `WriteMind-<version>-mac-arm64.dmg` and `WriteMind-<version>-mac-x64.dmg`
(signed ad hoc: docs/INSTALL-MAC.md). A last job checks that all five files are there
(`latest.yml`, the `.exe`, its `.blockmap`, the two dmgs) and publishes the release; a failed
Windows or Mac job leaves it a draft (re-run that job). Every installed copy then finds it
(docs/BUILDING.md, "What an installed copy does").
Never `--publish always` from a local machine.

## How it was checked (2026-10-05, installer lane)

- `tools\build-installer.ps1 -NoBuild -ShortcutName "WriteMind installer test inst-1"`, then a
  silent install into `C:\CLAUDIO\agents\instances\inst-1\WriteMind` with
  `/WM-DRYRUN /WM-PYTHON /WM-WOLFRAM /WM-ACTIVATE` and `WRITEMIND_TOOLS_PRETEND=missing`
  (the log lists the three commands), a `/S --updated` over it (nothing extra ran), the installed
  exe with its own `--user-data-dir`, `WRITEMIND_NOTES` and CDP port
  (`C:\CLAUDIO\agents\e2e\installer\installed-app.mjs`: the Quick Reference opens, koffi loads
  from the asar layout in the main process, the Tablet sheet opens the pen subsystem with a clean
  `pen.log`, a Python cell runs), then a silent uninstall: folder, both shortcuts, the Settings
  entry and the updater folder gone; profile and notes kept.
- The page itself, without installing: the installer's UI driven by window messages to the tools
  page and captured (`C:\CLAUDIO\agents\instances\inst-1\ui-page.ps1`; on this machine all three
  boxes read "already ..."; with `WRITEMIND_TOOLS_PRETEND=missing` the activation box is disabled
  until the engine is ticked, then ticked with it), and once through Install with `/WM-DRYRUN`
  (the ticked boxes reached the tools step as `-Python -Wolfram -Activate`).
- "Configured" without the PATH: an instance started with no Python on its PATH (no `C:\Windows`,
  no WindowsApps) ran a Python cell with `C:\Program Files (x86)\Python314-32\python.exe`
  (`C:\CLAUDIO\agents\e2e\installer\python-without-path.mjs`).
- A failing tools step (winget hidden from the helper): the installer still exits 0 with
  WriteMind installed, and the log says "failed: winget is missing".
- Not run for real: a winget install of Python or the Wolfram Engine, the activation window, the
  end-of-install message box (shown only by a non-silent install whose tools step failed), and a
  real tablet through the installed copy.

## How it is checked now (2026-10-06, installer-tools fixes)

Every dry run above returned before the line that runs winget, and that line was wrong: winget's
output became the helper's result (nothing of it in the console, `System.Object[]` in the
summary, every winget line in `wm-result.ini` and the end message). `npm test` checks the
installer's tools step on every machine, and on Windows (CI's `verify` job) runs the helper
itself, `apps/desktop/test/installerTools.test.ts`:

- Everywhere: electron-builder finds `installer.nsh` by name in `packaging/` (no `nsis.include`
  or `nsis.script`) and the page packs `installer-tools.ps1` from there; the helper is ASCII; the
  winget ids, `--scope user`, the Python switches and the licence flags are the ones this page
  prints; the detection has its time limit; tools.ts and the helper pick the same folder from one
  fixture (`apps/desktop/test/fixtures/installer-tool-folders.json`).
- On Windows, under Windows PowerShell 5.1 (the installer's): the helper parses; `-Detect` on a
  bare machine and on the fixture's folders; every copy on the PATH (a Store placeholder first does
  not hide a real `python.exe`); a probe that waits on its stdin does not hold the page up; dry
  runs exit 0. Then real runs against a stand-in `winget.exe` (compiled by the test; the helper's
  PATH holds only it and `%LOCALAPPDATA%` is a scratch folder, so no real winget is reachable):
  its lines reach the console and never the result, the result is exactly `installed` / `already
  installed` / `installed (restart needed)` / the failure in words for each exit code, and the
  arguments it gets are the documented ones, the Python switches as one argument.
- The fixes were written on a Mac, where only the first half runs: the Windows half first runs
  in CI's `verify` job (or `npm test` on a Windows box).
- Still only a real machine can say: whether a real per-user Python install now comes up
  without a Windows prompt; whether Engine 15.0's version folder holds `wolframscript.exe`, and
  where its activation writes `mathpass`; the message boxes.
