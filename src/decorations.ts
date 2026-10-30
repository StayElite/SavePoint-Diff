/**
 * SavePoint Diff - Decorations
 *
 * Creates and owns the added/modified/deleted gutter decoration types
 * (icons, optional background highlight, overview ruler markers) and
 * applies them to every visible editor showing a given document,
 * including split editors and multiple editor groups.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";
import { DiffChange } from "./types";
import { clampLine } from "./utils";

export interface DecorationConfig {
  showAdded: boolean;
  showModified: boolean;
  showDeleted: boolean;
  showOverviewRuler: boolean;
  showBackgroundHighlight: boolean;
  /** Attach a "Revert this change" command link to each marker's hover. */
  enableRevertInHover: boolean;
}

/**
 * Owns the three gutter decoration types (added/modified/deleted) and
 * knows how to turn a list of DiffChange blocks into VS Code decoration
 * ranges for a given editor.
 *
 * Decoration types are recreated (disposed + rebuilt) whenever a setting
 * that affects their render options changes (overview ruler on/off,
 * background highlight on/off), since VS Code decoration render options
 * are fixed at creation time.
 */
export class DecorationManager implements vscode.Disposable {
  private addedType!: vscode.TextEditorDecorationType;
  private modifiedType!: vscode.TextEditorDecorationType;
  private deletedType!: vscode.TextEditorDecorationType;

  constructor(private readonly context: vscode.ExtensionContext, private config: DecorationConfig) {
    this.buildTypes();
  }

  /**
   * Applies a configuration change. `showAdded`/`showModified`/
   * `showDeleted` are only ever read at decoration-*application* time
   * (see `apply()`), so updating `this.config` is enough to pick those
   * up on the next recompute. `showOverviewRuler` and
   * `showBackgroundHighlight`, however, are baked into the decoration
   * types' fixed render options at *creation* time — VS Code has no
   * way to change those on an existing `TextEditorDecorationType` — so
   * those two (and only those two) require disposing and rebuilding
   * the types. Rebuilding unconditionally on every settings change
   * (including ones unrelated to decorations entirely, e.g.
   * `debounceMs`) would needlessly dispose/recreate every decoration
   * type and briefly flicker any currently-visible markers.
   */
  public updateConfig(config: DecorationConfig): void {
    const needsRebuild =
      config.showOverviewRuler !== this.config.showOverviewRuler ||
      config.showBackgroundHighlight !== this.config.showBackgroundHighlight;
    this.config = config;
    if (needsRebuild) {
      this.disposeTypes();
      this.buildTypes();
    }
  }

  private iconPath(name: "added" | "modified" | "deleted"): vscode.Uri {
    return vscode.Uri.file(this.context.asAbsolutePath(`resources/${name}.svg`));
  }

  private buildTypes(): void {
    const overviewLane = vscode.OverviewRulerLane.Left;

    this.addedType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.iconPath("added"),
      gutterIconSize: "contain",
      isWholeLine: this.config.showBackgroundHighlight,
      backgroundColor: this.config.showBackgroundHighlight
        ? new vscode.ThemeColor("diffEditor.insertedTextBackground")
        : undefined,
      overviewRulerLane: this.config.showOverviewRuler ? overviewLane : undefined,
      overviewRulerColor: this.config.showOverviewRuler
        ? new vscode.ThemeColor("editorOverviewRuler.addedForeground")
        : undefined,
    });

    this.modifiedType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.iconPath("modified"),
      gutterIconSize: "contain",
      isWholeLine: this.config.showBackgroundHighlight,
      backgroundColor: this.config.showBackgroundHighlight
        ? new vscode.ThemeColor("diffEditor.modifiedTextBackground")
        : undefined,
      overviewRulerLane: this.config.showOverviewRuler ? overviewLane : undefined,
      overviewRulerColor: this.config.showOverviewRuler
        ? new vscode.ThemeColor("editorOverviewRuler.modifiedForeground")
        : undefined,
    });

    this.deletedType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.iconPath("deleted"),
      gutterIconSize: "contain",
      // Deleted lines have no current-document text to highlight, so we
      // never apply a background here regardless of the setting — only
      // the gutter glyph and (optionally) the overview ruler tick mark.
      isWholeLine: false,
      overviewRulerLane: this.config.showOverviewRuler ? overviewLane : undefined,
      overviewRulerColor: this.config.showOverviewRuler
        ? new vscode.ThemeColor("editorOverviewRuler.deletedForeground")
        : undefined,
    });
  }

  private disposeTypes(): void {
    this.addedType.dispose();
    this.modifiedType.dispose();
    this.deletedType.dispose();
  }

  /**
   * Applies the given changes to every visible editor showing `document`
   * (handles split editors / multiple groups showing the same file).
   */
  public apply(document: vscode.TextDocument, changes: DiffChange[]): void {
    const added: vscode.DecorationOptions[] = [];
    const modified: vscode.DecorationOptions[] = [];
    // Deletion markers are zero-width and anchored to a current-document
    // line, so two distinct deleted blocks can legitimately clamp onto
    // the same anchor (e.g. deleting content at both the start and end
    // of a file that's now a single line). Grouped by anchor here (rather
    // than de-duplicated outright) so VS Code gets exactly one marker per
    // anchor while the hover for that marker can still offer a separate
    // "revert" link for each underlying deletion — reverting one
    // shouldn't silently revert or hide the other.
    const deletedByAnchor = new Map<number, number[]>();

    changes.forEach((change, index) => {
      if (change.type === "deleted") {
        const anchor = clampLine(change.startLine, document);
        const indices = deletedByAnchor.get(anchor);
        if (indices) {
          indices.push(index);
        } else {
          deletedByAnchor.set(anchor, [index]);
        }
        return;
      }

      const start = clampLine(change.startLine, document);
      const end = clampLine(change.endLine, document);
      // Extend to the actual end of the last line's text (rather than a
      // zero-width position at column 0) so the gutter icon and optional
      // background highlight unambiguously cover every line in the
      // block, including the last one, regardless of any edge-case
      // differences in how a given VS Code version resolves a decoration
      // range that ends exactly at column 0.
      const endPosition =
        document.lineCount > 0 ? document.lineAt(end).range.end : new vscode.Position(end, 0);
      const range = new vscode.Range(new vscode.Position(start, 0), endPosition);
      const options: vscode.DecorationOptions = {
        range,
        hoverMessage: this.config.enableRevertInHover ? this.revertHoverFor(document.uri, [index]) : undefined,
      };

      (change.type === "added" ? added : modified).push(options);
    });

    const deleted: vscode.DecorationOptions[] = Array.from(deletedByAnchor.entries(), ([anchor, indices]) => ({
      range: new vscode.Range(anchor, 0, anchor, 0),
      hoverMessage: this.config.enableRevertInHover ? this.revertHoverFor(document.uri, indices) : undefined,
    }));

    for (const editor of this.editorsFor(document)) {
      editor.setDecorations(this.addedType, this.config.showAdded ? added : []);
      editor.setDecorations(this.modifiedType, this.config.showModified ? modified : []);
      editor.setDecorations(this.deletedType, this.config.showDeleted ? deleted : []);
    }
  }

  /**
   * Builds the hover shown for a marker: one or more "Revert this change"
   * links, each a `command:savepointDiff.revertChange` URI carrying the
   * document's URI and the change's index into the last-computed change
   * list (see `lastChanges` in extension.ts) as its argument — that's
   * enough for the command handler to look the exact DiffChange back up
   * and undo just that block. `indices` has more than one entry only for
   * a deletion anchor shared by multiple distinct deleted blocks (see
   * `apply()` above); each gets its own link so they can be reverted
   * independently.
   *
   * `isTrusted = true` is required for VS Code to execute a `command:`
   * link from a hover at all — untrusted MarkdownStrings render command
   * links as inert text. This hover's content is entirely our own
   * (document URI + an index into our own array), never user-authored
   * text, so there's nothing here for that trust boundary to protect
   * against.
   */
  /**
   * Encodes a command link's JSON argument payload for use inside a
   * Markdown link target. `encodeURIComponent` deliberately leaves `(`
   * and `)` unescaped — they're valid "sub-delims" in a URI — but a
   * literal `)` inside a Markdown `[text](target)` link prematurely
   * closes the target, truncating (or outright breaking) the link. Any
   * document whose path contains a paren — "report (final).txt",
   * "Copy (1).js", a "Downloads (2)" folder, all common in the wild —
   * would otherwise produce a broken "Revert this change" link, so both
   * characters are escaped explicitly on top of `encodeURIComponent`.
   */
  private encodeCommandArgs(payload: unknown): string {
    return encodeURIComponent(JSON.stringify(payload)).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));
  }

  private revertHoverFor(uri: vscode.Uri, indices: number[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    const key = uri.toString();

    if (indices.length === 1) {
      const args = this.encodeCommandArgs([{ uri: key, indices: [indices[0]] }]);
      md.appendMarkdown(`[↺ Revert this change](command:savepointDiff.revertChange?${args})`);
      return md;
    }

    indices.forEach((changeIndex, n) => {
      const args = this.encodeCommandArgs([{ uri: key, indices: [changeIndex] }]);
      md.appendMarkdown(`[↺ Revert deletion ${n + 1} of ${indices.length}](command:savepointDiff.revertChange?${args})`);
      if (n < indices.length - 1) {
        md.appendMarkdown("  \n");
      }
    });
    return md;
  }

  /** Clears all three decoration types for every editor showing `document`. */
  public clear(document: vscode.TextDocument): void {
    for (const editor of this.editorsFor(document)) {
      editor.setDecorations(this.addedType, []);
      editor.setDecorations(this.modifiedType, []);
      editor.setDecorations(this.deletedType, []);
    }
  }

  /** Clears decorations across every currently visible editor. */
  public clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.addedType, []);
      editor.setDecorations(this.modifiedType, []);
      editor.setDecorations(this.deletedType, []);
    }
  }

  private editorsFor(document: vscode.TextDocument): vscode.TextEditor[] {
    const key = document.uri.toString();
    return vscode.window.visibleTextEditors.filter((e) => e.document.uri.toString() === key);
  }

  public dispose(): void {
    this.disposeTypes();
  }
}
