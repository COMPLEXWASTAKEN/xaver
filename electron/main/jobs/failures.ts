import path from "node:path";
import { app, BrowserWindow } from "electron";
import type { FailedDownload, FailedState, FailReason, MediaItem } from "../../shared/types";
import { readSecureJson, writeSecureJson } from "../storage/secure-store";

const LIMIT = 1000;
const SAVE_DELAY_MS = 400;

let list: FailedDownload[] | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const retrying = new Set<string>();

function storePath(): string {
  return path.join(app.getPath("userData"), "failed-downloads.json");
}

function load(): FailedDownload[] {
  if (list) return list;
  try {
    const raw = readSecureJson<FailedDownload[]>(storePath());
    list = Array.isArray(raw) ? raw.filter((f) => f && typeof f.key === "string" && f.item?.url) : [];
  } catch {
    list = [];
  }
  return list;
}

export function flushFailures(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!list) return;
  try {
    writeSecureJson(storePath(), list);
  } catch {}
}

function changed(): void {
  if (!saveTimer) saveTimer = setTimeout(flushFailures, SAVE_DELAY_MS);
  const state = failureState();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("failures:changed", state);
  }
}

export function failureKey(item: Pick<MediaItem, "id" | "url">): string {
  return item.id || item.url;
}

export function classify(status: number, error: string): FailReason {
  if (status === 404 || status === 410) return "gone";
  if (status === 401 || status === 403) return "denied";
  if (status === 429) return "limited";
  if (/timed? ?out|timeout|ETIMEDOUT/i.test(error)) return "timeout";
  if (/HTML response|Not media/i.test(error)) return "notmedia";
  if (/ECONN|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|ERR_/i.test(error)) return "network";
  return "other";
}

function cleanError(error: string): string {
  return String(error || "Unknown error")
    .replace(/ for https?:\/\/\S+/g, "")
    .slice(0, 300);
}

export function failureState(): FailedState {
  return { items: [...load()], retrying: [...retrying] };
}

export function recordFailures(
  errors: { url: string; err: string; status?: number; item?: MediaItem }[],
  meta: { profile: string | null; runDir: string | null }
): number {
  if (!errors.length) return 0;
  const all = load();
  const now = Date.now();
  for (const e of errors) {
    const item: MediaItem = e.item ? { ...e.item } : { url: e.url, kind: "image" };
    delete item.localPath;
    delete item.rel;
    delete item.sha256;
    const key = failureKey(item);
    const status = Number(e.status) || 0;
    const prev = all.findIndex((f) => f.key === key);
    const entry: FailedDownload = {
      key,
      item,
      profile: meta.profile,
      runDir: meta.runDir,
      reason: classify(status, e.err),
      error: cleanError(e.err),
      status,
      attempts: prev >= 0 ? all[prev].attempts + 1 : 1,
      firstFailedAt: prev >= 0 ? all[prev].firstFailedAt : now,
      lastFailedAt: now
    };
    if (prev >= 0) all.splice(prev, 1);
    all.unshift(entry);
  }
  if (all.length > LIMIT) all.length = LIMIT;
  changed();
  return errors.length;
}

export function resolveFailures(items: Pick<MediaItem, "id" | "url">[]): void {
  if (!items.length) return;
  const keys = new Set(items.flatMap((i) => [i.id, i.url].filter(Boolean) as string[]));
  const all = load();
  const next = all.filter((f) => !keys.has(f.key) && !keys.has(f.item.url));
  if (next.length === all.length) return;
  list = next;
  changed();
}

export function dismissFailures(keys?: string[]): number {
  const all = load();
  const drop = keys ? new Set(keys) : null;
  const next = drop ? all.filter((f) => !drop.has(f.key) || retrying.has(f.key)) : all.filter((f) => retrying.has(f.key));
  const removed = all.length - next.length;
  list = next;
  if (removed) changed();
  return removed;
}

export function pickFailures(keys?: string[]): FailedDownload[] {
  const all = load().filter((f) => !retrying.has(f.key));
  if (!keys) return all;
  const want = new Set(keys);
  return all.filter((f) => want.has(f.key));
}

export function markRetrying(keys: string[], on: boolean): void {
  for (const k of keys) {
    if (on) retrying.add(k);
    else retrying.delete(k);
  }
  changed();
}

export function failureCount(): number {
  return load().length;
}
