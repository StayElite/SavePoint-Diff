/**
 * SavePoint Diff
 *
 * A lightweight VS Code extension that shows live, unsaved changes in
 * the editor gutter and Source Control panel - like Git diff
 * decorations, but without needing Git. Compares the last-saved
 * baseline of a file against its current, in-memory content and
 * updates gutter markers on every keystroke; also adds a Source
 * Control panel entry and a full old-vs-current diff view, purely
 * from a local, dependency-light diff engine.
 *
 * Documentation: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 * GitHub:        https://github.com/StayElite/SavePoint-Diff
 *
 * Created and maintained by Ashish Sharma (Stay Elite).
 *
 * Copyright (c) 2026 Ashish Sharma (Stay Elite)
 * Licensed under the MIT License. See the LICENSE file for details.
 */

// Extension entry point: wires baseline tracking, diffing, decorations,
// the Source Control panel, and commands together.

import * as vscode from "vscode";
import { BaselineManager } from "./baselineManager";
import { DecorationManager, DecorationConfig } from "./decorations";
import { computeDiff } from "./diffEngine";
import { registerCommands, updateStatusBarItem, summarizeChanges, CommandHost, RevertChangeRef } from "./commands";
import { DiffChange, DocumentState } from "./types";
import { byteLength, clampLine, debounce, isDiffableDocument, isUntitled, keyFor } from "./utils";
import {
  BASELINE_SCHEME,
  BaselineContentProvider,
  LiveDiffFileDecorationProvider,
  LiveDiffSourceControl,
} from "./scmProvider";
import {
  SNAPSHOT_SCHEME,
  SnapshotConfig,
  SnapshotManager,
  SnapshotContentProvider,
  snapshotUriFor,
} from "./snapshotManager";

const CONFIG_SECTION = "savepointDiff";
const DEFAULT_MAX_FILE_SIZE = 2000000;
const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_MAX_SNAPSHOTS = 10;

interface ResolvedConfig extends DecorationConfig {
  enabled: boolean;
  maxFileSize: number;
  debounceMs: number;
  snapshots: SnapshotConfig;
}

/**
 * Sanitizes a setting that must be a positive (> 0) number, e.g.
 * `maxFileSize`: 0 would mean "every non-empty file exceeds the
 * threshold", i.e. diffing silently disabled everywhere, which is
 * never a sane value for a size *limit*. Falls back to `fallback` for
 * anything that isn't a finite, positive number — covers negative
 * values, zero, NaN/Infinity, and non-numeric hand-edited
 * settings.json values (`cfg.get`'s generic type parameter is not
 * runtime-validated, so a stray string or boolean would otherwise
 * flow straight through).
 */
function resolvePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Sanitizes a setting that must be a non-negative (>= 0) number, e.g.
 * `debounceMs`, where 0 is a legitimate ("recompute immediately")
 * value. Falls back to `fallback` for negative numbers, NaN/Infinity,
 * and non-numeric values.
 */
function resolveNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readConfig(): ResolvedConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enabled: cfg.get<boolean>("enabled", true),
    showAdded: cfg.get<boolean>("showAdded", true),
    showModified: cfg.get<boolean>("showModified", true),
    showDeleted: cfg.get<boolean>("showDeleted", true),
    showOverviewRuler: cfg.get<boolean>("showOverviewRuler", true),
    showBackgroundHighlight: cfg.get<boolean>("showBackgroundHighlight", false),
    enableRevertInHover: cfg.get<boolean>("enableRevertInHover", true),
    maxFileSize: resolvePositiveNumber(cfg.get("maxFileSize"), DEFAULT_MAX_FILE_SIZE),
    debounceMs: resolveNonNegativeNumber(cfg.get("debounceMs"), DEFAULT_DEBOUNCE_MS),
    snapshots: {
      enabled: cfg.get<boolean>("snapshots.enabled", true),
      maxSnapshots: resolvePositiveNumber(cfg.get("snapshots.maxSnapshots"), DEFAULT_MAX_SNAPSHOTS),
      autoSnapshotOnSave: cfg.get<boolean>("snapshots.autoSnapshotOnSave", true),
    },
  };
}

/** True if every field relevant to this extension's behavior is identical. */
function configsEqual(a: ResolvedConfig, b: ResolvedConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.showAdded === b.showAdded &&
    a.showModified === b.showModified &&
    a.showDeleted === b.showDeleted &&
    a.showOverviewRuler === b.showOverviewRuler &&
    a.showBackgroundHighlight === b.showBackgroundHighlight &&
    a.enableRevertInHover === b.enableRevertInHover &&
    a.maxFileSize === b.maxFileSize &&
    a.debounceMs === b.debounceMs &&
    a.snapshots.enabled === b.snapshots.enabled &&
    a.snapshots.maxSnapshots === b.snapshots.maxSnapshots &&
    a.snapshots.autoSnapshotOnSave === b.snapshots.autoSnapshotOnSave
  );
}

export function activate(context: vscode.ExtensionContext): void {
  let config = readConfig();

  const baselines = new BaselineManager();
  const decorations = new DecorationManager(context, config);
  const docStates = new Map<string, DocumentState>();
  const warnedTooLarge = new Set<string>();
  // Documents with an in-flight on-disk baseline read (see
  // `initializeBaseline`), so repeat events don't queue duplicate reads.
  const reconciling = new Set<string>();
  // Each document's most recently computed change list, keyed the same
  // way as docStates. Two things read this: the status bar's live
  // +added ~modified -deleted summary for the active file, and
  // `revertChange`, which needs to map a hover link's (or the cursor's)
  // change index back to the actual DiffChange to undo.
  const lastChanges = new Map<string, DiffChange[]>();

  const baselineContentProvider = new BaselineContentProvider(baselines);
  const sourceControl = new LiveDiffSourceControl(baselines);
  const fileDecorations = new LiveDiffFileDecorationProvider();

  const snapshotManager = new SnapshotManager(config.snapshots);
  const snapshotContentProvider = new SnapshotContentProvider(snapshotManager);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, baselineContentProvider),
    vscode.workspace.registerTextDocumentContentProvider(SNAPSHOT_SCHEME, snapshotContentProvider),
    vscode.window.registerFileDecorationProvider(fileDecorations),
    baselineContentProvider,
    sourceControl,
    fileDecorations,
    snapshotManager
  );

  function stateFor(uri: vscode.Uri): DocumentState {
    const key = keyFor(uri);
    let state = docStates.get(key);
    if (!state) {
      state = { timer: undefined };
      docStates.set(key, state);
    }
    return state;
  }

  /**
   * Refreshes the status bar's live change-count summary for whichever
   * document is in the active editor right now (or falls back to the
   * bare ON/OFF label if there's no active editor, the extension is
   * disabled, or that document has no computed changes yet). Safe to
   * call unconditionally from anywhere — it re-reads
   * `vscode.window.activeTextEditor` itself rather than trusting a
   * caller's notion of "active", so callers never need to guess whether
   * their document is the active one.
   */
  function refreshStatusBarForActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    const changes = editor && config.enabled ? lastChanges.get(keyFor(editor.document.uri)) : undefined;
    updateStatusBarItem(statusBarItem, config.enabled, changes ? summarizeChanges(changes) : undefined);
  }

  /**
   * Clears every UI surface for a single document — gutter decorations,
   * its Source Control panel entry, its file badge, and its cached
   * change list — and, if it's the active editor's document, refreshes
   * the status bar summary to match. Every code path that needs to
   * clear one of these surfaces clears all of them through here, so the
   * UI can't end up contradicting itself (e.g. a file still badged "M"
   * with no gutter markers, or a stale status bar count after a save).
   */
  function clearSurfaces(document: vscode.TextDocument): void {
    decorations.clear(document);
    sourceControl.setHasChanges(document, false);
    fileDecorations.setHasChanges(document.uri, false);
    lastChanges.delete(keyFor(document.uri));
    if (vscode.window.activeTextEditor?.document === document) {
      refreshStatusBarForActiveEditor();
    }
  }

  /** The `clearSurfaces` equivalent for "disable globally" scenarios (the
   * toggle command, or a settings change that disables the extension) —
   * clears every visible editor's decorations and every tracked
   * document's panel entry, badge, and cached change list in one go.
   * Callers update the status bar label themselves right afterward
   * (they already know the new `enabled` value directly), so this
   * doesn't touch it. */
  function clearEverySurface(): void {
    decorations.clearAll();
    sourceControl.clearAll();
    fileDecorations.clearAll();
    lastChanges.clear();
  }

  /** Recomputes the diff for a document right now and (re)applies decorations. */
  function recompute(document: vscode.TextDocument): void {
    if (!isDiffableDocument(document)) {
      return;
    }

    // A debounced recompute (or a resolved disk read) can land after its
    // document was closed. Reading from a closed TextDocument is not
    // supported by the VS Code API and can throw inside the extension
    // host, so bail out rather than risk an unhandled rejection.
    if (document.isClosed) {
      return;
    }

    if (!config.enabled) {
      clearSurfaces(document);
      return;
    }

    const key = keyFor(document.uri);
    const size = byteLength(document.getText());
    // Ensures a docStates entry exists for this document (so its timer
    // field is ready for scheduleRecompute later); the returned state
    // object itself isn't needed here.
    stateFor(document.uri);

    if (size > config.maxFileSize) {
      clearSurfaces(document);
      if (!warnedTooLarge.has(key)) {
        warnedTooLarge.add(key);
        vscode.window.showWarningMessage(
          `SavePoint Diff: "${document.fileName}" exceeds savepointDiff.maxFileSize; live diffing is disabled for this file.`
        );
      }
      return;
    }

    // If this document was previously flagged too-large and has since
    // shrunk back under the threshold, clear its one-time warning too —
    // otherwise growing past the limit again later would silently skip
    // the warning a second time.
    warnedTooLarge.delete(key);
    initializeBaseline(document);

    const baseline = baselines.get(document.uri);
    const changes = computeDiff(baseline, document.getText());
    decorations.apply(document, changes);
    lastChanges.set(key, changes);

    const hasChanges = changes.length > 0;
    sourceControl.setHasChanges(document, hasChanges);
    fileDecorations.setHasChanges(document.uri, hasChanges);

    if (vscode.window.activeTextEditor?.document === document) {
      refreshStatusBarForActiveEditor();
    }
  }

  /**
   * Establishes a document's baseline, and — for a document that is
   * already dirty the first time we see it (VS Code's "hot exit"
   * restores unsaved changes when a window reopens) — kicks off a
   * background read of the real on-disk content to replace the
   * provisional baseline, then recomputes once it lands.
   *
   * Tracked in `reconciling` so a burst of events for the same document
   * can't queue several redundant disk reads.
   */
  function initializeBaseline(document: vscode.TextDocument): void {
    const needsReconcile = baselines.initialize(document);
    if (!needsReconcile) {
      return;
    }
    const key = keyFor(document.uri);
    if (reconciling.has(key)) {
      return;
    }
    const state = stateFor(document.uri);
    state.cts?.cancel();
    state.cts?.dispose();
    const cts = new vscode.CancellationTokenSource();
    state.cts = cts;

    reconciling.add(key);
    void baselines
      .reconcileWithDisk(document, cts.token)
      .then((changed) => {
        if (changed && !cts.token.isCancellationRequested && !document.isClosed) {
          recompute(document);
          baselineContentProvider.refresh(document.uri);
        }
      })
      .finally(() => {
        reconciling.delete(key);
        if (state.cts === cts) {
          cts.dispose();
          state.cts = undefined;
        }
      });
  }

  /** Debounced entry point used for on-every-keystroke change events. */
  function scheduleRecompute(document: vscode.TextDocument): void {
    if (!isDiffableDocument(document)) {
      return;
    }
    const state = stateFor(document.uri);
    state.timer = debounce(state.timer, config.debounceMs, () => {
      state.timer = undefined;
      recompute(document);
    });
  }

  function refreshVisibleEditorsFor(document: vscode.TextDocument): void {
    recompute(document);
  }

  function refreshAllVisibleEditors(): void {
    // `visibleTextEditors` has one entry per *editor*, not per document —
    // the same file split across two groups appears twice, pointing at
    // the identical TextDocument object. `recompute()` already updates
    // every visible editor for a document in one call (via
    // `decorations.apply`'s own `editorsFor` lookup), so recomputing it
    // again for the second entry would just redo the same diff for the
    // same result.
    const seen = new Set<string>();
    for (const editor of vscode.window.visibleTextEditors) {
      const key = keyFor(editor.document.uri);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      recompute(editor.document);
    }
  }

  /** Splits text into logical lines the same way the diff engine indexes
   * them (originalStartLine/originalEndLine refer to this same split) —
   * on any `\r\n`, standalone `\r`, or bare `\n`, never producing a trailing empty entry
   * for a normal file-ending newline the way a plain `.split("\n")`
   * would for text a diff already treats as ending cleanly. */
  function splitLines(text: string): string[] {
    return text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
  }

  /** True if `change`'s current-document range includes `line` — used to
   * find the change under the cursor for a Command-Palette-invoked
   * revert (no hover link, hence no explicit change index). A deletion
   * has no current-document lines of its own, so it "covers" only its
   * single anchor line. */
  function changeCoversLine(change: DiffChange, line: number, document: vscode.TextDocument): boolean {
    if (change.type === "deleted") {
      return clampLine(change.startLine, document) === line;
    }
    const start = clampLine(change.startLine, document);
    const end = clampLine(change.endLine, document);
    return start <= line && line <= end;
  }

  /** The range to delete for an "added" revert: the full lines
   * `start..end` including their trailing line break — *except* when
   * those lines run all the way to the end of the document, where
   * there's no trailing break to absorb, so the break *before* `start`
   * is absorbed instead (mirroring how editors' own "delete line"
   * commands avoid leaving a dangling blank line). */
  function deletionRangeForLines(document: vscode.TextDocument, start: number, end: number): vscode.Range {
    if (document.lineCount === 0) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const isTrailing = end === document.lineCount - 1;
    if (isTrailing && start > 0) {
      const prevLineEnd = document.lineAt(start - 1).range.end;
      return new vscode.Range(prevLineEnd, document.lineAt(end).range.end);
    }
    return new vscode.Range(new vscode.Position(start, 0), document.lineAt(end).rangeIncludingLineBreak.end);
  }

  /**
   * Applies one WorkspaceEdit that restores every change in `targets`
   * back to its baseline content, then triggers an immediate (not
   * debounced) recompute so the gutter/panel/status-bar reflect the
   * result right away.
   *
   * - "added" blocks are deleted outright (they don't exist in the
   *   baseline).
   * - "modified" blocks are replaced with their corresponding baseline
   *   lines.
   * - "deleted" blocks are re-inserted at their anchor. A deletion whose
   *   raw (unclamped) anchor is at or past the document's current line
   *   count was of *trailing* content — the anchor `clampLine` resolved
   *   it to is an existing line, not "the line after the gap" (there
   *   isn't one), so the restored text is appended after the document's
   *   last line instead of inserted before that clamped line.
   *
   * Restored text is joined using the live document's current line
   * ending (not necessarily the baseline's own), so the result stays
   * internally consistent with the surrounding lines it's dropped into.
   */
  async function revertChanges(document: vscode.TextDocument, targets: DiffChange[]): Promise<void> {
    const baselineLines = splitLines(baselines.get(document.uri));
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const edit = new vscode.WorkspaceEdit();

    // Sort targets in descending order by startLine (and endLine) so that edits
    // later in the document do not shift line numbers for earlier edits.
    const sortedTargets = [...targets].sort((a, b) => {
      if (b.startLine !== a.startLine) {
        return b.startLine - a.startLine;
      }
      return (b.endLine ?? b.startLine) - (a.endLine ?? a.startLine);
    });

    for (const change of sortedTargets) {
      if (change.type === "added") {
        const start = clampLine(change.startLine, document);
        const end = clampLine(change.endLine, document);
        edit.delete(document.uri, deletionRangeForLines(document, start, end));
      } else if (change.type === "deleted") {
        const originalStart = change.originalStartLine ?? 0;
        const originalEnd = change.originalEndLine ?? originalStart;
        const restored = baselineLines.slice(originalStart, originalEnd + 1);
        const rawAnchor = change.startLine;

        if (rawAnchor >= document.lineCount) {
          const insertPos =
            document.lineCount > 0 ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(0, 0);
          edit.insert(document.uri, insertPos, eol + restored.join(eol));
        } else {
          const insertPos = new vscode.Position(Math.max(0, rawAnchor), 0);
          edit.insert(document.uri, insertPos, restored.join(eol) + eol);
        }
      } else {
        const start = clampLine(change.startLine, document);
        const end = clampLine(change.endLine, document);
        const originalStart = change.originalStartLine ?? start;
        const originalEnd = change.originalEndLine ?? end;
        const restored = baselineLines.slice(originalStart, originalEnd + 1);
        const endPosition =
          document.lineCount > 0 ? document.lineAt(end).range.end : new vscode.Position(end, 0);
        const range = new vscode.Range(new vscode.Position(start, 0), endPosition);
        edit.replace(document.uri, range, restored.join(eol));
      }
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      vscode.window.showWarningMessage("SavePoint Diff: Could not revert the selected change.");
      return;
    }

    const state = stateFor(document.uri);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    recompute(document);
  }

  // --- Commands + status bar ---
  //
  // Registered before both the initial baseline pass below (whose
  // recompute() calls now reach into `statusBarItem` via
  // refreshStatusBarForActiveEditor) and the event listeners further
  // down (e.g. onDidChangeConfiguration references it directly) — no
  // forward reference into a not-yet-initialized const either way.

  const host: CommandHost = {
    isEnabled: () => config.enabled,
    setEnabled: (enabled: boolean) => {
      const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
      // Persist to whichever scope currently governs the effective
      // value, so the toggle actually sticks. Writing unconditionally to
      // Global (as this used to do) is silently shadowed whenever
      // `savepointDiff.enabled` is already overridden at the Workspace
      // or WorkspaceFolder level — the write would succeed but have no
      // effect, since the narrower scope still wins, leaving the
      // optimistic in-memory `config.enabled` update below out of sync
      // with the real effective setting. Falls back to Global, same as
      // before, when no override exists at either narrower scope.
      const inspected = cfg.inspect<boolean>("enabled");
      const target =
        inspected?.workspaceFolderValue !== undefined
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      // The onDidChangeConfiguration handler below will pick up the
      // change, see it matches what we already applied here, and skip
      // redundant recompute work.
      void cfg.update("enabled", enabled, target);
      config = { ...config, enabled };
      if (!enabled) {
        clearEverySurface();
      }
    },
    refreshActiveEditor: () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        recompute(editor.document);
      }
    },
    refreshAll: () => refreshAllVisibleEditors(),
    clearActiveEditorDecorations: () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      // Clear every surface, not just the gutter: leaving the file
      // listed in the Source Control panel and badged "M" (or the
      // status bar still showing a stale count) while its markers are
      // gone would have the UI contradicting itself. The baseline is
      // deliberately left untouched, so the next edit (or an explicit
      // Refresh) brings the real state straight back.
      clearSurfaces(editor.document);
    },
    saveDocument: async (uri: vscode.Uri) => {
      // Look up in open text documents, or open via workspace if not currently in memory.
      // TextDocument.save() is a no-op that resolves `true` if the
      // document has no unsaved changes, so it's safe to call even if
      // the row was clicked right as a save from elsewhere landed.
      try {
        const document =
          vscode.workspace.textDocuments.find((doc) => keyFor(doc.uri) === keyFor(uri)) ??
          (await vscode.workspace.openTextDocument(uri));
        return document ? await document.save() : false;
      } catch {
        return false;
      }
    },
    saveAllTracked: async () => {
      // Snapshot the list before saving: each successful save fires
      // onDidSaveTextDocument, which removes that document from the
      // panel and would otherwise mutate the list we're iterating.
      const uris = sourceControl.getTrackedUris();
      for (const uri of uris) {
        try {
          const document =
            vscode.workspace.textDocuments.find((doc) => keyFor(doc.uri) === keyFor(uri)) ??
            (await vscode.workspace.openTextDocument(uri));
          if (document) {
            await document.save();
          }
        } catch {
          // Continue saving remaining tracked documents even if one fails
        }
      }
    },
    revertChange: async (ref?: RevertChangeRef) => {
      // Resolve which document we're acting on first, before touching
      // `lastChanges` at all.
      let document: vscode.TextDocument | undefined;
      if (ref && typeof ref.uri === "string" && Array.isArray(ref.indices)) {
        document = vscode.workspace.textDocuments.find((doc) => keyFor(doc.uri) === ref.uri);
        if (!document) {
          try {
            document = await vscode.workspace.openTextDocument(vscode.Uri.parse(ref.uri, true));
          } catch {
            document = undefined;
          }
        }
      } else {
        document = vscode.window.activeTextEditor?.document;
      }

      if (!document) {
        vscode.window.setStatusBarMessage("SavePoint Diff: No change to revert here.", 2000);
        return;
      }

      // `lastChanges` is only ever refreshed by a (possibly still-
      // pending) debounced recompute, so it can be up to `debounceMs`
      // stale relative to the document's actual current text — e.g. the
      // user types, then immediately invokes revert (from the Command
      // Palette, or a hover link that was already open) before that
      // recompute has run. Reverting against a stale change list could
      // silently touch the wrong lines in a document that has since
      // shifted. Forcing an immediate, synchronous recompute here first
      // (mirroring what the Refresh command already does) guarantees
      // `lastChanges` always matches `document`'s real current content
      // before anything below reads it. If the document genuinely did
      // change since a hover's link was rendered, a `ref.indices` lookup
      // below may then legitimately come up empty — safely reported as
      // "no change to revert" rather than silently reverting the wrong
      // content.
      const state = stateFor(document.uri);
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
      recompute(document);

      const changes = lastChanges.get(keyFor(document.uri)) ?? [];
      let targets: DiffChange[] = [];

      if (ref && Array.isArray(ref.indices)) {
        // Came from a gutter marker's hover link: the exact change(s) are
        // identified by index into this document's change list.
        targets = ref.indices.map((i) => changes[i]).filter((c): c is DiffChange => c !== undefined);
      } else {
        // Command-Palette invocation with no argument: fall back to
        // whatever change(s) sit under the active editor's cursor. Using
        // every match rather than just the first matters for deletions —
        // two distinct deleted blocks can share one anchor line (see
        // `DecorationManager.apply`'s `deletedByAnchor` grouping), and a
        // cursor sitting on that line should be able to revert both, the
        // same way the hover's two separate links already can.
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === document) {
          const line = editor.selection.active.line;
          targets = changes.filter((c) => changeCoversLine(c, line, document));
        }
      }

      if (targets.length === 0) {
        vscode.window.setStatusBarMessage("SavePoint Diff: No change to revert here.", 2000);
        return;
      }

      await revertChanges(document, targets);
    },
    createSavepoint: () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isDiffableDocument(editor.document)) {
        return;
      }
      const document = editor.document;
      // Moves the diff baseline to right now, without writing anything
      // to disk: document.isDirty (and the editor tab's own unsaved-dot
      // indicator) are completely untouched by this. A subsequent real
      // Save still works exactly as before and simply supersedes this
      // savepoint as the new baseline, same as it always has.
      baselines.set(document.uri, document.getText());
      baselineContentProvider.refresh(document.uri);
      const state = stateFor(document.uri);
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
      recompute(document);
      vscode.window.setStatusBarMessage("SavePoint Diff: Savepoint created — now diffing from this point.", 2500);
    },
    saveSnapshot: async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isDiffableDocument(editor.document)) {
        vscode.window.showInformationMessage("SavePoint Diff: No active diffable editor to snapshot.");
        return;
      }
      if (!config.snapshots.enabled) {
        vscode.window.showInformationMessage(
          "SavePoint Diff: Snapshots are currently disabled in settings (savepointDiff.snapshots.enabled)."
        );
        return;
      }
      const document = editor.document;
      const label = await vscode.window.showInputBox({
        prompt: "Optional description or commit-style message for this snapshot",
        placeHolder: "e.g. before refactoring login handler",
      });
      if (label === undefined) {
        return; // User cancelled
      }
      const snap = snapshotManager.addSnapshot(document.uri, document.getText(), label.trim() || undefined);
      if (snap) {
        vscode.window.showInformationMessage(
          `SavePoint Diff: Snapshot saved${snap.label ? ` ("${snap.label}")` : ""}.`
        );
      }
    },
    restoreSnapshot: async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isDiffableDocument(editor.document)) {
        vscode.window.showInformationMessage("SavePoint Diff: No active diffable editor for snapshots.");
        return;
      }
      const document = editor.document;
      const history = snapshotManager.getSnapshots(document.uri);
      if (history.length === 0) {
        vscode.window.showInformationMessage("SavePoint Diff: No snapshots saved yet for this file.");
        return;
      }

      interface SnapshotQuickPickItem extends vscode.QuickPickItem {
        snapshot: typeof history[number];
      }

      const items: SnapshotQuickPickItem[] = [...history].reverse().map((snap, idx) => {
        const timeStr = new Date(snap.timestamp).toLocaleTimeString();
        const dateStr = new Date(snap.timestamp).toLocaleDateString();
        const title = snap.label ? `"${snap.label}"` : `Snapshot #${history.length - idx}`;
        return {
          label: `$(history) ${title}`,
          description: `${dateStr} ${timeStr}`,
          detail: `ID: ${snap.id} • ${byteLength(snap.text)} bytes`,
          snapshot: snap,
        };
      });

      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a snapshot to inspect or restore",
      });
      if (!chosen) {
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          { label: "$(diff) Compare Diff with Current", action: "diff" as const },
          { label: "$(discard) Revert Entire File to This Snapshot", action: "revert" as const },
        ],
        { placeHolder: `Action for ${chosen.label}` }
      );

      if (!action) {
        return;
      }

      if (action.action === "diff") {
        const snapUri = snapshotUriFor(document.uri, chosen.snapshot.id);
        const fileName = document.uri.path.split(/[\\/]/).pop() || "file";
        await vscode.commands.executeCommand(
          "vscode.diff",
          snapUri,
          document.uri,
          `${fileName} (Snapshot: ${chosen.snapshot.label || chosen.snapshot.id}) ↔ Current`
        );
      } else if (action.action === "revert") {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to revert "${document.fileName}" to snapshot ${chosen.label}?`,
          { modal: true },
          "Revert"
        );
        if (confirm !== "Revert") {
          return;
        }

        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          document.lineCount > 0 ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(0, 0)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, chosen.snapshot.text);
        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
          const state = stateFor(document.uri);
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = undefined;
          }
          recompute(document);
          vscode.window.showInformationMessage(`SavePoint Diff: Reverted to snapshot ${chosen.label}.`);
        }
      }
    },
  };

  const statusBarItem = registerCommands(context, host);

  // --- Initialize baselines for documents already open at activation time ---
  for (const document of vscode.workspace.textDocuments) {
    if (isDiffableDocument(document)) {
      initializeBaseline(document);
    }
  }
  refreshAllVisibleEditors();

  // --- Event wiring ---

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!isDiffableDocument(document)) {
        return;
      }
      initializeBaseline(document);
      refreshVisibleEditorsFor(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const document = event.document;
      if (!isDiffableDocument(document)) {
        return;
      }
      if (event.contentChanges.length === 0) {
        // Some events (e.g. dirty-state-only flips) carry no content
        // changes; nothing to recalculate.
        return;
      }

      // A content change that leaves the document *not* dirty means its
      // content now matches what's on disk — so that content is the new
      // baseline, by definition. This covers cases no save event ever
      // fires for:
      //
      //   - "File: Revert File", which discards unsaved edits by
      //     re-reading disk (previously left a stale baseline, so the
      //     reverted file kept showing markers for changes the user had
      //     just thrown away)
      //   - the file being changed underneath the editor by something
      //     else (a branch switch, an external formatter, another
      //     program) while the buffer was clean
      //
      // Undo-back-to-saved-state also lands here, where it's a harmless
      // no-op: the baseline already equals the content, so this just
      // re-sets the same string.
      if (!document.isDirty && !isUntitled(document)) {
        const state = stateFor(document.uri);
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = undefined;
        }
        baselines.set(document.uri, document.getText());
        clearSurfaces(document);
        baselineContentProvider.refresh(document.uri);
        return;
      }

      scheduleRecompute(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!isDiffableDocument(document)) {
        return;
      }
      if (config.snapshots.enabled && config.snapshots.autoSnapshotOnSave) {
        snapshotManager.addSnapshot(document.uri, document.getText());
      }
      const state = stateFor(document.uri);
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
      baselines.set(document.uri, document.getText());
      clearSurfaces(document);
      baselineContentProvider.refresh(document.uri);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = keyFor(document.uri);
      const state = docStates.get(key);
      if (state?.timer) {
        clearTimeout(state.timer);
      }
      if (state?.cts) {
        state.cts.cancel();
        state.cts.dispose();
      }
      docStates.delete(key);
      warnedTooLarge.delete(key);
      reconciling.delete(key);
      lastChanges.delete(key);
      sourceControl.removeDocument(document.uri);
      fileDecorations.setHasChanges(document.uri, false);
      // Only drop the baseline once no other visible editor still shows
      // this exact document instance (VS Code can briefly hold multiple
      // TextDocument references during tab operations); a same-URI reopen
      // immediately after will simply re-initialize the baseline anyway.
      baselines.delete(document.uri);
    })
  );

  // Handles real on-disk renames (e.g. renaming a file in the Explorer),
  // so the baseline and tracking state follow the file instead of being lost.
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((event) => {
      for (const { oldUri, newUri } of event.files) {
        baselines.rekey(oldUri, newUri);
        snapshotManager.rekey(oldUri, newUri);
        const oldKey = keyFor(oldUri);
        const newKey = keyFor(newUri);
        if (docStates.has(oldKey)) {
          docStates.set(newKey, docStates.get(oldKey)!);
          docStates.delete(oldKey);
        }
        if (lastChanges.has(oldKey)) {
          lastChanges.set(newKey, lastChanges.get(oldKey)!);
          lastChanges.delete(oldKey);
        }
        if (warnedTooLarge.has(oldKey)) {
          warnedTooLarge.delete(oldKey);
          warnedTooLarge.add(newKey);
        }
        sourceControl.removeDocument(oldUri);
        fileDecorations.setHasChanges(oldUri, false);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        refreshVisibleEditorsFor(editor.document);
      }
      // Covers both a genuinely new active document (recompute above
      // already refreshed it, but this is cheap enough to not special-
      // case) and switching away to no active editor at all, where the
      // count should disappear back to the bare ON/OFF label.
      refreshStatusBarForActiveEditor();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        refreshVisibleEditorsFor(editor.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) {
        return;
      }

      const next = readConfig();
      if (configsEqual(config, next)) {
        // Nothing actually changed from this extension's point of view —
        // most commonly because our own toggle command already applied
        // this exact value in memory before its `configuration.update()`
        // call round-tripped back as this event. Recomputing again here
        // would just duplicate work every editor already reflects.
        return;
      }
      config = next;

      decorations.updateConfig(config);
      snapshotManager.updateConfig(config.snapshots);
      updateStatusBarItem(statusBarItem, config.enabled);

      if (!config.enabled) {
        clearEverySurface();
      } else {
        // Any relevant setting change (toggling visibility of a change
        // type, re-enabling, changing overview-ruler/background options)
        // warrants a full recompute so editors reflect it immediately.
        refreshAllVisibleEditors();
      }
    })
  );

  context.subscriptions.push(decorations);
  context.subscriptions.push({
    dispose: () => {
      for (const state of docStates.values()) {
        if (state.timer) {
          clearTimeout(state.timer);
        }
        if (state.cts) {
          state.cts.cancel();
          state.cts.dispose();
        }
      }
      docStates.clear();
      warnedTooLarge.clear();
      reconciling.clear();
      lastChanges.clear();
      baselines.dispose();
    },
  });
}

export function deactivate(): void {
  // All per-document timers and decoration types are disposed via
  // context.subscriptions in activate(); nothing else to clean up here.
}
