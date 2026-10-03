import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const nuke = ["out", "release", "dist", "installer/bin", "installer/obj", "installer/out"];

for (const target of nuke) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) continue;
  fs.rmSync(full, { recursive: true, force: true });
}

console.log("clean done.");
