/**
 * SavePoint Diff - Types
 *
 * Shared type definitions used across the diff engine, baseline
 * tracking, and decoration/SCM layers.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";

/**
 * The kind of change a DiffChange represents.
 */
export type ChangeType = "added" | "modified" | "deleted";

/**
 * A single contiguous change between the saved baseline and the current
 * in-memory document content, expressed in terms of 0-based line numbers.
 *
 * - "added":    lines [startLine, endLine] exist only in the current document.
 * - "modified": lines [startLine, endLine] exist in the current document and
 *               replace lines [originalStartLine, originalEndLine] from the
 *               baseline.
 * - "deleted":  no current lines exist for this change. startLine/endLine
 *               instead mark the current-document anchor line where the
 *               deletion marker should be rendered (a zero-width range),
 *               and originalStartLine/originalEndLine describe how many
 *               baseline lines were removed at that point.
 */
export interface DiffChange {
  type: ChangeType;
  startLine: number;
  endLine: number;
  originalStartLine?: number;
  originalEndLine?: number;
}

/**
 * Per-document bookkeeping the extension keeps while it is active.
 */
export interface DocumentState {
  /** Debounce timer handle for pending recalculation, if any. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Cancellation token source for any in-flight background operation
   * (e.g. on-disk baseline reconciliation). Cancelled when the document
   * closes or a new operation supersedes it.
   */
  cts?: vscode.CancellationTokenSource;
}
