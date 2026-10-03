import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function verifyApp() {
  console.log("verify     packaged app");
  if (!fs.existsSync(exe)) {
    check(false, "packaged exe exists", exe);
    return;
  }
  const asar = path.join(unpacked, "resources", "app.asar");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xaver-verify-"));
  const probe = path.join(tmp, "probe.mjs");
  fs.writeFileSync(
    probe,
    `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const asar = ${JSON.stringify(asar)};
const tmp = ${JSON.stringify(tmp)};
const out = {};
const need = ["out/main/index.js", "out/preload/index.mjs", "out/renderer/index.html", "out/src/runner.js", "out/src/db/mediadb.js", "out/src/download/download.js", "node_modules/sql.js/dist/sql-wasm.wasm"];
out.missing = need.filter((f) => !fs.existsSync(path.join(asar, f)));
try {
  const db = await import(pathToFileURL(path.join(asar, "out/src/db/mediadb.js")).href);
  const key = Buffer.alloc(32, 7);
  const file = path.join(tmp, "db.sqlite");
  const h = await db.openMediaDb(file, { key });
  h.recordFile({ sha256: "b".repeat(64), path: path.join(tmp, "x.jpg"), bytes: 1, kind: "image", keys: ["image:VERIFY"] });
  h.flushNow();
  out.dbEncrypted = db.isEncryptedDbBuffer(fs.readFileSync(file));
  out.dbSearch = h.search("VERIFY").length;
} catch (e) { out.dbError = String(e && e.stack || e); }
try {
  const runner = await import(pathToFileURL(path.join(asar, "out/src/runner.js")).href);
  out.runnerExports = ["runCollectJob", "runDownloadJob", "runScrapeJob"].filter((k) => typeof runner[k] === "function").length;
} catch (e) { out.runnerError = String(e && e.stack || e); }
const ff = path.join(path.dirname(asar), "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe");
out.ffmpeg = fs.existsSync(ff);
console.log("@@" + JSON.stringify(out));
`
  );
  const r = spawnSync(exe, [probe], {
    env: cleanEnv({ ELECTRON_RUN_AS_NODE: "1" }),
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  const line = (r.stdout || "").split(/\r?\n/).find((l) => l.startsWith("@@"));
  if (!line) {
    check(false, "engine runs inside the packaged app", (r.stderr || r.error?.message || "no output").trim().slice(0, 400));
    return;
  }
  const res = JSON.parse(line.slice(2));
  check(res.missing.length === 0, "required files packaged", res.missing.join(", "));
  check(res.dbEncrypted && res.dbSearch === 1, "encrypted database works", res.dbError ? res.dbError.split("\n")[0] : "");
  check(res.runnerExports === 3, "scan/download engine loads", res.runnerError ? res.runnerError.split("\n")[0] : "");
  check(res.ffmpeg, "ffmpeg unpacked next to the archive");
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

if (!only || only === "app") verifyApp();
if (!only || only === "installer") verifyInstaller();

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`verify     ${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`verify     all ${results.length} checks passed`);
