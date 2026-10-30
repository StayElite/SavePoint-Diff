/**
 * SavePoint Diff - Source Control Integration
 *
 * Adds a "SavePoint Diff" entry to VS Code's built-in Source Control
 * panel, a virtual read-only content provider for the last-saved
 * baseline (used as the "old" side of a full diff view opened via
 * `vscode.diff`), and an "M" file-decoration badge for modified files -
 * all without using Git.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";
import { BaselineManager } from "./baselineManager";
import { keyFor, BASELINE_SCHEME } from "./utils";

/**
 * Custom URI scheme used for the read-only "baseline" (last-saved)
 * side of a diff. Defined in utils.ts (so `isDiffableDocument` can
 * reference it without a circular import) and re-exported here, where
 * consumers naturally look for it.
 */
export { BASELINE_SCHEME };

/**
 * Builds the virtual URI that represents "the baseline content of
 * `uri`", preserving the original path (so the diff editor still gets
 * the right file extension for syntax highlighting and a sensible tab
 * title) while stashing the real URI in the query string so the content
 * provider can look the baseline back up.
 */
export function baselineUriFor(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.from({
    scheme: BASELINE_SCHEME,
    path: uri.path,
    query: uri.toString(),
  });
}

function originalUriFrom(baselineUri: vscode.Uri): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(baselineUri.query, true);
  } catch {
    return undefined;
  }
}

/**
 * Serves the last-saved baseline text as a read-only virtual document,
 * so it can be used as the "left side" of a normal VS Code diff editor
 * (via the built-in `vscode.diff` command) — exactly the same mechanism
 * Git's "Open Changes" uses, just pointed at our in-memory baseline
 * instead of a Git object.
 */
export class BaselineContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly baselines: BaselineManager) {}

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const original = originalUriFrom(uri);
    if (!original) {
      return "";
    }
    return this.baselines.get(original);
  }

  /**
   * Notifies any currently-open diff editor for `uri` that the baseline
   * changed (e.g. right after a save), so it refreshes instead of
   * showing stale content.
   */
  public refresh(uri: vscode.Uri): void {
    this.changeEmitter.fire(baselineUriFor(uri));
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

function basenameOf(uri: vscode.Uri): string {
  const segments = uri.path.split(/[\\/]/);
  return segments[segments.length - 1] || uri.path;
}

/**
 * A Source Control panel entry ("SavePoint Diff") listing every open
 * document that currently differs from its saved baseline — mirroring
 * how Git's own Source Control panel lists modified files. Clicking an
 * entry opens the same kind of split old-vs-current diff editor Git
 * uses for "Open Changes", via the built-in `vscode.diff` command,
 * except the "old" side is our virtual baseline and the "new" side is
 * the real, live (editable) document — so unsaved keystrokes show up
 * immediately, without needing to save first.
 */
export class LiveDiffSourceControl implements vscode.Disposable {
  private readonly sourceControl: vscode.SourceControl;
  private readonly group: vscode.SourceControlResourceGroup;
  private readonly resourceStates = new Map<string, vscode.SourceControlResourceState>();

  constructor(private readonly baselines: BaselineManager) {
    this.sourceControl = vscode.scm.createSourceControl("savepointDiff", "SavePoint Diff");
    this.group = this.sourceControl.createResourceGroup("unsaved", "Unsaved Changes");
    this.group.hideWhenEmpty = true;

    // Every SourceControl gets a Git-style commit-message input box by
    // default, whether or not it's used. This extension has no
    // "commit" concept (no `acceptInputCommand` is ever set), so the
    // box would just sit there empty and unclickable — hide it so the
    // panel only shows what's actually actionable.
    this.sourceControl.inputBox.visible = false;

    // Enables VS Code's built-in "quick diff" affordances (e.g. the
    // small diff indicator/hover some views offer) to resolve against
    // our baseline too. In a Git repository, Git's own quick-diff
    // provider is typically what actually drives the editor gutter —
    // this extension's own gutter decorations (added/modified/deleted)
    // are what guarantee the live markers regardless of Git being
    // present, so this is purely an additive nicety, not load-bearing.
    this.sourceControl.quickDiffProvider = {
      provideOriginalResource: (uri: vscode.Uri) => {
        if (!this.baselines.has(uri)) {
          return undefined;
        }
        return baselineUriFor(uri);
      },
    };
  }

  /** Adds, updates, or removes `document`'s entry based on whether it currently has unsaved changes. */
  public setHasChanges(document: vscode.TextDocument, hasChanges: boolean): void {
    const key = keyFor(document.uri);
    if (!hasChanges) {
      if (this.resourceStates.delete(key)) {
        this.render();
      }
      return;
    }

    const name = basenameOf(document.uri);
    const state: vscode.SourceControlResourceState = {
      resourceUri: document.uri,
      command: {
        command: "vscode.diff",
        title: "Open Unsaved Changes",
        arguments: [baselineUriFor(document.uri), document.uri, `${name} (Unsaved Changes)`],
      },
      decorations: {
        tooltip: "Has unsaved changes since last save",
      },
      // Lets menu contributions (see the "savepointDiff.saveDocument"
      // inline save button in package.json) target specifically these
      // resource states via a `when` clause, rather than any resource
      // state any SCM provider might ever show.
      contextValue: "savepointDiff.unsavedFile",
    };
    this.resourceStates.set(key, state);
    this.render();
  }

  public removeDocument(uri: vscode.Uri): void {
    if (this.resourceStates.delete(keyFor(uri))) {
      this.render();
    }
  }

  public clearAll(): void {
    if (this.resourceStates.size > 0) {
      this.resourceStates.clear();
      this.render();
    }
  }

  /**
   * URIs of every document currently listed under "Unsaved Changes",
   * in display order. Used to implement the panel's "Save All" toolbar
   * button (`savepointDiff.saveAll`), which needs to know which
   * documents to save without the caller having to track that itself.
   */
  public getTrackedUris(): vscode.Uri[] {
    return Array.from(this.resourceStates.values(), (state) => state.resourceUri);
  }

  private render(): void {
    this.group.resourceStates = Array.from(this.resourceStates.values());
    this.sourceControl.count = this.resourceStates.size;
  }

  public dispose(): void {
    this.group.dispose();
    this.sourceControl.dispose();
  }
}

/**
 * Adds the small "M" badge VS Code shows next to modified files (in the
 * Explorer and on editor tabs) — the same visual language Git uses —
 * for any document that currently has unsaved changes tracked by this
 * extension.
 */
export class LiveDiffFileDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  public readonly onDidChangeFileDecorations = this.changeEmitter.event;

  private readonly changed = new Set<string>();

  public setHasChanges(uri: vscode.Uri, hasChanges: boolean): void {
    const key = keyFor(uri);
    const was = this.changed.has(key);
    if (hasChanges === was) {
      return;
    }
    if (hasChanges) {
      this.changed.add(key);
    } else {
      this.changed.delete(key);
    }
    this.changeEmitter.fire(uri);
  }

  public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.changed.has(keyFor(uri))) {
      return undefined;
    }
    return {
      badge: "M",
      tooltip: "Unsaved changes (SavePoint Diff)",
      color: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
    };
  }

  /**
   * Clears every tracked badge, regardless of whether its document is
   * currently visible. Iterating only `vscode.window.visibleTextEditors`
   * (as the caller might otherwise do) would miss background/hidden
   * tabs that still have a badge from before — leaving a stale "M" badge
   * in the Explorer indefinitely after disabling the extension.
   */
  public clearAll(): void {
    if (this.changed.size === 0) {
      return;
    }
    const uris = Array.from(this.changed, (key) => vscode.Uri.parse(key, true));
    this.changed.clear();
    this.changeEmitter.fire(uris);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}
