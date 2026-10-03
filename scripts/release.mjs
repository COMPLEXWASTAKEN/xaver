import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const kind = args.find((a) => !a.startsWith("--")) || "patch";

function run(cmd, cmdArgs, { quiet = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", stdio: quiet ? "pipe" : "inherit" });
  if (r.status !== 0) {
    if (quiet) process.stderr.write(r.stderr || "");
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed`);
  }
  return (r.stdout || "").trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function next(current) {
  if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(kind)) return kind;
  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  fail(`use patch, minor, major or an exact version like 2.1.0 (got "${kind}")`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = next(pkg.version);
const tag = `v${version}`;

if (run("git", ["status", "--porcelain"], { quiet: true })) fail("commit or stash your changes first");
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
if (branch !== "main") fail(`releases are cut from main (you're on ${branch})`);
run("git", ["fetch", "--tags", "origin"], { quiet: true });
if (run("git", ["tag", "--list", tag], { quiet: true })) fail(`${tag} already exists`);
const behind = run("git", ["rev-list", "--count", "HEAD..origin/main"], { quiet: true });
if (behind !== "0") fail(`main is ${behind} commit(s) behind origin. Pull first.`);

console.log(`release: ${pkg.version} -> ${version}${dry ? " (dry run)" : ""}`);
if (dry) process.exit(0);

run("node", ["scripts/version.mjs", `--set=${version}`]);
run("git", ["add", "package.json", "build/VERSION", "build/version-memory.json"]);
run("git", ["commit", "-q", "-m", `Release ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `Xaver ${version}`]);
run("git", ["push", "--atomic", "origin", "main", tag]);

console.log(`release: pushed ${tag}. GitHub Actions is building it now.`);
