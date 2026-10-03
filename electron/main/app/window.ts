import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import { isBusy, setJobsWindow } from "../jobs/queue";
import { loadConfig } from "../storage/config";
import { loadWindowState, trackWindowState } from "./window-state";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function beginShutdown(): boolean {
  if (shuttingDown) return false;
  shuttingDown = true;
  return true;
}

function rendererRoot(): string {
  if (process.env.ELECTRON_RENDERER_URL) return process.env.ELECTRON_RENDERER_URL;
  return pathToFileURL(path.join(__dirname, "../renderer")).href;
}

export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const r = new URL(rendererRoot());
    if (u.protocol !== r.protocol) return false;
    if (u.protocol === "file:") {
      return decodeURIComponent(u.pathname).toLowerCase().startsWith(decodeURIComponent(r.pathname).toLowerCase());
    }
    return u.origin === r.origin;
  } catch {
    return false;
  }
}

export function openOutside(url: string): void {
  if (/^https:\/\//i.test(url)) void shell.openExternal(url).catch(() => {});
}

export function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath || "", "icon.png"),
    path.join(__dirname, "../../build/icon.ico"),
    path.join(__dirname, "../../build/icons/icon-256.png"),
    path.join(process.cwd(), "build/icon.ico"),
    path.join(process.cwd(), "build/icons/icon-256.png")
  ];
  return candidates.find((c) => c && fs.existsSync(c));
}

function preloadPath(): string {
  const mjs = path.join(__dirname, "../preload/index.mjs");
  return fs.existsSync(mjs) ? mjs : path.join(__dirname, "../preload/index.js");
}

function windowBackground(): string {
  const theme = loadConfig().theme;
  const light = theme === "light" || (theme === "system" && !nativeTheme.shouldUseDarkColors);
  if (light) return "#f4f1ec";
  if (theme === "midnight") return "#000000";
  if (theme === "slate") return "#0b0f14";
  return "#080706";
}

function confirmQuitWhileBusy(win: BrowserWindow): boolean {
  const choice = dialog.showMessageBoxSync(win, {
    type: "warning",
    buttons: ["Keep running", "Stop and quit"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: "Xaver",
    message: "A scan or download is still running.",
    detail: "Quitting now stops it. Files that were already saved are kept."
  });
  return choice === 1;
}

export function createMainWindow(): BrowserWindow {
  const icon = resolveAppIcon();
  const state = loadWindowState({ width: 1360, height: 860, minWidth: 960, minHeight: 640 });
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 960,
    minHeight: 640,
    backgroundColor: windowBackground(),
    title: "Xaver",
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow = win;
  setJobsWindow(win);
  trackWindowState(win);

  win.on("ready-to-show", () => {
    if (state.maximized) win.maximize();
    win.show();
  });
  win.on("close", (e) => {
    if (shuttingDown || !isBusy()) return;
    e.preventDefault();
    if (confirmQuitWhileBusy(win)) app.quit();
  });
  win.on("closed", () => {
    setJobsWindow(null);
    if (mainWindow === win) mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

export function installNavigationGuards(): void {
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-navigate", (e, url) => {
      if (!isAppUrl(url)) e.preventDefault();
    });
    contents.on("will-redirect", (e, url) => {
      if (!isAppUrl(url)) e.preventDefault();
    });
    contents.on("will-attach-webview", (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openOutside(url);
      return { action: "deny" };
    });
  });
}
