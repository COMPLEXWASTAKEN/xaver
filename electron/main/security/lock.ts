import crypto from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, globalShortcut, powerMonitor } from "electron";
import { runHello } from "./hello";
import {
  applyCapture,
  applyCaptureAll,
  captureSupport,
  hideWindow,
  isWindowHidden,
  panicKeyActive,
  showWindow,
  syncPanicKey
} from "./privacy";
import { canEncrypt, readSecureJson, writeSecureJson } from "../storage/secure-store";
import { PANIC_KEYS, type LockReason, type SecurityPrefs, type SecurityStatus, type UnlockResult } from "../../shared/types";

type Store = {
  version: 1;
  pinHash: string | null;
  pinSalt: string | null;
  pinLength: number;
  hello: boolean;
  lockOnLaunch: boolean;
  idleMinutes: number;
  lockOnSystemLock: boolean;
  lockOnMinimize: boolean;
  hideFromCapture: boolean;
  blurWhenInactive: boolean;
  panicKey: string;
  encryptDatabase: boolean;
  dbKey: string | null;
  failedAttempts: number;
  lockoutUntil: number;
};

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const FREE_ATTEMPTS = 5;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;
const ACTIVITY_CHECK_MS = 10_000;

let store: Store | null = null;
let locked = false;
let lockReason: LockReason | null = null;
let lastActivity = Date.now();
let getWindow: () => BrowserWindow | null = () => null;
let helloAvailability: boolean | null = null;
let helloProbe: Promise<boolean> | null = null;
let helloInFlight: Promise<UnlockResult> | null = null;
let unlockChain: Promise<unknown> = Promise.resolve();
const listeners = new Set<(locked: boolean) => void>();

function storePath(): string {
  return join(app.getPath("userData"), "security.json");
}

function defaults(): Store {
  return {
    version: 1,
    pinHash: null,
    pinSalt: null,
    pinLength: 0,
    hello: false,
    lockOnLaunch: true,
    idleMinutes: 10,
    lockOnSystemLock: true,
    lockOnMinimize: false,
    hideFromCapture: false,
    blurWhenInactive: false,
    panicKey: "",
    encryptDatabase: canEncrypt(),
    dbKey: null,
    failedAttempts: 0,
    lockoutUntil: 0
  };
}

function load(): Store {
  if (store) return store;
  let raw: Partial<Store> | null = null;
  try {
    raw = readSecureJson<Partial<Store>>(storePath());
  } catch {
    raw = null;
  }
  store = { ...defaults(), ...(raw || {}) };
  if (store.panicKey && !PANIC_KEYS.includes(store.panicKey)) store.panicKey = "";
  if (store.encryptDatabase && !canEncrypt()) store.encryptDatabase = false;
  if (store.encryptDatabase && !store.dbKey) {
    store.dbKey = crypto.randomBytes(32).toString("base64");
    save();
  }
  return store;
}

function save(): void {
  if (!store) return;
  writeSecureJson(storePath(), store);
}

function pinSet(): boolean {
  const s = load();
  return Boolean(s.pinHash && s.pinSalt);
}

function hashPin(pin: string, saltB64: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, Buffer.from(saltB64, "base64"), 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,12}$/.test(pin);
}

function lockoutRemaining(): number {
  return Math.max(0, load().lockoutUntil - Date.now());
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = unlockChain.then(fn, fn);
  unlockChain = next.catch(() => {});
  return next;
}

async function checkPin(pin: string): Promise<UnlockResult> {
  const s = load();
  const wait = lockoutRemaining();
  if (wait > 0) return { ok: false, lockoutMs: wait, reason: "lockout" };
  if (!pinSet()) return { ok: true };
  if (!validPin(pin)) return { ok: false, reason: "invalid", attemptsLeft: Math.max(0, FREE_ATTEMPTS - s.failedAttempts) };
  const got = await hashPin(pin, s.pinSalt!);
  const want = Buffer.from(s.pinHash!, "base64");
  if (got.length === want.length && crypto.timingSafeEqual(got, want)) {
    if (s.failedAttempts || s.lockoutUntil) {
      s.failedAttempts = 0;
      s.lockoutUntil = 0;
      save();
    }
    return { ok: true };
  }
  s.failedAttempts += 1;
  let lockoutMs = 0;
  if (s.failedAttempts >= FREE_ATTEMPTS) {
    lockoutMs = Math.min(MAX_LOCKOUT_MS, 30_000 * 2 ** (s.failedAttempts - FREE_ATTEMPTS));
    s.lockoutUntil = Date.now() + lockoutMs;
  }
  save();
  return {
    ok: false,
    reason: lockoutMs ? "lockout" : "wrong",
    lockoutMs: lockoutMs || undefined,
    attemptsLeft: Math.max(0, FREE_ATTEMPTS - s.failedAttempts)
  };
}

function broadcast(): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("security:changed", status());
  for (const fn of listeners) {
    try {
      fn(locked);
    } catch {}
  }
}

export function onLockChange(fn: (locked: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isLocked(): boolean {
  return locked;
}

export function status(): SecurityStatus {
  const s = load();
  return {
    locked,
    lockReason: locked ? lockReason : null,
    pinSet: pinSet(),
    pinLength: s.pinLength,
    hello: s.hello && pinSet(),
    helloAvailable: helloAvailability === true,
    lockOnLaunch: s.lockOnLaunch,
    idleMinutes: s.idleMinutes,
    lockOnSystemLock: s.lockOnSystemLock,
    lockOnMinimize: s.lockOnMinimize,
    hideFromCapture: s.hideFromCapture,
    blurWhenInactive: s.blurWhenInactive,
    panicKey: s.panicKey,
    panicActive: panicKeyActive(s.panicKey),
    captureSupport: captureSupport(),
    encryptDatabase: s.encryptDatabase,
    encryptionAvailable: canEncrypt(),
    lockoutMs: lockoutRemaining(),
    failedAttempts: s.failedAttempts
  };
}

export function lockNow(reason: LockReason = "manual"): boolean {
  if (!pinSet() || locked) return locked;
  locked = true;
  lockReason = reason;
  broadcast();
  return true;
}

function unlock(): void {
  if (!locked) return;
  locked = false;
  lockReason = null;
  lastActivity = Date.now();
  broadcast();
}

export function markActivity(): void {
  if (!locked) lastActivity = Date.now();
}

export function unlockWithPin(pin: string): Promise<UnlockResult> {
  return serialize(async () => {
    if (!locked) return { ok: true };
    const r = await checkPin(String(pin || ""));
    if (r.ok) unlock();
    else broadcast();
    return r;
  });
}

export async function unlockWithHello(): Promise<UnlockResult> {
  if (!locked) return { ok: true };
  const s = load();
  if (!s.hello || !pinSet()) return { ok: false, reason: "unavailable" };
  if (lockoutRemaining() > 0) return { ok: false, reason: "lockout", lockoutMs: lockoutRemaining() };
  if (helloInFlight) return helloInFlight;
  helloInFlight = (async () => {
    try {
      const verdict = await runHello("verify");
      if (verdict === "Verified") {
        unlock();
        return { ok: true } as UnlockResult;
      }
      return { ok: false, reason: verdict === "Canceled" ? "cancelled" : "hello-failed", detail: verdict } as UnlockResult;
    } catch (e) {
      return { ok: false, reason: "hello-failed", detail: String((e as Error)?.message || e) } as UnlockResult;
    } finally {
      helloInFlight = null;
    }
  })();
  return helloInFlight;
}

export function setPin(current: string, next: string): Promise<UnlockResult> {
  return serialize(async () => {
    if (!validPin(next)) return { ok: false, reason: "invalid" };
    if (pinSet()) {
      const r = await checkPin(String(current || ""));
      if (!r.ok) return r;
    }
    const s = load();
    const salt = crypto.randomBytes(16).toString("base64");
    s.pinSalt = salt;
    s.pinHash = (await hashPin(next, salt)).toString("base64");
    s.pinLength = next.length;
    s.failedAttempts = 0;
    s.lockoutUntil = 0;
    save();
    broadcast();
    return { ok: true };
  });
}

export function removePin(current: string): Promise<UnlockResult> {
  return serialize(async () => {
    if (!pinSet()) return { ok: true };
    const r = await checkPin(String(current || ""));
    if (!r.ok) return r;
    const s = load();
    s.pinHash = null;
    s.pinSalt = null;
    s.pinLength = 0;
    s.hello = false;
    save();
    locked = false;
    lockReason = null;
    broadcast();
    return { ok: true };
  });
}

export function setPrefs(patch: Partial<SecurityPrefs>): Promise<SecurityStatus> {
  return serialize(() => applyPrefs(patch));
}

async function applyPrefs(patch: Partial<SecurityPrefs>): Promise<SecurityStatus> {
  const s = load();
  if (typeof patch.panicKey === "string" && patch.panicKey && !PANIC_KEYS.includes(patch.panicKey)) {
    throw new Error("Unknown shortcut.");
  }
  if (patch.hello === true) {
    if (!pinSet()) throw new Error("Set a PIN first. It's your fallback when Windows Hello isn't available.");
    if (!(await probeHello())) throw new Error("Windows Hello isn't set up on this PC.");
  }
  if (typeof patch.lockOnLaunch === "boolean") s.lockOnLaunch = patch.lockOnLaunch;
  if (typeof patch.lockOnSystemLock === "boolean") s.lockOnSystemLock = patch.lockOnSystemLock;
  if (typeof patch.lockOnMinimize === "boolean") s.lockOnMinimize = patch.lockOnMinimize;
  if (patch.idleMinutes != null) {
    s.idleMinutes = Math.max(0, Math.min(240, Math.floor(Number(patch.idleMinutes) || 0)));
  }
  if (typeof patch.hideFromCapture === "boolean") s.hideFromCapture = patch.hideFromCapture;
  if (typeof patch.blurWhenInactive === "boolean") s.blurWhenInactive = patch.blurWhenInactive;
  if (typeof patch.panicKey === "string") s.panicKey = patch.panicKey;
  if (typeof patch.hello === "boolean") s.hello = patch.hello;
  save();
  applyCaptureAll(s.hideFromCapture);
  syncPanicKey(s.panicKey || null, panic);
  broadcast();
  return status();
}

export function setEncryptDatabase(on: boolean): SecurityStatus {
  const s = load();
  if (on && !canEncrypt()) throw new Error("Windows data protection isn't available for this account.");
  s.encryptDatabase = on;
  if (on && !s.dbKey) s.dbKey = crypto.randomBytes(32).toString("base64");
  save();
  broadcast();
  return status();
}

export function databaseKey(): string | null {
  const s = load();
  return s.encryptDatabase && s.dbKey ? s.dbKey : null;
}

export function probeHello(): Promise<boolean> {
  if (helloAvailability !== null) return Promise.resolve(helloAvailability);
  if (!helloProbe) {
    helloProbe = runHello("check")
      .then((v) => v === "Available")
      .catch(() => false)
      .then((ok) => {
        helloAvailability = ok;
        helloProbe = null;
        broadcast();
        return ok;
      });
  }
  return helloProbe;
}

export function initSecurity(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  const s = load();
  locked = pinSet() && s.lockOnLaunch;
  lockReason = locked ? "launch" : null;
  void probeHello();

  powerMonitor.on("lock-screen", () => {
    if (load().lockOnSystemLock) lockNow("system");
  });
  powerMonitor.on("suspend", () => {
    if (load().lockOnSystemLock) lockNow("system");
  });

  syncPanicKey(s.panicKey || null, panic);
  app.on("will-quit", () => globalShortcut.unregisterAll());

  const timer = setInterval(() => {
    const cur = load();
    if (locked || !pinSet() || !cur.idleMinutes) return;
    if (Date.now() - lastActivity >= cur.idleMinutes * 60_000) lockNow("idle");
  }, ACTIVITY_CHECK_MS);
  timer.unref?.();
}

export function attachWindow(win: BrowserWindow): void {
  applyCapture(win, load().hideFromCapture);
  win.on("minimize", () => {
    if (load().lockOnMinimize) lockNow("minimize");
  });
  win.on("focus", () => markActivity());
}

function panic(): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (isWindowHidden(win)) {
    revealWindow();
    return;
  }
  lockNow("panic");
  hideWindow(win);
}

export function revealWindow(): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  showWindow(win);
}
