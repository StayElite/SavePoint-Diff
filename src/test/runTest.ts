// Minimal mock for vscode module during standalone node testing
const mockVscode = {
  EventEmitter: class {
    private listeners: Function[] = [];
    public event = (fn: Function) => {
      this.listeners.push(fn);
      return { dispose: () => {} };
    };
    public fire(data: any) {
      this.listeners.forEach((l) => l(data));
    }
    public dispose() {
      this.listeners = [];
    }
  },
  Uri: {
    parse: (str: string) => {
      const parts = str.split(":");
      return { scheme: parts[0], path: parts.slice(1).join(":"), toString: () => str };
    },
    from: (components: any) => ({
      scheme: components.scheme,
      path: components.path,
      query: components.query,
      toString: () => `${components.scheme}://${components.path}?${components.query}`,
    }),
  },
};

const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (path: string) {
  if (path === "vscode") {
    return mockVscode;
  }
  return originalRequire.apply(this, arguments);
};

import * as assert from "assert";
import { computeDiff } from "../diffEngine";
import { clampLine, byteLength, isUntitled, isDiffableDocument, BASELINE_SCHEME, SNAPSHOT_SCHEME } from "../utils";
import { SnapshotManager, parseSnapshotUri, snapshotUriFor } from "../snapshotManager";

function runTests() {
  console.log("Running unit tests...");

  // computeDiff
  assert.deepStrictEqual(computeDiff("line1\nline2\n", "line1\nline2\n"), []);
  
  const add = computeDiff("", "line1\nline2\n");
  assert.strictEqual(add.length, 1);
  assert.strictEqual(add[0].type, "added");
  assert.strictEqual(add[0].startLine, 0);
  assert.strictEqual(add[0].endLine, 1);

  const del = computeDiff("line1\nline2\n", "");
  assert.strictEqual(del.length, 1);
  assert.strictEqual(del[0].type, "deleted");
  assert.strictEqual(del[0].startLine, 0);

  // CRLF & lone CR
  assert.deepStrictEqual(computeDiff("a\r\nb\r\n", "a\nb\n"), []);
  assert.deepStrictEqual(computeDiff("a\rb\r", "a\nb\n"), []);

  // Clamping
  const dummyDoc = { lineCount: 10 } as any;
  assert.strictEqual(clampLine(-5, dummyDoc), 0);
  assert.strictEqual(clampLine(4, dummyDoc), 4);
  assert.strictEqual(clampLine(15, dummyDoc), 9);

  const emptyDoc = { lineCount: 0 } as any;
  assert.strictEqual(clampLine(0, emptyDoc), 0);

  // UTF-8 byte length
  assert.strictEqual(byteLength("hello"), 5);
  assert.strictEqual(byteLength("✓"), 3);

  // Scheme checks
  const normalDoc = { uri: { scheme: "file" } } as any;
  const untitledDoc = { uri: { scheme: "untitled" } } as any;
  const outputDoc = { uri: { scheme: "output" } } as any;
  const baselineDoc = { uri: { scheme: BASELINE_SCHEME } } as any;
  const snapshotDoc = { uri: { scheme: SNAPSHOT_SCHEME } } as any;

  assert.strictEqual(isDiffableDocument(normalDoc), true);
  assert.strictEqual(isDiffableDocument(untitledDoc), true);
  assert.strictEqual(isUntitled(untitledDoc), true);
  assert.strictEqual(isDiffableDocument(outputDoc), false);
  assert.strictEqual(isDiffableDocument(baselineDoc), false);
  assert.strictEqual(isDiffableDocument(snapshotDoc), false);

  // SnapshotManager tests
  const testUri = { scheme: "file", path: "/test/file.ts", toString: () => "file:///test/file.ts" } as any;
  const sm = new SnapshotManager({ enabled: true, maxSnapshots: 2, autoSnapshotOnSave: true });
  
  const snap1 = sm.addSnapshot(testUri, "version 1", "first");
  assert.ok(snap1);
  assert.strictEqual(sm.getSnapshots(testUri).length, 1);
  assert.strictEqual(snap1?.label, "first");

  // Identical text deduplication
  const snap1dup = sm.addSnapshot(testUri, "version 1");
  assert.strictEqual(snap1dup?.id, snap1?.id);
  assert.strictEqual(sm.getSnapshots(testUri).length, 1);

  const snap2 = sm.addSnapshot(testUri, "version 2", "second");
  assert.ok(snap2);
  assert.strictEqual(sm.getSnapshots(testUri).length, 2);

  // maxSnapshots limit trimming (limit is 2, adding 3rd trims 1st)
  const snap3 = sm.addSnapshot(testUri, "version 3", "third");
  assert.ok(snap3);
  assert.strictEqual(sm.getSnapshots(testUri).length, 2);
  assert.strictEqual(sm.getSnapshots(testUri)[0].id, snap2?.id);
  assert.strictEqual(sm.getSnapshots(testUri)[1].id, snap3?.id);

  // Snapshot URI roundtrip
  const sUri = snapshotUriFor(testUri, snap3!.id);
  assert.strictEqual(sUri.scheme, SNAPSHOT_SCHEME);
  const parsed = parseSnapshotUri(sUri);
  assert.strictEqual(parsed?.snapshotId, snap3!.id);

  // Sorting descending logic for multi-target reverts
  const targets = [
    { type: "added" as const, startLine: 1, endLine: 2 },
    { type: "modified" as const, startLine: 5, endLine: 6 },
    { type: "deleted" as const, startLine: 3, endLine: 3 },
  ];
  const sorted = [...targets].sort((a, b) => {
    if (b.startLine !== a.startLine) {
      return b.startLine - a.startLine;
    }
    return (b.endLine ?? b.startLine) - (a.endLine ?? a.startLine);
  });
  assert.strictEqual(sorted[0].startLine, 5);
  assert.strictEqual(sorted[1].startLine, 3);
  assert.strictEqual(sorted[2].startLine, 1);

  console.log("All unit tests passed successfully!");
}

runTests();
