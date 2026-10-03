import fs from "node:fs";
import path from "node:path";
import { app, screen, type BrowserWindow } from "electron";

export type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
};

function stateFile(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function onScreen(s: Required<Pick<WindowState, "x" | "y" | "width" | "height">>): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const left = Math.max(a.x, s.x);
    const right = Math.min(a.x + a.width, s.x + s.width);
    const top = Math.max(a.y, s.y);
    const bottom = Math.min(a.y + a.height, s.y + s.height);
    return right - left >= 160 && bottom - top >= 80 && s.y >= a.y - 8;
  });
}

export function loadWindowState(fallback: { width: number; height: number; minWidth: number; minHeight: number }): WindowState {
  const base: WindowState = { width: fallback.width, height: fallback.height, maximized: false };
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Partial<WindowState>;
    const width = Math.round(Number(raw.width));
    const height = Math.round(Number(raw.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return base;
    const state: WindowState = {
      width: Math.max(fallback.minWidth, Math.min(width, 10000)),
      height: Math.max(fallback.minHeight, Math.min(height, 10000)),
      maximized: raw.maximized === true
    };
    const x = Math.round(Number(raw.x));
    const y = Math.round(Number(raw.y));
    if (Number.isFinite(x) && Number.isFinite(y) && onScreen({ x, y, width: state.width, height: state.height })) {
      state.x = x;
      state.y = y;
    }
    return state;
  } catch {
    return base;
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    const data: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    const file = stateFile();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
    }
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize"] as const) win.on(ev as "resize", later);
  win.on("close", save);
}
