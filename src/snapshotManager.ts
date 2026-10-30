/**
 * SavePoint Diff - Snapshot Manager
 *
 * Provides Git/GitHub-like checkpoint snapshots allowing users to save
 * historical snapshots of their files (either manually or automatically on save),
 * view snapshot history, compare differences with current content or past snapshots,
 * and revert entire files or specific changes to any prior snapshot.
 *
 * Part of the SavePoint Diff project.
 * Docs: https://github.com/StayElite/SavePoint-Diff/blob/main/README.md
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";
import { keyFor, SNAPSHOT_SCHEME } from "./utils";

export { SNAPSHOT_SCHEME };

export interface Snapshot {
  id: string;
  timestamp: number;
  label?: string;
  text: string;
}

export interface SnapshotConfig {
  enabled: boolean;
  maxSnapshots: number;
  autoSnapshotOnSave: boolean;
}

export function snapshotUriFor(uri: vscode.Uri, snapshotId: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: SNAPSHOT_SCHEME,
    path: uri.path,
    query: JSON.stringify({ uri: uri.toString(), snapshotId }),
  });
}

export function parseSnapshotUri(snapshotUri: vscode.Uri): { uri: vscode.Uri; snapshotId: string } | undefined {
  try {
    const data = JSON.parse(snapshotUri.query);
    if (typeof data.uri === "string" && typeof data.snapshotId === "string") {
      return {
        uri: vscode.Uri.parse(data.uri, true),
        snapshotId: data.snapshotId,
      };
    }
  } catch {
    // Malformed URI query
  }
  return undefined;
}

export class SnapshotManager implements vscode.Disposable {
  private readonly snapshots = new Map<string, Snapshot[]>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChangeSnapshots = this.changeEmitter.event;

  constructor(private config: SnapshotConfig) {}

  public updateConfig(config: SnapshotConfig): void {
    this.config = config;
    if (this.config.maxSnapshots > 0) {
      // Trim any existing histories that exceed the new max limit
      for (const [key, list] of this.snapshots.entries()) {
        if (list.length > this.config.maxSnapshots) {
          this.snapshots.set(key, list.slice(-this.config.maxSnapshots));
        }
      }
    }
  }

  public getSnapshots(uri: vscode.Uri): readonly Snapshot[] {
    return this.snapshots.get(keyFor(uri)) ?? [];
  }

  public getSnapshot(uri: vscode.Uri, snapshotId: string): Snapshot | undefined {
    const list = this.snapshots.get(keyFor(uri));
    return list?.find((s) => s.id === snapshotId);
  }

  /**
   * Adds a new snapshot for a document. If content is identical to the most
   * recent snapshot, returns that existing snapshot instead of creating duplicates.
   */
  public addSnapshot(uri: vscode.Uri, text: string, label?: string): Snapshot | undefined {
    if (!this.config.enabled || this.config.maxSnapshots <= 0) {
      return undefined;
    }

    const key = keyFor(uri);
    let list = this.snapshots.get(key);
    if (!list) {
      list = [];
      this.snapshots.set(key, list);
    }

    // Deduplicate against the latest snapshot if content is identical
    if (list.length > 0 && list[list.length - 1].text === text) {
      if (label && !list[list.length - 1].label) {
        list[list.length - 1].label = label;
        this.changeEmitter.fire(uri);
      }
      return list[list.length - 1];
    }

    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const snapshot: Snapshot = {
      id,
      timestamp: Date.now(),
      label,
      text,
    };

    list.push(snapshot);
    if (list.length > this.config.maxSnapshots) {
      list.splice(0, list.length - this.config.maxSnapshots);
    }

    this.changeEmitter.fire(uri);
    return snapshot;
  }

  public delete(uri: vscode.Uri): void {
    if (this.snapshots.delete(keyFor(uri))) {
      this.changeEmitter.fire(uri);
    }
  }

  public rekey(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const oldKey = keyFor(oldUri);
    if (this.snapshots.has(oldKey)) {
      const list = this.snapshots.get(oldKey)!;
      this.snapshots.delete(oldKey);
      this.snapshots.set(keyFor(newUri), list);
      this.changeEmitter.fire(newUri);
    }
  }

  public clearAll(): void {
    this.snapshots.clear();
  }

  public dispose(): void {
    this.changeEmitter.dispose();
    this.snapshots.clear();
  }
}

/**
 * TextDocumentContentProvider for virtual snapshot documents, allowing split diff view
 * comparison between current content and any past snapshot.
 */
export class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly snapshotManager: SnapshotManager) {}

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const parsed = parseSnapshotUri(uri);
    if (!parsed) {
      return "";
    }
    const snap = this.snapshotManager.getSnapshot(parsed.uri, parsed.snapshotId);
    return snap?.text ?? "";
  }
}
