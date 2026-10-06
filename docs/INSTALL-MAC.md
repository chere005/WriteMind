# WriteMind on a Mac: the dmg

WriteMind for macOS comes as a disk image on the repo's
[Releases page](https://github.com/chere005/WriteMind/releases/latest), beside the Windows
installer. It needs **macOS 13 Ventura or newer**. It is signed *ad hoc* and not notarized (there is
no Apple Developer ID behind it yet), so macOS asks you to confirm the first time you open it; this
page says how.

## Which dmg

Apple menu ▸ **About This Mac**:

| About This Mac says | Download |
| --- | --- |
| **Chip**: Apple M1, M2, M3, M4 … (Apple silicon) | `WriteMind-<version>-mac-arm64.dmg` |
| **Processor**: … Intel Core … | `WriteMind-<version>-mac-x64.dmg` |

The Intel one also runs on Apple silicon (through Rosetta, more slowly); the Apple silicon one does
not run on an Intel Mac.

## Installing

1. Open the dmg. A window shows **WriteMind** and an **Applications** folder.
2. Drag **WriteMind** onto **Applications**. If an older WriteMind is there, Finder asks whether to
   replace it: quit WriteMind first, then **Replace**. Your notes and settings are not in the app,
   so replacing it keeps them.
3. Eject the dmg (the ⏏ beside it in the Finder sidebar). You can delete the .dmg file afterwards.

Your notes live in `~/Documents/WriteMind` (plain `.md` files); WriteMind's own settings,
sessions and update choice are in `~/Library/Application Support/@writemind/desktop`. Notes kept by an
older copy in `~/Documents/WriteMindCross` (the folder's name until 2026-10-06) are moved to
`~/Documents/WriteMind` on the first launch; if both folders exist (the Swift WriteMind keeps its notes in
`~/Documents/WriteMind`), WriteMind keeps using `WriteMindCross` and says so.

## The first open

macOS checks every app downloaded from the internet. WriteMind is signed, but not by an Apple
Developer ID and not notarized by Apple, so macOS will not open it until you say so, once per
downloaded version.

**macOS 15 Sequoia and macOS 26 Tahoe**

1. Open **WriteMind** from Applications. macOS says *"WriteMind" Not Opened* (Apple could not verify
   it is free of malware). Click **Done**, not Move to Trash.
2. Open Apple menu ▸ **System Settings** ▸ **Privacy & Security** and scroll down to **Security**.
   It says *"WriteMind" was blocked to protect your Mac*: click **Open Anyway**. (The button is
   there for about an hour after the blocked open; if it is gone, do step 1 again.)
3. Type your login password (or use Touch ID). In the dialog that follows, click **Open Anyway**.

From then on WriteMind opens like any other app.

**macOS 13 Ventura and macOS 14 Sonoma**

In Applications, **Control-click** (or right-click) **WriteMind** ▸ **Open**, then **Open** in the
dialog. (The System Settings way above works there too.)

**If none of that works.** If macOS says WriteMind *"is damaged and can't be opened"*, or Open Anyway
never appears, you can remove the "downloaded from the internet" mark from **this one app** in
Terminal (Applications ▸ Utilities ▸ Terminal):

```sh
xattr -dr com.apple.quarantine /Applications/WriteMind.app
```

That does for WriteMind.app what Open Anyway does, and nothing else: Gatekeeper stays on for every
other app. Do it only for a WriteMind.app you downloaded yourself from
`github.com/chere005/WriteMind/releases`, and never turn Gatekeeper off as a whole (`spctl
--master-disable` and the like): nothing here needs it.

## The camera and the Documents folder

The first time the video pane uses the camera, macOS asks with WriteMind's own wording; the first
time WriteMind opens your notes, it may ask about the **Documents** folder. Click **Allow**.

Because the app is signed ad hoc, macOS ties these answers to that exact build: **after each new
version it asks again**, and you allow it again. If you clicked Don't Allow: System Settings ▸
Privacy & Security ▸ **Camera** (or **Files & Folders**) ▸ WriteMind on. If the switch is on but the
camera stays black after an update, quit WriteMind and run, in Terminal,
`tccutil reset Camera com.seancheren.writemind` (it resets WriteMind's camera answer only); macOS
asks again at the next use.

## Updates

**Help ▸ Check for Updates…** (and a look at launch, when **Check on startup** is ticked) asks
GitHub for the newest release. When there is a newer one with a dmg for your Mac, the **Updates
available** dialog offers **Download**, which opens that release's page in your browser. On a Mac,
WriteMind never downloads, installs or restarts anything itself. To update:

1. Download the dmg for your chip (the same name as before, with the new version).
2. Quit WriteMind, open the dmg and drag the new WriteMind onto Applications ▸ **Replace**.
3. Open it as on the first open above (Open Anyway once more), and allow the camera again.

## A development run beside the installed app

A development run from a clone (`npm run dev`) uses the same settings folder as the installed app
(`~/Library/Application Support/@writemind/desktop`) and the same notes, so the two are **one
instance**: whichever starts second brings the first one's window forward and quits. Quit the
installed WriteMind before `npm run dev` (and the other way round).

## Runnable cells: File ▸ Language Setup…

**File ▸ Language Setup…** shows the program each kind of runnable cell uses — Wolfram and Python,
and C, C++ and Rust under them — and lets you choose another. An app opened from the Finder or the
Dock gets the system's short PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), not your shell's, so WriteMind
also looks in Homebrew's folders (`/opt/homebrew/bin`, `/usr/local/bin`) and, for Wolfram, inside
`/Applications/Wolfram Engine.app` (where the Wolfram Engine's own dmg puts `wolframscript`).

- **To use another Python** — a virtual environment, a Homebrew one — press **Choose…** in the
  Python row and pick the program or the environment's folder (⇧⌘G takes a pasted path, and the
  picker shows hidden folders such as `.venv`). Copies WriteMind found by itself are listed under
  **Also on this computer**, each with **Use**. WriteMind asks the program its version before it
  keeps the choice, and **Test** runs a small program with it.
- **A program you chose is the only one that language uses.** If it goes (the venv deleted), the row
  and the cell say so, and nothing runs until you choose another or press **Find Automatically**.
- **Not installed:** **Get Python…** and **Get Wolfram Engine…** open the download pages. Apple's
  `/usr/bin/python3` asks to install the Command Line Tools the first time it runs; Language Setup
  never runs it until you press something.
- **The Wolfram Engine not activated yet:** the row shows the command to run once in Terminal
  (`… -activate`, with your own Wolfram ID), with a button to copy it.

The choices are kept in `~/Library/Application Support/@writemind/desktop/languages.json`.

## Uninstalling

Quit WriteMind and drag `/Applications/WriteMind.app` to the Trash. That leaves your notes
(`~/Documents/WriteMind`, or `~/Documents/WriteMindCross` if it kept that one) and WriteMind's own data
(`~/Library/Application Support/@writemind/desktop`); delete that folder too for a clean removal
(the notes are yours: delete them only if you mean to). `tccutil reset All com.seancheren.writemind`
forgets WriteMind's camera and folder answers.

## For whoever builds it

The dmgs are made by `.github/workflows/release.yml` (its mac job, on macos-15) and, on every push
to main, by `ci.yml`'s mac-package job, with `npm -w @writemind/desktop run package:mac:adhoc`
after `npm run build`; `bash tools/verify-mac.sh` checks them (docs/BUILDING.md, "Releases and
updates").
