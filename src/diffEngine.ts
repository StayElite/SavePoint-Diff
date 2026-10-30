/**
 * SavePoint Diff - Diff Engine
 *
 * The line-based diff engine used to compare a file's last-saved
 * baseline against its current, unsaved content - built on jsdiff's
 * Myers diff, with added/modified/deleted blocks synthesized on top
 * of jsdiff's raw added/removed chunks.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import { diffLines, Change } from "diff";
import { DiffChange } from "./types";

/**
 * Computes the set of changes needed to turn `original` (the saved
 * baseline) into `modified` (the current in-memory document), as a list
 * of line-oriented DiffChange blocks.
 *
 * Built on jsdiff's diffLines, which implements the classic Myers diff
 * algorithm over whole lines. jsdiff was chosen over a hand-rolled Myers/
 * LCS implementation because it is small (~20KB), has years of production
 * hardening across mixed line endings, unicode, and pathological inputs,
 * and is already a dependency of many editor tools including VS Code's
 * own ecosystem — re-implementing it from scratch would mostly reproduce
 * jsdiff with a higher chance of subtle correctness bugs, for no benefit
 * to this extension's actual goal (showing accurate unsaved-diff gutter
 * markers).
 *
 * jsdiff gives us a flat list of unchanged/added/removed chunks. A
 * "modified" line, from the user's point of view, is really just a
 * removed chunk immediately followed by an added chunk of about the same
 * size — jsdiff has no native concept of "modified", so we synthesize it
 * here by pairing up adjacent removed+added chunks.
 */
export function computeDiff(original: string, modified: string): DiffChange[] {
  if (original === modified) {
    return [];
  }

  // jsdiff's diffLines compares chunks as exact strings including
  // trailing newlines. Without normalizing, a final line that has no
  // trailing "\n" in one version but does in the other (because a line
  // was added/removed after it) is treated as a wholesale text
  // difference rather than "this line is unchanged" — e.g. deleting the
  // last line of "A\nB\nC" down to "A\nB" would otherwise misreport line
  // B as modified instead of correctly reporting only C as deleted.
  // `normalizeForDiff` appends a trailing newline (purely for comparison
  // purposes — it never touches the real baseline or document text) and
  // also normalizes CRLF ("\r\n") to LF ("\n"), so a line whose content
  // is unchanged doesn't get spuriously reported as "modified" purely
  // because of a differing trailing carriage return (e.g. after pasting
  // text copied from a source using the other line-ending style).
  const parts = diffLines(normalizeForDiff(original), normalizeForDiff(modified));
  const result: DiffChange[] = [];

  let originalLine = 0; // 0-based cursor into the baseline
  let currentLine = 0; // 0-based cursor into the current document

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const count = lineCountOf(part);

    if (!part.added && !part.removed) {
      originalLine += count;
      currentLine += count;
      continue;
    }

    if (part.removed) {
      const next = parts[i + 1];

      if (next && next.added) {
        // A removed block immediately followed by an added block is
        // treated as a "modified" region for the overlapping line count,
        // with any size difference spilling over into a pure add or
        // pure delete for the remainder.
        const removedCount = count;
        const addedCount = lineCountOf(next);
        const modifiedCount = Math.min(removedCount, addedCount);

        if (modifiedCount > 0) {
          result.push({
            type: "modified",
            startLine: currentLine,
            endLine: currentLine + modifiedCount - 1,
            originalStartLine: originalLine,
            originalEndLine: originalLine + modifiedCount - 1,
          });
        }

        if (addedCount > modifiedCount) {
          result.push({
            type: "added",
            startLine: currentLine + modifiedCount,
            endLine: currentLine + addedCount - 1,
          });
        }

        if (removedCount > modifiedCount) {
          // Extra deleted lines beyond what the replacement covers: anchor
          // the marker right after the replacement content, in the
          // current document.
          const anchor = currentLine + addedCount;
          result.push({
            type: "deleted",
            startLine: anchor,
            endLine: anchor,
            originalStartLine: originalLine + modifiedCount,
            originalEndLine: originalLine + removedCount - 1,
          });
        }

        originalLine += removedCount;
        currentLine += addedCount;
        i++; // the paired "added" chunk has been consumed
        continue;
      }

      // A pure deletion with nothing replacing it: anchor the marker at
      // the current line position (the line that now immediately follows
      // the gap left by the deleted content).
      result.push({
        type: "deleted",
        startLine: currentLine,
        endLine: currentLine,
        originalStartLine: originalLine,
        originalEndLine: originalLine + count - 1,
      });
      originalLine += count;
      continue;
    }

    // Pure addition (not part of a removed+added pair, e.g. brand new
    // content inserted where nothing was removed).
    result.push({
      type: "added",
      startLine: currentLine,
      endLine: currentLine + count - 1,
    });
    currentLine += count;
  }

  return result;
}

function ensureTrailingNewline(text: string): string {
  if (text.length === 0 || text.endsWith("\n")) {
    return text;
  }
  return text + "\n";
}

/**
 * Prepares text for the diff algorithm: ensures a trailing newline (see
 * the note in `computeDiff`) and normalizes CRLF and standalone CR to LF so differing
 * line-ending styles alone never produce a spurious "modified" line.
 * This is purely a comparison-time transform — the real baseline and
 * document text are never touched.
 */
function normalizeForDiff(text: string): string {
  return ensureTrailingNewline(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
}

/**
 * jsdiff sets `count` to the number of lines in a chunk for line-mode
 * diffs, but we fall back to counting newlines defensively in case that
 * ever changes across versions.
 */
function lineCountOf(part: Change): number {
  if (typeof part.count === "number") {
    return part.count;
  }
  if (part.value.length === 0) {
    return 0;
  }
  const matches = part.value.match(/\n/g);
  const newlineCount = matches ? matches.length : 0;
  // A trailing newline means the chunk ends exactly on a line boundary;
  // otherwise there's one more (partial) line after the last newline.
  return part.value.endsWith("\n") ? newlineCount : newlineCount + 1;
}
