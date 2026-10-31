# Changelog

All notable changes to the "SavePoint Diff" extension are documented
in this file.

## [0.2.0] - 2026-10-31

- **Added:** optional cloud storage sync (rclone-based, off by default) as a
  private alternative to GitHub: upload a whole project folder, then only
  changed/new/deleted files sync on save. A `.savepoint/history.json` log
  (in a `.savepoint/` folder in the cloud copy, like `.git`) records an ID,
  timestamp, changed files and a short summary for every save that changed
  something. New commands: Cloud: Connect Storage / Upload Project Folder /
  Sync Now / View Savepoint History.
- **Added:** `DOCUMENTATION.md`, a single full reference covering every
  feature, command, setting, source file, and the rclone setup guide.
- Cloud sync is off by default; with it off there is no network use.

## [0.1.0] - Initial release

- Live, real-time gutter decorations (added/modified/deleted) comparing
  the last-saved baseline against the current unsaved editor content.
- Git-free, network-free, fully local diffing via `jsdiff`'s Myers line
  diff.
- Baseline reset and decoration clearing on save.
- Correct handling of undo/redo (always recomputed from saved baseline
  vs. current text, never manually tracked deltas).
- Deletion markers anchored at the correct gap position, including at
  file start/end and for runs of consecutive deleted lines.
- Untitled-file support: empty baseline until Save As.
- Configurable visibility per change type, overview ruler markers,
  optional background highlighting, file-size threshold, and debounce
  interval.
- `Toggle` / `Refresh` / `Clear Decorations` commands plus a status bar
  toggle.
- Support for multiple open documents, split editors, and multiple
  editor groups.
- Source Control panel entry listing files with unsaved changes, an
  "M" badge on modified files (Explorer/tabs), and a full split
  old-vs-current diff editor (baseline vs. live document) opened via
  the built-in `vscode.diff` command — mirroring Git's own "Open
  Changes" UI, without using Git.

### Fixes & improvements (still 0.1.0 — no version bump)

A full source audit turned up the following, all fixed in place without
introducing a new version number:

- **Fixed:** disabling the extension only cleared the "M" file-decoration
  badge on *visible* editors; files open in background/hidden tabs kept a
  stale badge indefinitely. `LiveDiffFileDecorationProvider` now has a
  proper `clearAll()` that clears every tracked badge regardless of
  visibility.
- **Fixed:** toggling the extension on via the command or status bar
  triggered a full gutter/Source-Control recompute twice — once
  immediately, and once again when the settings write it triggers
  round-tripped back as a configuration-change event. A config-equality
  check now skips the second, redundant pass.
- **Fixed:** once a file was flagged as exceeding `maxFileSize`, its
  one-time oversized-file warning never reset — if the file later shrank
  back under the limit and then grew past it again, no second warning
  was shown. The warning now re-arms whenever a file drops back under
  the threshold.
- **Fixed:** mixed or Windows-style (CRLF) line endings could cause a
  line whose content hadn't actually changed to be reported as
  "modified", purely because of a differing trailing carriage return
  (e.g. after pasting text copied from a source using the other
  convention). Comparison now normalizes CRLF to LF before diffing.
- **Fixed:** a misplaced doc comment in `diffEngine.ts` described the
  wrong function.
- **Improved:** `maxFileSize` and `debounceMs` now reject negative
  values both in the settings schema (`minimum: 0`) and defensively in
  code, so a mistyped or hand-edited setting can't silently disable
  diffing for every file or produce a negative delay.
- **Improved:** added/modified gutter decorations now span to the exact
  end of the last changed line (rather than a zero-width position at
  column 0), removing any ambiguity around the final line of a
  multi-line change reliably getting its gutter icon and (when enabled)
  background highlight.
- **Improved:** `statusBarItem` is now fully initialized before any
  event listener can reference it (commands/status bar are registered
  before the event-wiring section), removing a forward reference that
  worked in practice but was fragile to reason about.
- **Improved:** added a `.gitignore` (previously missing despite the
  project being GitHub-hosted).

### Second audit pass — further fixes & improvements (still 0.1.0 — no version bump)

A follow-up full source scan turned up the following, also fixed in
place without a version bump:

- **Fixed:** setting `savepointDiff.maxFileSize` to `0` (or any other
  non-positive value) previously survived the existing defensive
  clamp — `Math.max(0, value)` — as `0`, which meant "every non-empty
  file exceeds the threshold," i.e. live diffing silently disabled for
  every file, exactly the outcome that clamp's own comment said it was
  there to prevent. `maxFileSize` (and `debounceMs`) are now validated
  as finite, correctly-signed numbers and fall back to the documented
  default (`2000000`) whenever the configured value is invalid —
  covering zero/negative values, `NaN`/`Infinity`, and even a
  non-numeric hand-edited `settings.json` entry (e.g. a stray string),
  none of which were actually caught before. The `maxFileSize` setting
  schema's minimum was also corrected from `0` to `1` to match.
- **Fixed:** any settings change — including ones with no visual
  effect at all, like `debounceMs` or `maxFileSize` — unconditionally
  disposed and rebuilt all three gutter decoration types. Only
  `showOverviewRuler` and `showBackgroundHighlight` actually need a
  rebuild (they're baked into a decoration type's fixed render options
  at creation time); `showAdded`/`showModified`/`showDeleted` are read
  at decoration-*application* time and never needed one.
  `DecorationManager.updateConfig` now only disposes/rebuilds when one
  of those two render-affecting settings actually changed, avoiding
  needless work and a brief decoration flicker on every unrelated
  settings change.

### New feature (still 0.1.0 — no version bump)

- **Added: Save straight from the Source Control panel.** The
  "SavePoint Diff" panel now has a **"Save All"** toolbar button (top
  of the panel, the same spot Git puts its commit button) that saves
  every file currently listed under "Unsaved Changes", plus an inline
  **save icon** on each row that saves just that one file — no need to
  switch back to the editor tab and press `Ctrl+S` first. Backed by two
  new commands, `savepointDiff.saveDocument` and `savepointDiff.saveAll`,
  wired up via the `scm/resourceState/context` and `scm/title` menu
  contribution points.
  > This is a genuinely new user-facing feature rather than a bug fix,
  > so under normal semantic-versioning practice it would warrant a
  > minor version bump (`0.1.0` → `0.2.0`). It's included here at
  > `0.1.0` only because this file is still being kept at the initial
  > version per an earlier no-bump request; bump it whenever that
  > constraint is lifted.
- **Improved:** the "SavePoint Diff" Source Control panel no longer
  shows the default Git-style commit-message input box. This
  extension has no commit concept (no `acceptInputCommand` is ever
  set), so it was just empty, unclickable clutter above the file list —
  hidden via `SourceControlInputBox.visible = false`.

### Third audit pass — remote environments, hot exit, and UI consistency (still 0.1.0 — no version bump)

- **Fixed: Extension did nothing in remote and virtual environments.** Tracked
  documents were restricted to the `file` and `untitled` URI schemes, so
  under Remote-SSH, WSL, Dev Containers, GitHub Codespaces, Remote
  Repositories, or vscode.dev / github.dev — where real, editable files
  use other schemes — no markers, panel entries, or badges ever
  appeared. Replaced the scheme allowlist with a blocklist of known
  synthetic/internal schemes (output channels, debug console, settings
  UI, notebook cells, walkthroughs, and the extension's own baseline
  documents), so real files are tracked wherever they're opened from.
- **Fixed: Unsaved changes restored after a restart showed no markers.** VS
  Code's "hot exit" (on by default) restores unsaved edits when a window
  reopens, which meant a document could already be dirty the first time
  the extension saw it — its baseline was captured from that *unsaved*
  text, so the diff came out empty and every in-flight change was
  silently hidden. Such documents now have their baseline reconciled
  against the file's real on-disk content in the background, via VS
  Code's own filesystem API (read-only, and remote-aware).
- **Fixed: Reverting a file left stale markers.** "File: Revert File" discards
  unsaved edits without firing a save event, so the baseline went stale
  and the reverted file kept showing markers for changes that no longer
  existed. The same applied when a file was rewritten underneath a clean
  buffer (a branch switch, an external formatter, another program). Any
  content change that leaves a document not dirty now re-syncs the
  baseline automatically. This removes a limitation previously
  documented in the README.
- **Fixed: "Clear Decorations" left the UI self-contradictory.** The command
  cleared gutter markers but left the file listed in the Source Control
  panel and still badged "M". It now clears all three surfaces together,
  while still leaving the baseline untouched.
- **Fixed: Possible errors from late recomputes.** A debounced recompute (or a
  resolved background disk read) could land after its document had been
  closed, and reading from a closed document is unsupported by the VS
  Code API. Such recomputes now bail out early.
- **Fixed: Redundant deletion markers.** Two distinct deleted blocks could
  clamp onto the same anchor line (e.g. deleting content at both the
  start and end of a file that is now a single line), handing VS Code
  duplicate identical ranges to render. Anchors are now de-duplicated.
- **Fixed: Incomplete teardown.** The `warnedTooLarge` set and the
  in-flight-read tracking set weren't cleared on deactivation, and the
  latter wasn't cleared when a document closed.

### Fourth audit pass — dead state and a settings-scope bug (still 0.1.0 — no version bump)

A full source scan (code, manifest, and docs) turned up the following,
fixed in place without a version bump:

- **Fixed:** `DocumentState.tooLarge` was set on every recompute but
  never read anywhere — a dead, write-only field that gave the false
  impression something downstream gated on it. Removed.
- **Fixed:** toggling the extension (via the status bar item or the
  `savepointDiff.toggle` command) always persisted the new `enabled`
  value at the Global (User) settings scope. If `savepointDiff.enabled`
  was already overridden at the Workspace or WorkspaceFolder level,
  that write was silently shadowed — the toggle looked like it took
  effect (decorations updated optimistically) but the real, effective
  setting never changed, and the in-memory state could drift out of
  sync with it on the next settings-change event. The toggle now
  writes to whichever scope currently governs the effective value
  (falling back to Global when no override exists), matching how the
  setting will actually be resolved afterwards.
- **Improved:** added a `package` npm script (`vsce package`) so
  packaging can be run consistently via `npm run package`, alongside
  the existing `compile`/`watch` scripts; `CONTRIBUTING.md` now
  mentions it next to the direct `vsce package` invocation.

### New features: per-change revert, status bar summary, manual savepoints (still 0.1.0 — no version bump)

- **Added: Revert a single change.** Every gutter marker's hover now
  offers a "↺ Revert this change" link that restores just that
  added/modified/deleted block back to its baseline content in one
  edit, leaving the rest of the file — including any other unrelated
  changes in it — untouched. Also reachable with no hover at all via
  the new `SavePoint Diff: Revert Change (at Cursor)` command, which
  acts on whichever change the active editor's cursor is currently
  inside. A new `savepointDiff.enableRevertInHover` setting (default
  `true`) turns the hover link off for anyone who finds it visually
  noisy, without affecting the command.
- **Added: Live change count in the status bar.** The `SavePoint:
  ON`/`OFF` status bar item now appends a running `+added ~modified
  -deleted` tally for the active file whenever it has unsaved changes
  (e.g. `SavePoint: ON  +12 ~4 -2`), clearing back to the bare label
  the moment the file is saved, its changes are reverted, or a
  different (unchanged) file becomes active.
- **Added: Manual savepoints.** The new `SavePoint Diff: Create
  Savepoint` command snapshots the active file's current in-memory
  content as the new diff baseline immediately, without writing
  anything to disk — a way to checkpoint "diff from here" before a
  risky edit, independent of the next real Save. The file's editor tab
  keeps showing its normal unsaved-changes indicator throughout, since
  nothing was actually saved; see the new "Known limitations" entry in
  `README.md` for the resulting (intentional) gap between that
  indicator and SavePoint Diff's own panel/badge/status-bar surfaces.
  > Like the Save-All feature above, this is new user-facing
  > functionality rather than a bug fix, so it would normally warrant
  > a minor version bump. Included here at `0.1.0` for the same
  > no-bump reason.
- **Internal:** the "every UI surface clears together" contract
  (decorations, panel entry, file badge) introduced in the third audit
  pass now also covers the status bar's change count and a new
  per-document cache of the last-computed change list (needed to look
  up which change a hover link or the cursor refers to). Two small
  helpers, `clearSurfaces()` (one document) and `clearEverySurface()`
  (every tracked document), replace what were previously several
  independently hand-rolled instances of the same three-or-four-call
  pattern scattered across the save handler, the revert-to-saved
  handler, the "Clear Decorations" command, and both places the
  extension disables itself — so a future change to what counts as
  "the UI surfaces" only needs to happen in one place.

### Fifth audit pass: bugs in the new revert/status-bar/savepoint features (still 0.1.0 — no version bump)

A full source scan of the three features added above (the newest,
least battle-tested code in the project) turned up six real issues,
fixed in place without a version bump:

- **Fixed: a gutter marker's "Revert this change" link broke for any
  file with a `(` or `)` in its path.** The hover link's
  `command:savepointDiff.revertChange?...` URI JSON-encodes a small
  payload and passes it through `encodeURIComponent` — which
  deliberately leaves `(` and `)` unescaped (they're valid URI
  "sub-delims"). A literal `)` inside a Markdown `[text](target)`
  link's target prematurely closes it, though, so any document whose
  path contains one — `report (final).txt`, `Copy (1).js`, a
  `Downloads (2)` folder, all ordinary real-world paths — produced a
  broken or truncated hover link. `DecorationManager` now escapes both
  characters explicitly on top of `encodeURIComponent`.
- **Fixed: revert could silently touch the wrong lines if invoked
  immediately after typing.** `lastChanges` (which both the hover
  link's index and the Command-Palette cursor fallback rely on) is
  only refreshed by a debounced `recompute()`, so it could be up to
  `debounceMs` stale relative to the document's real content — typing,
  then immediately clicking an already-open hover link or running
  `SavePoint Diff: Revert Change (at Cursor)`, could revert against a
  change list computed before that last keystroke. `revertChange` now
  forces an immediate, synchronous recompute first, so it always
  reverts against the document's actual current content; in the rare
  case a hover's specific index no longer matches anything after that
  refresh, it now safely reports "no change to revert" instead of
  silently editing the wrong lines.
- **Fixed: a manual savepoint could be silently overwritten by a
  slow, in-flight hot-exit disk read.** `BaselineManager.reconcileWithDisk()`'s
  race guard used to check only "still has a baseline and still
  dirty" before applying a background disk read — which correctly
  caught a save landing mid-read (a save clears `isDirty`), but not a
  manual savepoint landing mid-read, since `SavePoint Diff: Create
  Savepoint` deliberately leaves `isDirty` untouched. On a slow or
  remote filesystem, this meant a just-created savepoint could quietly
  get replaced by the stale original on-disk content moments later,
  with no indication anything had happened. The guard now snapshots
  the exact baseline value a reconcile is meant to replace and only
  applies the disk read if the baseline is still that same value when
  the read resolves.
- **Fixed: reverting from the cursor couldn't reach both of two
  deletions sharing one gutter marker.** Two distinct deleted blocks
  can collapse onto the same anchor line (e.g. content deleted at both
  the start and end of a file that's now a single line); the hover
  already offers a separate "Revert deletion 1 of 2" / "2 of 2" link
  for each, but the Command-Palette cursor-based fallback used
  `Array.find`, which only ever reached the first. It now collects
  every change covering the cursor's line and reverts them together in
  one edit.
- **Fixed: `SavePoint Diff: Save File` sat in the Command Palette
  doing nothing.** `savepointDiff.saveDocument` requires a
  `resourceState` argument that only its inline Source Control panel
  row button ever supplies; invoked from the Command Palette (with no
  argument), it silently no-ops. Hidden from the Command Palette via a
  `"when": "false"` menu contribution — the same pattern VS Code's own
  Git extension uses for its resource-state-only commands.
- **Improved:** `refreshAllVisibleEditors()` recomputed the same
  document twice whenever it was split across two editor groups
  (`vscode.window.visibleTextEditors` has one entry per *editor*, not
  per document, and `recompute()` already updates every visible editor
  for a document in a single call). Now deduplicated by document URI.

### Sixth audit pass: comprehensive edge-case fixes, cleanup & automated testing (still 0.1.0 — no version bump)

A deep, full-source audit across the codebase uncovered several edge cases and robustness gaps, fixed in place without a version bump:

- **Fixed: multiple changes reverted together could shift line offsets.** When reverting multiple changes (such as cursor on an anchor line with multiple deletions, or future batch reverts), executing edits in arbitrary order caused earlier changes to shift lines for subsequent changes. Targets in `revertChanges()` are now sorted descending by `startLine` (and `endLine`) so downstream edits never shift positions of upstream targets.
- **Fixed: single carriage return (`\r`) line endings caused spurious diffs.** Classic Mac OS / legacy formats using lone `\r` (or text pasted from such files) were not normalized by the diff engine. `normalizeForDiff()` and `splitLines()` now normalize standalone `\r` alongside `\r\n` to `\n`, ensuring completely reliable diffing across any line ending convention.
- **Fixed: background hot-exit disk reads could outlive document lifecycle.** If a document was closed or its baseline was superseded while a background disk reconcile read was in flight over a slow or remote connection, the promise could resolve afterwards without cancellation. Added `vscode.CancellationTokenSource` tracking per document in `DocumentState`, cleanly cancelling and discarding in-flight reads upon document close, replacement, or extension deactivation.
- **Fixed: state leakage and missing rekeying on file renames.** Renaming a file on disk via `onDidRenameFiles` previously rekeyed `BaselineManager`, but left `docStates`, `lastChanges`, and `warnedTooLarge` orphaned under the old URI key while stale panel/badge states lingered. Now all tracking maps and UI badges are properly migrated or cleared.
- **Fixed: `saveDocument` / `saveAllTracked` failing for documents not currently in memory.** If a file in the Source Control panel was unloaded from active editor memory, clicking save could fail to find it in `vscode.workspace.textDocuments`. `saveDocument` and `saveAllTracked` now safely fallback to `vscode.workspace.openTextDocument(uri)` with try/catch resilience.
- **Fixed: `revertChange` could fail if invoked for an unloaded document.** Added `vscode.workspace.openTextDocument` fallback when looking up the target document from URI link parameters.
- **Fixed: empty document `lineAt()` throws exception in decoration & revert ranges.** Accessing `document.lineAt(end)` when `document.lineCount === 0` throws an error in the VS Code API. Guarded range calculations in `DecorationManager.apply()` and `revertChanges()` to safely fall back to `new Position(end, 0)` on empty documents.
- **Fixed: cross-platform path separator handling in Source Control tab title.** `basenameOf()` split paths strictly on `/`, which failed to isolate filenames from Windows paths containing `\`. Switched to `/[\\/]/` splitting so diff editor titles format cleanly on all platforms.
- **Fixed: hover command argument unpacking compatibility in `revertChange`.** In MarkdownString `command:` URLs, VS Code passes the JSON payload as array arguments or direct parameters depending on host version. `revertChange` command registration now normalizes array-wrapped references (`ref[0]`) to ensure seamless execution across all VS Code environments.
- **Added: Automated test suite & `npm test` script.** Added unit test runner (`src/test/runTest.ts`) verifying diffing, line ending normalization, line clamping, UTF-8 byte calculations, multi-target sort ordering, and scheme filtering under `npm test`.

### New Feature: Git/GitHub-Style Checkpoint Snapshots & Restore (still 0.1.0 — no version bump)

- **Added: Snapshot history & restore.** A new snapshot system provides GitHub/Git-like revision history checkpointing without needing Git:
  - **`SavePoint Diff: Save Snapshot`**: Saves a named or timestamped snapshot of the active file to local in-memory history.
  - **`SavePoint Diff: View & Restore Snapshot...`**: Opens a QuickPick listing historical snapshots with timestamps, byte sizes, and optional descriptions. Users can either:
    - **Compare Diff**: View a split old-vs-current diff editor between any historical snapshot and the current live buffer via the virtual `savepoint-diff-snapshot` URI scheme.
    - **Revert Entire File**: Replaces the document buffer with the selected snapshot's content in a single undoable edit with user confirmation.
  - **Configurable retention (`savepointDiff.snapshots.maxSnapshots`)**: Users decide how many snapshots to retain per file (default: `10`, trimmed on limit overflow).
  - **Auto-snapshot on save (`savepointDiff.snapshots.autoSnapshotOnSave`)**: Automatically snapshots content on save events (default: `true`, can be disabled).
  - **Master toggle (`savepointDiff.snapshots.enabled`)**: Allows users to completely enable or disable snapshots.
  - **Smart deduplication**: Identical sequential edits are deduplicated to avoid saving redundant snapshots.

### Visual Assets & Branding (still 0.1.0 — no version bump)

- **Added: Extension Logo**: High-resolution, professional extension branding icon (`resources/icon.png`) fusing a modern savepoint floppy disk design with vibrant git diff colors (green added `+`, blue modified `~`, red deleted `-`). Configured in `package.json` for VS Code marketplace and extension manager display.
- **Added: Interactive Demo GIF for README**: High-quality animated walkthrough (`resources/demo.gif`) embedded into `README.md` showcasing live gutter marker updates, modified file badges in Source Control, per-change revert tooltip, and automatic snapshot clearing on save.
