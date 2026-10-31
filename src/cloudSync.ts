/**
 * SavePoint Diff - Cloud Sync
 *
 * Optional, rclone-backed alternative to GitHub: on save, only changed
 * files of the project folder are synced to a cloud remote, and a
 * `.savepoint/history.json` log (kept in the cloud copy, like `.git`)
 * records what changed. Disabled by default; no credentials are stored
 * here (auth lives in the user's rclone config).
 */

// Created and maintained by Ashish Sharma (Stay Elite).
// Copyright (c) 2026 Ashish Sharma (Stay Elite)
// Licensed under the MIT License. See the LICENSE file for details.

import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { createReadStream, promises as fsp } from "fs";
import { debounce } from "./utils";

const SECTION = "savepointDiff.cloud";
const STATE_KEY = "savepointDiff.cloud.state";
const SAVEPOINT_DIR = ".savepoint"; // never uploaded as a normal file
const LOG_PATH = `${SAVEPOINT_DIR}/history.json`;
const REMOTE_RE = /^(?!-)[\w.+@-]+:[^\0-\x1f]*$/; // rclone "name:path"
const CHUNK = 100;
const MAX_LISTED = 50;
const SYNC_DELAY_MS = 2000;
const NOT_FOUND = [3, 4]; // rclone exit codes: directory / file not found

interface FileInfo { size: number; mtime: number; hash: string }
interface Entry { timestamp: string; changes: string[]; summary: string }
interface Log { project: string; savepoints: Array<Entry & { id: string }> }
interface State { root: string; remote: string; files: Record<string, FileInfo>; pending: Entry[] }
type RcloneError = Error & { code?: number };

/** Runs rclone with an args array (no shell); `input` goes to stdin. */
function rclone(bin: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["--ask-password=false", ...args]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.stdin.on("error", () => undefined);
    proc.on("error", (e) => reject(new Error(`Cannot run rclone ("${bin}"): ${e.message}`)));
    proc.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(Object.assign(new Error(err.trim().slice(-300) || `rclone exited with ${code}`), { code }))
    );
    proc.stdin.end(input);
  });
}

const hashFile = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });

const destOf = (remote: string, rel: string): string => `${remote.replace(/\/+$/, "")}${remote.endsWith(":") ? "" : "/"}${rel}`;

/** Builds a short human summary, e.g. "Updated app.js; added 5 files." */
function summarize(a: string[], m: string[], d: string[]): string {
  const parts = ([["updated", m], ["added", a], ["deleted", d]] as Array<[string, string[]]>)
    .filter(([, l]) => l.length)
    .map(([v, l]) => `${v} ${l.length > 3 ? `${l.length} files` : l.map((r) => path.posix.basename(r)).join(", ")}`)
    .join("; ");
  return parts.charAt(0).toUpperCase() + parts.slice(1) + ".";
}

export class CloudSync implements vscode.Disposable {
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private again = false;
  private fails = 0;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.status.command = "savepointDiff.cloud.syncNow";
    ctx.subscriptions.push(
      this,
      vscode.commands.registerCommand("savepointDiff.cloud.connect", () => this.connect()),
      vscode.commands.registerCommand("savepointDiff.cloud.uploadFolder", () => this.uploadFolder()),
      vscode.commands.registerCommand("savepointDiff.cloud.syncNow", () => this.syncNow()),
      vscode.commands.registerCommand("savepointDiff.cloud.history", () => this.history()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(SECTION) && this.show("idle"))
    );
    this.show("idle");
  }

  public dispose(): void {
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    this.status.dispose();
  }

  private cfg = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(SECTION);
  private enabled = (): boolean => this.cfg().get<boolean>("enabled", false);
  private bin = (): string => this.cfg().get<string>("rclonePath", "rclone");
  private remote = (): string => this.cfg().get<string>("remote", "").trim();
  private validRemote = (): boolean => REMOTE_RE.test(this.remote());

  private show(label: string, tip = "Click to sync now"): void {
    if (!this.enabled()) {
      this.status.hide();
      return;
    }
    this.status.text = `$(cloud) Cloud: ${label}`;
    this.status.tooltip = tip;
    this.status.show();
  }

  /** Called from the extension's save hook; debounced, only for files inside the synced root. */
  public onSaved(doc: vscode.TextDocument): void {
    if (!this.enabled() || !this.cfg().get<boolean>("autoSyncOnSave", true) || doc.uri.scheme !== "file") {
      return;
    }
    const root = this.ctx.workspaceState.get<State>(STATE_KEY)?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const rel = root ? path.relative(root, doc.uri.fsPath) : "..";
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return;
    }
    this.timer = debounce(this.timer, SYNC_DELAY_MS, () => void this.sync());
  }

  /** Serialized sync: a save during a running sync just queues one more pass. */
  private async sync(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    clearTimeout(this.retry);
    this.show("syncing");
    try {
      do {
        this.again = false;
        await this.run();
      } while (this.again);
      this.fails = 0;
      this.show("synced");
    } catch (e) {
      const msg = (e as Error).message;
      this.show("error", msg);
      if (this.fails === 0) {
        void vscode.window.showWarningMessage(`SavePoint Diff cloud sync failed (will retry): ${msg}`);
      }
      this.retry = setTimeout(() => void this.sync(), Math.min(60000 * 2 ** this.fails++, 600000));
    } finally {
      this.busy = false;
    }
  }

  private async run(): Promise<void> {
    const remote = this.remote();
    if (!REMOTE_RE.test(remote)) {
      throw new Error("Invalid savepointDiff.cloud.remote (expected name:path).");
    }
    const bin = this.bin();
    const saved = this.ctx.workspaceState.get<State>(STATE_KEY);
    const root = saved?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      throw new Error("Open a folder first.");
    }
    const st: State = saved && saved.remote === remote ? saved : { root, remote, files: {}, pending: [] };
    const first = Object.keys(st.files).length === 0;

    // Diff the folder against the manifest of what is already in the cloud.
    const cur = await this.scan(root, st.files);
    const added: string[] = [];
    const modified: string[] = [];
    for (const [rel, info] of Object.entries(cur)) {
      const old = st.files[rel];
      if (!old) {
        added.push(rel);
      } else if (old.hash !== info.hash) {
        modified.push(rel);
      } else {
        st.files[rel] = info; // touched but identical: no upload, no savepoint
      }
    }
    const deleted = Object.keys(st.files).filter((rel) => !cur[rel]);

    // Transfer in chunks; the manifest only advances for chunks that succeeded.
    const done = new Set<string>();
    let failure: unknown;
    const each = async (list: string[], args: string[], onOk: (rel: string) => void): Promise<void> => {
      for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        await rclone(bin, args, chunk.join("\n"));
        chunk.forEach((rel) => {
          done.add(rel);
          onOk(rel);
        });
      }
    };
    try {
      await each([...added, ...modified], ["copy", root, remote, "--files-from-raw", "-"], (rel) => (st.files[rel] = cur[rel]));
      await each(deleted, ["delete", remote, "--files-from-raw", "-"], (rel) => delete st.files[rel]);
      if (deleted.length) {
        await rclone(bin, ["rmdirs", remote, "--leave-root"]).catch(() => undefined); // tidy empty folders, best effort
      }
    } catch (e) {
      failure = e;
    }

    // Record exactly what was synced; skipped entirely when nothing changed.
    const ok = (l: string[]): string[] => l.filter((rel) => done.has(rel));
    const [a, m, d] = [ok(added), ok(modified), ok(deleted)];
    const changes = [...a.map((r) => `Added ${r}`), ...m.map((r) => `Updated ${r}`), ...d.map((r) => `Deleted ${r}`)];
    if (changes.length) {
      st.pending.push({
        timestamp: new Date().toISOString(),
        changes: changes.length > MAX_LISTED ? [...changes.slice(0, MAX_LISTED), `...and ${changes.length - MAX_LISTED} more`] : changes,
        summary: first ? `Initial upload: ${a.length} files.` : summarize(a, m, d),
      });
    }
    await this.ctx.workspaceState.update(STATE_KEY, st); // persist before touching the log, so an interruption can resume
    if (failure) {
      throw failure;
    }
    await this.flushLog(st, bin);
  }

  /** Appends pending entries to the cloud `.savepoint/history.json`, never overwriting a log it cannot parse. */
  private async flushLog(st: State, bin: string): Promise<void> {
    if (!st.pending.length) {
      return;
    }
    const log = await this.readLog(bin, st.remote, path.basename(st.root));
    st.pending.forEach((e) => log.savepoints.push({ id: `sp_${String(log.savepoints.length + 1).padStart(3, "0")}`, ...e }));
    await rclone(bin, ["rcat", destOf(st.remote, LOG_PATH)], JSON.stringify(log, null, 2));
    st.pending = [];
    await this.ctx.workspaceState.update(STATE_KEY, st);
  }

  private async readLog(bin: string, remote: string, project: string): Promise<Log> {
    let text = "";
    try {
      text = await rclone(bin, ["cat", destOf(remote, LOG_PATH)]);
    } catch (e) {
      if (!NOT_FOUND.includes((e as RcloneError).code ?? -1)) {
        throw e;
      }
    }
    if (!text.trim()) {
      return { project, savepoints: [] };
    }
    try {
      const log = JSON.parse(text) as Log;
      if (Array.isArray(log.savepoints)) {
        return log;
      }
    } catch {
      // fall through to the error below
    }
    throw new Error(`${LOG_PATH} in the cloud is unreadable; left untouched.`);
  }

  /** Walks the folder (skipping excludes and symlinks), re-hashing only files whose size/mtime changed. */
  private async scan(root: string, prev: Record<string, FileInfo>): Promise<Record<string, FileInfo>> {
    const skip = this.cfg()
      .get<string[]>("exclude", [])
      .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
    const out: Record<string, FileInfo> = {};
    const walk = async (dir: string): Promise<void> => {
      for (const e of await fsp.readdir(path.join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.name === SAVEPOINT_DIR || skip.some((re) => re.test(e.name))) {
          continue;
        }
        if (e.isDirectory()) {
          await walk(rel);
        } else if (e.isFile()) {
          const abs = path.join(root, rel);
          const st = await fsp.stat(abs);
          const old = prev[rel];
          out[rel] = old && old.size === st.size && old.mtime === st.mtimeMs ? old : { size: st.size, mtime: st.mtimeMs, hash: await hashFile(abs) };
        }
      }
    };
    await walk("");
    return out;
  }

  private async syncNow(): Promise<void> {
    if (!this.enabled() || !this.validRemote()) {
      void vscode.window.showInformationMessage("SavePoint Diff: run 'Cloud: Connect Storage' first.");
      return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "SavePoint Diff: syncing to cloud…" }, () => this.sync());
  }

  private async connect(): Promise<void> {
    const remote = await vscode.window.showInputBox({
      prompt: "rclone remote and folder, e.g. mydrive:projects/myapp (set up with `rclone config`)",
      value: this.remote(),
      validateInput: (v) => (REMOTE_RE.test(v.trim()) ? undefined : "Use the form name:path"),
    });
    if (!remote) {
      return;
    }
    try {
      await rclone(this.bin(), ["mkdir", remote.trim()]); // also proves the remote is writable
    } catch (e) {
      void vscode.window.showErrorMessage(`SavePoint Diff: cannot reach "${remote}": ${(e as Error).message}`);
      return;
    }
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await this.cfg().update("remote", remote.trim(), target);
    await this.cfg().update("enabled", true, target);
    void vscode.window.showInformationMessage("SavePoint Diff: cloud storage connected. Use 'Cloud: Upload Project Folder' to start.");
  }

  private async uploadFolder(): Promise<void> {
    if (!this.validRemote()) {
      await this.connect();
    }
    if (!this.enabled() || !this.validRemote()) {
      return;
    }
    const [pick] =
      (await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        openLabel: "Upload this folder",
      })) ?? [];
    if (!pick) {
      return;
    }
    const excluded = this.cfg().get<string[]>("exclude", []).join(", ");
    const ok = await vscode.window.showWarningMessage(
      `Upload "${pick.fsPath}" to ${this.remote()}? Excluded: ${excluded || "nothing"}.`,
      { modal: true },
      "Upload"
    );
    if (ok !== "Upload") {
      return;
    }
    const fresh: State = { root: pick.fsPath, remote: this.remote(), files: {}, pending: [] };
    await this.ctx.workspaceState.update(STATE_KEY, fresh);
    await this.syncNow();
  }

  private async history(): Promise<void> {
    if (!this.enabled() || !this.validRemote()) {
      void vscode.window.showInformationMessage("SavePoint Diff: cloud storage is not connected.");
      return;
    }
    try {
      const root = this.ctx.workspaceState.get<State>(STATE_KEY)?.root ?? "";
      const log = await this.readLog(this.bin(), this.remote(), path.basename(root));
      if (!log.savepoints.length) {
        void vscode.window.showInformationMessage("SavePoint Diff: no savepoints in the cloud yet.");
        return;
      }
      const items = [...log.savepoints].reverse().map((s) => ({
        label: `$(history) ${s.id}  ${s.summary}`,
        description: new Date(s.timestamp).toLocaleString(),
        detail: s.changes.join(" • "),
        s,
      }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: `Savepoints for ${log.project} (newest first)`, matchOnDetail: true });
      if (pick) {
        void vscode.window.showInformationMessage(`${pick.s.id} — ${new Date(pick.s.timestamp).toLocaleString()}`, { modal: true, detail: pick.s.changes.join("\n") });
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`SavePoint Diff: could not read history: ${(e as Error).message}`);
    }
  }
}
