import os from "node:os";
import { app, BrowserWindow, globalShortcut } from "electron";
import type { CaptureSupport } from "../../shared/types";

let registered: string | null = null;
let hidden = false;

export function captureSupport(): CaptureSupport {
  if (process.platform === "darwin") return "full";
  if (process.platform !== "win32") return "none";
  const build = Number(os.release().split(".")[2] || 0);
  return build >= 19041 ? "full" : "black";
}

export function applyCapture(win: BrowserWindow, on: boolean): void {
  if (win.isDestroyed()) return;
  try {
    win.setContentProtection(on);
  } catch {}
}

export function applyCaptureAll(on: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) applyCapture(win, on);
}

export function panicKeyActive(key: string): boolean {
  return Boolean(key) && registered === key;
}

export function syncPanicKey(want: string | null, onPress: () => void): void {
  if (!app.isReady() || registered === want) return;
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {}
    registered = null;
  }
  if (!want) return;
  try {
    if (globalShortcut.register(want, onPress)) registered = want;
  } catch {}
}

export function isWindowHidden(win: BrowserWindow): boolean {
  return hidden || !win.isVisible();
}

export function hideWindow(win: BrowserWindow): void {
  hidden = true;
  win.webContents.setAudioMuted(true);
  win.hide();
}

export function showWindow(win: BrowserWindow): void {
  hidden = false;
  win.webContents.setAudioMuted(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
