import { app, BrowserWindow, dialog, shell } from "electron";
import type { AppConfig, Appearance, SecurityPrefs } from "../../shared/types";
import { appInfo, cancelDownload, checkForUpdates, downloadUpdate, installUpdate, updateState } from "../app/updates";
import { getMainWindow } from "../app/window";
import {
  clearAuth,
  clearShardxProfile,
  ensureShardxReady,
  getAuthStatus,
  getShardxCacheDir,
  importCookiesFromText,
  loginWithBrowser,
  pickAndImportCookieFile,
  refreshScreenName
} from "../auth/session";
import { cancelJob, downloadSelection, enqueueJob, getLiveItems, listJobs, retryFailed, revealPath } from "../jobs/queue";
import { dismissFailures, failureState } from "../jobs/failures";
import {
  clearNotices,
  markNoticesRead,
  noticeFeed,
  removeNotice,
  takePendingOpen,
  testNotice
} from "../notifications/center";
import { stageRemoteMedia } from "../protocols/media";
import {
  lockNow,
  markActivity,
  probeHello,
  removePin,
  setEncryptDatabase,
  setPin,
  setPrefs as setSecurityPrefs,
  status as securityStatus,
  unlockWithHello,
  unlockWithPin
} from "../security/lock";
import { DEFAULT_CONFIG, loadConfig, resetConfigSection, saveConfig } from "../storage/config";
import { isOpenablePath, listRunFiles, listRuns } from "../storage/library";
import {
  applyDbKey,
  dbBackup,
  dbCompact,
  dbRelink,
  dbMigrateLegacy,
  dbOverview,
  dbPickAndMigrate,
  dbPruneMissing,
  dbRescan,
  dbReveal,
  dbSearch,
  dbVerify
} from "../storage/media-db";
import { handle, whenIdle } from "./guard";

function dialogParent(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() || getMainWindow();
}

async function pick(opts: Electron.OpenDialogOptions): Promise<string | null> {
  const win = dialogParent();
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

function libraryPath(target: unknown): string {
  const p = String(target || "");
  if (!isOpenablePath(p)) throw new Error("That location is outside your library.");
  return p;
}

function registerApp(): void {
  handle("app:version", () => app.getVersion());
  handle("appearance:get", (): Appearance => {
    const c = loadConfig();
    return {
      theme: c.theme,
      accent: c.accent,
      motion: c.motion,
      cornerStyle: c.cornerStyle,
      uiScale: c.uiScale,
      themeDensity: c.themeDensity,
      setupComplete: c.setupComplete
    };
  });
  handle("config:get", () => loadConfig());
  handle("config:set", (_e, patch: Partial<AppConfig>) => saveConfig(patch));
  handle("config:reset", (_e, keys: (keyof AppConfig)[]) => {
    if (!keys?.length) return saveConfig({ ...DEFAULT_CONFIG, outputRoot: loadConfig().outputRoot });
    return resetConfigSection(keys);
  });
  handle("config:defaults", () => ({ ...DEFAULT_CONFIG, outputRoot: loadConfig().outputRoot || DEFAULT_CONFIG.outputRoot }));
  handle("dialog:pickFolder", () => pick({ properties: ["openDirectory", "createDirectory"] }));
  handle("dialog:pickCookieFile", () =>
    pick({
      filters: [
        { name: "Cookie export", extensions: ["txt", "cookies"] },
        { name: "All", extensions: ["*"] }
      ],
      properties: ["openFile"]
    })
  );
  handle("shell:openExternal", async (_e, url: string) => {
    if (/^https?:\/\//i.test(String(url || ""))) await shell.openExternal(String(url));
    return true;
  });
  handle("media:stagePreview", async (_e, url: string) => {
    try {
      return { ok: true as const, path: await stageRemoteMedia(String(url || "")) };
    } catch (e) {
      return { ok: false as const, error: String((e as Error)?.message || e) };
    }
  });
}

function registerSecurity(): void {
  handle("security:status", () => securityStatus());
  handle("security:unlockPin", (_e, pin: string) => unlockWithPin(String(pin || "")));
  handle("security:unlockHello", () => unlockWithHello());
  handle("security:activity", () => {
    markActivity();
    return true;
  });
  handle("security:lock", () => lockNow("manual"));
  handle("security:setPin", (_e, current: string, next: string) => setPin(String(current || ""), String(next || "")));
  handle("security:removePin", (_e, current: string) => removePin(String(current || "")));
  handle("security:setPrefs", (_e, patch: Partial<SecurityPrefs>) => setSecurityPrefs(patch || {}));
  handle("security:probeHello", () => probeHello());
  handle("security:setEncryptDatabase", (_e, on: boolean) =>
    whenIdle(async () => {
      const st = setEncryptDatabase(Boolean(on));
      await applyDbKey();
      return st;
    })
  );
}

function registerAuth(): void {
  handle("auth:getStatus", () => getAuthStatus());
  handle("auth:importText", (_e, text: string) => importCookiesFromText(text, "paste"));
  handle("auth:importFile", () => pickAndImportCookieFile(getMainWindow()));
  handle("auth:loginBrowser", () => loginWithBrowser(getMainWindow()));
  handle("auth:refresh", () => refreshScreenName());
  handle("auth:clear", () => clearAuth());
  handle("auth:clearProfile", async () => ({ ok: true, profileDir: await clearShardxProfile() }));
  handle("auth:ensureEngine", () => ensureShardxReady(getMainWindow()));
  handle("auth:profileDir", () => getShardxCacheDir());
}

function registerJobs(): void {
  handle("jobs:list", () => listJobs());
  handle("jobs:enqueue", (_e, target: string, opts?: { sources?: string[] }) => enqueueJob(target, true, opts));
  handle("jobs:start", (_e, target: string, opts?: { sources?: string[] }) => enqueueJob(target, true, opts));
  handle("jobs:cancel", (_e, jobId?: string) => cancelJob(jobId));
  handle("jobs:liveItems", () => getLiveItems());
  handle("jobs:download", (_e, urls?: string[]) => downloadSelection(urls));
  handle("jobs:downloadAll", () => downloadSelection());
  handle("failures:list", () => failureState());
  handle("failures:retry", (_e, keys?: string[]) => retryFailed(Array.isArray(keys) ? keys.map(String) : undefined));
  handle("failures:dismiss", (_e, keys?: string[]) => dismissFailures(Array.isArray(keys) ? keys.map(String) : undefined));
}

function registerLibrary(): void {
  handle("library:listRuns", () => listRuns());
  handle("library:listItems", (_e, runId: string) => listRunFiles(runId));
  handle("library:openPath", async (_e, target: string) => {
    await revealPath(libraryPath(target));
    return true;
  });
  handle("library:reveal", (_e, target: string) => {
    shell.showItemInFolder(libraryPath(target));
    return true;
  });
}

function registerDatabase(): void {
  handle("db:overview", () => dbOverview());
  handle("db:search", (_e, q: string) => dbSearch(String(q || "")));
  handle("db:migrate", () => whenIdle(() => dbMigrateLegacy()));
  handle("db:migrateFile", () => whenIdle(() => dbPickAndMigrate(dialogParent())));
  handle("db:verify", () => dbVerify());
  handle("db:prune", () => whenIdle(() => dbPruneMissing()));
  handle("db:rescan", () => whenIdle(() => dbRescan()));
  handle("db:compact", () => whenIdle(() => dbCompact()));
  handle("db:relink", () => whenIdle(() => dbRelink(dialogParent())));
  handle("db:backup", () => dbBackup(dialogParent()));
  handle("db:reveal", () => dbReveal());
}

function registerUpdates(): void {
  handle("updates:info", () => appInfo());
  handle("updates:state", () => updateState());
  handle("updates:check", () => checkForUpdates());
  handle("updates:download", () => downloadUpdate());
  handle("updates:cancel", () => cancelDownload());
  handle("updates:install", () => installUpdate());
}

function registerNotices(): void {
  handle("notices:list", () => noticeFeed());
  handle("notices:markRead", (_e, ids?: string[]) => markNoticesRead(Array.isArray(ids) ? ids.map(String) : undefined));
  handle("notices:remove", (_e, id: string) => removeNotice(String(id || "")));
  handle("notices:clear", () => clearNotices());
  handle("notices:test", () => testNotice());
  handle("notices:takeOpen", () => takePendingOpen());
}

export function registerIpc(): void {
  registerApp();
  registerSecurity();
  registerAuth();
  registerJobs();
  registerLibrary();
  registerDatabase();
  registerNotices();
  registerUpdates();
}
