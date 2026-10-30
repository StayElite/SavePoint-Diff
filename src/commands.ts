/**
 * SavePoint Diff - Commands
 *
 * Registers the Toggle / Refresh / Clear Decorations / Revert Change /
 * Create Savepoint / Save / Save All commands and the "SavePoint:
 * ON/OFF" status bar item (which also shows a live +added ~modified
 * -deleted summary for the active file) used to control the extension.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";
import { DiffChange } from "./types";

/** Identifies a single change to revert, as carried by a hover command link. */
export interface RevertChangeRef {
  /** `uri.toString()` of the document the change belongs to. */
  uri: string;
  /**
   * Index (or indices) into that document's last-computed change list
   * (see `lastChanges` in extension.ts). A hover link always sends
   * exactly one; the shape stays a list so a future caller could revert
   * several blocks in one atomic edit without a different argument shape.
   */
  indices: number[];
}

export interface CommandHost {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  refreshActiveEditor(): void;
  refreshAll(): void;
  clearActiveEditorDecorations(): void;
  /** Saves a single tracked document, identified by its URI. */
  saveDocument(uri: vscode.Uri): Thenable<unknown>;
  /** Saves every document currently listed under "Unsaved Changes". */
  saveAllTracked(): Thenable<unknown>;
  /**
   * Reverts one change block back to its baseline content. `ref`, when
   * present, identifies the exact change (from a gutter hover's command
   * link); when omitted (Command Palette invocation), the change under
   * the active editor's cursor is used instead.
   */
  revertChange(ref?: RevertChangeRef): Thenable<unknown>;
  /**
   * Snapshots the active editor's current in-memory content as the new
   * diff baseline, without writing anything to disk — a manual
   * "diff from here" checkpoint independent of the next real Save.
   */
  createSavepoint(): void;
  /** Saves a named or timestamped snapshot of the active file to history. */
  saveSnapshot(): Thenable<unknown>;
  /** Shows snapshot history for the active file and lets user preview diff or revert. */
  restoreSnapshot(): Thenable<unknown>;
}

/** Per-file added/modified/deleted line counts shown in the status bar. */
export interface ChangeSummary {
  added: number;
  modified: number;
  deletedLines: number;
}

/**
 * Reduces a document's computed change list down to the three counts the
 * status bar shows. "added"/"modified" count current-document lines;
 * "deletedLines" counts baseline lines removed (a deletion block has no
 * current-document lines of its own to count).
 */
export function summarizeChanges(changes: DiffChange[]): ChangeSummary {
  let added = 0;
  let modified = 0;
  let deletedLines = 0;

  for (const change of changes) {
    if (change.type === "added") {
      added += change.endLine - change.startLine + 1;
    } else if (change.type === "modified") {
      modified += change.endLine - change.startLine + 1;
    } else {
      const start = change.originalStartLine ?? 0;
      const end = change.originalEndLine ?? start;
      deletedLines += end - start + 1;
    }
  }

  return { added, modified, deletedLines };
}

/**
 * Registers the user-facing commands plus a status bar item that mirrors
 * and toggles the enabled state, and — when a summary is supplied via
 * `updateStatusBarItem` — shows a live change count for the active file.
 */
export function registerCommands(context: vscode.ExtensionContext, host: CommandHost): vscode.StatusBarItem {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "savepointDiff.toggle";
  updateStatusBarItem(statusBarItem, host.isEnabled());
  statusBarItem.show();

  const toggle = vscode.commands.registerCommand("savepointDiff.toggle", () => {
    const next = !host.isEnabled();
    host.setEnabled(next);
    updateStatusBarItem(statusBarItem, next);
    if (next) {
      host.refreshAll();
    }
  });

  const refresh = vscode.commands.registerCommand("savepointDiff.refresh", () => {
    host.refreshActiveEditor();
  });

  const clear = vscode.commands.registerCommand("savepointDiff.clearDecorations", () => {
    host.clearActiveEditorDecorations();
  });

  // Bound to the inline "save" icon shown next to each entry in the
  // "SavePoint Diff" Source Control panel (see the
  // `scm/resourceState/context` menu contribution in package.json).
  // VS Code invokes an inline resource-state command with that
  // resource state as the argument, so the URI to save comes from
  // `resourceState.resourceUri` — there is deliberately no
  // active-editor fallback here, since an inline row button should
  // only ever act on the row it's attached to.
  const saveDocument = vscode.commands.registerCommand(
    "savepointDiff.saveDocument",
    (resourceState?: vscode.SourceControlResourceState) => {
      if (resourceState?.resourceUri) {
        return host.saveDocument(resourceState.resourceUri);
      }
      return undefined;
    }
  );

  // Bound to the toolbar "save all" icon at the top of the "SavePoint
  // Diff" Source Control panel (see the `scm/title` menu contribution
  // in package.json) — the same spot Git's own panel puts its commit
  // button.
  const saveAll = vscode.commands.registerCommand("savepointDiff.saveAll", () => {
    return host.saveAllTracked();
  });

  // Bound to each gutter marker's hover "Revert this change" link (see
  // `DecorationManager.revertHoverFor` in decorations.ts), which passes
  // a `RevertChangeRef`. Also reachable from the Command Palette with no
  // argument, in which case the host falls back to the change at the
  // active editor's cursor.
  const revertChange = vscode.commands.registerCommand(
    "savepointDiff.revertChange",
    (ref?: RevertChangeRef | [RevertChangeRef]) => {
      const normalizedRef = Array.isArray(ref) ? ref[0] : ref;
      return host.revertChange(normalizedRef);
    }
  );

  const createSavepoint = vscode.commands.registerCommand("savepointDiff.createSavepoint", () => {
    host.createSavepoint();
  });

  const saveSnapshot = vscode.commands.registerCommand("savepointDiff.saveSnapshot", () => {
    return host.saveSnapshot();
  });

  const restoreSnapshot = vscode.commands.registerCommand("savepointDiff.restoreSnapshot", () => {
    return host.restoreSnapshot();
  });

  context.subscriptions.push(
    toggle,
    refresh,
    clear,
    saveDocument,
    saveAll,
    revertChange,
    createSavepoint,
    saveSnapshot,
    restoreSnapshot,
    statusBarItem
  );
  return statusBarItem;
}

/**
 * Renders the status bar's ON/OFF label and, when `summary` is given and
 * enabled, appends a live `+added ~modified -deleted` count for the
 * active file — e.g. `$(diff) SavePoint: ON  +12 ~4 -2`. Omitting
 * `summary` (or passing one whose counts are all zero) falls back to the
 * bare label, matching the original behavior for a disabled extension or
 * an unchanged file.
 */
export function updateStatusBarItem(item: vscode.StatusBarItem, enabled: boolean, summary?: ChangeSummary): void {
  const base = enabled ? "$(diff) SavePoint: ON" : "$(circle-slash) SavePoint: OFF";
  const hasCounts = enabled && !!summary && (summary.added > 0 || summary.modified > 0 || summary.deletedLines > 0);

  if (!hasCounts) {
    item.text = base;
    item.tooltip = "Click to toggle SavePoint Diff";
    return;
  }

  item.text = `${base}  +${summary!.added} ~${summary!.modified} -${summary!.deletedLines}`;
  item.tooltip = `Click to toggle SavePoint Diff\nActive file since baseline: +${summary!.added} added, ~${summary!.modified} modified, -${summary!.deletedLines} deleted`;
}
