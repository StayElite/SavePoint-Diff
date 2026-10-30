/**
 * SavePoint Diff - Baseline Manager
 *
 * Tracks the last-saved "baseline" text for every open document, keyed
 * by URI, entirely in extension-host memory - no filesystem snapshots,
 * no Git objects. Establishes baselines on open, resets them on save,
 * and handles untitled files and on-disk renames.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";
import { keyFor, isUntitled } from "./utils";

/**
 * Owns the "savedBaseline" text for every document the extension is
 * currently tracking, keyed by `uri.toString()` as recommended for a
 * reliable document identifier.
 *
 * The baseline is intentionally just a plain string snapshot — no
 * filesystem snapshots, no Git objects, nothing persisted to disk. It
 * lives only in extension-host memory for the lifetime of the editor
 * session, exactly mirroring "the content that existed at the last
 * successful save".
 */
export class BaselineManager {
  private readonly baselines = new Map<string, string>();

  public has(uri: vscode.Uri): boolean {
    return this.baselines.has(keyFor(uri));
  }

  public get(uri: vscode.Uri): string {
    return this.baselines.get(keyFor(uri)) ?? "";
  }

  /** Unconditionally (re)establish the baseline, e.g. on save. */
  public set(uri: vscode.Uri, text: string): void {
    this.baselines.set(keyFor(uri), text);
  }

  /**
   * Establish a baseline only if one doesn't already exist, used when a
   * document is opened. Untitled documents get an empty baseline (per
   * spec: everything typed in a brand new file counts as "added" until
   * the user does Save As); regular files get their on-open content as
   * the baseline, since that content is by definition what's on disk.
   *
   * Returns true if the caller should follow up with
   * `reconcileWithDisk()` — see `needsDiskReconcile()` below.
   */
  public initialize(document: vscode.TextDocument): boolean {
    const uri = document.uri;
    if (this.has(uri)) {
      return false;
    }
    this.baselines.set(keyFor(uri), isUntitled(document) ? "" : document.getText());
    return this.needsDiskReconcile(document);
  }

  /**
   * True if this document's freshly-established baseline can't be
   * trusted and should be reconciled against the file on disk.
   *
   * VS Code's "hot exit" (on by default) restores unsaved changes when
   * a window reopens, so a document can already be dirty the very first
   * time this extension sees it. In that case `document.getText()` is
   * the *unsaved* content, not the last-saved content — using it as the
   * baseline would make the diff come out empty and silently hide every
   * change the user had in flight before restarting.
   */
  public needsDiskReconcile(document: vscode.TextDocument): boolean {
    return document.isDirty && !isUntitled(document);
  }

  /**
   * Replaces a provisional baseline with the file's real on-disk
   * content. Only meaningful for documents flagged by
   * `needsDiskReconcile()`.
   *
   * Uses `vscode.workspace.fs`, VS Code's own filesystem abstraction —
   * so this works over Remote-SSH, WSL, and virtual filesystems just as
   * it does locally, and it never writes, only reads. If the read fails
   * (file deleted on disk, permissions, an unreadable virtual FS), the
   * provisional baseline is kept: a possibly-empty diff is a far better
   * failure mode than a crash or a wall of bogus markers.
   *
   * Returns true if the baseline actually changed, so the caller knows
   * whether a recompute is worthwhile.
   */
  public async reconcileWithDisk(document: vscode.TextDocument, token?: vscode.CancellationToken): Promise<boolean> {
    const uri = document.uri;
    // Snapshot the provisional baseline this reconcile is meant to
    // replace, so the guard below can detect *any* intervening change to
    // it — not just the two specific cases (save, close) it used to
    // special-case explicitly.
    const provisional = this.get(uri);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (token?.isCancellationRequested) {
        return false;
      }
      const onDisk = Buffer.from(bytes).toString("utf8");
      if (provisional === onDisk) {
        return false;
      }
      // Guard against races: if something else already moved the
      // baseline on while this read was in flight, that newer state
      // wins over this now-stale disk snapshot. Comparing against the
      // exact `provisional` value (rather than just "still has *a*
      // baseline and is still dirty") is what matters here: a save also
      // happens to clear `document.isDirty`, which alone used to be
      // enough to catch that case, but creating a manual savepoint
      // deliberately does *not* touch `isDirty` — so a save is still
      // caught by the dirty check below, while a savepoint landing
      // mid-read is caught only by this direct value comparison. Without
      // it, a slow disk read could silently overwrite a just-created
      // savepoint with the stale original content moments later.
      if (!this.has(uri) || document.isClosed || !document.isDirty || this.get(uri) !== provisional) {
        return false;
      }
      this.baselines.set(keyFor(uri), onDisk);
      return true;
    } catch {
      return false;
    }
  }

  public delete(uri: vscode.Uri): void {
    this.baselines.delete(keyFor(uri));
  }

  /**
   * Carries a baseline over from one URI to another. Used for the
   * "Save As" transition: when an untitled buffer is saved to disk (or a
   * saved file is saved to a new path), VS Code represents this as a new
   * TextDocument with a new URI rather than renaming the old one in
   * place. In practice the newly opened document's initial content
   * already equals what was just written to disk, so `initialize` alone
   * handles this correctly — `rekey` exists as a defensive extra for any
   * host/version where the old URI's baseline might otherwise linger.
   */
  public rekey(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const oldKey = keyFor(oldUri);
    if (!this.baselines.has(oldKey)) {
      return;
    }
    const value = this.baselines.get(oldKey)!;
    this.baselines.delete(oldKey);
    this.baselines.set(keyFor(newUri), value);
  }

  public dispose(): void {
    this.baselines.clear();
  }
}
