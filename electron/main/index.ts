import fs from "node:fs";
import { app, BrowserWindow, Menu, session } from "electron";
import { registerAppIdentity, tagShortcuts } from "./app/identity";
import { beginShutdown, createMainWindow, getMainWindow, installNavigationGuards, isShuttingDown } from "./app/window";
import { ensureShardxReady } from "./auth/session";
import { registerIpc } from "./ipc/register";
import { initJobsFromDisk, stopAll, whenIdle } from "./jobs/queue";
import { flushNotices, initNotifications } from "./notifications/center";
import { flushFailures } from "./jobs/failures";
import { initUpdates } from "./app/updates";
import { handleMediaProtocols, purgePreviewCache, registerMediaSchemes } from "./protocols/media";
import { attachWindow, initSecurity, revealWindow } from "./security/lock";
import { resolvedOutputRoot } from "./storage/config";
import { flushMediaDb } from "./storage/media-db";

const PERMISSIONS_ALLOWED = new Set(["fullscreen", "clipboard-sanitized-write"]);

let cleanedUp = false;

registerMediaSchemes();
registerAppIdentity();
installNavigationGuards();

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on("second-instance", () => {
  if (!isShuttingDown()) revealWindow();
});

app.whenReady().then(() => {
  if (!primaryInstance) return;
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(PERMISSIONS_ALLOWED.has(permission)));
  purgePreviewCache();
  tagShortcuts();
  void ensureShardxReady(null).catch(() => {});

  handleMediaProtocols();
  try {
    fs.mkdirSync(resolvedOutputRoot(), { recursive: true });
  } catch {}

  initSecurity(getMainWindow);
  initNotifications();
  initJobsFromDisk();
  registerIpc();
  createMainWindow();
  initUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("browser-window-created", (_e, win) => attachWindow(win));

app.on("before-quit", (e) => {
  if (cleanedUp) return;
  e.preventDefault();
  if (!beginShutdown()) return;
  void (async () => {
    try {
      stopAll();
      await whenIdle(8000);
    } catch {}
    try {
      await flushMediaDb();
    } catch {}
    flushNotices();
    flushFailures();
    purgePreviewCache();
    cleanedUp = true;
    app.quit();
  })();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
