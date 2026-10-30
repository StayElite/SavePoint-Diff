# Contributing to SavePoint Diff

This document covers building from source, packaging, and manually
verifying behaviour. End-user docs live in [README.md](./README.md).

## Building from source

```bash
npm install
npm run compile
npm test
```

This compiles `src/**/*.ts` into `out/**/*.js` using the TypeScript
compiler, per `tsconfig.json` (strict mode), and executes the unit test
suite covering diffing, line ending normalization, and boundary conditions.

To iterate while developing, run `npm run watch` and press <kbd>F5</kbd>
in VS Code (using the included `.vscode/launch.json`) to open an
Extension Development Host window with the extension loaded.

## Packaging

```bash
npm install -g @vscode/vsce   # if you don't already have it
vsce package
```

(Equivalently, `npm run package`, which runs the same `vsce package`
command.)

This produces `savepoint-diff-0.1.0.vsix` (named after the current
`version` in `package.json`), which can be installed via
**Extensions view → "…" menu → Install from VSIX…**, or:

```bash
code --install-extension savepoint-diff-0.1.0.vsix
```

`vsce` automatically resolves and bundles only the production
dependency (`diff`) from `package.json` — devDependencies like
TypeScript and its type packages are left out of the `.vsix`.

## Architecture

```text
savepoint-diff/
├── package.json          # extension manifest, commands, settings
├── tsconfig.json
├── src/
│   ├── extension.ts       # entry point — wires everything together
│   ├── diffEngine.ts       # Myers line diff -> added/modified/deleted blocks
│   ├── baselineManager.ts  # per-document "last saved" text, in memory
│   │                       #   (+ on-disk reconcile for hot-exit restores)
│   ├── decorations.ts      # gutter decoration types + application
│   ├── scmProvider.ts      # Source Control panel, virtual baseline docs, file badges
│   ├── commands.ts         # Toggle/Refresh/Clear/Revert/Savepoint/Save
│   │                       #   commands + the status bar item (incl. its
│   │                       #   live +added ~modified -deleted summary)
│   ├── types.ts
│   └── utils.ts            # keys, scheme filtering, debounce, clamping
└── resources/
    ├── added.svg
    ├── modified.svg
    └── deleted.svg
```

## Manual test checklist

The extension was designed against these scenarios; re-verify any of
them by hand after making changes:

1. Open a plain (non-Git) folder, edit a file — decorations should
   appear immediately, before saving.
2. Add one line / add 100 lines.
3. Delete one line / delete 100 lines.
4. Modify one line / modify multiple scattered lines.
5. Add and delete in the same edit (a true "modified" block plus extra
   pure add or pure delete around it).
6. Select-all and replace the entire file contents.
7. Select-all and delete everything (empty file) — a single deletion
   marker should sit at line 0.
8. Add content at the very beginning of the file.
9. Add content at the very end of the file.
10. Delete the first line; delete the last line.
11. Undo repeatedly back to the saved state — decorations should
    disappear exactly when the text matches the baseline again.
12. Redo — decorations should reappear.
13. Save (<kbd>Ctrl+S</kbd>) — all decorations clear immediately, new
    baseline established.
14. Save As on an untitled file — decorations clear and future edits
    diff against the newly saved content.
15. Split the editor for the same file into two groups — both should
    show identical, correctly synced decorations.
16. Open several files at once and switch between tabs — each keeps its
    own independent diff state.
17. Open a brand-new untitled file and start typing — everything shows
    as added.
18. Open an empty file and start typing.
19. Open a file larger than `savepointDiff.maxFileSize` — a warning
    appears once and no live diff is computed.
20. Toggle the extension off via the status bar or command — all
    decorations clear and no further recalculation happens until
    toggled back on.
21. Edit a file, check the Source Control panel shows a "SavePoint
    Diff" entry for it with an "M" badge; click it and confirm a split
    old-vs-current diff editor opens, with the right side reflecting
    live unsaved edits as you keep typing; save the file and confirm
    the entry disappears and the diff editor updates to show no diff.
22. Open a file saved with CRLF (Windows-style) line endings and edit
    one line — only that line should show as modified; unchanged lines
    around it should not be flagged just because of line-ending style.
23. Toggle the extension off while a background (non-active) tab has
    unsaved changes — its "M" badge should clear too, not just the
    active tab's.
24. Hand-edit `settings.json` to set `savepointDiff.maxFileSize` to
    `0`, a negative number, or a non-numeric value (e.g. `"abc"`) —
    diffing should keep working normally (falls back to the `2000000`
    default) instead of silently going dark for every file.
25. With a file showing live decorations, change an unrelated setting
    (e.g. `savepointDiff.debounceMs`) — decorations should update
    without any visible flicker/blink, since only
    `showOverviewRuler`/`showBackgroundHighlight` changes need to
    rebuild the underlying decoration types.
26. Edit two files so both appear in the "SavePoint Diff" panel. Click
    the inline save icon on just one row — only that file saves and
    drops off the list; the other stays. Then click the "Save All"
    toolbar button at the top of the panel — the remaining file saves
    and the panel empties.
27. Open the "SavePoint Diff" panel with no files edited yet — there
    should be no commit-message input box above the (empty) file
    list, unlike Git's own panel.
28. **Remote/virtual environments:** open a folder over Remote-SSH, WSL,
    a Dev Container, a Codespace, or on vscode.dev, edit a file, and
    confirm gutter markers, the panel entry, and the "M" badge all
    appear — these documents don't use the `file` scheme.
29. **Hot exit:** edit a file without saving, close the VS Code window
    entirely, and reopen it. The unsaved edits are restored by VS Code;
    confirm the markers for them are restored too (they should appear
    within a moment of the window loading, once the on-disk baseline
    read completes), and that the diff view shows the same changes.
30. **Revert:** edit a file, then run **File: Revert File**. All markers
    should clear on their own, the panel entry should disappear, and a
    subsequent edit should diff against the reverted content — no
    **Refresh** needed.
31. **External change to a clean buffer:** with a file open and *not*
    dirty, modify it from outside the editor (another program, or a
    branch switch). The buffer reloads; confirm no bogus markers appear
    for content the user didn't change.
32. **Clear Decorations consistency:** edit a file, run **SavePoint
    Diff: Clear Decorations**, and confirm the gutter markers, the panel
    entry, *and* the "M" badge all clear together. A further edit (or
    **Refresh**) should bring the real state straight back.
33. **Late recompute:** type rapidly in a file and close its tab
    mid-keystroke (discarding changes). No errors should surface in the
    Extension Host output channel.
34. **Duplicate deletion anchors:** take a multi-line file and delete
    content at both the start and the end so only one line remains.
    Exactly one deletion marker should render on that line.
35. **Revert a single change:** edit a file with several separate
    changes scattered through it (an added block, a modified line, and
    a deleted block, none adjacent). Hover the modified line's gutter
    marker, click "↺ Revert this change", and confirm only that line
    reverts to its baseline content — the added and deleted blocks
    elsewhere in the file are untouched. Repeat by placing the cursor
    in a different change and running `SavePoint Diff: Revert Change
    (at Cursor)` from the Command Palette instead — same result, no
    hover needed.
36. **Revert at file boundaries:** delete the last line of a file, hover
    its (now file-end) deletion marker, and revert it — the line should
    reappear at the end, not get inserted before the wrong line. Repeat
    for a deletion at the very start of the file.
37. **Revert one of two duplicate-anchor deletions:** reproduce test 34
    (content deleted at both start and end, collapsing to one visible
    marker), hover it, and confirm the hover offers two separate revert
    links ("Revert deletion 1 of 2" / "2 of 2") — clicking one restores
    only that side, leaving the other deletion in place. Then reproduce
    it again and instead place the cursor on that shared anchor line and
    run `SavePoint Diff: Revert Change (at Cursor)` from the Command
    Palette — this should revert *both* deletions at once, restoring the
    file completely (the Command Palette path has no way to pick "just
    one" the way a specific hover link does).
38. **Revert with `savepointDiff.enableRevertInHover` off:** disable the
    setting, confirm gutter marker hovers no longer show a revert link,
    but `SavePoint Diff: Revert Change (at Cursor)` from the Command
    Palette still works.
39. **Status bar change count:** edit a file with a mix of added,
    modified, and deleted lines and confirm the status bar item shows
    `SavePoint: ON  +N ~N -N` matching the actual counts; switch to a
    different, unchanged file and confirm the count disappears (back to
    the bare label); save the file and confirm the count drops to zero
    immediately.
40. **Create Savepoint:** edit a file (markers appear as usual), run
    `SavePoint Diff: Create Savepoint`, and confirm all markers, the
    panel entry, and the status bar count clear immediately — *without*
    the editor tab's own unsaved-changes dot going away. Keep editing;
    new markers should appear diffed against the savepoint, not the
    original disk content. A subsequent real Save should still work
    normally and clear everything, same as always.
41. **Revert on a file with parens in its name:** open a file whose path
    contains a literal `(` or `)` (e.g. `report (final).txt`), edit it,
    hover a gutter marker, and confirm the "↺ Revert this change" link
    actually appears and works, rather than a broken/truncated hover.
42. **Revert immediately after typing, before the debounce fires:** set
    `savepointDiff.debounceMs` to something noticeably slow (e.g.
    `2000`) for this test, type a change, and — within that window,
    before the gutter marker itself has even appeared — run `SavePoint
    Diff: Revert Change (at Cursor)` from the Command Palette. It should
    revert your just-typed change correctly (not a stale, pre-keystroke
    change list), or report "no change to revert" if the cursor genuinely
    isn't inside one — never touch the wrong lines.
43. **Savepoint survives a slow hot-exit reconcile:** this one is timing-
    sensitive and mainly useful when touching `baselineManager.ts` — on
    a remote or otherwise slow filesystem, restore a hot-exit session
    (test 29) and, as fast as possible after the window loads, run
    `SavePoint Diff: Create Savepoint` before the background disk read
    has had time to complete. Once it does complete, the savepoint's
    baseline must still be in effect — not silently overwritten by the
    (by-then-stale) disk content.

## Design notes

A few decisions in the codebase look arbitrary but are load-bearing.
Changing them without understanding why will reintroduce fixed bugs.

**Scheme filtering is a blocklist, not an allowlist.** It is tempting
to write `scheme === "file" || scheme === "untitled"`. Don't — real
editable documents use `vscode-remote` (Remote-SSH / WSL / Dev
Containers), `vscode-vfs` (Remote Repositories, vscode.dev), and other
schemes contributed by other extensions. An allowlist makes the whole
extension silently inert in those environments. See
`NON_DIFFABLE_SCHEMES` in `utils.ts`.

**A document can be dirty before the extension has ever seen it.** VS
Code's "hot exit" restores unsaved changes when a window reopens, so
`document.getText()` at first sight is not necessarily the last-saved
content. `BaselineManager.needsDiskReconcile()` flags this case and
`reconcileWithDisk()` repairs it in the background. Both the
in-flight-read guard (`reconciling` in `extension.ts`) and the
staleness re-checks inside `reconcileWithDisk` matter: without them a
save landing mid-read can be clobbered by the older disk snapshot.

**"Not dirty" is the signal that the baseline is stale.** There is no
event for "the user reverted this file". The change handler infers it:
any content change that leaves the document non-dirty means the buffer
now equals disk, so the baseline is re-set from it. This is what makes
Revert File and external rewrites work, and it is why that branch must
run *before* `scheduleRecompute` rather than after.

**Every UI surface clears together.** Gutter decorations, the Source
Control panel entry, the file badge, the cached change list
(`lastChanges` in `extension.ts`), and — for the active file — the
status bar's change count are five independent surfaces that all
represent the same fact. Any code path that clears one must clear all
five, or the UI ends up contradicting itself (e.g. a file still badged
"M" with no gutter markers, or a stale status bar count after a save).
`clearSurfaces()` (one document) and `clearEverySurface()` (every
tracked document) exist specifically so this can't be done
half-way — don't hand-roll a subset of the five clears at a new call
site; call one of those instead.

**A deletion's revert direction depends on whether its anchor is
in-bounds.** `revertChanges()` in `extension.ts` re-inserts a deleted
block at its anchor line — except when the deletion's *raw* (unclamped)
`startLine` is at or past the document's current line count, meaning
the deletion was of trailing content and there is no "line after the
gap" to insert before. That case appends after the document's last
line instead. Using the *clamped* anchor to decide which mode applies
would be wrong: clamping is what maps "past the end" down to a
valid-looking line index in the first place, so the raw value is the
only thing that still distinguishes the two cases. See the worked
example in `revertChanges`'s doc comment, and the "delete last line"
row in the diff-engine's own test coverage for why the raw startLine
can legitimately exceed `document.lineCount`.

**Untitled documents never get a disk read or a revert re-sync.** They
have no disk content; their baseline is empty by design until Save As.
Both code paths explicitly exclude them.

**A hover's revert link isn't allowed to trust `lastChanges`.** Because
`lastChanges` is only ever refreshed by a (possibly still-pending)
debounced `recompute()`, it can briefly lag behind the document's real
content — e.g. the user types, then immediately triggers a revert (a
hover link that was already open, or the Command Palette) before that
recompute has run. `host.revertChange` in `extension.ts` forces an
immediate, synchronous `recompute(document)` before reading
`lastChanges` for exactly this reason: reverting against a stale change
list could silently apply an edit to the wrong lines in a document that
has since shifted. Don't remove that call to "optimize" the common case
where nothing actually changed — the cost is one cheap extra diff, and
removing it reopens a real correctness bug, not just a redundant-work
one.

**Command-URI arguments need their own escaping pass beyond
`encodeURIComponent`.** `DecorationManager`'s hover-link builder JSON-
encodes a small payload (document URI + change index) into a
`command:savepointDiff.revertChange?...` Markdown link. `encodeURIComponent`
deliberately leaves `(` and `)` unescaped (they're valid URI
"sub-delims"), but a literal `)` inside a Markdown `[text](target)`
link's target prematurely closes it — so any document whose path
contains a paren (`report (final).txt`, `Copy (1).js`, a `Downloads
(2)` folder — all ordinary, common paths) would silently break or
truncate the link. `encodeCommandArgs()` escapes both characters
explicitly on top of `encodeURIComponent` for this reason; don't drop
back to a bare `encodeURIComponent()` call for any future command link
built the same way.

**A savepoint has to be able to defeat an in-flight hot-exit reconcile,
not just a save.** `BaselineManager.reconcileWithDisk()`'s race guard
used to check only "the document still has a baseline and is still
dirty" before applying a slow disk read — which correctly caught a
save landing mid-read (a save clears `isDirty`), but not a manual
savepoint landing mid-read, since `createSavepoint` deliberately leaves
`isDirty` untouched. Without the fix, a slow disk read (a remote or
otherwise slow filesystem) could silently overwrite a just-created
savepoint with the stale original on-disk content moments later. The
fix snapshots the exact provisional baseline a reconcile is meant to
replace and only applies the disk read if the baseline is *still*
that same value when the read resolves — catching a save, a savepoint,
or literally anything else that moves the baseline in between, not
just the two cases that used to be special-cased explicitly.

## Why jsdiff instead of a hand-rolled diff?

The spec calls for a "proper" line diff (Myers/LCS), not a naive
line-number comparison. `jsdiff`'s `diffLines` is a small (~20KB),
widely used, well-tested implementation of exactly that algorithm. A
hand-rolled reimplementation would need to correctly handle the same
edge cases (mixed line endings, files with/without trailing newlines,
very large inputs, degenerate diffs) that `jsdiff` has already had
years of production hardening against.

One subtlety worth knowing if you touch `diffEngine.ts`: both texts are
padded with a trailing newline before being handed to `diffLines`. Without
that, a final line with no trailing `\n` in one version but a trailing
`\n` in the other (because a line was added/removed after it) gets
diffed as a wholesale text difference rather than "this line is
unchanged" — e.g. deleting the last line of `A\nB\nC` down to `A\nB`
would otherwise misreport line `B` as modified instead of correctly
reporting only `C` as deleted.
