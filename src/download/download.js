import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
    } catch (e) {
      throw new Error(`The proxy address isn't valid (${e?.message || e}). Fix it in Settings or clear it.`);
    }
  }
  const fetchFn = dispatcher ? require("undici").fetch : fetch;
  const cookieHeader = String(opts.cookieHeader || "");
  const wantsCookies = (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
    } catch {
      return false;
    }
  };
  return {
    async save(url, init, file) {
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
      let out = null;
      try {
        const headers = { ...extra, ...(init.headers || {}) };
        if (cookieHeader && wantsCookies(url)) headers.Cookie = cookieHeader;
        const fetchOpts = { headers, redirect: "follow", signal: ctrl.signal };
        if (dispatcher) fetchOpts.dispatcher = dispatcher;
        const res = await fetchFn(url, fetchOpts);
        bump();
        const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
        if (!res.ok) {
          try {
            await res.body?.cancel();
          } catch {}
          const err = new Error(`HTTP ${res.status} for ${url}`);
          err.status = res.status;
          err.retryAfter = res.headers.get("retry-after") || undefined;
          throw err;
        }
        const hash = crypto.createHash("sha256");
        let bytes = 0;
        let head = Buffer.alloc(0);
        let checked = false;
        const check = () => {
          checked = true;
          if (looksLikeHtml(head)) throw new Error(`HTML response for ${url}`);
          if (looksLikePlaylist(head)) throw new Error(`Not media (playlist) for ${url}`);
          if (!looksLikeMedia(head) && !/^(image|video|application\/octet-stream)/i.test(contentType)) {
            throw new Error(`Not media (${contentType || "unknown"}) for ${url}`);
          }
          out = fs.createWriteStream(file);
          out.on("error", () => {});
        };
        const write = async (chunk) => {
          hash.update(chunk);
          bytes += chunk.length;
          if (!out.write(chunk)) await once(out, "drain");
        };
        if (res.body) {
          for await (const value of res.body) {
            const chunk = Buffer.from(value);
            bump();
            if (!checked) {
              head = Buffer.concat([head, chunk]);
              if (head.length < 64) continue;
              check();
              await write(head);
              continue;
            }
            await write(chunk);
          }
        }
        if (!checked) {
          check();
          if (head.length) await write(head);
        }
        await new Promise((resolve, reject) => {
          out.once("error", reject);
          out.end(resolve);
        });
        out = null;
        if (!bytes) throw new Error(`Empty response for ${url}`);
        return { contentType, url: res.url || url, sha256: hash.digest("hex"), bytes, head: head.subarray(0, 64) };
      } catch (e) {
        if (out) {
          out.destroy();
          await once(out, "close").catch(() => {});
        }
        await fs.promises.rm(file, { force: true }).catch(() => {});
        if (ctrl.signal.aborted && !outer?.aborted) {
          const err = new Error(`Timed out after ${Math.max(1, Math.round(timeout / 1000))}s for ${url}`);
          err.status = 408;
          throw err;
        }
        throw e;
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuterAbort);
      }
    },
    async dispose() {
      if (dispatcher) await dispatcher.close().catch(() => {});
      dispatcher = null;
    }
  };
}

function looksLikePlaylist(buf) {
  return Buffer.from(buf).subarray(0, 16).toString("utf8").trimStart().startsWith("#EXTM3U");
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
  return false;
}

export { sha256FileSync };

export function createKnownMediaCheck(db, opts = {}) {
  if (!db) return () => null;
  const check = db.createKnownCheck({ remember: opts.remember === true });
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

async function fetchToFile(requestContext, url, signal, file) {
  return requestContext.save(url, { headers: { Accept: "*/*", Referer: "https://x.com/" }, signal }, file);
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransient(err) {
  if (err?.status) return TRANSIENT_STATUS.has(err.status);
  const msg = String(err?.message || err);
  if (/^(HTML response|Not media|Empty response)/.test(msg)) return false;
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

async function fetchWithRetry(requestContext, url, signal, retries, file) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      return await fetchToFile(requestContext, url, signal, file);
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (attempt >= retries || !isTransient(e)) throw e;
      await sleep(retryDelayMs(e, attempt), signal);
    }
  }
}

async function fetchItem(requestContext, item, signal, retries, file) {
  const urls =
    item.kind === "image" && !item.gif ? imageFetchCandidates(item.url) : [item.url];
  let lastErr = null;
  for (const u of urls) {
    if (signal?.aborted) throw abortError();
    try {
      return await fetchWithRetry(requestContext, u, signal, retries, file);
    } catch (e) {
      if (signal?.aborted) throw abortError();
      lastErr = e;
      if (isTransient(e)) throw e;
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

async function mp4FileToGif(input) {
  const output = `${input}.gif`;
  try {
    await runFfmpeg([
      "-y",
      "-f",
      "mp4",
      "-i",
      input,
      "-an",
      "-vf",
      "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
      "-loop",
      "0",
      "-f",
      "gif",
      output
    ]);
    const fh = await fs.promises.open(output, "r");
    const head = Buffer.alloc(6);
    let size = 0;
    try {
      size = (await fh.stat()).size;
      await fh.read(head, 0, 6, 0);
    } finally {
      await fh.close();
    }
    if (size < 32 || head[0] !== 0x47 || head[1] !== 0x49) throw new Error("gif encode failed");
    await fs.promises.rename(output, input);
    return { sha256: await sha256File(input), bytes: size };
  } finally {
    await fs.promises.rm(output, { force: true }).catch(() => {});
  }
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function downloadAll(requestContext, items, outDir, options = {}) {
  const onProgress = typeof options === "function" ? options : options.onProgress;
  const onSaved = typeof options === "object" && typeof options.onSaved === "function" ? options.onSaved : null;
  const signal = typeof options === "object" ? options.signal : null;
  const db = options.db || null;
  const dedupe = options.dedupe !== false;
  const list = collapseMediaItems(items);

  const split = options.split !== false;
  const shared = options.shared === true;
  const prefix = options.prefix ? `${sanitizeName(options.prefix, 40)}_` : "";
  fs.mkdirSync(outDir, { recursive: true });
  const photosDir = split ? path.join(outDir, "photos") : outDir;
  const videosDir = split ? path.join(outDir, "videos") : outDir;
  const gifsDir = split ? path.join(outDir, "gifs") : outDir;
  if (split) {
    fs.mkdirSync(photosDir, { recursive: true });
    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(gifsDir, { recursive: true });
  }

  const saved = [];
  const skipped = [];
  const errors = [];
  const usedNames = new Set();
  const remember = options.remember === true;
  const knownMedia = dedupe ? createKnownMediaCheck(db, { remember }) : () => null;
  const runHashes = new Map();
  const concurrency = Math.max(1, Math.min(8, Math.floor(Number(options.concurrency) || 1)));
  const retries = Math.max(0, Math.min(6, Math.floor(Number(options.retries) || 0)));
  let cursor = 0;
  let done = 0;
  const reportExisting = (known, item) => {
    if (!onSaved || !known?.path) return;
    const rel = path.relative(outDir, known.path).replace(/\\/g, "/");
    onSaved({ path: known.path, rel, bytes: known.bytes || 0, sha256: known.sha256, existing: true }, item);
  };
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
        reportExisting(prev, item);
        tick();
        continue;
      }

      const part = path.join(outDir, `.xaver-${process.pid}-${i}-${crypto.randomBytes(4).toString("hex")}.part`);
      try {
        let { contentType, url: usedUrl, sha256: hash, bytes, head } = await fetchItem(requestContext, item, signal, retries, part);
        let ext = extFor(item, contentType);

        if (item.gif && (looksLikeMp4Box(head) || /mp4|octet-stream/i.test(contentType))) {
          try {
            ({ sha256: hash, bytes } = await mp4FileToGif(part));
            ext = ".gif";
            contentType = "image/gif";
          } catch {
            ext = ".mp4";
          }
        }

        const known = dedupe ? runHashes.get(hash) || (db ? db.knownFile(hash, { remember }) : null) : null;
        if (known) {
          await fs.promises.rm(part, { force: true }).catch(() => {});
          db?.linkKeys(itemIndexKeys(item, usedUrl), hash);
          skipped.push({ url: item.url, sha256: hash, path: known.path, reason: "sha256" });
          reportExisting({ ...known, sha256: hash }, item);
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

        if (shared) base = base.replace(/^(photo|gif|video)_\d{4,}_/, "$1_");
        base = prefix + base;

        let name = base;
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const tail = dot > 0 ? base.slice(dot) : "";
        for (let n = 2; usedNames.has(folder + name) || fs.existsSync(path.join(folder, name)); n++) {
          name = `${stem}_${n}${tail}`;
        }
        usedNames.add(folder + name);
        const dest = path.join(folder, name);
        runHashes.set(hash, { path: dest });
        try {
          await fs.promises.rename(part, dest);
        } catch (e) {
          runHashes.delete(hash);
          usedNames.delete(folder + name);
          throw e;
        }

        db?.recordFile({
          sha256: hash,
          path: dest,
          bytes,
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
          bytes,
          sha256: hash
        };
        saved.push(entry);
        if (onSaved) onSaved(entry, item);
        tick();
      } catch (e) {
        await fs.promises.rm(part, { force: true }).catch(() => {});
        if (signal?.aborted || e?.name === "AbortError") throw abortError();
        errors.push({ url: item.url, err: String(e?.message || e), status: Number(e?.status) || 0, item });
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
      const file = path.join(outDir, "hashes.json");
      const fresh = saved.map((s) => ({ sha256: s.sha256, file: s.rel, bytes: s.bytes }));
      let earlier = [];
      if (shared) {
        try {
          const prev = JSON.parse(fs.readFileSync(file, "utf8"));
          if (Array.isArray(prev?.saved)) earlier = prev.saved;
        } catch {}
      }
      const mine = new Set(fresh.map((s) => s.file));
      const merged = [...earlier.filter((s) => s && !mine.has(s.file)), ...fresh];
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ saved: merged, skipped }, null, 2));
      fs.renameSync(tmp, file);
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

export async function zipFilesToFile(files, baseDir, zipPath) {
  await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 0 }, store: true });
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
    output.on("error", reject);
  });
  archive.pipe(output);
  for (const file of files) {
    archive.file(file, { name: path.relative(baseDir, file).replace(/\\/g, "/") });
  }
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

