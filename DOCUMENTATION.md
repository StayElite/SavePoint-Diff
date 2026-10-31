# SavePoint Diff — Full Documentation

This is the complete reference for SavePoint Diff: every command, every setting, how each source file fits together, and how the optional cloud sync works. For a quicker overview, see [README.md](./README.md). Release notes live in [CHANGELOG.md](./CHANGELOG.md).

## Table of Contents

01. [Requirements](#1-requirements)
02. [Getting Started](#2-getting-started)
03. [Core Features (Local, No Network)](#3-core-features-local-no-network)
    - [3.1 Live Gutter Diff](#31-live-gutter-diff)
    - [3.2 Source Control Panel & Badges](#32-source-control-panel--badges)
    - [3.3 Reverting a Single Change](#33-reverting-a-single-change)
    - [3.4 Savepoints (Baseline Reset)](#34-savepoints-baseline-reset)
    - [3.5 Snapshots](#35-snapshots)
04. [Commands](#4-commands)
05. [Settings](#5-settings)
06. [Cloud Sync (Optional GitHub Alternative)](#6-cloud-sync-optional-github-alternative)
    - [6.1 Setting Up rclone](#61-setting-up-rclone)
    - [6.2 Connecting and Uploading](#62-connecting-and-uploading)
    - [6.3 How a Sync Works](#63-how-a-sync-works)
    - [6.4 The `.savepoint` Folder](#64-the-savepoint-folder)
    - [6.5 Error Handling & Recovery](#65-error-handling--recovery)
    - [6.6 Security](#66-security)
    - [6.7 Limitations](#67-limitations)
07. [Project Structure (Who Is What)](#7-project-structure-who-is-what)
08. [How It Works Internally](#8-how-it-works-internally)
09. [Status Bar](#9-status-bar)
10. [Troubleshooting](#10-troubleshooting)
11. [Frequently Asked Questions](#11-frequently-asked-questions-faq)
12. [Versioning](#12-versioning)

* * *

## 1. Requirements

- **VS Code** `1.60.0` or later
- **Nothing else** for the core features — no Git, no other extensions.
- **rclone** — only if you turn on the optional cloud sync (see [Section 6](#6-cloud-sync-optional-github-alternative)).

* * *

## 2. Getting Started

### Installation

Install from the Marketplace, or run from Quick Open (`Ctrl+P` / `Cmd+P`):

```
ext install StayElite.StayElite-Savepoint-Diff
```

### Minimal Example

Open any file and start typing. That is enough to:

1. Capture the file's content as the "last saved" baseline.
2. Show green / blue / red gutter markers for added / modified / deleted lines, updated on every keystroke.
3. List the file in the **SavePoint Diff** panel of the Source Control view.
4. Clear all of it when you save.

Cloud sync is **off by default**. If you never enable it, SavePoint Diff makes no network requests.

* * *

## 3. Core Features (Local, No Network)

### 3.1 Live Gutter Diff

The current editor content is diffed against the baseline (the last save or the last savepoint) using a Myers line diff, and rendered as:

| Marker | Meaning |
|---|---|
| Green | Added lines |
| Blue | Modified lines |
| Red | A deletion happened at this position |

Markers are debounced (`savepointDiff.debounceMs`) so typing stays fast. Overview-ruler ticks and an optional background tint are available through settings. Undo and redo are handled naturally, because the diff is always recomputed from baseline versus current text.

### 3.2 Source Control Panel & Badges

- A **SavePoint Diff** group in the Source Control view lists every open file with unsaved changes.
- Clicking a file opens VS Code's split diff: the baseline on the left, your live, editable buffer on the right.
- An **M** badge appears on changed files in the Explorer and on editor tabs.
- The toolbar **Save All** button and each row's inline **Save** icon save files without any commit message, since there is nothing to commit.

### 3.3 Reverting a Single Change

Hover a gutter marker and click **Revert this change**, or put the cursor in a change and run `SavePoint Diff: Revert Change (at Cursor)`. Only that block returns to its baseline content, with no save required first. Added blocks are deleted, modified blocks are replaced with their baseline lines, and deleted blocks are re-inserted.

### 3.4 Savepoints (Baseline Reset)

`SavePoint Diff: Create Savepoint (Don't Save to Disk)` makes the current in-memory content the new baseline without writing to disk. Use it before a risky edit to diff against "a minute ago".

> **Note:** A savepoint resets SavePoint Diff's UI, not the file's real dirty state. The panel entry, badge, and status bar count show "no differences", but the editor tab's own dirty dot still tells you whether you need to press `Ctrl+S`.

> **Not the same thing as cloud savepoints.** The cloud history in [Section 6.4](#64-the-savepoint-folder) is a log of synced saves. This local command only moves the diff baseline.

### 3.5 Snapshots

Snapshots are Git-style checkpoints of a single file, kept **in memory** for the current window session.

- `Save Snapshot` captures a labeled checkpoint. A snapshot is also taken on every save when `snapshots.autoSnapshotOnSave` is on.
- A snapshot identical to the latest one is not duplicated.
- The last `snapshots.maxSnapshots` (default 10) are kept per file.
- `View & Restore Snapshot...` lets you diff any snapshot against the current buffer or revert the whole file to it.

* * *

## 4. Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **SavePoint Diff**.

| Command | Description |
|---|---|
| `SavePoint Diff: Toggle` | Turn the extension on or off. |
| `SavePoint Diff: Refresh` | Force-recalculate the diff for the active editor. |
| `SavePoint Diff: Clear Decorations` | Clear markers without changing the baseline. |
| `SavePoint Diff: Save File` | Save one file (inline icon in the panel). |
| `SavePoint Diff: Save All Unsaved Changes` | Save every file listed in the panel. |
| `SavePoint Diff: Revert Change (at Cursor)` | Revert the change block at the cursor. |
| `SavePoint Diff: Create Savepoint (Don't Save to Disk)` | Set the current content as the new baseline. |
| `SavePoint Diff: Save Snapshot (Git-style Checkpoint)` | Capture a labeled checkpoint of the active file. |
| `SavePoint Diff: View & Restore Snapshot...` | Compare or restore a snapshot. |
| `SavePoint Diff: Cloud: Connect Storage...` | Set and test the rclone remote. |
| `SavePoint Diff: Cloud: Upload Project Folder...` | Upload a whole folder to the connected storage. |
| `SavePoint Diff: Cloud: Sync Now` | Sync changed, new, and deleted files immediately. |
| `SavePoint Diff: Cloud: View Savepoint History` | Browse the cloud history, newest first. |

* * *

## 5. Settings

### Core

| Setting | Type | Default | Description |
|---|---|---|---|
| `savepointDiff.enabled` | `boolean` | `true` | Enable or disable the extension globally. |
| `savepointDiff.showAdded` | `boolean` | `true` | Show markers for added lines. |
| `savepointDiff.showModified` | `boolean` | `true` | Show markers for modified lines. |
| `savepointDiff.showDeleted` | `boolean` | `true` | Show markers for deleted-line positions. |
| `savepointDiff.showOverviewRuler` | `boolean` | `true` | Show ticks in the overview ruler. |
| `savepointDiff.showBackgroundHighlight` | `boolean` | `false` | Lightly tint changed lines. |
| `savepointDiff.enableRevertInHover` | `boolean` | `true` | Show the "Revert this change" link on hover. |
| `savepointDiff.maxFileSize` | `number` | `2000000` | Files larger than this many bytes skip live diffing. Invalid values fall back to the default. |
| `savepointDiff.debounceMs` | `number` | `150` | Delay after the last keystroke before recalculating. |
| `savepointDiff.snapshots.enabled` | `boolean` | `true` | Enable snapshot history. |
| `savepointDiff.snapshots.maxSnapshots` | `number` | `10` | Maximum snapshots kept per file. |
| `savepointDiff.snapshots.autoSnapshotOnSave` | `boolean` | `true` | Snapshot automatically on every save. |

### Cloud

| Setting | Type | Default | Description |
|---|---|---|---|
| `savepointDiff.cloud.enabled` | `boolean` | `false` | Master switch for cloud sync. Off means zero network use. |
| `savepointDiff.cloud.remote` | `string` | `""` | rclone remote and folder, e.g. `mydrive:projects/my-app`. |
| `savepointDiff.cloud.rclonePath` | `string` | `"rclone"` | Path to the rclone executable. |
| `savepointDiff.cloud.autoSyncOnSave` | `boolean` | `true` | Sync automatically after each save. |
| `savepointDiff.cloud.exclude` | `string[]` | `[".git", "node_modules", "out", ".env*"]` | Names that are never uploaded. `*` wildcards are supported. |

> **Note:** The cloud settings are read fresh on every sync, so changing them takes effect immediately without a reload.

* * *

## 6. Cloud Sync (Optional GitHub Alternative)

Cloud sync is a private alternative to GitHub for people who would rather not push project files to it. It is built on [rclone](https://rclone.org), so one code path covers Google Drive, Mega, and many other storage providers.

```
 1 Install rclone  ->  2 Add a remote  ->  3 Connect in VS Code  ->  4 Upload, then just save
```

It is completely optional and independent of GitHub. Anyone who leaves it off keeps using the extension exactly as before.

### 6.1 Setting Up rclone

**Install**

| System | Command |
|---|---|
| Windows | `winget install Rclone.Rclone` |
| macOS | `brew install rclone` |
| Linux | `curl https://rclone.org/install.sh \| sudo bash` |

Check it:

```
rclone version
```

> **Remote-SSH / WSL / Dev Containers:** install rclone on the machine where the extension host runs (the remote side), not on your laptop.

**Create a remote**

Run the interactive setup once:

```
rclone config
```

Press `n` (new remote), give it a short name such as `mydrive`, and choose your storage type. rclone handles the login and saves everything in **its own config file**. SavePoint Diff never sees or stores your password or tokens.

- **Google Drive:** choose the *Google Drive* type, leave client ID and secret empty, choose full access when asked for the scope, and finish the browser login. Official guide: <https://rclone.org/drive/>
- **Mega:** choose the *Mega* type and enter your email and password. Official guide: <https://rclone.org/mega/>
- **Anything else:** see <https://rclone.org/overview/>. If rclone can reach it, SavePoint Diff can use it.

> **Note:** rclone's prompts vary slightly between versions. The official guides linked above are the source of truth.

**Verify**

```
rclone listremotes        # should list  mydrive:
rclone lsd mydrive:       # lists top-level folders
```

### 6.2 Connecting and Uploading

1. Run `SavePoint Diff: Cloud: Connect Storage...` and enter `remote:folder`, for example `mydrive:projects/my-app`. The extension runs `rclone mkdir` on it, which creates the folder and also proves the remote is writable. On success it saves `cloud.remote` and turns `cloud.enabled` on (in Workspace scope when a folder is open, otherwise Global).
2. Run `SavePoint Diff: Cloud: Upload Project Folder...`, pick the folder, and read the confirmation (it shows the destination and the excluded names). Click **Upload**.
3. From then on, just save.

The remote string must have the form `name:path`. Anything else is rejected before rclone is ever called.

### 6.3 How a Sync Works

```
 Save file
    |
    v
 Wait 2 seconds (debounce), then scan the folder
    |
    +--> nothing changed? --> stop (no upload, no savepoint entry)
    |
    v changed
 Upload new / modified files   (chunks of 100)
 Delete removed files in cloud (chunks of 100), then tidy empty folders
    |
    v
 Append an entry to  .savepoint/history.json  in the cloud copy
```

Details:

- **Scanning** walks the folder, skips excluded names and symlinks, and compares each file with a manifest of what was last synced. A file is re-hashed (SHA-256) only if its size or modified time changed. A file that was touched but is byte-identical produces no upload and no savepoint.
- **Only changes move.** Files are classified as added, modified, or deleted against the manifest. The whole folder is never re-uploaded after the first upload.
- **Deleted files** are removed from the cloud copy, so the cloud mirrors the project.
- **One sync at a time.** If you save while a sync is running, one more pass is queued after it finishes.
- **Auto sync** only fires for files saved inside the synced folder, and only for `file://` documents.
- **Sync Now** and the status bar item run the same logic on demand.

### 6.4 The `.savepoint` Folder

Your cloud copy gets a `.savepoint/` folder, similar to `.git` in a Git repository. It is the home for the extension's own files for that project. Today it holds one file, `history.json`:

```json
{
  "project": "my-app",
  "savepoints": [
    {
      "id": "sp_001",
      "timestamp": "2026-10-31T16:20:00.000Z",
      "changes": ["Updated src/app.js", "Added components/header.jsx"],
      "summary": "Updated app.js; added header.jsx."
    },
    {
      "id": "sp_002",
      "timestamp": "2026-10-31T16:30:00.000Z",
      "changes": ["Updated styles/main.css"],
      "summary": "Updated main.css."
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `project` | The name of the synced folder. |
| `id` | Sequential savepoint ID (`sp_001`, `sp_002`, ...). |
| `timestamp` | When the sync happened, ISO 8601 in UTC. |
| `changes` | One line per file: `Added`, `Updated`, or `Deleted`, followed by the path. At most 50 are listed; extra ones collapse into `...and N more`. |
| `summary` | A short sentence. Up to 3 files per verb are named; larger groups use a count. The first upload reads `Initial upload: N files.` |

Rules:

- **History is append-only.** Existing entries are never overwritten.
- **No duplicates.** A save that changed nothing creates no entry.
- **Local ignore.** A local folder named `.savepoint` is never uploaded as a normal project file.
- **Reading it:** run `SavePoint Diff: Cloud: View Savepoint History` for a list, newest first. Pick an entry to see its full change list.

### 6.5 Error Handling & Recovery

| Situation | Behavior |
|---|---|
| Network or provider failure during a sync | The files that already uploaded stay recorded; the rest remain pending. The status bar shows `error`, you get one warning, and it retries automatically after 1 minute, doubling each time up to 10 minutes. |
| VS Code closes mid-sync | The manifest only advances for chunks that finished, so the next sync resumes from where it stopped. |
| Files synced but writing `history.json` failed | The entries are stored as pending and written on the next sync, so files and history stay consistent. |
| `history.json` in the cloud is unreadable (damaged or hand-edited) | It is **not overwritten**. The sync reports an error and keeps the pending entries until you fix it. |
| rclone not found | A clear error naming the executable that could not run. |
| Changed `cloud.remote` | The manifest is reset, since it describes a different destination, and the next sync uploads everything. |
| Saving during a sync | Queued, never run in parallel. |

Retrying is also triggered by the next save or by `Sync Now`.

### 6.6 Security

- **No credentials are stored by the extension.** Authentication lives in your rclone config only.
- rclone is launched with an argument list and **without a shell**, and the remote string is validated, so a crafted setting cannot inject commands.
- The `--ask-password=false` flag is passed so an encrypted rclone config produces an error instead of a hidden prompt that would hang a sync.
- `.git`, `node_modules`, `out`, and `.env*` are excluded by default, and you confirm the destination before the first upload.
- Symlinks are skipped.

> ⚠️ **Review your exclude list.** Anything inside the synced folder that is not excluded is uploaded. If your project holds other secrets (keys, credentials files), add them to `savepointDiff.cloud.exclude`.

### 6.7 Limitations

- One folder is synced per workspace (no multi-root support).
- Two computers writing to the same remote can overwrite each other's `history.json`, since the log is read, extended, and written back as a whole file.
- rclone must be installed where the extension host runs.
- Cloud sync needs Node's `child_process`, so it is unavailable in browser-only hosts such as vscode.dev.
- This is file sync plus a history log. It does not provide branching, merging, or restoring files from the cloud copy.

* * *

## 7. Project Structure (Who Is What)

```
savepoint-diff/
├── package.json            # manifest: commands, settings, version
├── tsconfig.json
├── README.md               # overview
├── DOCUMENTATION.md        # this file
├── CHANGELOG.md            # release notes
├── CONTRIBUTING.md         # build, packaging, manual test checklist
├── src/
│   ├── extension.ts
│   ├── diffEngine.ts
│   ├── baselineManager.ts
│   ├── decorations.ts
│   ├── scmProvider.ts
│   ├── snapshotManager.ts
│   ├── commands.ts
│   ├── cloudSync.ts
│   ├── types.ts
│   └── utils.ts
└── resources/              # icon, demo, added / modified / deleted gutter icons
```

| File | Role |
|---|---|
| `src/extension.ts` | Entry point. Wires everything together, owns the per-document change cache and recompute flow, and listens to open / change / save / close / rename events. Calls `cloudSync.onSaved()` from the save hook. |
| `src/diffEngine.ts` | `computeDiff()`: a Myers line diff (via the `diff` library) turned into added / modified / deleted blocks. CRLF is normalized so line-ending style alone is never a change. |
| `src/baselineManager.ts` | Keeps the "last saved" text per document, in memory. Handles untitled files, renames, and reconciling hot-exit restores against the real on-disk content. |
| `src/decorations.ts` | Creates the gutter decoration types and applies them to every visible editor of a document, including split editors. Also builds the hover revert link. |
| `src/scmProvider.ts` | The Source Control panel group, the read-only virtual baseline document used by the split diff, and the "M" badge provider. |
| `src/snapshotManager.ts` | In-memory snapshot history per file, plus the virtual document provider used to diff a snapshot against the current buffer. |
| `src/commands.ts` | Registers the local commands and the `SavePoint: ON/OFF` status bar item, and computes the `+added ~modified -deleted` summary. |
| `src/cloudSync.ts` | **Optional cloud sync.** The rclone runner, folder scan, incremental sync, `.savepoint/history.json` log, retry logic, cloud status bar item, and the four cloud commands. |
| `src/types.ts` | Shared types (`DiffChange`, `DocumentState`). |
| `src/utils.ts` | Helpers: document keys, untitled / diffable checks, debounce, line clamping, byte length. |

* * *

## 8. How It Works Internally

**Local diff**

1. **Baseline:** when a file opens, its content is stored as the baseline. Untitled files start with an empty baseline.
2. **Live diff:** each edit schedules a debounced recompute of `computeDiff(baseline, currentText)`, then updates decorations, the panel entry, the badge, and the status bar.
3. **Save:** saving resets the baseline and clears every surface through one function, so the UI never contradicts itself.
4. **Revert / external changes:** if a file stops being dirty without a save (Revert File, or an outside tool rewrote it), the baseline re-syncs automatically.
5. **Large files:** files above `maxFileSize` skip diffing, with a one-time warning that re-arms after the file shrinks.

**Cloud sync**

1. The save hook calls `CloudSync.onSaved()`, which checks that sync is enabled, the document is a local file, and it lives inside the synced folder, then debounces a sync.
2. A sync scans the folder and builds added / modified / deleted lists against the manifest.
3. rclone is called with `copy ... --files-from-raw -` for uploads and `delete ... --files-from-raw -` for removals, feeding file names through stdin in chunks.
4. After each successful chunk, the manifest advances. The state (synced root, remote, manifest, pending log entries) is stored in the workspace state, so it survives a restart.
5. The log is read with `rclone cat`, extended, and written back with `rclone rcat`.

* * *

## 9. Status Bar

| Item | Meaning |
|---|---|
| `SavePoint: ON` / `OFF` | Extension state. Click to toggle. When the active file has changes it also shows `+added ~modified -deleted`. |
| `Cloud: syncing` | A cloud sync is running. |
| `Cloud: synced` | The cloud copy is up to date. |
| `Cloud: error` | The last sync failed. Hover for the reason. |

The cloud item only appears while `savepointDiff.cloud.enabled` is on. Click it to run `Sync Now`.

* * *

## 10. Troubleshooting

| You see | Try this |
|---|---|
| No markers inside a Git repository | VS Code's built-in quick-diff colors are usually driven by Git there. The panel entry, badges, status bar count, and split diff still work. |
| Everything is "added" in a new file | Untitled files start with an empty baseline until you **Save As**. |
| Panel says "no differences" after a savepoint | Expected. Check the editor tab's dirty dot to know whether you still need to save. |
| `Cannot run rclone ("rclone")` | rclone is not installed or not on `PATH`. Install it, or set `savepointDiff.cloud.rclonePath`. |
| `Invalid savepointDiff.cloud.remote` | Use the form `name:path`, then re-run **Connect Storage**. |
| `cannot reach "..."` while connecting | Test `rclone lsd yourremote:` in a terminal. Re-run `rclone config` if your login expired. |
| `.savepoint/history.json ... unreadable; left untouched` | Fix or delete that file in your cloud storage, then run **Sync Now**. |
| Nothing uploads on save | Check that `cloud.enabled` is on, the file is inside the uploaded folder, and its name is not excluded. |
| The first cloud sync is slow | The initial upload sends the whole folder. Later syncs only send changes. |
| Cloud history is empty on a brand-new remote | The log is created by the first sync that records a change. |

* * *

## 11. Frequently Asked Questions (FAQ)

### Does SavePoint Diff replace Git?

No. It tracks unsaved edits and short-term snapshots. Cloud sync gives you a private copy and a change log, but no branches or merges. Keep using Git where you need real version control.

### Do I need GitHub or Git for cloud sync?

No. Cloud sync is independent of both. Use whichever cloud your rclone supports.

### Does anything leave my machine if I never enable cloud sync?

No. There is no telemetry, and the extension makes no network requests unless `savepointDiff.cloud.enabled` is on.

### Where does my cloud login go?

Into rclone's own config file, managed by rclone. The extension only stores the remote name and folder (for example `mydrive:projects/my-app`) in settings.

### Are my files encrypted in the cloud?

Not by this extension. Encryption is an rclone feature (its `crypt` remote type); see the rclone documentation if you need it.

### Can I sync a different folder than the one I opened?

Yes. `Upload Project Folder...` lets you pick any folder. Auto sync then follows saves inside that folder.

### Why was a file I deleted removed from the cloud too?

Deletions are mirrored so the cloud copy matches your project. The deletion is recorded in `history.json`.

### How do I stop syncing?

Set `savepointDiff.cloud.enabled` to `false`. Nothing already in your cloud is touched.

### Does it work in Remote-SSH, WSL, and Dev Containers?

The core features do. For cloud sync, install rclone on the remote side, where the extension host runs.

* * *

## 12. Versioning

The current version is defined in `package.json`. See [CHANGELOG.md](./CHANGELOG.md) for what changed in each release.
