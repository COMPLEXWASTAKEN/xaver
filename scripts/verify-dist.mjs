import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productName = pkg.build?.productName || "Xaver";
const unpacked = path.join(root, "dist", "win-unpacked");
const exe = path.join(unpacked, `${productName}.exe`);
const setup = path.join(root, "dist", `${productName} Setup ${pkg.version}.exe`);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, ...extra };
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(sleepCell, 0, 0, ms);

async function verifyApp() {
  console.log("verify     packaged app");
  if (!fs.existsSync(exe)) {
    check(false, "packaged exe exists", exe);
    return;
  }
  const archive = path.join(unpacked, "resources", "app.asar");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xaver-verify-"));
  const app = path.join(tmp, "app");
  try {
    const { extractAll } = await import("@electron/asar");
    extractAll(archive, app);
    const need = [
      "out/main/index.js",
      "out/preload/index.cjs",
      "out/renderer/index.html",
      "out/src/runner.js",
      "out/src/db/mediadb.js",
      "out/src/download/download.js",
      "node_modules/sql.js/dist/sql-wasm.wasm"
    ];
    const missing = need.filter((f) => !fs.existsSync(path.join(app, f)));
    check(missing.length === 0, "required files packaged", missing.join(", "));
    try {
      const db = await import(pathToFileURL(path.join(app, "out/src/db/mediadb.js")).href);
      const file = path.join(tmp, "db.sqlite");
      const h = await db.openMediaDb(file, { key: Buffer.alloc(32, 7) });
      h.recordFile({ sha256: "b".repeat(64), path: path.join(tmp, "x.jpg"), bytes: 1, kind: "image", keys: ["image:VERIFY"] });
      h.flushNow();
      check(db.isEncryptedDbBuffer(fs.readFileSync(file)) && h.search("VERIFY").length === 1, "encrypted database works");
    } catch (e) {
      check(false, "encrypted database works", String(e?.message || e).split("\n")[0]);
    }
    try {
      const runner = await import(pathToFileURL(path.join(app, "out/src/runner.js")).href);
      const found = ["runCollectJob", "runDownloadJob", "runScrapeJob"].filter((k) => typeof runner[k] === "function").length;
      check(found === 3, "scan/download engine loads");
    } catch (e) {
      check(false, "scan/download engine loads", String(e?.message || e).split("\n")[0]);
    }
    check(
      fs.existsSync(path.join(unpacked, "resources", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe")),
      "ffmpeg unpacked next to the archive"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
  if (process.env.CI || process.argv.includes("--launch")) await verifyLaunch();
}

async function verifyLaunch() {
  console.log("verify     hardened launch");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xaver-verify-launch-"));
  const probe = path.join(tmp, "probe.js");
  fs.writeFileSync(probe, 'console.log("@@node-mode");process.exit(0);');
  const child = spawn(exe, [probe], { env: cleanEnv({ ELECTRON_RUN_AS_NODE: "1" }), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  await new Promise((r) => setTimeout(r, 12000));
  const alive = child.exitCode === null;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  await new Promise((r) => setTimeout(r, 1500));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  check(!out.includes("@@node-mode"), "exe can't be used as a Node runtime");
  check(alive, "app starts with archive integrity checks on", alive ? "" : `exited with ${child.exitCode}`);
}

function regQuery(key) {
  return spawnSync("reg", ["query", key], { encoding: "utf8", windowsHide: true }).status === 0;
}

function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    sleep(300);
  }
  return fn();
}

function verifyInstaller() {
  console.log("verify     installer (isolated install → uninstall)");
  if (!fs.existsSync(setup)) {
    check(false, "setup exe exists", setup);
    return;
  }
  const channel = "Verify";
  const env = cleanEnv({ XAVER_SETUP_CHANNEL: channel });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xaver-verify-install-"));
  const target = path.join(dir, `${productName} (${channel})`);
  const regKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\XaverVerify";
  try {
    const t0 = Date.now();
    const inst = spawnSync(setup, ["/S", "/nodesktop", "/nostartmenu", `/D=${target}`], { env, timeout: 300000, windowsHide: true });
    check(inst.status === 0, "silent install", `exit ${inst.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const appExe = path.join(target, `${productName}.exe`);
    const uninstaller = path.join(target, `Uninstall ${productName}.exe`);
    check(fs.existsSync(appExe) && fs.existsSync(path.join(target, "resources", "app.asar")), "app files installed");
    check(fs.existsSync(uninstaller), "uninstaller installed");
    check(regQuery(regKey), "registered with Windows");
    if (fs.existsSync(appExe)) {
      const size = fs.statSync(path.join(target, "resources", "app.asar")).size;
      const src = fs.statSync(path.join(unpacked, "resources", "app.asar")).size;
      check(size === src, "installed files match the build");
    }
    if (fs.existsSync(uninstaller)) {
      spawnSync(uninstaller, ["/uninstall", "/S"], { env, timeout: 120000, windowsHide: true });
      const gone = waitFor(() => !fs.existsSync(target) && !regQuery(regKey), 30000);
      check(gone, "silent uninstall removes files and registration");
    }
  } finally {
    if (regQuery(regKey)) spawnSync("reg", ["delete", regKey, "/f"], { windowsHide: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (!only || only === "app") await verifyApp();
if (!only || only === "installer") verifyInstaller();

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`verify     ${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`verify     all ${results.length} checks passed`);
