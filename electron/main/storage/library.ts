import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { resolvedOutputRoot } from "./config";

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

type Kind = "image" | "video" | "gif";

const SUBDIRS: [string, Kind][] = [
  ["photos", "image"],
  ["videos", "video"],
  ["gifs", "gif"]
];

const MEDIA_RE = /\.(jpe?g|png|webp|gif|mp4|mov|webm|m4v)$/i;

function kindOf(name: string, fallback: Kind | null): Kind | null {
  if (!MEDIA_RE.test(name)) return null;
  if (fallback) return fallback;
  if (/\.gif$/i.test(name) || /(^|_)gif_/i.test(name)) return "gif";
  return /\.(jpe?g|png|webp)$/i.test(name) ? "image" : "video";
}

function readNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function eachMedia(dir: string, visit: (subdir: string, name: string, kind: Kind) => void): void {
  for (const [subdir, kind] of SUBDIRS) {
    for (const name of readNames(path.join(dir, subdir))) {
      if (kindOf(name, kind)) visit(subdir, name, kind);
    }
  }
  for (const name of readNames(dir)) {
    const kind = kindOf(name, null);
    if (kind) visit("", name, kind);
  }
}

function countMedia(dir: string): { photos: number; videos: number; gifs: number } {
  const counts = { photos: 0, videos: 0, gifs: 0 };
  eachMedia(dir, (_s, _n, kind) => {
    if (kind === "image") counts.photos++;
    else if (kind === "gif") counts.gifs++;
    else counts.videos++;
  });
  return counts;
}

function latestChange(dir: string): number {
  let latest = 0;
  for (const d of [dir, ...SUBDIRS.map(([s]) => path.join(dir, s))]) {
    try {
      latest = Math.max(latest, fs.statSync(d).mtimeMs);
    } catch {}
  }
  return latest;
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
    const mtime = latestChange(full);
    if (!mtime) continue;
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

async function fileFingerprint(full: string, size: number): Promise<string> {
  const hash = crypto.createHash("sha1");
  hash.update(String(size));
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(full, "r");
    const head = Buffer.alloc(Math.min(FINGERPRINT_CHUNK, size));
    await fh.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > FINGERPRINT_CHUNK * 2) {
      const tail = Buffer.alloc(FINGERPRINT_CHUNK);
      await fh.read(tail, 0, tail.length, size - FINGERPRINT_CHUNK);
      hash.update(tail);
    } else if (size > FINGERPRINT_CHUNK) {
      const rest = Buffer.alloc(size - FINGERPRINT_CHUNK);
      await fh.read(rest, 0, rest.length, FINGERPRINT_CHUNK);
      hash.update(rest);
    }
  } catch {
    return `path:${full}`;
  } finally {
    await fh?.close().catch(() => {});
  }
  return hash.digest("hex");
}

export async function listRunFiles(runId: string): Promise<LibraryFile[]> {
  const root = resolvedOutputRoot();
  const id = String(runId || "");
  if (!root || !id || id.startsWith(".") || /[\\/]/.test(id)) return [];
  const dir = path.join(root, id);
  if (!isUnderDir(dir, root)) return [];
  try {
    if (!(await fs.promises.stat(dir)).isDirectory()) return [];
  } catch {
    return [];
  }
  const found: { subdir: string; name: string; kind: Kind }[] = [];
  eachMedia(dir, (subdir, name, kind) => found.push({ subdir, name, kind }));
  const files: (LibraryFile & { size: number })[] = [];
  const LIMIT = 16;
  for (let i = 0; i < found.length; i += LIMIT) {
    const batch = await Promise.all(
      found.slice(i, i + LIMIT).map(async ({ subdir, name, kind }) => {
        const full = path.join(dir, subdir, name);
        try {
          const st = await fs.promises.stat(full);
          if (!st.isFile() || st.size === 0) return null;
          const rel = (subdir ? `${subdir}/${name}` : name).replace(/\\/g, "/");
          return { id: `${id}/${rel}`, name, path: full, kind, bytes: st.size, runId: id, rel, size: st.size };
        } catch {
          return null;
        }
      })
    );
    for (const f of batch) if (f) files.push(f);
  }
  const bySize = new Map<number, number>();
  for (const f of files) bySize.set(f.size, (bySize.get(f.size) || 0) + 1);
  const seenContent = new Set<string>();
  const out: LibraryFile[] = [];
  for (const f of files) {
    if ((bySize.get(f.size) || 0) > 1) {
      const fp = await fileFingerprint(f.path, f.size);
      if (seenContent.has(fp)) continue;
      seenContent.add(fp);
    }
    const { size: _size, ...file } = f;
    out.push(file);
  }
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
