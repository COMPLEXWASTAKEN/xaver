import crypto from "node:crypto";
import path from "node:path";
import { app, Notification } from "electron";
import type { Notice, NoticeFeed, NoticeInput, NoticeKind, NoticeTarget } from "../../shared/types";
import { getMainWindow, resolveAppIcon } from "../app/window";
import { isLocked, onLockChange, revealWindow } from "../security/lock";
import { loadConfig } from "../storage/config";
import { readSecureJson, writeSecureJson } from "../storage/secure-store";
import { unreadBadge } from "./badge";

const LIMIT = 80;
const SAVE_DELAY_MS = 400;

let feed: Notice[] | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let pendingOpen: { id: string; target?: NoticeTarget } | null = null;
const live = new Set<Notification>();

function storePath(): string {
  return path.join(app.getPath("userData"), "notifications.json");
}

function items(): Notice[] {
  if (feed) return feed;
  try {
    const raw = readSecureJson<Notice[]>(storePath());
    feed = Array.isArray(raw) ? raw.filter((n) => n && typeof n.id === "string").slice(0, LIMIT) : [];
  } catch {
    feed = [];
  }
  return feed;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNotices, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

export function flushNotices(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!feed) return;
  try {
    writeSecureJson(storePath(), feed);
  } catch {}
}

function unreadCount(): number {
  return items().reduce((n, it) => n + (it.read ? 0 : 1), 0);
}

export function noticeFeed(): NoticeFeed {
  return { items: items().map((n) => ({ ...n })), unread: unreadCount() };
}

function send(channel: string, payload: unknown): void {
  if (isLocked()) return;
  const win = getMainWindow();
  if (win) win.webContents.send(channel, payload);
}

function syncBadge(): void {
  const win = getMainWindow();
  if (!win || process.platform !== "win32") return;
  const unread = unreadCount();
  try {
    if (unread > 0 && !win.isFocused()) win.setOverlayIcon(unreadBadge(), `${unread} unread notification${unread === 1 ? "" : "s"}`);
    else win.setOverlayIcon(null, "");
  } catch {}
}

function changed(): void {
  scheduleSave();
  syncBadge();
  send("notices:changed", noticeFeed());
}

function kindEnabled(kind: NoticeKind): boolean {
  const c = loadConfig();
  if (kind === "scan") return c.notifyScans;
  if (kind === "download") return c.notifyDownloads;
  if (kind === "failure" || kind === "session") return c.notifyFailures;
  return true;
}

function inQuietHours(): boolean {
  const c = loadConfig();
  if (!c.notifyQuiet) return false;
  const from = Math.max(0, Math.min(23, Math.floor(c.notifyQuietFrom)));
  const to = Math.max(0, Math.min(23, Math.floor(c.notifyQuietTo)));
  if (from === to) return true;
  const h = new Date().getHours();
  return from < to ? h >= from && h < to : h >= from || h < to;
}

function userIsHere(): boolean {
  const win = getMainWindow();
  return Boolean(win && win.isVisible() && !win.isMinimized() && win.isFocused());
}

function desktopToast(n: Notice, force = false): void {
  const c = loadConfig();
  if (!Notification.isSupported()) return;
  if (!force) {
    if (!c.notifyDesktop || !kindEnabled(n.kind) || inQuietHours()) return;
    if (c.notifyWhenAway && userIsHere() && !isLocked()) return;
  }
  const hide = c.notifyPrivate || isLocked();
  const title = hide ? "Xaver" : n.title;
  const body = hide
    ? n.tone === "error" || n.tone === "warn"
      ? "Something needs your attention."
      : "A task finished."
    : n.body;
  try {
    const icon = resolveAppIcon();
    const toast = new Notification({ title, body, silent: !c.notifySound, ...(icon ? { icon } : {}) });
    live.add(toast);
    const drop = () => live.delete(toast);
    toast.on("click", () => {
      drop();
      openNotice(n.id);
    });
    toast.on("close", drop);
    toast.on("failed", drop);
    toast.show();
    setTimeout(drop, 120_000).unref?.();
  } catch {}
}

function attention(): void {
  const win = getMainWindow();
  if (!win || win.isFocused()) return;
  try {
    win.flashFrame(true);
    win.once("focus", () => !win.isDestroyed() && win.flashFrame(false));
  } catch {}
}

export function notify(input: NoticeInput, opts: { forceToast?: boolean } = {}): Notice {
  const n: Notice = {
    id: `n_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    at: Date.now(),
    read: false,
    kind: input.kind,
    tone: input.tone,
    title: String(input.title || "").slice(0, 120),
    body: String(input.body || "").slice(0, 400),
    ...(input.target ? { target: input.target } : {}),
    ...(input.path ? { path: input.path } : {})
  };
  const list = items();
  list.unshift(n);
  if (list.length > LIMIT) list.length = LIMIT;
  changed();
  send("notices:added", n);
  attention();
  desktopToast(n, opts.forceToast);
  return n;
}

export function markNoticesRead(ids?: string[]): NoticeFeed {
  const want = Array.isArray(ids) && ids.length ? new Set(ids) : null;
  let dirty = false;
  for (const n of items()) {
    if (!n.read && (!want || want.has(n.id))) {
      n.read = true;
      dirty = true;
    }
  }
  if (dirty) changed();
  return noticeFeed();
}

export function removeNotice(id: string): NoticeFeed {
  const list = items();
  const at = list.findIndex((n) => n.id === id);
  if (at >= 0) {
    list.splice(at, 1);
    changed();
  }
  return noticeFeed();
}

export function clearNotices(): NoticeFeed {
  items().length = 0;
  changed();
  return noticeFeed();
}

export function testNotice(): Notice {
  return notify(
    {
      kind: "system",
      tone: "info",
      title: "Notifications are working",
      body: "This is what alerts from Xaver look like.",
      target: "settings"
    },
    { forceToast: true }
  );
}

function openNotice(id: string): void {
  const n = items().find((x) => x.id === id);
  if (!n) return;
  if (!n.read) {
    n.read = true;
    changed();
  }
  const open = { id, target: n.target };
  revealWindow();
  if (isLocked()) pendingOpen = open;
  else send("notices:open", open);
}

export function takePendingOpen(): { id: string; target?: NoticeTarget } | null {
  const p = pendingOpen;
  pendingOpen = null;
  return p;
}

export function initNotifications(): void {
  items();
  onLockChange((locked) => {
    if (!locked) syncBadge();
  });
  app.on("browser-window-focus", syncBadge);
  app.on("browser-window-blur", syncBadge);
}
