import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

const MAGIC = Buffer.from("PMSSEC1\n", "latin1");

export function canEncrypt(): boolean {
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function atomicWrite(file: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

export function encryptBuffer(plain: Buffer): Buffer {
  return Buffer.concat([MAGIC, safeStorage.encryptString(plain.toString("base64"))]);
}

export function isSealed(buf: Buffer): boolean {
  return buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptBuffer(buf: Buffer): Buffer {
  return Buffer.from(safeStorage.decryptString(buf.subarray(MAGIC.length)), "base64");
}

function encPath(base: string): string {
  return `${base}.enc`;
}

export function readSecureJson<T>(base: string): T | null {
  const enc = encPath(base);
  if (fs.existsSync(enc)) {
    const buf = fs.readFileSync(enc);
    if (isSealed(buf)) {
      if (!canEncrypt()) throw new Error("Encrypted data cannot be unlocked on this Windows account.");
      return JSON.parse(decryptBuffer(buf).toString("utf8")) as T;
    }
    return JSON.parse(buf.toString("utf8")) as T;
  }
  if (fs.existsSync(base)) {
    const data = JSON.parse(fs.readFileSync(base, "utf8")) as T;
    if (canEncrypt()) {
      try {
        writeSecureJson(base, data);
      } catch {}
    }
    return data;
  }
  return null;
}

export function writeSecureJson(base: string, data: unknown): void {
  const json = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  if (canEncrypt()) {
    atomicWrite(encPath(base), encryptBuffer(json));
    if (fs.existsSync(base)) {
      try {
        fs.rmSync(base, { force: true });
      } catch {}
    }
    return;
  }
  atomicWrite(base, json);
}

export function removeSecureJson(base: string): void {
  for (const f of [base, encPath(base)]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {}
  }
}

export function secureJsonExists(base: string): boolean {
  return fs.existsSync(base) || fs.existsSync(encPath(base));
}
