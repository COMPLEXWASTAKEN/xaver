import fs from "node:fs";
import { BrowserWindow, shell } from "electron";
import { getAuthStatus, getSessionCookies, getShardxCacheDir } from "../auth/session";
import { loadConfig, loadHistory, resolvedOutputRoot, safeFolderName, safeLaunchArgs, saveHistory } from "../storage/config";
import type { JobProgress, JobRecord, MediaItem } from "../../shared/types";
import { loadEngineModule } from "../engine/loader";
import { mediaDbPath } from "../storage/media-db";
import { databaseKey, isLocked } from "../security/lock";
import { notify } from "../notifications/center";


let queue: JobRecord[] = [];
let history: JobRecord[] = [];
let activeJobId: string | null = null;
let scanAbort: AbortController | null = null;
let downloadAbort: AbortController | null = null;
let liveItems: MediaItem[] = [];
let liveIndex = new Map<string, number>();
let lastProfilePath: string | null = null;
let scanGeneration = 0;
let mainWindow: BrowserWindow | null = null;
let pumping = false;
let downloading = false;

function uid(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emit(channel: string, payload: unknown): void {
  if (isLocked()) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function resetLive(items: MediaItem[]): void {
  liveItems = items;
  liveIndex = new Map();
  items.forEach((it, i) => indexLive(it, i));
}

function indexLive(item: MediaItem, i: number): void {
  if (item.url) liveIndex.set(item.url, i);
  if (item.id) liveIndex.set(item.id, i);
}

function findLive(item: MediaItem): number {
  const byId = item.id ? liveIndex.get(item.id) : undefined;
  if (byId !== undefined) return byId;
  return liveIndex.get(item.url) ?? -1;
}

function taskbar(progress: number, mode?: "normal" | "indeterminate" | "error"): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setProgressBar(progress, mode ? { mode } : undefined);
  } catch {}
}

function settle(ok: boolean): void {
  if (ok) {
    taskbar(-1);
    return;
  }
  taskbar(1, "error");
  setTimeout(() => taskbar(-1), 4000).unref?.();
}

const SESSION_ERROR = /session|sign ?in|log ?in|logged out|401|403|unauthori[sz]ed|cookie/i;

function reportFailure(what: "Scan" | "Download", msg: string): void {
  settle(false);
  const session = SESSION_ERROR.test(msg);
  notify({
    kind: session ? "session" : "failure",
    tone: "error",
    title: session ? "Sign in again" : `${what} failed`,
    body: session ? "Your X session looks expired or invalid. Open Account to sign in." : msg.slice(0, 240),
    target: session ? "account" : "jobs"
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function persist(): void {
  saveHistory([...queue.filter((j) => j.status === "queued"), ...history]);
}

function busy(): boolean {
  return pumping || downloading;
}

export function setJobsWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function initJobsFromDisk(): void {
  const raw = loadHistory() as JobRecord[];
  history = raw
    .filter((j) => j && j.status !== "queued")
    .map((j) => {
      if (["running", "scraping", "downloading", "zipping"].includes(j.status)) {
        return {
          ...j,
          status: "failed" as const,
          errorMessage: j.errorMessage || "Interrupted",
          finishedAt: j.finishedAt || new Date().toISOString()
        };
      }
      return j;
    });
  queue = [];
}

function pushLog(job: JobRecord, msg: string): void {
  job.logs.push(msg);
  if (job.logs.length > 40) job.logs.splice(0, job.logs.length - 40);
  emit("jobs:log", { jobId: job.id, message: msg, logs: job.logs });
}

function loadRunner() {
  return loadEngineModule("runner.js");
}

function snapshot() {
  return {
    queue: queue.map((j) => ({ ...j })),
    history: history.map((j) => ({ ...j })),
    activeJobId,
    downloading,
    scanning: pumping,
    generation: scanGeneration
  };
}

export function listJobs() {
  return snapshot();
}

export function getLiveItems(): MediaItem[] {
  return [...liveItems];
}

function engineOpts(cfg: ReturnType<typeof loadConfig>, signal?: AbortSignal) {
  const launchArgs = safeLaunchArgs(cfg.playwrightArgs);
  return {
    headless: cfg.headless,
    maxScrolls: cfg.maxScrolls,
    pauseMs: cfg.scrollDelayMs,
    maxIdleRounds: cfg.maxIdleRounds,
    viewport: { width: cfg.viewportWidth, height: cfg.viewportHeight },
    userAgent: cfg.userAgent,
    overrideUserAgent: cfg.overrideUserAgent,
    launchArgs,
    proxyUrl: cfg.proxyUrl || undefined,
    humanize: cfg.shardxHumanize,
    template: cfg.shardxTemplate || undefined,
    profileId: cfg.shardxProfileId || undefined,
    timezone: cfg.shardxTimezone || undefined,
    webrtc: cfg.shardxWebrtc || "auto",
    userDataDir: getShardxCacheDir(),
    cacheDir: getShardxCacheDir(),
    includePhotos: cfg.includePhotos,
    includeVideos: cfg.includeVideos,
    includeGifs: cfg.includeGifs,
    skipHls: cfg.skipHls,
    sha256Dedupe: cfg.sha256Dedupe,
    rememberDownloads: cfg.rememberDownloads,
    hideDownloaded: cfg.hideDownloaded,
    concurrency: cfg.downloadConcurrency,
    retries: cfg.retryCount,
    requestTimeoutMs: cfg.requestTimeoutMs,
    wantZip: cfg.defaultZip,
    outRoot: resolvedOutputRoot(cfg),
    folderLayout: cfg.folderLayout,
    singleFolderName: safeFolderName(cfg.singleFolderName),
    splitByType: cfg.splitByType,
    dbPath: mediaDbPath(),
    dbKey: databaseKey(),
    signal
  };
}

export function enqueueJob(
  target: string,
  startImmediately = true,
  opts?: { sources?: string[] }
): JobRecord {
  if (downloading) {
    throw new Error("Wait for the current download to finish.");
  }
  if (pumping) {
    throw new Error("A scan is already running.");
  }

  const sources = Array.isArray(opts?.sources)
    ? opts.sources.map((s) => String(s || "").toLowerCase()).filter(Boolean)
    : [];

  const job: JobRecord = {
    id: uid(),
    target: String(target || "me").trim() || "me",
    sources: sources as JobRecord["sources"],
    status: "queued",
    createdAt: new Date().toISOString(),
    mediaCount: 0,
    saved: 0,
    skipped: 0,
    errors: 0,
    logs: []
  };
  queue.push(job);
  emit("jobs:updated", snapshot());
  persist();
  if (startImmediately) void pumpQueue();
  return job;
}

export function cancelJob(jobId?: string): boolean {
  const id = jobId || activeJobId;
  if (!id) {
    if (downloadAbort) {
      downloadAbort.abort();
      return true;
    }
    if (scanAbort) {
      scanAbort.abort();
      return true;
    }
    return false;
  }

  const qIdx = queue.findIndex((j) => j.id === id);
  if (qIdx >= 0 && queue[qIdx].status === "queued") {
    const [removed] = queue.splice(qIdx, 1);
    removed.status = "cancelled";
    removed.finishedAt = new Date().toISOString();
    pushLog(removed, "Cancelled");
    history.unshift(removed);
    emit("jobs:updated", snapshot());
    persist();
    return true;
  }

  if (activeJobId === id) {
    if (downloading && downloadAbort) {
      downloadAbort.abort();
      return true;
    }
    if (scanAbort) {
      scanAbort.abort();
      return true;
    }
  }
  return false;
}

async function pumpQueue(): Promise<void> {
  if (pumping || downloading) return;
  pumping = true;
  try {
    while (queue.length) {
      const job = queue[0];
      if (job.status !== "queued") {
        queue.shift();
        continue;
      }
      await runCollect(job);
      queue.shift();
      history.unshift({ ...job });
      if (history.length > 200) history.length = 200;
      emit("jobs:updated", snapshot());
      persist();
    }
  } finally {
    pumping = false;
    if (!downloading) activeJobId = null;
    scanAbort = null;
    emit("jobs:updated", snapshot());
  }
}

async function runCollect(job: JobRecord): Promise<void> {
  const cfg = loadConfig();
  const cookies = getSessionCookies();
  if (!cookies.length) {
    job.status = "failed";
    job.errorMessage = "No session. Sign in on the Account page first.";
    job.finishedAt = new Date().toISOString();
    pushLog(job, job.errorMessage);
    emit("jobs:done", { job, error: job.errorMessage });
    notify({
      kind: "session",
      tone: "warn",
      title: "Sign in first",
      body: "Add your X session on the Account page, then start the scan again.",
      target: "account"
    });
    return;
  }

  const gen = ++scanGeneration;
  resetLive([]);
  taskbar(2, "indeterminate");
  lastProfilePath = null;
  activeJobId = job.id;
  scanAbort = new AbortController();
  job.status = "scraping";
  job.startedAt = new Date().toISOString();
  pushLog(job, `Scanning ${job.target}`);
  emit("jobs:updated", snapshot());
  emit("jobs:items-reset", { jobId: job.id, generation: gen });

  try {
    const { runCollectJob } = await loadRunner();
    const result = await runCollectJob(
      {
        cookies,
        screenName: getAuthStatus().screenName || undefined,
        target: job.target,
        sources: job.sources || [],
        ...engineOpts(cfg, scanAbort.signal)
      },
      {
        onLog: (msg: string) => pushLog(job, msg),
        onProgress: (p: Record<string, unknown>) => {
          if (gen !== scanGeneration) return;
          if (typeof p.mediaCount === "number") job.mediaCount = p.mediaCount as number;
          emit("jobs:progress", {
            jobId: job.id,
            phase: "scraping",
            message: String(p.message || ""),
            scroll: p.scroll as number | undefined,
            maxScrolls: p.maxScrolls as number | undefined,
            mediaCount: p.mediaCount as number | undefined
          } satisfies JobProgress);
          emit("jobs:updated", snapshot());
        },
        onItem: (item: MediaItem) => {
          if (gen !== scanGeneration) return;
          const idx = findLive(item);
          if (idx >= 0) {
            if (liveItems[idx].url === item.url) return;
            liveItems[idx] = { ...liveItems[idx], ...item };
            indexLive(liveItems[idx], idx);
            emit("jobs:item", { jobId: job.id, generation: gen, item: liveItems[idx] });
            return;
          }
          liveItems.push(item);
          indexLive(item, liveItems.length - 1);
          job.mediaCount = liveItems.length;
          emit("jobs:item", { jobId: job.id, generation: gen, item });
        }
      }
    );

    if (gen !== scanGeneration) return;

    resetLive(result.items);
    lastProfilePath = result.profilePath || null;
    job.status = "ready";
    job.profilePath = result.profilePath;
    job.mediaCount = result.items.length;
    job.hidden = Number(result.hiddenCount) || 0;
    job.finishedAt = new Date().toISOString();
    pushLog(job, `${result.items.length} ready`);
    emit("jobs:items", { jobId: job.id, generation: gen, items: liveItems });
    emit("jobs:done", { job, phase: "ready", generation: gen });
    settle(true);
    const found = result.items.length;
    const hidden = job.hidden || 0;
    notify({
      kind: "scan",
      tone: found ? "ok" : "info",
      title: found ? "Scan finished" : "Nothing new found",
      body: found
        ? `${plural(found, "new item")} ready to review${hidden ? ` · ${hidden} already saved` : ""}`
        : hidden
          ? `Everything here is already saved (${hidden}).`
          : "The scan didn't find any media.",
      target: "run"
    });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const cancelled = (e as Error)?.name === "AbortError" || /cancel/i.test(msg);
    job.status = cancelled ? "cancelled" : "failed";
    job.errorMessage = msg;
    job.finishedAt = new Date().toISOString();
    pushLog(job, cancelled ? "Cancelled" : msg);
    emit("jobs:done", { job, error: msg, generation: gen });
    if (gen === scanGeneration) {
      if (cancelled) taskbar(-1);
      else reportFailure("Scan", msg);
    }
  } finally {
    scanAbort = null;
    if (!downloading) activeJobId = null;
  }
}

export async function downloadSelection(urls?: string[]): Promise<JobRecord> {
  if (downloading) throw new Error("A download is already running.");
  if (pumping) throw new Error("Wait for the scan to finish.");

  const cfg = loadConfig();
  const cookies = getSessionCookies();
  if (!cookies.length) throw new Error("No session. Sign in first.");

  let items = [...liveItems];
  if (Array.isArray(urls) && urls.length) {
    const set = new Set(urls);
    items = items.filter((it) => set.has(it.url) || (it.id ? set.has(it.id) : false));
  }
  if (!items.length) throw new Error("No media selected.");

  const job: JobRecord = {
    id: uid(),
    target: lastProfilePath || "selection",
    profilePath: lastProfilePath || undefined,
    status: "downloading",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    mediaCount: items.length,
    saved: 0,
    skipped: 0,
    errors: 0,
    logs: [`Downloading ${items.length}`]
  };

  const gen = scanGeneration;
  downloading = true;
  activeJobId = job.id;
  downloadAbort = new AbortController();
  history.unshift(job);
  if (history.length > 200) history.length = 200;
  taskbar(0);
  emit("jobs:updated", snapshot());
  emit("jobs:log", { jobId: job.id, message: job.logs[0], logs: job.logs });

  try {
    const { runDownloadJob } = await loadRunner();
    const result = await runDownloadJob(
      {
        cookies,
        items,
        profilePath: lastProfilePath || undefined,
        label: lastProfilePath || "media",
        ...engineOpts(cfg, downloadAbort.signal)
      },
      {
        onLog: (msg: string) => pushLog(job, msg),
        onProgress: (p: Record<string, unknown>) => {
          if (p.phase === "zipping") job.status = "zipping";
          if (typeof p.saved === "number") job.saved = p.saved as number;
          if (typeof p.skipped === "number") job.skipped = p.skipped as number;
          if (typeof p.failed === "number") job.errors = p.failed as number;
          const total = Number(p.downloadTotal) || 0;
          if (p.phase === "zipping") taskbar(2, "indeterminate");
          else if (total > 0) taskbar(Math.min(1, (Number(p.downloadDone) || 0) / total));
          emit("jobs:progress", {
            jobId: job.id,
            phase: String(p.phase || "downloading"),
            message: String(p.message || ""),
            downloadDone: p.downloadDone as number | undefined,
            downloadTotal: p.downloadTotal as number | undefined,
            saved: p.saved as number | undefined,
            skipped: p.skipped as number | undefined,
            failed: p.failed as number | undefined,
            mediaCount: items.length
          } satisfies JobProgress);
          emit("jobs:updated", snapshot());
        },
        onItem: (item: MediaItem) => {
          if (gen !== scanGeneration) return;
          const idx = findLive(item);
          if (idx >= 0) liveItems[idx] = { ...liveItems[idx], ...item };
          emit("jobs:item", { jobId: job.id, generation: gen, item });
        }
      }
    );

    job.status = "done";
    job.runDir = result.runDir;
    job.zipPath = result.zipPath;
    job.saved = result.saved.length;
    job.skipped = result.skipped.length;
    job.errors = result.errors.length;
    job.finishedAt = new Date().toISOString();
    pushLog(job, `Saved ${job.saved}`);

    if (cfg.openFolderOnComplete && job.runDir) {
      shell.openPath(job.runDir).catch(() => {});
    }

    emit("jobs:done", { job, phase: "downloaded" });
    persist();
    settle(job.errors === 0 || job.saved > 0);
    notify({
      kind: "download",
      tone: job.errors ? (job.saved ? "warn" : "error") : "ok",
      title: job.errors && !job.saved ? "Download failed" : "Download finished",
      body: `${plural(job.saved, "file")} saved${job.skipped ? ` · ${job.skipped} skipped` : ""}${job.errors ? ` · ${job.errors} failed` : ""}`,
      target: "library",
      ...(job.runDir ? { path: job.runDir } : {})
    });
    return job;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const cancelled = (e as Error)?.name === "AbortError" || /cancel/i.test(msg);
    job.status = cancelled ? "cancelled" : "failed";
    job.errorMessage = msg;
    job.finishedAt = new Date().toISOString();
    pushLog(job, cancelled ? "Cancelled" : msg);
    emit("jobs:done", { job, error: msg });
    persist();
    if (cancelled) taskbar(-1);
    else reportFailure("Download", msg);
    throw e;
  } finally {
    downloading = false;
    downloadAbort = null;
    activeJobId = null;
    emit("jobs:updated", snapshot());
  }
}

export async function revealPath(targetPath: string): Promise<void> {
  if (!targetPath) return;
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    await shell.openPath(targetPath);
  } else {
    shell.showItemInFolder(targetPath);
  }
}

export function isBusy(): boolean {
  return busy();
}

export function stopAll(): void {
  const now = new Date().toISOString();
  for (const job of queue.splice(0)) {
    if (job.status !== "queued") continue;
    job.status = "cancelled";
    job.finishedAt = now;
    job.logs.push("Cancelled");
    history.unshift(job);
  }
  downloadAbort?.abort();
  scanAbort?.abort();
  persist();
}

export async function whenIdle(timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (busy() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return !busy();
}
