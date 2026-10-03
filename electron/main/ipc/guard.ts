import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { getMainWindow, isAppUrl } from "../app/window";
import { isBusy } from "../jobs/queue";
import { isLocked } from "../security/lock";

const OPEN_WHILE_LOCKED = new Set([
  "app:version",
  "appearance:get",
  "security:status",
  "security:unlockPin",
  "security:unlockHello",
  "security:activity"
]);

export type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

export function handle(channel: string, listener: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents || !isAppUrl(event.senderFrame?.url || "")) {
      throw new Error("Untrusted sender.");
    }
    if (isLocked() && !OPEN_WHILE_LOCKED.has(channel)) {
      throw new Error("Xaver is locked.");
    }
    return listener(event, ...args);
  });
}

export function whenIdle<T>(fn: () => T): T {
  if (isBusy()) throw new Error("Wait for the current scan or download to finish.");
  return fn();
}
