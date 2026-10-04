import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { resolvedOutputRoot } from "./config";
import { loadEngineModule } from "../engine/loader";
import { databaseKey } from "../security/lock";
import type { DbOverview, DbSearchRow, LegacyIndexStatus, MigrateResult } from "../../shared/types";

const DB_FILE_NAME = "media-index.sqlite";

type EngineDb = {
  path: string;
  stats: (o?: Record<string, number>) => Omit<DbOverview, "legacy" | "encrypted">;
  legacyStatus: (outRoot: string) => LegacyIndexStatus | null;
  importLegacy: (file: string, o?: { outRoot?: string; archive?: boolean }) => MigrateResult;
  verify: () => { checked: number; missing: number };
  pruneMissing: () => { removedFiles: number; removedKeys: number };
  seedFromDisk: (outRoot: string) => { scanned: number; added: number };
  compact: () => void;
  search: (q: string, limit?: number) => DbSearchRow[];
  backupTo: (dest: string) => string;
  flushNow: () => void;
};

type EngineDbModule = {
  openMediaDb: (p: string, o?: { key?: string | null }) => Promise<EngineDb>;
  flushAllMediaDbs: () => void;
  LEGACY_INDEX_NAME: string;
};

let lock: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}

export function mediaDbPath(): string {
  return path.join(app.getPath("userData"), DB_FILE_NAME);
}

async function engine(): Promise<EngineDbModule> {
  return loadEngineModule<EngineDbModule>("db/mediadb.js");
}

async function db(): Promise<EngineDb> {
  return (await engine()).openMediaDb(mediaDbPath(), { key: databaseKey() });
}

export function applyDbKey(): Promise<void> {
  return exclusive(async () => {
    await db();
  });
}

export async function dbOverview(): Promise<DbOverview> {
  const d = await db();
  const root = resolvedOutputRoot();
  return { ...d.stats(), encrypted: Boolean(databaseKey()), legacy: root ? d.legacyStatus(root) : null };
}

export function dbMigrateLegacy(file?: string): Promise<MigrateResult> {
  return exclusive(async () => {
    const d = await db();
    const mod = await engine();
    const root = resolvedOutputRoot();
    const target = file || (root ? path.join(root, mod.LEGACY_INDEX_NAME) : "");
    if (!target || !fs.existsSync(target)) throw new Error("No old index file found to migrate.");
    const outRoot = path.dirname(target);
    return d.importLegacy(target, { outRoot });
  });
}

export async function dbPickAndMigrate(win: BrowserWindow | null): Promise<MigrateResult | null> {
  const opts = {
    title: "Choose an old .media-hashes.json index",
    properties: ["openFile", "showHiddenFiles"] as Array<"openFile" | "showHiddenFiles">,
    filters: [{ name: "Legacy index", extensions: ["json", "migrated"] }]
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths[0]) return null;
  return dbMigrateLegacy(res.filePaths[0]);
}

export function dbVerify() {
  return exclusive(async () => (await db()).verify());
}

export function dbPruneMissing() {
  return exclusive(async () => (await db()).pruneMissing());
}

export function dbRescan() {
  return exclusive(async () => {
    const root = resolvedOutputRoot();
    if (!root || !fs.existsSync(root)) throw new Error("Output folder does not exist yet.");
    return (await db()).seedFromDisk(root);
  });
}

export function dbCompact() {
  return exclusive(async () => {
    (await db()).compact();
    return { ok: true };
  });
}

export async function dbSearch(q: string): Promise<DbSearchRow[]> {
  if (!String(q || "").trim()) return [];
  return (await db()).search(q, 60);
}

export async function dbBackup(win: BrowserWindow | null): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const opts = {
    title: "Save database backup",
    defaultPath: path.join(app.getPath("documents"), `media-index-${stamp}.sqlite`),
    filters: [{ name: "SQLite database", extensions: ["sqlite", "db"] }]
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  return exclusive(async () => (await db()).backupTo(res.filePath!));
}

export async function dbReveal(): Promise<void> {
  const d = await db();
  d.flushNow();
  shell.showItemInFolder(d.path);
}

export async function flushMediaDb(): Promise<void> {
  try {
    (await engine()).flushAllMediaDbs();
  } catch {}
}
