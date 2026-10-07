import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const DB_FILE_NAME = "media-index.sqlite";
export const LEGACY_INDEX_NAME = ".media-hashes.json";
export const LEGACY_MIGRATED_SUFFIX = ".migrated";
const SCHEMA_VERSION = 1;
const MEDIA_EXT = /\.(mp4|mov|webm|m4v|jpe?g|png|webp|gif)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const FLUSH_DELAY_MS = 750;
const ENC_MAGIC = Buffer.from("PMSDB1", "latin1");
const IV_LEN = 12;
const TAG_LEN = 16;

export class MediaDbLockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "MediaDbLockedError";
    this.code = "DB_ENCRYPTED";
  }
}

function normalizeKey(key) {
  if (!key) return null;
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), /^[a-f0-9]{64}$/i.test(String(key)) ? "hex" : "base64");
  if (buf.length !== 32) throw new Error("Database key must be 32 bytes");
  return buf;
}

export function isEncryptedDbBuffer(buf) {
  return buf.length > ENC_MAGIC.length + IV_LEN + TAG_LEN && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC);
}

function encryptDb(plain, key) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(ENC_MAGIC);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([ENC_MAGIC, iv, cipher.getAuthTag(), ct]);
}

function decryptDb(buf, key) {
  const iv = buf.subarray(ENC_MAGIC.length, ENC_MAGIC.length + IV_LEN);
  const tag = buf.subarray(ENC_MAGIC.length + IV_LEN, ENC_MAGIC.length + IV_LEN + TAG_LEN);
  const ct = buf.subarray(ENC_MAGIC.length + IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(ENC_MAGIC);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS files (
  sha256 TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'image',
  profile TEXT,
  source_url TEXT,
  media_id TEXT,
  run_id INTEGER,
  origin TEXT NOT NULL DEFAULT 'download',
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  missing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_path ON files(path);
CREATE INDEX IF NOT EXISTS files_profile ON files(profile);
CREATE INDEX IF NOT EXISTS files_created ON files(created_at);
CREATE TABLE IF NOT EXISTS media_keys (
  key TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL REFERENCES files(sha256) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_keys_sha ON media_keys(sha256);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile TEXT,
  run_dir TEXT,
  out_root TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  requested INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS imports (
  source TEXT PRIMARY KEY,
  imported_at INTEGER NOT NULL,
  files INTEGER NOT NULL DEFAULT 0,
  keys INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0
);
`;

let sqlPromise = null;

function loadSql() {
  if (!sqlPromise) {
    const init = require("sql.js");
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const wasmBinary = fs.readFileSync(wasmPath);
    sqlPromise = init({ wasmBinary }).catch((e) => {
      sqlPromise = null;
      throw e;
    });
  }
  return sqlPromise;
}

export function defaultDbPath() {
  const fromEnv = process.env.XAVER_DB || process.env.PMS_DB;
  if (fromEnv) return path.resolve(fromEnv);
  let base;
  if (process.platform === "win32") {
    base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    base = path.join(os.homedir(), "Library", "Application Support");
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  }
  const legacy = path.join(base, "Profile Media Saver", DB_FILE_NAME);
  return fs.existsSync(legacy) ? legacy : path.join(base, "Xaver", DB_FILE_NAME);
}

export function sha256FileSync(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function pathKey(p) {
  const abs = path.resolve(p);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function kindFromName(name) {
  if (/\.gif$/i.test(name)) return "gif";
  if (VIDEO_EXT.test(name)) return /(^|[\\/])gifs[\\/]/i.test(name) ? "gif" : "video";
  return "image";
}

function looksLikeSqlite(buf) {
  return buf.length >= 16 && buf.subarray(0, 15).toString("latin1") === "SQLite format 3";
}

class MediaDb {
  constructor(SQL, dbPath, key = null) {
    this.SQL = SQL;
    this.path = dbPath;
    this.key = normalizeKey(key);
    this.flushTimer = null;
    this.dirty = false;
    this.lastSavedAt = null;
    this.recoveredFrom = null;
    this.db = this.openFile();
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.setMeta("schema_version", String(SCHEMA_VERSION));
    if (!this.getMeta("created_at")) this.setMeta("created_at", String(Date.now()));
    this.flushNow();
  }

  openFile() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    if (fs.existsSync(this.path)) {
      let buf = fs.readFileSync(this.path);
      if (isEncryptedDbBuffer(buf)) {
        if (!this.key) {
          throw new MediaDbLockedError("The media database is encrypted by the desktop app and can only be opened there.");
        }
        try {
          buf = decryptDb(buf, this.key);
        } catch {
          throw new MediaDbLockedError("The media database could not be decrypted with this key.");
        }
      } else if (this.key && buf.length && looksLikeSqlite(buf)) {
        this.dirty = true;
      }
      if (buf.length && looksLikeSqlite(buf)) {
        try {
          const db = new this.SQL.Database(buf);
          db.exec("SELECT count(*) FROM sqlite_master;");
          this.lastSavedAt = fs.statSync(this.path).mtimeMs;
          return db;
        } catch {}
      }
      if (buf.length) {
        const bad = `${this.path}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.path, bad);
          this.recoveredFrom = bad;
        } catch {}
      }
    }
    return new this.SQL.Database();
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    this.markDirty();
  }

  tx(fn) {
    this.db.exec("BEGIN;");
    try {
      const out = fn();
      this.db.exec("COMMIT;");
      this.markDirty();
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {}
      throw e;
    }
  }

  getMeta(key) {
    return this.get("SELECT value FROM meta WHERE key = ?", [key])?.value ?? null;
  }

  setMeta(key, value) {
    this.run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      key,
      value == null ? null : String(value)
    ]);
  }

  markDirty() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        this.flushNow();
      } catch {}
    }, FLUSH_DELAY_MS);
    if (typeof this.flushTimer.unref === "function") this.flushTimer.unref();
  }

  flushNow() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty && fs.existsSync(this.path)) return;
    const plain = Buffer.from(this.db.export());
    this.db.exec("PRAGMA foreign_keys = ON;");
    const data = this.key ? encryptDb(plain, this.key) : plain;
    const tmp = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, this.path);
    } catch {
      fs.copyFileSync(tmp, this.path);
      fs.rmSync(tmp, { force: true });
    }
    this.dirty = false;
    this.lastSavedAt = Date.now();
  }

  createKnownCheck({ remember = false } = {}) {
    const alive = new Map();
    const isAlive = (p) => {
      if (remember) return true;
      if (!p) return false;
      if (!alive.has(p)) alive.set(p, fs.existsSync(p));
      return alive.get(p);
    };
    return (keys) => {
      const list = [...new Set((keys || []).filter(Boolean))];
      if (!list.length) return null;
      const rows = this.all(
        `SELECT f.sha256 AS sha256, f.path AS path FROM media_keys k
         JOIN files f ON f.sha256 = k.sha256
         WHERE k.key IN (${list.map(() => "?").join(",")})`,
        list
      );
      for (const r of rows) {
        if (isAlive(r.path)) return { sha256: r.sha256, path: r.path };
      }
      return null;
    };
  }

  aliveFile(sha256) {
    const row = this.get("SELECT sha256, path, bytes, kind FROM files WHERE sha256 = ?", [sha256]);
    if (!row || !row.path || !fs.existsSync(row.path)) return null;
    return row;
  }

  knownFile(sha256, { remember = false } = {}) {
    if (!remember) return this.aliveFile(sha256);
    return this.get("SELECT sha256, path, bytes, kind FROM files WHERE sha256 = ?", [sha256]) || null;
  }

  linkKeys(keys, sha256) {
    const list = [...new Set((keys || []).filter(Boolean))];
    if (!list.length || !sha256) return;
    const now = Date.now();
    this.tx(() => {
      for (const k of list) {
        this.db.run(
          "INSERT INTO media_keys(key, sha256, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET sha256 = excluded.sha256",
          [k, sha256, now]
        );
      }
    });
  }

  recordFile(rec) {
    const now = Date.now();
    this.tx(() => {
      this.db.run(
        `INSERT INTO files(sha256, path, bytes, kind, profile, source_url, media_id, run_id, origin, created_at, verified_at, missing)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(sha256) DO UPDATE SET
           path = excluded.path,
           bytes = excluded.bytes,
           kind = excluded.kind,
           profile = COALESCE(excluded.profile, files.profile),
           source_url = COALESCE(excluded.source_url, files.source_url),
           media_id = COALESCE(excluded.media_id, files.media_id),
           run_id = COALESCE(excluded.run_id, files.run_id),
           verified_at = excluded.verified_at,
           missing = 0`,
        [
          rec.sha256,
          path.resolve(rec.path),
          Number(rec.bytes) || 0,
          rec.kind || "image",
          rec.profile || null,
          rec.sourceUrl || null,
          rec.mediaId || null,
          rec.runId ?? null,
          rec.origin || "download",
          now,
          now
        ]
      );
      for (const k of new Set((rec.keys || []).filter(Boolean))) {
        this.db.run(
          "INSERT INTO media_keys(key, sha256, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET sha256 = excluded.sha256",
          [k, rec.sha256, now]
        );
      }
    });
  }

  startRun({ profile, runDir, outRoot, requested }) {
    this.run(
      "INSERT INTO runs(profile, run_dir, out_root, started_at, status, requested) VALUES(?, ?, ?, ?, 'running', ?)",
      [profile || null, runDir || null, outRoot || null, Date.now(), Number(requested) || 0]
    );
    return this.get("SELECT last_insert_rowid() AS id").id;
  }

  finishRun(id, { status, saved, skipped, failed, bytes }) {
    if (id == null) return;
    this.run(
      "UPDATE runs SET finished_at = ?, status = ?, saved = ?, skipped = ?, failed = ?, bytes = ? WHERE id = ?",
      [Date.now(), status || "done", saved || 0, skipped || 0, failed || 0, bytes || 0, id]
    );
  }

  seedFromDisk(outRoot, { signal, onProgress } = {}) {
    if (!outRoot || !fs.existsSync(outRoot)) return { scanned: 0, added: 0 };
    const known = new Set();
    for (const r of this.all("SELECT path FROM files")) known.add(pathKey(r.path));
    let scanned = 0;
    let added = 0;
    const stack = [outRoot];
    const pending = [];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
          stack.push(full);
          continue;
        }
        if (!MEDIA_EXT.test(ent.name)) continue;
        scanned++;
        if (!known.has(pathKey(full))) pending.push(full);
      }
    }
    const now = Date.now();
    let i = 0;
    for (const full of pending) {
      if (signal?.aborted) break;
      i++;
      try {
        const hash = sha256FileSync(full);
        const row = this.get("SELECT path FROM files WHERE sha256 = ?", [hash]);
        if (row && row.path && fs.existsSync(row.path)) continue;
        const bytes = fs.statSync(full).size;
        this.run(
          `INSERT INTO files(sha256, path, bytes, kind, origin, created_at, verified_at, missing)
           VALUES(?, ?, ?, ?, 'disk', ?, ?, 0)
           ON CONFLICT(sha256) DO UPDATE SET path = excluded.path, bytes = excluded.bytes, verified_at = excluded.verified_at, missing = 0`,
          [hash, path.resolve(full), bytes, kindFromName(full), now, now]
        );
        added++;
      } catch {}
      if (onProgress && i % 25 === 0) onProgress(i, pending.length);
    }
    if (onProgress) onProgress(pending.length, pending.length);
    this.setMeta("last_rescan_at", String(Date.now()));
    return { scanned, added };
  }

  verify() {
    const rows = this.all("SELECT sha256, path, missing FROM files");
    const now = Date.now();
    let missing = 0;
    this.tx(() => {
      for (const r of rows) {
        const gone = !r.path || !fs.existsSync(r.path) ? 1 : 0;
        if (gone) missing++;
        this.db.run("UPDATE files SET missing = ?, verified_at = ? WHERE sha256 = ?", [gone, now, r.sha256]);
      }
    });
    this.setMeta("last_verify_at", String(now));
    return { checked: rows.length, missing };
  }

  pruneMissing() {
    const { missing } = this.verify();
    const keysBefore = this.get("SELECT count(*) AS n FROM media_keys").n;
    this.run("DELETE FROM files WHERE missing = 1");
    const keysAfter = this.get("SELECT count(*) AS n FROM media_keys").n;
    this.compact();
    return { removedFiles: missing, removedKeys: keysBefore - keysAfter };
  }

  compact() {
    this.db.exec("VACUUM;");
    this.dirty = true;
    this.flushNow();
  }

  legacyStatus(outRoot) {
    if (!outRoot) return null;
    const file = path.join(outRoot, LEGACY_INDEX_NAME);
    if (!fs.existsSync(file)) return null;
    const summary = readLegacy(file);
    const imported = this.get("SELECT imported_at FROM imports WHERE source = ?", [pathKey(file)]);
    return {
      path: file,
      files: summary ? Object.keys(summary.byHash).length : 0,
      keys: summary ? Object.keys(summary.byUrl).length : 0,
      readable: Boolean(summary),
      importedAt: imported?.imported_at ?? null
    };
  }

  importLegacy(file, { outRoot, archive = true } = {}) {
    const data = readLegacy(file);
    if (!data) throw new Error(`Not a readable legacy index: ${file}`);
    const root = outRoot || path.dirname(file);
    const now = Date.now();
    let files = 0;
    let keys = 0;
    let skipped = 0;
    this.tx(() => {
      for (const [sha, rec] of Object.entries(data.byHash)) {
        if (!/^[a-f0-9]{64}$/i.test(sha) || !rec?.path) {
          skipped++;
          continue;
        }
        const abs = path.resolve(root, String(rec.path));
        const existing = this.get("SELECT path FROM files WHERE sha256 = ?", [sha]);
        if (existing && existing.path && fs.existsSync(existing.path)) continue;
        this.db.run(
          `INSERT INTO files(sha256, path, bytes, kind, origin, created_at, missing)
           VALUES(?, ?, ?, ?, 'legacy', ?, ?)
           ON CONFLICT(sha256) DO UPDATE SET path = excluded.path, bytes = excluded.bytes, missing = excluded.missing`,
          [sha, abs, Number(rec.bytes) || 0, rec.kind || kindFromName(abs), now, fs.existsSync(abs) ? 0 : 1]
        );
        files++;
      }
      for (const [key, rec] of Object.entries(data.byUrl)) {
        const sha = rec?.sha256;
        if (!key || !sha) {
          skipped++;
          continue;
        }
        let has = this.get("SELECT 1 AS ok FROM files WHERE sha256 = ?", [sha]);
        if (!has && rec.path) {
          const abs = path.resolve(root, String(rec.path));
          this.db.run(
            `INSERT INTO files(sha256, path, bytes, kind, origin, created_at, missing)
             VALUES(?, ?, 0, ?, 'legacy', ?, ?)`,
            [sha, abs, kindFromName(abs), now, fs.existsSync(abs) ? 0 : 1]
          );
          files++;
          has = true;
        }
        if (!has) {
          skipped++;
          continue;
        }
        this.db.run(
          "INSERT INTO media_keys(key, sha256, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO NOTHING",
          [key, sha, now]
        );
        keys++;
      }
      this.db.run(
        `INSERT INTO imports(source, imported_at, files, keys, skipped) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET imported_at = excluded.imported_at, files = excluded.files, keys = excluded.keys, skipped = excluded.skipped`,
        [pathKey(file), now, files, keys, skipped]
      );
    });
    this.flushNow();
    let archivedTo = null;
    if (archive && path.basename(file) === LEGACY_INDEX_NAME) {
      const dest = `${file}${LEGACY_MIGRATED_SUFFIX}`;
      try {
        fs.renameSync(file, dest);
        archivedTo = dest;
      } catch {}
    }
    return { files, keys, skipped, archivedTo };
  }

  stats({ recent = 15, profiles = 8, runs = 8 } = {}) {
    const totals = this.get(
      `SELECT count(*) AS files, COALESCE(sum(bytes), 0) AS bytes,
              COALESCE(sum(missing), 0) AS missing,
              COALESCE(sum(kind = 'image'), 0) AS images,
              COALESCE(sum(kind = 'video'), 0) AS videos,
              COALESCE(sum(kind = 'gif'), 0) AS gifs
       FROM files`
    );
    const keyCount = this.get("SELECT count(*) AS n FROM media_keys").n;
    const runCount = this.get("SELECT count(*) AS n FROM runs").n;
    const origins = this.all("SELECT origin, count(*) AS n FROM files GROUP BY origin ORDER BY n DESC");
    const topProfiles = this.all(
      `SELECT COALESCE(profile, '(unknown)') AS profile, count(*) AS files, COALESCE(sum(bytes), 0) AS bytes,
              max(created_at) AS last_at
       FROM files GROUP BY COALESCE(profile, '(unknown)') ORDER BY files DESC LIMIT ?`,
      [profiles]
    );
    const recentFiles = this.all(
      `SELECT sha256, path, bytes, kind, profile, origin, created_at, missing
       FROM files ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [recent]
    );
    const recentRuns = this.all(
      `SELECT id, profile, run_dir, started_at, finished_at, status, requested, saved, skipped, failed, bytes
       FROM runs ORDER BY id DESC LIMIT ?`,
      [runs]
    );
    const imports = this.all("SELECT source, imported_at, files, keys, skipped FROM imports ORDER BY imported_at DESC");
    let sizeOnDisk = 0;
    try {
      sizeOnDisk = fs.statSync(this.path).size;
    } catch {}
    return {
      path: this.path,
      sizeOnDisk,
      schemaVersion: Number(this.getMeta("schema_version")) || SCHEMA_VERSION,
      createdAt: Number(this.getMeta("created_at")) || null,
      lastSavedAt: this.lastSavedAt,
      lastVerifyAt: Number(this.getMeta("last_verify_at")) || null,
      lastRescanAt: Number(this.getMeta("last_rescan_at")) || null,
      recoveredFrom: this.recoveredFrom,
      totals: { ...totals, keys: keyCount, runs: runCount },
      origins,
      topProfiles,
      recentFiles,
      recentRuns,
      imports
    };
  }

  search(query, limit = 50) {
    const q = `%${String(query || "").trim()}%`;
    return this.all(
      `SELECT DISTINCT f.sha256, f.path, f.bytes, f.kind, f.profile, f.origin, f.created_at, f.missing
       FROM files f LEFT JOIN media_keys k ON k.sha256 = f.sha256
       WHERE f.sha256 LIKE ? OR f.path LIKE ? OR f.profile LIKE ? OR f.source_url LIKE ? OR k.key LIKE ?
       ORDER BY f.created_at DESC LIMIT ?`,
      [q, q, q, q, q, limit]
    );
  }

  get encrypted() {
    return Boolean(this.key);
  }

  setKey(key) {
    const next = normalizeKey(key);
    const same = (this.key && next && this.key.equals(next)) || (!this.key && !next);
    if (same) return;
    this.key = next;
    this.dirty = true;
    this.flushNow();
  }

  backupTo(dest) {
    this.flushNow();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const plain = Buffer.from(this.db.export());
    this.db.exec("PRAGMA foreign_keys = ON;");
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, plain);
    fs.renameSync(tmp, dest);
    return dest;
  }

  close() {
    try {
      this.flushNow();
    } finally {
      this.db.close();
    }
  }
}

function readLegacy(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      byHash: raw.byHash && typeof raw.byHash === "object" ? raw.byHash : {},
      byUrl: raw.byUrl && typeof raw.byUrl === "object" ? raw.byUrl : {}
    };
  } catch {
    return null;
  }
}

const instances = new Map();
const opened = new Set();
let exitHooked = false;

export async function openMediaDb(dbPath = defaultDbPath(), opts = {}) {
  const key = pathKey(dbPath);
  const hasKeyOpt = Object.prototype.hasOwnProperty.call(opts, "key");
  if (instances.has(key)) {
    const db = await instances.get(key);
    if (hasKeyOpt) db.setKey(opts.key || null);
    return db;
  }
  const p = loadSql().then((SQL) => {
    const db = new MediaDb(SQL, path.resolve(dbPath), hasKeyOpt ? opts.key : null);
    opened.add(db);
    return db;
  });
  p.catch(() => instances.delete(key));
  instances.set(key, p);
  if (!exitHooked) {
    exitHooked = true;
    process.on("exit", flushAllMediaDbs);
  }
  return p;
}

export function flushAllMediaDbs() {
  for (const db of opened) {
    try {
      db.flushNow();
    } catch {}
  }
}
