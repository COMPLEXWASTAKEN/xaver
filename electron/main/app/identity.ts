import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";

export const APP_ID = app.isPackaged ? "app.xaver.desktop" : "app.xaver.desktop.dev";

const LEGACY_DATA_DIR = "profile-media-saver-desktop";

export function registerAppIdentity(): void {
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  const appData = app.getPath("appData");
  const current = path.resolve(app.getPath("userData")).toLowerCase();
  if (current !== path.resolve(appData, app.getName()).toLowerCase()) return;
  const legacy = path.join(appData, LEGACY_DATA_DIR);
  if (fs.existsSync(legacy)) app.setPath("userData", legacy);
}

export function tagShortcuts(): void {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const exe = path.resolve(process.execPath).toLowerCase();
  const dirs = [
    path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
    app.getPath("desktop")
  ];
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => /^(Xaver|Profile Media Saver).*\.lnk$/i.test(n));
    } catch {
      continue;
    }
    for (const name of names) {
      const lnk = path.join(dir, name);
      try {
        const link = shell.readShortcutLink(lnk);
        if (path.resolve(link.target).toLowerCase() !== exe || link.appUserModelId === APP_ID) continue;
        shell.writeShortcutLink(lnk, "update", { ...link, appUserModelId: APP_ID });
      } catch {}
    }
  }
}
