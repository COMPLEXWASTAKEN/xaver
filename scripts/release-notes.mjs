import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);

function readRelease() {
  const file = path.join(dist, "release.json");
  if (!fs.existsSync(file)) throw new Error("dist/release.json is missing. Run npm run dist first.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function size(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

function seconds(s) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;
}

function assetName(file) {
  return file.replace(/\s+/g, "-");
}

function stage(release, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const staged = release.artifacts.map((a) => {
    const name = assetName(a.file);
    fs.copyFileSync(path.join(dist, a.file), path.join(outDir, name));
    return { ...a, file: name };
  });
  fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), staged.map((a) => `${a.sha256}  ${a.file}`).join("\n") + "\n");
  fs.copyFileSync(path.join(dist, "release.json"), path.join(outDir, "release.json"));
  return staged;
}

function changes(tag) {
  const previous = git(["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`]);
  const range = previous ? `${previous}..${tag}` : tag;
  const log = git(["log", range, "--no-merges", "--pretty=format:%s (%h)"]);
  const lines = log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Release v\d/.test(l));
  return { previous, lines };
}

function buildTable(release) {
  const rows = release.steps.map((s) => `| ${s.name} | ${seconds(s.seconds)} |`).join("\n");
  return `| Step | Time |\n|---|---|\n${rows}`;
}

function notes(release, tag, repo, build) {
  const staged = release.artifacts.map((a) => ({ ...a, file: assetName(a.file) }));
  const setup = staged.find((a) => /setup/i.test(a.file)) || staged[0];
  const base = `https://github.com/${repo}`;
  const { previous, lines } = build ? { previous: "", lines: [git(["log", "-1", "--pretty=format:%s (%h)"])].filter(Boolean) } : changes(tag);
  const out = [];
  if (build) {
    const sha = (process.env.GITHUB_SHA || git(["rev-parse", "HEAD"])).slice(0, 7);
    out.push(
      `> Built automatically from \`${sha}\` on \`main\` at ${release.builtAt}. This updates on every push, so it may have rough edges. For a stable version, pick the newest release without the Pre-release label.`,
      ""
    );
  }
  if (setup) {
    out.push(
      `**[Download ${setup.file}](${base}/releases/download/${tag}/${encodeURIComponent(setup.file)})** · ${size(setup.bytes)} · Windows 10 and 11, 64-bit`,
      ""
    );
  }
  out.push("### What's changed", "");
  out.push(...(lines.length ? lines.map((l) => `- ${l}`) : ["- Maintenance release"]), "");
  out.push(
    "### Installing",
    "",
    "Run the setup. Updating keeps your library, settings, PIN and X session, and an older Profile Media Saver install is replaced automatically.",
    "",
    "The installer isn't code-signed yet, so Windows SmartScreen may show a warning. Choose **More info**, then **Run anyway**.",
    "",
    "> [!WARNING]",
    "> Xaver is built with heavy help from AI coding tools. It's tested before every release, but treat it as hobby software and keep backups of anything you care about.",
    "",
    "### Checksums",
    "",
    "| File | SHA-256 |",
    "|---|---|",
    ...staged.map((a) => `| ${a.file} | \`${a.sha256}\` |`),
    "",
    "<details><summary>Build details</summary>",
    "",
    `Built ${release.builtAt} with Node ${release.node} and Electron ${String(release.electron || "").replace(/^\^/, "")}. App size ${size(release.appBytes)}.`,
    "",
    buildTable(release),
    "",
    "</details>"
  );
  if (previous) out.push("", `**Full changelog:** ${base}/compare/${previous}...${tag}`);
  return out.join("\n") + "\n";
}

function summary(release) {
  const sha = (process.env.GITHUB_SHA || git(["rev-parse", "HEAD"])).slice(0, 7);
  const total = release.steps.reduce((n, s) => n + s.seconds, 0);
  return [
    `## ${release.product} ${release.version} · ${sha}`,
    "",
    `Built in ${seconds(total)}. The installer is attached to this run under **Artifacts**.`,
    "",
    "| File | Size | SHA-256 |",
    "|---|---|---|",
    ...release.artifacts.map((a) => `| ${a.file} | ${size(a.bytes)} | \`${a.sha256.slice(0, 16)}…\` |`),
    `| win-unpacked/ | ${size(release.appBytes)} | |`,
    "",
    buildTable(release),
    ""
  ].join("\n");
}

const release = readRelease();

if (flag("summary")) {
  const text = summary(release);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else process.stdout.write(text);
}

const stageDir = arg("stage");
if (stageDir) {
  const staged = stage(release, path.resolve(root, stageDir));
  console.log(staged.map((a) => a.file).join("\n"));
}

const notesFile = arg("notes");
if (notesFile) {
  const tag = arg("tag") || `v${release.version}`;
  const repo = arg("repo") || process.env.GITHUB_REPOSITORY || "";
  fs.writeFileSync(path.resolve(root, notesFile), notes(release, tag, repo, flag("build")));
}
