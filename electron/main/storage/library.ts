import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { loadConfig, resolvedOutputRoot } from "./config";

export type LibraryRun = {
  id: string;
  name: string;
  path: string;
  mtime: number;
  photoCount: number;
  videoCount: number;
  gifCount: number;
};

export type LibraryFile = {
  id: string;
  name: string;
  path: string;
  kind: "image" | "video" | "gif";
  bytes: number;
  runId: string;
  rel: string;
};

function countMedia(dir: string): { photos: number; videos: number; gifs: number } {
  const photosDir = path.join(dir, "photos");
  const videosDir = path.join(dir, "videos");
  const gifsDir = path.join(dir, "gifs");
  const count = (d: string, re: RegExp) => {
    if (!fs.existsSync(d)) return 0;
    try {
      return fs.readdirSync(d).filter((f) => re.test(f)).length;
    } catch {
      return 0;
    }
  };
  return {
    photos: count(photosDir, /\.(jpe?g|png|webp)$/i),
    videos: count(videosDir, /\.(mp4|mov|webm|m4v)$/i),
    gifs: count(gifsDir, /\.(gif|mp4|webm)$/i)
  };
}

export function listRuns(): LibraryRun[] {
  const root = resolvedOutputRoot();
  if (!root || !fs.existsSync(root)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: LibraryRun[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;
    const full = path.join(root, ent.name);
    let mtime = 0;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const counts = countMedia(full);
    runs.push({
      id: ent.name,
      name: ent.name,
      path: full,
      mtime,
      photoCount: counts.photos,
      videoCount: counts.videos,
      gifCount: counts.gifs
    });
  }
  runs.sort((a, b) => b.mtime - a.mtime);
  return runs;
}

const FINGERPRINT_CHUNK = 64 * 1024;

function fileFingerprint(full: string, size: number): string {
  const hash = crypto.createHash("sha1");
  hash.update(String(size));
  let fd: number | null = null;
  try {
    fd = fs.openSync(full, "r");
    const head = Buffer.alloc(Math.min(FINGERPRINT_CHUNK, size));
    fs.readSync(fd, head, 0, head.length, 0);
    hash.update(head);
    if (size > FINGERPRINT_CHUNK * 2) {
      const tail = Buffer.alloc(FINGERPRINT_CHUNK);
      fs.readSync(fd, tail, 0, tail.length, size - FINGERPRINT_CHUNK);
      hash.update(tail);
    } else if (size > FINGERPRINT_CHUNK) {
      const rest = Buffer.alloc(size - FINGERPRINT_CHUNK);
      fs.readSync(fd, rest, 0, rest.length, FINGERPRINT_CHUNK);
      hash.update(rest);
    }
  } catch {
    return `path:${full}`;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
  return hash.digest("hex");
}

export function listRunFiles(runId: string): LibraryFile[] {
  const runs = listRuns();
  const run = runs.find((r) => r.id === runId || r.name === runId);
  if (!run) return [];
  const out: LibraryFile[] = [];
  const seenContent = new Set<string>();
  const walk = (subdir: string, kind: "image" | "video" | "gif") => {
    const dir = path.join(run.path, subdir);
    if (!fs.existsSync(dir)) return;
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of files) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size === 0) continue;
      if (!/\.(jpe?g|png|webp|gif|mp4|mov|webm|m4v)$/i.test(name)) continue;
      const fp = fileFingerprint(full, st.size);
      if (seenContent.has(fp)) continue;
      seenContent.add(fp);
      out.push({
        id: `${run.id}/${subdir}/${name}`,
        name,
        path: full,
        kind,
        bytes: st.size,
        runId: run.id,
        rel: path.join(subdir, name).replace(/\\/g, "/")
      });
    }
  };
  walk("photos", "image");
  walk("videos", "video");
  walk("gifs", "gif");
  return out;
}


function isUnderDir(abs: string, root: string): boolean {
  const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const target = fold(path.resolve(abs));
  const normalizedRoot = fold(path.resolve(root));
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  return target === normalizedRoot || target.startsWith(rootWithSep);
}

export function isOpenablePath(target: string): boolean {
  if (!target || typeof target !== "string" || !path.isAbsolute(target)) return false;
  const roots = [resolvedOutputRoot(), app.getPath("userData")].filter(Boolean);
  return roots.some((r) => isUnderDir(target, r));
}

export function resolveMediaPath(relativeOrAbsolute: string): string | null {
  const root = path.resolve(resolvedOutputRoot());
  const previewRoot = path.resolve(path.join(app.getPath("userData"), "preview-cache"));
  if (!relativeOrAbsolute) return null;
  let candidate = relativeOrAbsolute;
  if (/%[0-9A-Fa-f]{2}/.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {}
  }

  if (/^\/[A-Za-z]:\//.test(candidate)) {
    candidate = candidate.slice(1);
  }
  const abs = path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.normalize(path.join(root, candidate));
  if (!isUnderDir(abs, root) && !isUnderDir(abs, previewRoot)) {
    return null;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}
