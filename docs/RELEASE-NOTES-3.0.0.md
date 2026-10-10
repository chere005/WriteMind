WriteMind 3.0.0

- **Notes are .wm files.** A note is one ZIP (a "Note") holding its text as note.mdwm (the "MarkdownNote"), its drawing and its pictures. Format: docs/SPEC-WM.md. Double-click a .wm in Finder or Explorer to open it; a .md opened or dropped on the window is imported into a new .wm.
- **Notes from 2.15.0 and earlier convert on the first launch** that opens their folder. The originals are moved, never deleted, to a "legacy backup" folder beside them. The Swift app's notes, git working trees and node_modules are never converted; any other folder asks first.
- **Safer saving:** a note is never edited in place (a new archive is written and renamed over), a killed save cannot leave a note truncated, an externally renamed or trashed note is not re-created, and a damaged or hostile .wm is refused before anything is unpacked.
- **Quick Reference** (Help menu): a true list of what WriteMind does, always shown rendered.
- **About** shows the licences of every library and the Wolfram attribution; Wolfram cells show the Wolfram logo; copied drawings paste as transparent images; scanned pages are tabs; runnable cells have language icons.
