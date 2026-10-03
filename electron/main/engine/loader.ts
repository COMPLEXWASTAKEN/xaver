import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let engineDir: string | null = null;

function resolveEngineDir(): string {
  if (engineDir) return engineDir;
  const candidates = [
    path.resolve(__dirname, "../../src"),
    path.resolve(__dirname, "../src"),
    path.resolve(process.cwd(), "src")
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "runner.js"))) {
      engineDir = c;
      return c;
    }
  }
  throw new Error("Could not locate the engine (src/runner.js)");
}

export async function loadEngineModule<T = Record<string, any>>(name: string): Promise<T> {
  const file = path.join(resolveEngineDir(), name);
  return import(pathToFileURL(file).href) as Promise<T>;
}
