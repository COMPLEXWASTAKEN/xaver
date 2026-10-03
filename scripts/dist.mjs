import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

if (has("--help") || has("-h")) {
  console.log(`npm run dist -- [options]

  --dir            app only (dist/win-unpacked), no installer
  --no-bump        keep the current version
  --no-clean       keep previous build output
  --no-typecheck   skip the TypeScript check
  --no-verify      skip packaged-app and installer checks
  --skip-installer same as --dir but still bumps/verifies
  --nsis           also build the legacy NSIS setup
  --portable       also build a portable single-file exe`);
  process.exit(0);
}

const opts = {
  installer: !has("--dir") && !has("--skip-installer"),
  bump: !has("--no-bump"),
  clean: !has("--no-clean"),
  typecheck: !has("--no-typecheck"),
  verify: !has("--no-verify"),
  nsis: has("--nsis"),
  portable: has("--portable")
};

const isTTY = process.stdout.isTTY;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const accent = (s) => c("38;5;209", s);

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtTime(ms) {
  return ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    total += ent.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function sha256(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

const steps = [];
let stepNo = 0;
const started = Date.now();

function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true, env: childEnv() });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function step(name, fn) {
  stepNo += 1;
  const label = `${String(stepNo).padStart(2, " ")}. ${name}`;
  console.log(`\n${accent("▸")} ${bold(label)}`);
  const t = Date.now();
  try {
    fn();
  } catch (e) {
    const ms = Date.now() - t;
    steps.push({ name, ms, ok: false });
    summary();
    console.error(`\n${red("✖ dist failed at")} ${bold(name)} ${dim(`(${fmtTime(ms)})`)}`);
    console.error(red(String(e?.message || e)));
    if (opts.bump) console.error(dim("The version was not marked as shipped, so the next run reuses it."));
    process.exit(1);
  }
  const ms = Date.now() - t;
  steps.push({ name, ms, ok: true });
  console.log(dim(`   done in ${fmtTime(ms)}`));
}

function summary() {
  console.log(`\n${bold("steps")}`);
  for (const s of steps) {
    console.log(`  ${s.ok ? green("✓") : red("✖")} ${s.name.padEnd(34)} ${dim(fmtTime(s.ms).padStart(8))}`);
  }
}

function preflight() {
  const problems = [];
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) problems.push(`Node 18+ required (found ${process.versions.node})`);
  for (const mod of ["electron", "electron-builder", "electron-vite", "javascript-obfuscator", "7zip-bin", "sql.js"]) {
    if (!fs.existsSync(path.join(root, "node_modules", mod))) problems.push(`missing node_modules/${mod} (run npm install)`);
  }
  if (opts.installer) {
    const dn = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8", shell: true });
    if (dn.status !== 0 || !dn.stdout.trim()) problems.push("the .NET SDK is needed for the installer (https://dotnet.microsoft.com/download), or use --dir");
  }
  if (process.platform !== "win32") problems.push("Windows builds must be made on Windows");
  if (problems.length) throw new Error(problems.map((p) => `• ${p}`).join("\n"));
  console.log(dim(`   node ${process.versions.node} · installer ${opts.installer ? "on" : "off"} · verify ${opts.verify ? "on" : "off"}`));
}

console.log(bold(`\nXaver dist`));

step("Preflight", preflight);
if (opts.bump) step("Version", () => sh("node", ["scripts/version.mjs", "--dist"]));
const version = readPkg().version;
const productName = readPkg().build?.productName || "Xaver";
console.log(dim(`   building v${version}`));
if (opts.clean) step("Clean", () => sh("node", ["scripts/clean.mjs"]));
step("Icons", () => sh("node", ["scripts/make-icon.mjs"]));
if (opts.typecheck) step("Type check", () => sh("npx", ["tsc", "--noEmit", "-p", "."]));
step("Build app (main · preload · UI)", () => sh("npx", ["electron-vite", "build"]));
step("Obfuscate", () => sh("node", ["scripts/obfuscate.mjs"]));
step("Package (win-unpacked)", () => sh("npx", ["electron-builder", "--win", "--x64", "--dir"]));
if (opts.verify) step("Verify packaged app", () => sh("node", ["scripts/verify-dist.mjs", "--only=app"]));
if (opts.installer) step("Build installer", () => sh("node", ["scripts/installer.mjs"]));
if (opts.installer && opts.verify) step("Verify installer", () => sh("node", ["scripts/verify-dist.mjs", "--only=installer"]));
if (opts.nsis) step("Legacy NSIS setup", () => sh("npx", ["electron-builder", "--win", "nsis", "--x64", "--prepackaged", "dist/win-unpacked"]));
if (opts.portable) step("Portable exe", () => sh("npx", ["electron-builder", "--win", "portable", "--x64", "--prepackaged", "dist/win-unpacked"]));

const dist = path.join(root, "dist");
const artifacts = [];
step("Checksums & release notes", () => {
  for (const name of fs.readdirSync(dist)) {
    const p = path.join(dist, name);
    if (fs.statSync(p).isFile() && /\.exe$/i.test(name)) {
      artifacts.push({ file: name, bytes: fs.statSync(p).size, sha256: sha256(p) });
    }
  }
  if (artifacts.length) {
    fs.writeFileSync(path.join(dist, "SHA256SUMS.txt"), artifacts.map((a) => `${a.sha256}  ${a.file}`).join("\n") + "\n");
  }
  const release = {
    product: productName,
    version,
    builtAt: new Date().toISOString(),
    node: process.versions.node,
    electron: readPkg().devDependencies?.electron,
    appBytes: dirSize(path.join(dist, "win-unpacked")),
    artifacts,
    steps: steps.map((s) => ({ name: s.name, seconds: +(s.ms / 1000).toFixed(1) }))
  };
  fs.writeFileSync(path.join(dist, "release.json"), JSON.stringify(release, null, 2) + "\n");
});

if (opts.bump && opts.installer) step("Mark version shipped", () => sh("node", ["scripts/version.mjs", "--shipped"]));

summary();
console.log(`\n${bold("artifacts")} ${dim(path.relative(root, dist) + path.sep)}`);
for (const a of artifacts) console.log(`  ${fmtBytes(a.bytes).padStart(9)}  ${a.file}  ${dim(a.sha256.slice(0, 16) + "…")}`);
console.log(`  ${fmtBytes(dirSize(path.join(dist, "win-unpacked"))).padStart(9)}  win-unpacked${path.sep}`);
console.log(`\n${green("✔")} ${bold(`v${version} built in ${fmtTime(Date.now() - started)}`)}`);
