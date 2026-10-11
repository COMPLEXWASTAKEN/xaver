import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, net } from "electron";
import type { AppInfo, UpdateRelease, UpdateState } from "../../shared/types";
import { notify } from "../notifications/center";
import { loadConfig } from "../storage/config";
import { getMainWindow } from "./window";

const REPO = "COMPLEXWASTAKEN/xaver";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const ISSUES_URL = `https://github.com/${REPO}/issues`;
const DOWNLOAD_HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|github-releases\.githubusercontent\.com)$/i;
const AUTO_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15_000;

type Asset = { name: string; size: number; browser_download_url: string };

let state: UpdateState = { status: "idle", checkedAt: 0, release: null, received: 0, total: 0, error: null };
let assets: { setup: Asset | null; sums: Asset | null } = { setup: null, sums: null };
let checking: Promise<UpdateState> | null = null;
let download: AbortController | null = null;
let readyFile: string | null = null;
let announced: string | null = null;

function updatesDir(): string {
  return path.join(app.getPath("userData"), "updates");
}

function set(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch };
  const win = getMainWindow();
  if (win) win.webContents.send("updates:changed", state);
  return state;
}

function parse(v: string): { core: number[]; pre: string } {
  const [core, pre = ""] = v.replace(/^v/i, "").split("-", 2);
  return { core: core.split(".").map((n) => Number(n) || 0), pre };
}

export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.core[i] || 0) - (pb.core[i] || 0);
    if (d) return Math.sign(d);
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre, undefined, { numeric: true });
}

function trimNotes(body: string): string {
  const cut = body.search(/^###\s+(Installing|Checksums)/m);
  return (cut > 0 ? body.slice(0, cut) : body).trim().slice(0, 4000);
}

function osLabel(): string {
  if (process.platform !== "win32") return `${os.type()} ${os.release()}`;
  const build = Number(os.release().split(".")[2]) || 0;
  return `${build >= 22000 ? "Windows 11" : "Windows 10"} · build ${build}`;
}

export function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    os: osLabel(),
    arch: process.arch,
    packaged: app.isPackaged,
    installDir: path.dirname(process.execPath),
    dataDir: app.getPath("userData"),
    releasesUrl: RELEASES_URL,
    issuesUrl: ISSUES_URL,
    bugUrl: `${ISSUES_URL}/new?template=bug_report.yml`,
    requestUrl: `${ISSUES_URL}/new?template=feature_request.yml`,
    boardUrl: `${ISSUES_URL}?q=is%3Aissue+is%3Aopen+label%3Afeature-board`
  };
}

export function updateState(): UpdateState {
  return state;
}

async function fetchLatest(): Promise<UpdateState> {
  set({ status: "checking", error: null });
  try {
    const res = await net.fetch(API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Xaver/${app.getVersion()}` }
    });
    if (res.status === 404) return set({ status: "unavailable", checkedAt: Date.now(), release: null });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const data = (await res.json()) as {
      tag_name: string;
      name: string;
      body: string;
      published_at: string;
      html_url: string;
      assets: Asset[];
    };
    const setup = data.assets.find((a) => /setup.*\.exe$/i.test(a.name)) || null;
    const sums = data.assets.find((a) => /^SHA256SUMS\.txt$/i.test(a.name)) || null;
    assets = { setup, sums };
    const release: UpdateRelease = {
      version: data.tag_name.replace(/^v/i, ""),
      name: data.name || data.tag_name,
      publishedAt: data.published_at,
      notes: trimNotes(data.body || ""),
      url: data.html_url,
      asset: setup ? { name: setup.name, size: setup.size } : null
    };
    const newer = compareVersions(release.version, app.getVersion()) > 0;
    if (!newer) return set({ status: "current", checkedAt: Date.now(), release });
    if (readyFile && fs.existsSync(readyFile) && path.basename(readyFile) === setup?.name) {
      return set({ status: "ready", checkedAt: Date.now(), release });
    }
    if (announced !== release.version) {
      announced = release.version;
      notify({
        kind: "system",
        tone: "info",
        title: `Xaver ${release.version} is available`,
        body: "Open About to download and install it.",
        target: "about"
      });
    }
    return set({ status: "available", checkedAt: Date.now(), release });
  } catch (e) {
    return set({ status: "error", checkedAt: Date.now(), error: String((e as Error)?.message || e) });
  }
}

export function checkForUpdates(): Promise<UpdateState> {
  if (state.status === "downloading" || state.status === "installing") return Promise.resolve(state);
  if (!checking) checking = fetchLatest().finally(() => (checking = null));
  return checking;
}

function safeDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && DOWNLOAD_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

async function expectedHash(): Promise<string> {
  const sums = assets.sums;
  if (!sums || !assets.setup || !safeDownloadUrl(sums.browser_download_url)) throw new Error("This release has no checksum file.");
  const res = await net.fetch(sums.browser_download_url);
  if (!res.ok) throw new Error(`Couldn't read the checksums (${res.status}).`);
  const line = (await res.text()).split(/\r?\n/).find((l) => l.trim().endsWith(assets.setup!.name));
  const hash = line?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("The checksum file doesn't list the installer.");
  return hash;
}

export async function downloadUpdate(): Promise<UpdateState> {
  const setup = assets.setup;
  if (state.status !== "available" || !setup) return state;
  if (!safeDownloadUrl(setup.browser_download_url)) return set({ status: "error", error: "The download link doesn't point to GitHub." });
  const controller = new AbortController();
  download = controller;
  const dir = updatesDir();
  const file = path.join(dir, setup.name);
  const part = `${file}.${crypto.randomBytes(4).toString("hex")}.part`;
  set({ status: "downloading", received: 0, total: setup.size, error: null });
  try {
    const want = await expectedHash();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const res = await net.fetch(setup.browser_download_url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
    const total = Number(res.headers.get("content-length")) || setup.size;
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(part);
    const reader = res.body.getReader();
    let received = 0;
    let last = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
        if (Date.now() - last > 150) {
          last = Date.now();
          set({ received, total });
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(r));
    }
    if (hash.digest("hex") !== want) throw new Error("The download didn't match its checksum, so it was thrown away.");
    fs.renameSync(part, file);
    readyFile = file;
    return set({ status: "ready", received: total, total });
  } catch (e) {
    try {
      fs.rmSync(part, { force: true });
    } catch {}
    const cancelled = controller.signal.aborted;
    return set({ status: cancelled ? "available" : "error", received: 0, error: cancelled ? null : String((e as Error)?.message || e) });
  } finally {
    if (download === controller) download = null;
  }
}

export function cancelDownload(): void {
  download?.abort();
}

export function installUpdate(): UpdateState {
  if (state.status !== "ready" || !readyFile || !fs.existsSync(readyFile)) return state;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(readyFile, [], { detached: true, stdio: "ignore", env, windowsHide: false });
  child.unref();
  set({ status: "installing" });
  setTimeout(() => app.quit(), 600);
  return state;
}

export function initUpdates(): void {
  try {
    fs.rmSync(updatesDir(), { recursive: true, force: true });
  } catch {}
  if (!app.isPackaged) return;
  const tick = () => {
    if (loadConfig().autoUpdateCheck && Date.now() - state.checkedAt > AUTO_EVERY_MS) void checkForUpdates();
  };
  setTimeout(tick, FIRST_CHECK_DELAY_MS).unref?.();
  setInterval(tick, 60 * 60 * 1000).unref?.();
}
