import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import archiver from "archiver";
import { imageFetchCandidates, filenameFor, sanitizeName, mediaIdentity, collapseMediaItems } from "../scrape/media.js";
import { sha256FileSync } from "../db/mediadb.js";

const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static");

export function createHttpContext(opts = {}) {
  const extra = opts.extraHTTPHeaders || {};
  const timeout = Number(opts.timeout) || 120000;
  let dispatcher;
  const proxyUrl = String(opts.proxyUrl || "").trim();
  if (proxyUrl) {
    try {
      const { ProxyAgent } = require("undici");
      dispatcher = new ProxyAgent(proxyUrl);
    } catch {}
  }
  return {
    async get(url, init = {}) {
      const ctrl = new AbortController();
      let timer = setTimeout(() => ctrl.abort(), timeout);
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(), timeout);
      };
      const outer = init.signal;
      const onOuterAbort = () => ctrl.abort();
      if (outer) {
        if (outer.aborted) ctrl.abort();
        else outer.addEventListener("abort", onOuterAbort, { once: true });
      }
      try {
        const headers = { ...extra, ...(init.headers || {}) };
        const fetchOpts = { headers, redirect: "follow", signal: ctrl.signal };
        if (dispatcher) fetchOpts.dispatcher = dispatcher;
        const fetchFn = dispatcher ? require("undici").fetch : fetch;
        const res = await fetchFn(url, fetchOpts);
        bump();
        const chunks = [];
        if (res.body && typeof res.body.getReader === "function") {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
            bump();
          }
        } else {
          chunks.push(Buffer.from(await res.arrayBuffer()));
        }
        const buf = Buffer.concat(chunks);
        const hdrs = {};
        res.headers.forEach((v, k) => {
          hdrs[k] = v;
        });
        return {
          ok: () => res.ok,
          status: () => res.status,
          headers: () => hdrs,
          url: () => res.url,
          body: async () => buf
        };
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuterAbort);
      }
    },
    async dispose() {}
  };
}

function looksLikeHtml(buf) {
  const head = Buffer.from(buf).subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

function looksLikeMedia(buf) {
  if (!buf || buf.length < 12) return false;
  const b = Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true;
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true;
  if (b.toString("utf8", 0, 7) === "#EXTM3U") return true;
  return false;
}

export function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export { sha256FileSync };

export function createKnownMediaCheck(db) {
  if (!db) return () => null;
  const check = db.createKnownCheck();
  return (item) => check(itemIndexKeys(item));
}

export function itemIndexKeys(item, extraUrl) {
  const keys = new Set();
  const add = (u) => {
    if (!u) return;
    keys.add(normalizeUrlKey(u));
  };
  add(item.url);
  add(extraUrl);
  const ident = item.id || mediaIdentity(item);
  if (ident) keys.add(ident);
  return [...keys].filter(Boolean);
}

function normalizeUrlKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.delete("tag");
    u.searchParams.delete("name");
    u.searchParams.delete("format");
    return u.href;
  } catch {
    return String(url || "");
  }
}

function abortError() {
  const err = new Error("Cancelled");
  err.name = "AbortError";
  return err;
}

async function fetchBuffer(requestContext, url, signal) {
  const res = await requestContext.get(url, {
    headers: {
      Accept: '*/*',
      Referer: "https://x.com/"
    },
    signal
  });
  if (!res.ok()) {
    const err = new Error(`HTTP ${res.status()} for ${url}`);
    err.status = res.status();
    err.retryAfter = res.headers()["retry-after"];
    throw err;
  }
  const body = Buffer.from(await res.body());
  const contentType = (res.headers()["content-type"] || "").split(";")[0].trim();
  if (looksLikeHtml(body)) {
    throw new Error(`HTML response for ${url}`);
  }
  if (!looksLikeMedia(body) && !/^(image|video|application\/octet-stream|application\/vnd\.apple\.mpegurl)/i.test(contentType)) {
    throw new Error(`Not media (${contentType || "unknown"}) for ${url}`);
  }
  return { body, contentType, url: typeof res.url === "function" ? res.url() : url };
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransient(err) {
  if (err?.status) return TRANSIENT_STATUS.has(err.status);
  const msg = String(err?.message || err);
  if (/^(HTML response|Not media)/.test(msg)) return false;
  return true;
}

function retryDelayMs(err, attempt) {
  const ra = err?.retryAfter;
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.min(60000, Math.max(0, secs * 1000));
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.min(60000, Math.max(0, at - Date.now()));
  }
  const base = err?.status === 429 ? 5000 : 800;
  return Math.min(30000, base * 2 ** attempt) + Math.floor(Math.random() * 400);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithRetry(requestContext, url, signal, retries) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      return await fetchBuffer(requestContext, url, signal);
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (attempt >= retries || !isTransient(e)) throw e;
      await sleep(retryDelayMs(e, attempt), signal);
    }
  }
}

async function fetchItem(requestContext, item, signal, retries = 0) {
  const urls =
    item.kind === "image" && !item.gif ? imageFetchCandidates(item.url) : [item.url];
  let lastErr = null;
  for (const u of urls) {
    if (signal?.aborted) throw abortError();
    try {
      return await fetchWithRetry(requestContext, u, signal, retries);
    } catch (e) {
      if (signal?.aborted) throw abortError();
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Failed to fetch ${item.url}`);
}

function extFor(item, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (item.gif) return ".gif";
  if (item.kind === "image") {
    if (ct.includes("png")) return ".png";
    if (ct.includes("webp")) return ".webp";
    if (ct.includes("gif")) return ".gif";
    try {
      const pathPart = new URL(item.url).pathname.toLowerCase();
      if (pathPart.endsWith(".png")) return ".png";
      if (pathPart.endsWith(".webp")) return ".webp";
      if (pathPart.endsWith(".gif")) return ".gif";
    } catch {}
    return ".jpg";
  }
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("quicktime") || ct.includes("video/mov")) return ".mov";
  try {
    const pathPart = new URL(item.url).pathname.toLowerCase();
    if (pathPart.endsWith(".webm")) return ".webm";
    if (pathPart.endsWith(".mov")) return ".mov";
    if (pathPart.endsWith(".m4v")) return ".m4v";
  } catch {}
  return ".mp4";
}

function looksLikeMp4Box(buf) {
  if (!buf || buf.length < 12) return false;
  const b = Buffer.from(buf);
  return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
}

function resolveFfmpeg() {
  let bin = typeof ffmpegStatic === "string" ? ffmpegStatic : "";
  if (bin.includes("app.asar") && !bin.includes("app.asar.unpacked")) {
    bin = bin.replace("app.asar", "app.asar.unpacked");
  }
  return bin;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpeg();
    if (!bin || !fs.existsSync(bin)) {
      reject(new Error("ffmpeg binary not found"));
      return;
    }
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 4000) err = err.slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

async function mp4BufferToGif(buf) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "xaver-gif-"));
  const input = path.join(dir, "in.mp4");
  const output = path.join(dir, "out.gif");
  try {
    await fs.promises.writeFile(input, buf);
    await runFfmpeg([
      "-y",
      "-i",
      input,
      "-an",
      "-vf",
      "fps=12,scale=480:-1:flags=lanczos:force_original_aspect_ratio=decrease,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
      "-loop",
      "0",
      output
    ]);
    const out = await fs.promises.readFile(output);
    if (out.length < 32 || out[0] !== 0x47 || out[1] !== 0x49) {
      throw new Error("gif encode failed");
    }
    return out;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export async function downloadAll(requestContext, items, outDir, options = {}) {
  const onProgress = typeof options === "function" ? options : options.onProgress;
  const onSaved = typeof options === "object" && typeof options.onSaved === "function" ? options.onSaved : null;
  const signal = typeof options === "object" ? options.signal : null;
  const db = options.db || null;
  const dedupe = options.dedupe !== false;
  const list = collapseMediaItems(items);

  fs.mkdirSync(outDir, { recursive: true });
  const photosDir = path.join(outDir, "photos");
  const videosDir = path.join(outDir, "videos");
  const gifsDir = path.join(outDir, "gifs");
  fs.mkdirSync(photosDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(gifsDir, { recursive: true });

  const saved = [];
  const skipped = [];
  const errors = [];
  const usedNames = new Set();
  const knownMedia = dedupe ? createKnownMediaCheck(db) : () => null;
  const runHashes = new Map();
  const concurrency = Math.max(1, Math.min(8, Math.floor(Number(options.concurrency) || 1)));
  const retries = Math.max(0, Math.min(6, Math.floor(Number(options.retries) || 0)));
  let cursor = 0;
  let done = 0;
  const tick = () => {
    done++;
    if (onProgress) onProgress(done, list.length, saved.length, errors.length, skipped.length);
  };

  const worker = async () => {
    while (cursor < list.length) {
      if (signal?.aborted) throw abortError();
      const i = cursor++;
      const item = list[i];
      const prev = knownMedia(item);
      if (prev) {
        skipped.push({ url: item.url, sha256: prev.sha256, path: prev.path, reason: "url" });
        db?.linkKeys(itemIndexKeys(item), prev.sha256);
        tick();
        continue;
      }

      try {
        let { body, contentType, url: usedUrl } = await fetchItem(requestContext, item, signal, retries);
        let ext = extFor(item, contentType);

        if (item.gif && (looksLikeMp4Box(body) || /mp4|octet-stream/i.test(contentType))) {
          try {
            body = await mp4BufferToGif(body);
            ext = ".gif";
            contentType = "image/gif";
          } catch {
            ext = ".mp4";
          }
        }

        const hash = sha256Buffer(body);

        const known = dedupe ? runHashes.get(hash) || (db ? db.aliveFile(hash) : null) : null;
        if (known) {
          db?.linkKeys(itemIndexKeys(item, usedUrl), hash);
          skipped.push({ url: item.url, sha256: hash, path: known.path, reason: "sha256" });
          tick();
          continue;
        }

        const folder =
          item.kind === "image" ? photosDir : item.gif ? gifsDir : videosDir;
        const short = hash.slice(0, 16);
        let base =
          item.kind === "video" || item.gif
            ? `${item.gif ? "gif" : "video"}_${short}${ext}`
            : filenameFor(item, i + 1);

        if (item.kind === "image" && !base.includes(short)) {
          const dot = base.lastIndexOf(".");
          const stem = dot > 0 ? base.slice(0, dot) : base;
          const e = dot > 0 ? base.slice(dot) : ext;
          base = `${stem}_${short}${e}`;
        }

        let name = base;
        while (usedNames.has(name) || fs.existsSync(path.join(folder, name))) {
          name = name.replace(/(\.\w+)?$/, `_d${usedNames.size}$1`);
        }
        usedNames.add(name);
        const dest = path.join(folder, name);
        const tmpDest = `${dest}.part`;
        fs.writeFileSync(tmpDest, body);
        fs.renameSync(tmpDest, dest);

        runHashes.set(hash, { path: dest });
        db?.recordFile({
          sha256: hash,
          path: dest,
          bytes: body.length,
          kind: item.kind === "image" ? "image" : item.gif ? "gif" : "video",
          profile: options.profile || null,
          sourceUrl: usedUrl || item.url,
          mediaId: item.id || mediaIdentity(item),
          runId: options.runId ?? null,
          keys: itemIndexKeys(item, usedUrl)
        });

        const entry = {
          path: dest,
          rel: path.relative(outDir, dest).replace(/\\/g, "/"),
          bytes: body.length,
          sha256: hash
        };
        saved.push(entry);
        if (onSaved) onSaved(entry, item);
        tick();
      } catch (e) {
        if (signal?.aborted || e?.name === "AbortError") throw abortError();
        errors.push({ url: item.url, err: String(e?.message || e) });
        tick();
      }
    }
  };

  try {
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, list.length) || 1 }, () => worker())
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  } finally {
    try {
      db?.flushNow();
    } catch {}
    try {
      fs.writeFileSync(
        path.join(outDir, "hashes.json"),
        JSON.stringify(
          {
            saved: saved.map((s) => ({ sha256: s.sha256, file: s.rel, bytes: s.bytes })),
            skipped
          },
          null,
          2
        )
      );
    } catch {}
  }

  return { saved, skipped, errors };
}


export async function zipFolderToFile(folderPath, zipPath) {
  await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 0 }, store: true });
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
    output.on("error", reject);
  });
  archive.pipe(output);
  archive.directory(folderPath, false);
  await archive.finalize();
  await done;
  return zipPath;
}

export function defaultStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function labelFromPath(profilePath) {
  const parts = String(profilePath).split("/").filter(Boolean);
  return sanitizeName(parts[0] || "media", 40);
}

export async function writeBytesStream(filePath, buffer) {
  await pipeline(Readable.from(buffer), fs.createWriteStream(filePath));
}
