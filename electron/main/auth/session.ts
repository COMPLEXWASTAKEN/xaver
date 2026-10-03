import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, dialog, app } from "electron";
type Cookie = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type BrowserContext = {
  cookies: () => Promise<Cookie[]>;
  addCookies: (cookies: unknown[]) => Promise<void>;
  pages: () => unknown[];
};

type Page = {
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
};
import {
  clearSession,
  loadConfig,
  loadSession,
  safeLaunchArgs,
  saveSession,
  type StoredSession
} from "../storage/config";
import type { AuthStatus } from "../../shared/types";
import { loadEngineModule } from "../engine/loader";


function loadCookieModule() {
  return loadEngineModule("core/cookies.js");
}

function loadBrowserModule() {
  return loadEngineModule("core/browser.js");
}

function cookieNames(cookies: Array<{ name?: string }>): Set<string> {
  return new Set(cookies.map((c) => String(c.name || "")));
}

export function getShardxCacheDir(): string {
  const cfg = loadConfig();
  if (cfg.shardxCacheDir && path.isAbsolute(cfg.shardxCacheDir.trim())) {
    return path.resolve(cfg.shardxCacheDir.trim());
  }
  return path.join(app.getPath("userData"), "shardx");
}

export function getCloakProfileDir(): string {
  return getShardxCacheDir();
}

function shardxLaunchFromConfig(onLog?: (m: string) => void) {
  const cfg = loadConfig();
  const extraArgs = safeLaunchArgs(cfg.playwrightArgs).filter((a) => !/disable-blink-features=AutomationControlled/i.test(a));

  return {
    cacheDir: getShardxCacheDir(),
    userDataDir: getShardxCacheDir(),
    headless: false,
    proxyUrl: cfg.proxyUrl || undefined,
    humanize: cfg.shardxHumanize !== false,
    template: cfg.shardxTemplate || "win-rtx4060",
    profileId: cfg.shardxProfileId || undefined,
    timezone: cfg.shardxTimezone || undefined,
    webrtc: cfg.shardxWebrtc || "auto",
    extraArgs,
    onLog
  };
}

export function sessionToStatus(session: StoredSession | null): AuthStatus {
  if (!session?.cookies?.length) {
    return {
      authenticated: false,
      screenName: null,
      cookieCount: 0,
      hasAuthToken: false,
      hasCt0: false,
      updatedAt: null,
      source: "none"
    };
  }
  const names = cookieNames(session.cookies as Array<{ name?: string }>);
  const hasAuthToken = names.has("auth_token");
  const hasCt0 = names.has("ct0");
  return {
    authenticated: hasAuthToken && hasCt0,
    screenName: session.screenName,
    cookieCount: session.cookies.length,
    hasAuthToken,
    hasCt0,
    updatedAt: session.updatedAt,
    source: session.source
  };
}

export function getAuthStatus(): AuthStatus {
  return sessionToStatus(loadSession());
}

export async function importCookiesFromText(
  text: string,
  source: "file" | "paste" = "paste"
): Promise<AuthStatus> {
  const { parseCookieText, expandCookiesForX } = await loadCookieModule();
  const cookies = expandCookiesForX(parseCookieText(text));
  const session: StoredSession = {
    cookies,
    updatedAt: new Date().toISOString(),
    source,
    screenName: null
  };
  saveSession(session);
  return sessionToStatus(session);
}

export async function importCookiesFromFile(filePath: string): Promise<AuthStatus> {
  const text = fs.readFileSync(filePath, "utf8");
  return importCookiesFromText(text, "file");
}

export async function pickAndImportCookieFile(
  parent: BrowserWindow | null
): Promise<AuthStatus | null> {
  const opts: Electron.OpenDialogOptions = {
    title: "Select cookie export",
    filters: [
      { name: "Cookie export", extensions: ["txt", "cookies", "json"] },
      { name: "All files", extensions: ["*"] }
    ],
    properties: ["openFile"]
  };
  const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths[0]) return null;
  return importCookiesFromFile(res.filePaths[0]);
}

function hasSessionCookies(cookies: Cookie[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return names.has("auth_token") && names.has("ct0");
}

async function captureSessionFromContext(
  context: BrowserContext,
  page: Page,
  source: StoredSession["source"]
): Promise<AuthStatus> {
  const raw = await context.cookies();
  const captured = raw.filter((c) =>
    /x\.com|twitter\.com/i.test(c.domain.replace(/^\./, ""))
  );
  if (!hasSessionCookies(captured)) {
    throw new Error("No auth_token / ct0 in profile yet.");
  }

  const { expandCookiesForX } = await loadCookieModule();
  const mapped = captured.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain.startsWith(".") ? c.domain : `.${c.domain.replace(/^\./, "")}`,
    path: c.path || "/",
    expires: (c.expires ?? 0) > 0 ? c.expires : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax"
  }));
  const cookies = expandCookiesForX(mapped);

  let screenName: string | null = null;
  try {
    const { readLoggedInScreenName } = await loadEngineModule("scrape/scrape.js");
    screenName = await readLoggedInScreenName(page);
  } catch {
    screenName = null;
  }

  const session: StoredSession = {
    cookies,
    updatedAt: new Date().toISOString(),
    source,
    screenName
  };
  saveSession(session);
  return sessionToStatus(session);
}

export async function loginWithBrowser(
  parent: BrowserWindow | null
): Promise<AuthStatus> {
  const { openShardxContext } = await loadBrowserModule();
  const log = (message: string) => {
    if (parent && !parent.isDestroyed()) {
      parent.webContents.send("auth:login-waiting", { message });
    }
  };

  let handle: { context: BrowserContext; page: Page; close: () => Promise<void> } | null = null;

  try {
    log("Starting ShardX (anti-detect Chromium 152)…");
    const opened = await openShardxContext(shardxLaunchFromConfig(log));
    if (!opened) throw new Error("ShardX could not start.");
    handle = opened;
    const { context, page } = opened;


    await page.goto("https://x.com/", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });
    await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 1500)));

    await page.goto("https://x.com/i/flow/login", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    log("Complete login in the ShardX window. Waiting for session cookies…");

    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const cookies = await context.cookies();
        if (hasSessionCookies(cookies)) {
          const status = await captureSessionFromContext(context, page, "browser");
          log(
            `Session captured${status.screenName ? ` · @${status.screenName}` : ""}. Closing browser…`
          );
          await opened.close();
          handle = null;
          return status;
        }
      } catch {

      }

      try {
        if (context.pages().length === 0) {

          await new Promise((r) => setTimeout(r, 800));
          if (context.pages().length === 0) {
            throw new Error("Login browser closed before session cookies were captured.");
          }
        }
      } catch (e) {
        if (/closed|Target/i.test(String((e as Error)?.message || e))) {
          throw new Error("Login browser closed before session cookies were captured.");
        }
      }
    }

    throw new Error("Timed out waiting for auth_token / ct0. Try again or import cookies.");
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
}

export async function refreshScreenName(): Promise<AuthStatus> {
  const session = loadSession();
  if (!session?.cookies?.length) return getAuthStatus();

  const { openShardxContext } = await loadBrowserModule();
  const handle = await openShardxContext({
    ...shardxLaunchFromConfig(),
    headless: true,
    humanize: false
  });
  try {
    await handle.context.addCookies(session.cookies as never[]);
    const { readLoggedInScreenName } = await loadEngineModule("scrape/scrape.js");
    const screenName = await readLoggedInScreenName(handle.page);
    session.screenName = screenName;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    return sessionToStatus(session);
  } finally {
    await handle.close();
  }
}

export function clearAuth(): AuthStatus {
  clearSession();
  return getAuthStatus();
}


export async function clearShardxProfile(): Promise<string> {
  const dir = getShardxCacheDir();
  try {
    const { clearShardxProfile: wipe } = await loadBrowserModule();
    wipe(dir);
  } catch {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  return dir;
}

export async function clearCloakProfile(): Promise<string> {
  return clearShardxProfile();
}

export function getSessionCookies(): Array<Record<string, unknown>> {
  return loadSession()?.cookies || [];
}

export async function ensureShardxReady(
  parent: BrowserWindow | null
): Promise<{ ok: boolean; info?: unknown; error?: string }> {
  try {
    const { ensureShardxReady: ensure } = await loadBrowserModule();
    const info = await ensure(getShardxCacheDir(), (message: string) => {
      if (parent && !parent.isDestroyed()) {
        parent.webContents.send("auth:login-waiting", { message });
      }
    });
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function ensureCloakReady(parent: BrowserWindow | null) {
  return ensureShardxReady(parent);
}
