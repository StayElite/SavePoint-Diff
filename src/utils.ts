/**
 * SavePoint Diff - Utilities
 *
 * Small shared helpers: document-key generation, untitled/diffable
 * document checks, debouncing, line clamping, and byte-length checks
 * used against the maxFileSize setting.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";

/**
 * Custom URI scheme used for the read-only "baseline" (last-saved)
 * side of a diff. Defined here rather than in scmProvider.ts so that
 * `isDiffableDocument` below can reference it without creating a
 * circular import (scmProvider imports from this module).
 */
export const BASELINE_SCHEME = "savepoint-diff-baseline";
export const SNAPSHOT_SCHEME = "savepoint-diff-snapshot";

/**
 * Returns a stable string key for a document, per the VS Code-recommended
 * pattern of using the URI's string form as an identifier.
 */
export function keyFor(uri: vscode.Uri): string {
  return uri.toString();
}

/**
 * True if the document is a brand new, never-saved-to-disk buffer
 * ("Untitled-1", etc). Untitled documents get an empty baseline so that
 * everything typed shows up as "added" until the user does Save As.
 */
export function isUntitled(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "untitled";
}

/**
 * VS Code exposes many synthetic, read-only, or internal-tooling
 * documents as TextDocuments alongside real files — output channels,
 * the debug console, diff/search-editor views, walkthroughs, webview
 * text models, etc. None of these represent something a user "saves"
 * in the sense this extension cares about, so they're excluded by
 * scheme.
 *
 * Deliberately a blocklist rather than an allowlist of just
 * "file"/"untitled": a real user-editable document can appear under
 * many other URI schemes depending on the environment — "vscode-remote"
 * (Remote-SSH / Dev Containers / WSL), "vscode-vfs" (Remote
 * Repositories, vscode.dev / github.dev), "sftp", and others
 * contributed by other extensions. An allowlist would leave this
 * extension silently doing nothing in every one of those environments;
 * a blocklist degrades gracefully to "probably fine" for schemes this
 * list doesn't yet know about.
 */
const NON_DIFFABLE_SCHEMES = new Set([
  "output",
  "debug",
  "vscode",
  "vscode-settings",
  "vscode-userdata",
  "vscode-notebook-cell",
  "vscode-scm",
  "vscode-terminal",
  "git",
  "gitfs",
  "conflictResolution",
  "comment",
  "search-editor",
  "walkThrough",
  "walkThroughSnippet",
  "extension-output",
  "markdown-preview",
  "webview-panel",
  "chat-editing-snapshot-text-model",
  BASELINE_SCHEME,
  SNAPSHOT_SCHEME,
]);

/**
 * True if this document is one whose unsaved changes are worth
 * tracking — see `NON_DIFFABLE_SCHEMES` above for what's excluded and
 * why.
 */
export function isDiffableDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme === "untitled") {
    return true;
  }
  return !NON_DIFFABLE_SCHEMES.has(document.uri.scheme);
}

/**
 * A trivial trailing-edge debouncer, keyed by an external timer handle
 * that the caller owns (so it can be cancelled independently per document).
 */
export function debounce(
  existingTimer: ReturnType<typeof setTimeout> | undefined,
  delayMs: number,
  fn: () => void
): ReturnType<typeof setTimeout> {
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  return setTimeout(fn, delayMs);
}

/** Clamp a line number into the valid [0, lineCount - 1] range for a document. */
export function clampLine(line: number, document: vscode.TextDocument): number {
  if (document.lineCount === 0) {
    return 0;
  }
  return Math.max(0, Math.min(line, document.lineCount - 1));
}

/** Byte length of a string's UTF-8 encoding, used against maxFileSize. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
