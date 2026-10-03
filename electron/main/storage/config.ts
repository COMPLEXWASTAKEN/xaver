import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { AppConfig, DEFAULT_CONFIG } from "../../shared/types";
import { readSecureJson, removeSecureJson, writeSecureJson } from "./secure-store";

let configCache: AppConfig | null = null;
let sessionCache: { value: StoredSession | null } | null = null;

export type { AppConfig };
export { DEFAULT_CONFIG };

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function historyPath(): string {
  return path.join(app.getPath("userData"), "job-history.json");
}

function sessionPath(): string {
  return path.join(app.getPath("userData"), "session-cookies.json");
}

export function getDefaultOutputRoot(): string {
  const legacy = path.join(app.getPath("documents"), "ProfileMediaSaver");
  return fs.existsSync(legacy) ? legacy : path.join(app.getPath("documents"), "Xaver");
}

export function loadConfig(): AppConfig {
  if (configCache) return { ...configCache };
  let raw: Partial<AppConfig> = {};
  try {
    raw = readSecureJson<Partial<AppConfig>>(configPath()) || {};
  } catch {
    raw = {};
  }
  const legacy = raw as Record<string, unknown>;
  if (!raw.shardxCacheDir && typeof legacy.cloakProfileDir === "string") {
    raw.shardxCacheDir = legacy.cloakProfileDir as string;
  }
  if (!raw.shardxTimezone && typeof legacy.cloakTimezone === "string") {
    raw.shardxTimezone = legacy.cloakTimezone as string;
  }
  if (raw.shardxHumanize == null && typeof legacy.cloakHumanize === "boolean") {
    raw.shardxHumanize = legacy.cloakHumanize as boolean;
  }
  if (
    !raw.shardxTemplate &&
    typeof legacy.cloakFingerprintSeed === "string" &&
    /^(win-|mac-|linux-|android-)/i.test(legacy.cloakFingerprintSeed as string)
  ) {
    raw.shardxTemplate = legacy.cloakFingerprintSeed as string;
  }
  const merged: AppConfig = { ...DEFAULT_CONFIG, ...raw };
  if (!merged.outputRoot) {
    merged.outputRoot = getDefaultOutputRoot();
  }
  configCache = merged;
  return { ...merged };
}

function writeConfig(next: AppConfig): AppConfig {
  writeSecureJson(configPath(), next);
  configCache = { ...next };
  return next;
}

const BLOCKED_SWITCH =
  /^--(renderer-cmd-prefix|gpu-launcher|utility-cmd-prefix|plugin-launcher|ppapi-plugin-launcher|browser-subprocess-path|remote-debugging-[\w-]+|load-extension|disable-extensions-except|user-data-dir|no-sandbox|disable-web-security|disable-gpu-sandbox|no-zygote|single-process|js-flags|[\w-]*startup-dialog|enable-logging|log-file|nacl-[\w-]+)(=|$)/i;

export function safeLaunchArgs(raw: unknown): string[] {
  return String(raw || "")
    .split(/\s+/)
    .map((a) => a.trim())
    .filter((a) => /^--[a-z0-9][\w-]*(=\S*)?$/i.test(a) && !BLOCKED_SWITCH.test(a));
}

export function resolvedOutputRoot(cfg: AppConfig = loadConfig()): string {
  const root = String(cfg.outputRoot || "").trim();
  return root && path.isAbsolute(root) && path.resolve(root) === path.normalize(root) ? root : getDefaultOutputRoot();
}

function sanitize(patch: Partial<AppConfig>): Partial<AppConfig> {
  const out: Record<string, unknown> = {};
  const defaults = DEFAULT_CONFIG as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in defaults)) continue;
    const kind = typeof defaults[key];
    if (kind === "boolean" && typeof value === "boolean") out[key] = value;
    else if (kind === "number" && Number.isFinite(Number(value))) out[key] = Number(value);
    else if (kind === "string" && typeof value === "string") out[key] = value.slice(0, 2048);
  }
  if (typeof out.playwrightArgs === "string") out.playwrightArgs = safeLaunchArgs(out.playwrightArgs).join(" ");
  if (typeof out.proxyUrl === "string" && out.proxyUrl.trim() && !/^(https?|socks[45]?):\/\//i.test(out.proxyUrl.trim())) {
    delete out.proxyUrl;
  }
  return out as Partial<AppConfig>;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...sanitize(patch) };
  if (!next.outputRoot) next.outputRoot = getDefaultOutputRoot();
  return writeConfig(next);
}

export function resetConfigSection(keys: (keyof AppConfig)[]): AppConfig {
  const current = loadConfig();
  const next = { ...current };
  for (const k of keys) {
    (next as Record<string, unknown>)[k] = DEFAULT_CONFIG[k];
  }
  if (!next.outputRoot) next.outputRoot = getDefaultOutputRoot();
  return writeConfig(next);
}

export type StoredSession = {
  cookies: Array<Record<string, unknown>>;
  updatedAt: string;
  source: "file" | "paste" | "browser";
  screenName: string | null;
};

export function loadSession(): StoredSession | null {
  if (sessionCache) return sessionCache.value;
  let value: StoredSession | null = null;
  try {
    value = readSecureJson<StoredSession>(sessionPath());
  } catch {
    value = null;
  }
  sessionCache = { value };
  return value;
}

export function saveSession(session: StoredSession): void {
  writeSecureJson(sessionPath(), session);
  sessionCache = { value: session };
}

export function clearSession(): void {
  removeSecureJson(sessionPath());
  sessionCache = { value: null };
}

export function loadHistory(): unknown[] {
  try {
    const raw = readSecureJson<unknown[]>(historyPath());
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveHistory(jobs: unknown[]): void {
  writeSecureJson(historyPath(), jobs.slice(0, 200));
}

export function resealStoredData(): void {
  configCache = null;
  sessionCache = null;
  const cfg = loadConfig();
  writeConfig(cfg);
  const session = loadSession();
  if (session) saveSession(session);
  saveHistory(loadHistory());
}

export { configPath, historyPath, sessionPath };
