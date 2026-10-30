<p align="center">
  <img src="./resources/icon.png" width="128" height="128" alt="SavePoint Diff Logo" />
</p>

# SavePoint Diff

**See what you've changed since your last save — without Git.**

SavePoint Diff adds live, colour-coded gutter markers and a familiar
Source Control panel entry for your **unsaved** edits, updated on every
keystroke. It works in any folder, Git repo or not — no `.git` folder,
no network access, no external services required.

<p align="center">
  <img src="./resources/demo.gif" alt="SavePoint Diff Demo" width="850" />
</p>

## Why SavePoint Diff?

Git's gutter compares your file against the last **commit**. SavePoint
Diff compares it against the last **save** — so you can see your
in-progress edits even:

- between commits, in a messy/dirty working tree
- in folders that aren't a Git repository at all (scratch files,
  generated code, config directories, quick scripts)
- on files Git doesn't track

## Features

**🟢 🔵 🔴 Live gutter markers** — green for added lines, blue for
modified lines, red for deleted-line markers, recalculated on every
edit, before you ever press save.

**📁 Source Control panel integration** — a "SavePoint Diff" entry
lists every open file with unsaved changes, exactly like Git's own
panel, complete with a **"Save All"** toolbar button and a per-file
**save icon** — the same spot Git puts its commit button.

**🔍 One-click full diff view** — click a file (in the panel, or via
its gutter/tab) to open VS Code's native split diff editor: your
last-saved version on the left, your live, still-editable buffer on
the right.

**💾 Save straight from the panel** — no need to switch back to the
editor tab first: hit the **Save All** button at the top of the
"SavePoint Diff" panel to save every unsaved file at once, or the
inline save icon on a single row to save just that file. (The
panel skips Git's commit-message input box entirely, since there's
nothing to commit here.)

**🏷️ Modified-file badges** — an "M" badge on changed files in the
Explorer and on editor tabs, the same visual language Git uses.

**↺ Revert a single change** — hover any gutter marker for a "↺ Revert
this change" link that discards just that block back to its baseline
content, without touching the rest of the file or needing a save
first. Also reachable from the Command Palette (`SavePoint Diff:
Revert Change (at Cursor)`), which acts on whichever change your
cursor is currently in.

**📊 Live change count in the status bar** — the `SavePoint: ON`
status bar item shows a running `+added ~modified -deleted` tally for
the active file (e.g. `SavePoint: ON  +12 ~4 -2`), so you can see the
size of your unsaved edits at a glance without opening the diff view.

**📍 Manual savepoints** — `SavePoint Diff: Create Savepoint` snapshots
the active file's current in-memory content as the new diff baseline,
*without* saving anything to disk. Use it before a risky edit or
refactor so you can diff against "a minute ago" instead of only
"since I last hit Ctrl+S" — your editor tab's own unsaved-changes dot
is completely unaffected.

**🕒 Git-style snapshot history & restore** — create named checkpoints of your
file anytime (`SavePoint Diff: Save Snapshot`), or let SavePoint Diff automatically
snapshot on every save. View your snapshot timeline (`SavePoint Diff: View & Restore Snapshot...`),
inspect a split diff comparing any prior snapshot against your current buffer, or revert
the entire file back to that snapshot with one click.

**🌐 Works everywhere you code** — local folders, Remote-SSH, WSL, Dev
Containers, GitHub Codespaces, and virtual filesystems like
vscode.dev / github.dev.

**⚙️ Fully configurable** — toggle each marker type, the overview
ruler, optional background highlighting, and tune performance
thresholds for large files.

**🔒 100% local** — everything runs inside the extension host. No
Git, no telemetry, no network requests, no external services. Your
baseline never touches disk; it exists only in memory for the current
window session.

## Getting started

Install the extension, open any file, and start typing — that's it.
Gutter markers appear immediately as you edit and clear the moment you
save. A status bar item (`SavePoint: ON` / `SavePoint: OFF`) lets you
toggle the extension with one click.

## Commands

| Command | Description |
|---|---|
| `SavePoint Diff: Toggle` | Turn the extension on/off. |
| `SavePoint Diff: Refresh` | Force-recalculate the diff for the active editor. |
| `SavePoint Diff: Clear Decorations` | Clear decorations in the active editor without changing the baseline. |
| `SavePoint Diff: Save File` | Saves one file, via the inline save icon next to its row in the Source Control panel. |
| `SavePoint Diff: Save All Unsaved Changes` | Saves every file currently listed in the panel, via the toolbar button at the top of the panel. |
| `SavePoint Diff: Revert Change (at Cursor)` | Reverts the change block at the active editor's cursor back to baseline content. Also available as a "↺ Revert this change" link when hovering any gutter marker. |
| `SavePoint Diff: Create Savepoint (Don't Save to Disk)` | Snapshots the active file's current content as the new diff baseline, without writing to disk. |
| `SavePoint Diff: Save Snapshot` | Captures a named/timestamped checkpoint snapshot of the current file. |
| `SavePoint Diff: View & Restore Snapshot...` | Opens snapshot history for the active file to compare diffs or revert. |

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `savepointDiff.enabled` | `true` | Enable/disable the extension globally. |
| `savepointDiff.showAdded` | `true` | Show markers for added lines. |
| `savepointDiff.showModified` | `true` | Show markers for modified lines. |
| `savepointDiff.showDeleted` | `true` | Show markers for deleted-line positions. |
| `savepointDiff.showOverviewRuler` | `true` | Show tick marks in the overview ruler. |
| `savepointDiff.showBackgroundHighlight` | `false` | Also lightly tint the background of changed lines. |
| `savepointDiff.enableRevertInHover` | `true` | Show a "↺ Revert this change" link when hovering a gutter marker. |
| `savepointDiff.maxFileSize` | `2000000` | Files larger than this (bytes) skip live diffing, to protect performance. Must be a positive number; an invalid value (zero, negative, or non-numeric) falls back to the default. |
| `savepointDiff.debounceMs` | `150` | Delay after the last keystroke before recalculating. |
| `savepointDiff.snapshots.enabled` | `true` | Enable/disable Git/GitHub-style checkpoint snapshot history. |
| `savepointDiff.snapshots.maxSnapshots` | `10` | Maximum number of snapshots to retain per file. |
| `savepointDiff.snapshots.autoSnapshotOnSave` | `true` | Automatically capture a snapshot whenever a file is saved. |

## How it works

1. **Baseline** — when a file is opened, its content is captured as
   the "last saved" baseline.
2. **Live diff** — every edit is diffed against that baseline (using a
   small, well-established Myers line-diff library) and rendered as
   gutter markers, debounced so it stays fast even while typing quickly.
3. **Save** — pressing save resets the baseline to the new content and
   clears all markers; tracking starts fresh from there.
4. **Undo/redo** — always recomputed fresh from baseline vs. current
   text, so undoing back to your saved state naturally clears markers,
   and redoing naturally brings them back.
5. **Reverts and external changes** — if the file stops being "dirty"
   without a save (you ran **Revert File**, or something outside the
   editor rewrote the file while your buffer was clean), its content
   now matches disk by definition, so the baseline re-syncs
   automatically and markers clear.
6. **Reverting one change** — clicking a gutter marker's "↺ Revert this
   change" link (or running the command with your cursor in a change)
   applies a single edit that restores just that block's baseline
   content, then re-diffs — the rest of the file, and any other
   changes in it, are untouched.
7. **Savepoints** — `SavePoint Diff: Create Savepoint` moves the
   baseline to the file's current in-memory content immediately,
   without a disk write. Everything from here behaves exactly as if
   you'd just saved, except your editor tab still shows the file as
   unsaved (because it is) — a real Save later simply moves the
   baseline again, superseding the savepoint.

No Git objects, no filesystem snapshots, no manual delta tracking.

## Requirements

- VS Code `1.60.0` or later.
- Nothing else — no Git, no other extensions, no network access.

## Known limitations

- **In Git repositories**, VS Code's editor-gutter "quick diff" colours
  are typically driven by Git's own provider rather than this
  extension's — but SavePoint Diff's own gutter markers, Source
  Control panel entry, badges, and diff view all work independently of
  that, in Git and non-Git folders alike.
- **Untitled files** start with an empty baseline, so everything typed
  shows as "added" until you Save As — at which point the newly saved
  content becomes the real baseline.
- **Non-UTF-8 files** restored with unsaved changes after a restart
  (see "hot exit" in the changelog) have their on-disk baseline read as
  UTF-8. For a file in another encoding this can produce inaccurate
  markers until the next save; run **SavePoint Diff: Refresh** or save
  once to resync.
- **A savepoint clears the "unsaved changes" UI, not the file's actual
  unsaved state.** After `SavePoint Diff: Create Savepoint`, the
  Source Control panel entry, the "M" badge, and the status bar count
  all reflect "differs from the current baseline" — which, right
  after a savepoint, is "no differences" — even though the file still
  has real unsaved edits on disk. Rely on your editor tab's own dirty
  indicator (the ● dot) for whether you actually still need to press
  Ctrl+S, not on SavePoint Diff's surfaces, once you've used a
  savepoint.

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md) for the full history — including
several rounds of bug fixes, robustness improvements (stale badges on
hidden tabs, redundant recomputes on toggle, CRLF and lone CR line-ending
handling, descending edit sorting on multi-change reverts, background cancellation tokens,
safe document resolution on save/revert, an invalid `maxFileSize` no longer able to silently disable
diffing entirely, needless decoration rebuilds on unrelated settings
changes, and more), automated test runner additions, and new features (Save All from the panel,
per-change revert, the status bar change count, and manual savepoints)
folded into the initial `0.1.0` release.

## Contributing / building from source

See [CONTRIBUTING.md](./CONTRIBUTING.md) for build, packaging, and
manual test instructions.

## Privacy

Everything happens locally, in-memory, inside the extension host. No
network requests, no telemetry, no external services of any kind.

## Links & Author

- GitHub: https://github.com/StayElite/SavePoint-Diff
- Documentation: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
- Issues: https://github.com/StayElite/SavePoint-Diff/issues

Created and maintained by **Ashish Sharma (Stay Elite)**.

Copyright (c) 2026 Ashish Sharma (Stay Elite). Licensed under the MIT
License — see [LICENSE](./LICENSE) for details.
