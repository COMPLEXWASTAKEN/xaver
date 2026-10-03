import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const productName = pkg.build?.productName || "Xaver";
const project = path.join(root, "installer", "XaverSetup.csproj");
const work = path.join(root, "installer", "out");
const unpacked = path.join(root, "dist", "win-unpacked");
const sevenZip = require("7zip-bin").path7za;

function fail(message, code = 1) {
  console.error(`\n${message}`);
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) fail(`${path.basename(cmd)} failed with exit code ${r.status}`, r.status || 1);
}

function runQuiet(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  const noise = /^(Workload updates are available|\s*$)/;
  const lines = `${r.stdout || ""}${r.stderr || ""}`.split(/\r?\n/).filter((l) => !noise.test(l));
  if (lines.length) console.log(lines.join("\n"));
  if (r.status !== 0) fail(`${path.basename(cmd)} failed with exit code ${r.status}`, r.status || 1);
}

function dirSize(dir) {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    total += ent.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function mb(n) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const dotnetEnv = {
  ...process.env,
  DOTNET_NOLOGO: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1"
};

function dotnet(outDir, extra = []) {
  runQuiet(
    "dotnet",
    [
      "build",
      project,
      "-c",
      "Release",
      "--no-incremental",
      "-nologo",
      "-v",
      "q",
      "-o",
      outDir,
      "-clp:ErrorsOnly;NoSummary",
      `-p:Version=${version}`,
      ...extra
    ],
    { env: dotnetEnv }
  );
  return path.join(outDir, "XaverSetup.exe");
}

if (!fs.existsSync(path.join(unpacked, `${productName}.exe`))) {
  fail(`Missing ${path.relative(root, unpacked)}. Run "npm run dist" (or electron-builder --dir) first.`);
}

const sdk = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8", env: dotnetEnv });
if (sdk.status !== 0 || !sdk.stdout.trim()) {
  fail("The .NET SDK is required to build the installer: https://dotnet.microsoft.com/download");
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

console.log(`installer  building uninstaller (v${version})`);
const uninstaller = dotnet(path.join(work, "uninstaller"));
fs.copyFileSync(uninstaller, path.join(unpacked, `Uninstall ${productName}.exe`));

const payloadBytes = dirSize(unpacked);
const payload = path.join(work, "payload.7z");
console.log(`installer  compressing ${mb(payloadBytes)} of app files`);
run(sevenZip, ["a", "-t7z", "-mx=9", "-m0=lzma2", "-md=64m", "-mmt=on", "-ms=on", "-bso0", "-bsp0", payload, ".\\*"], {
  cwd: unpacked
});

console.log(`installer  building setup (payload ${mb(fs.statSync(payload).size)})`);
const setup = dotnet(path.join(work, "setup"), [
  `-p:PayloadPath=${payload}`,
  `-p:SevenZipPath=${sevenZip}`,
  `-p:PayloadBytes=${payloadBytes}`
]);

const target = path.join(root, "dist", `${productName} Setup ${version}.exe`);
fs.copyFileSync(setup, target);
console.log(`installer  ${mb(fs.statSync(target).size)}  ${path.relative(root, target)}`);
