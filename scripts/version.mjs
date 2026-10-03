import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const memPath = path.join(root, "build", "version-memory.json");

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function bumpPatch(ver) {
  const parts = String(ver || "0.0.0").split(".").map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

const pkg = readJson(pkgPath, {});
const mem = readJson(memPath, { version: pkg.version || "2.0.0", lastShipped: null, history: [] });
const setArg = process.argv.find((a) => a.startsWith("--set="));
const forceBump = process.argv.includes("--bump");
const forDist = process.argv.includes("--dist");
const shipped = process.argv.includes("--shipped");

let next = setArg ? setArg.slice(6) : mem.version || pkg.version || "2.0.1";

if (forDist && mem.lastShipped && mem.lastShipped === next) {
  next = bumpPatch(next);
}

if (forceBump && !forDist && !setArg) {
  next = bumpPatch(mem.version || pkg.version || "2.0.0");
}

if (!mem.history.includes(next)) mem.history.push(next);
mem.version = next;
pkg.version = next;

if (shipped) mem.lastShipped = next;

writeJson(pkgPath, pkg);
writeJson(memPath, mem);
fs.writeFileSync(path.join(root, "build", "VERSION"), next + "\n");
console.log(`version ${next}`);
