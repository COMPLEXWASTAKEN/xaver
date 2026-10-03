import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { app, net, protocol, session } from "electron";
import { getSessionCookies } from "../auth/session";
import { isLocked } from "../security/lock";
import { resolveMediaPath } from "../storage/library";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const staging = new Map<string, Promise<string>>();

export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "xaver-media",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    },
    {
      scheme: "xaver-proxy",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true }
    }
  ]);
}

function previewDir(): string {
  return path.join(app.getPath("userData"), "preview-cache");
}

export function purgePreviewCache(): void {
  try {
    fs.rmSync(previewDir(), { recursive: true, force: true, maxRetries: 2 });
  } catch {}
}

function xCookieHeader(): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const c of getSessionCookies()) {
    const name = String(c.name || "");
    const value = String(c.value || "");
    if (!name || !value || seen.has(name)) continue;
    const domain = String(c.domain || "").toLowerCase();
    if (!domain || domain.includes("x.com") || domain.includes("twitter.com") || domain.includes("twimg.com")) {
      seen.add(name);
      parts.push(`${name}=${value}`);
    }
  }
  return parts.join("; ");
}

function xHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: "https://x.com/",
    Origin: "https://x.com",
    Accept: "*/*",
    "User-Agent": USER_AGENT
  };
  const cookie = xCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function fetchX(url: string, extra: Record<string, string> = {}): Promise<Response> {
  try {
    return await net.fetch(url, { headers: { ...xHeaders(), ...extra }, redirect: "error" });
  } catch {
    const { Cookie: _cookie, ...anonymous } = { ...xHeaders(), ...extra };
    return net.fetch(url, { headers: anonymous, redirect: "follow" });
  }
}

function isAllowedMediaHost(host: string): boolean {
  return /(^|\.)twimg\.com$|(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)pscp\.tv$|(^|\.)periscope\.tv$/.test(host);
}

function allowedRemote(url: string): boolean {
  if (!/^https:\/\//i.test(url)) return false;
  try {
    return isAllowedMediaHost(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function stageRemoteMedia(url: string): Promise<string> {
  const pending = staging.get(url);
  if (pending) return pending;
  const job = fetchPreview(url).finally(() => staging.delete(url));
  staging.set(url, job);
  return job;
}

async function fetchPreview(url: string): Promise<string> {
  if (!allowedRemote(url)) throw new Error("Host not allowed");
  const dir = previewDir();
  fs.mkdirSync(dir, { recursive: true });
  let ext = path.extname(new URL(url).pathname).toLowerCase();
  if (!/\.(mp4|m4v|webm|mov|gif|jpe?g|png|webp)$/i.test(ext)) ext = ".mp4";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 24);
  const dest = path.join(dir, `${hash}${ext}`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return dest;

  const res = await fetchX(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) throw new Error("Empty media");
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.part`;
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    if (!fs.existsSync(dest)) throw e;
  }
  return dest;
}

function serveFile(abs: string, range: string | null): Response {
  const stat = fs.statSync(abs);
  const mime = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : stat.size - 1;
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < stat.size) {
      return new Response(Readable.toWeb(fs.createReadStream(abs, { start, end })) as BodyInit, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes"
        }
      });
    }
    return new Response("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(abs)) as BodyInit, {
    status: 200,
    headers: { "Content-Type": mime, "Content-Length": String(stat.size), "Accept-Ranges": "bytes" }
  });
}

export function handleMediaProtocols(): void {
  protocol.handle("xaver-media", async (request) => {
    if (isLocked()) return new Response("Locked", { status: 423 });
    try {
      const u = new URL(request.url);
      let raw = u.pathname.replace(/^\//, "");
      try {
        raw = decodeURIComponent(raw);
      } catch {}
      if (u.hostname && u.hostname !== "local") raw = path.join(u.hostname, raw);
      const abs = resolveMediaPath(raw);
      if (!abs) return new Response("Not found", { status: 404 });
      return serveFile(abs, request.headers.get("range"));
    } catch {
      return new Response("Bad request", { status: 400 });
    }
  });

  protocol.handle("xaver-proxy", async (request) => {
    if (isLocked()) return new Response("Locked", { status: 423 });
    try {
      let target = new URL(request.url).searchParams.get("u") || "";
      try {
        target = decodeURIComponent(target);
      } catch {}
      if (!allowedRemote(target)) return new Response("Host not allowed", { status: 403 });
      const range = request.headers.get("range");
      const res = await fetchX(target, range ? { Range: range } : {});
      const out = new Headers(res.headers);
      out.delete("set-cookie");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    } catch {
      return new Response("Proxy error", { status: 502 });
    }
  });

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["*://*.twimg.com/*", "*://video.twimg.com/*", "*://*.video.twimg.com/*", "*://ton.twitter.com/*", "*://*.pscp.tv/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers.Referer = headers.Referer || headers.referer || "https://x.com/";
      headers.Origin = headers.Origin || headers.origin || "https://x.com";
      const cookie = xCookieHeader();
      if (cookie) headers.Cookie = cookie;
      callback({ requestHeaders: headers });
    }
  );
}
