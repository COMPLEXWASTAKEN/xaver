import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, nativeImage, net, protocol, session } from "electron";
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
const PREVIEW_MAX_BYTES = 1024 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const THUMB_SIZE = 360;
const THUMB_CACHE = 800;
const thumbs = new Map<string, Promise<Buffer | null>>();

function thumbnail(abs: string, stamp: string): Promise<Buffer | null> {
  const key = `${abs}|${stamp}`;
  const hit = thumbs.get(key);
  if (hit) {
    thumbs.delete(key);
    thumbs.set(key, hit);
    return hit;
  }
  const job = nativeImage
    .createThumbnailFromPath(abs, { width: THUMB_SIZE, height: THUMB_SIZE })
    .then((img) => (img.isEmpty() ? null : img.toJPEG(82)))
    .catch(() => null);
  thumbs.set(key, job);
  if (thumbs.size > THUMB_CACHE) thumbs.delete(thumbs.keys().next().value as string);
  return job;
}

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

function needsCookies(host: string): boolean {
  return host === "ton.twitter.com";
}

function xHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: "https://x.com/",
    Origin: "https://x.com",
    Accept: "*/*",
    "User-Agent": USER_AGENT
  };
  try {
    if (needsCookies(new URL(url).hostname.toLowerCase())) {
      const cookie = xCookieHeader();
      if (cookie) headers.Cookie = cookie;
    }
  } catch {}
  return headers;
}

async function fetchX(url: string, extra: Record<string, string> = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedRemote(current)) throw new Error("Host not allowed");
    const res = await net.fetch(current, { headers: { ...xHeaders(current), ...extra }, redirect: "manual" });
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res;
    const next = res.headers.get("location");
    try {
      await res.body?.cancel();
    } catch {}
    if (!next) return res;
    current = new URL(next, current).href;
  }
  throw new Error("Too many redirects");
}

function isAllowedMediaHost(host: string): boolean {
  return /(^|\.)twimg\.com$/.test(host) || host === "ton.twitter.com";
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
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length")) > PREVIEW_MAX_BYTES) {
    await res.body.cancel().catch(() => {});
    throw new Error("Too large to preview");
  }
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.part`;
  try {
    let bytes = 0;
    const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    body.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > PREVIEW_MAX_BYTES) body.destroy(new Error("Too large to preview"));
    });
    await pipeline(body, fs.createWriteStream(tmp));
    if (bytes < 32) throw new Error("Empty media");
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    if (!fs.existsSync(dest)) throw e;
  }
  return dest;
}

function serveFile(abs: string, range: string | null): Response {
  const stat = fs.statSync(abs);
  const mime = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (!m[1] && !Number(m[2])) start = stat.size;
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
      if (u.hostname === "thumb") {
        const abs = resolveMediaPath(raw);
        if (!abs) return new Response("Not found", { status: 404 });
        const st = await fs.promises.stat(abs);
        const jpg = await thumbnail(abs, `${st.size}:${st.mtimeMs}`);
        if (jpg) {
          return new Response(new Uint8Array(jpg), {
            status: 200,
            headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpg.length), "Cache-Control": "max-age=3600" }
          });
        }
        if (/\.(jpe?g|png|webp|gif)$/i.test(abs)) return serveFile(abs, null);
        return new Response("No thumbnail", { status: 404 });
      }
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
    { urls: ["*://*.twimg.com/*", "*://ton.twitter.com/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers.Referer = headers.Referer || headers.referer || "https://x.com/";
      headers.Origin = headers.Origin || headers.origin || "https://x.com";
      try {
        if (needsCookies(new URL(details.url).hostname.toLowerCase())) {
          const cookie = xCookieHeader();
          if (cookie) headers.Cookie = cookie;
        }
      } catch {}
      callback({ requestHeaders: headers });
    }
  );
}
