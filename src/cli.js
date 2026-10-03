#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { runScrapeJob } from "./runner.js";
import { openMediaDb, defaultDbPath, LEGACY_INDEX_NAME } from "./db/mediadb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function ask(rl, q, def = "") {
  const hint = def ? ` [${def}]` : "";
  return new Promise((resolve) => {
    rl.question(`${q}${hint}: `, (ans) => {
      const v = String(ans ?? "").trim();
      resolve(v || def);
    });
  });
}

function resolvePathMaybe(p) {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

function fmtBytes(n) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n) || 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function dbCommand(cmd, arg) {
  let db;
  try {
    db = await openMediaDb(defaultDbPath());
  } catch (e) {
    throw new Error(`${e.message} Open the Database page in the app instead.`);
  }
  if (cmd === "migrate") {
    const target = resolvePathMaybe(arg || path.join(ROOT, "output"));
    const file = fs.existsSync(target) && fs.statSync(target).isDirectory()
      ? path.join(target, LEGACY_INDEX_NAME)
      : target;
    if (!fs.existsSync(file)) throw new Error(`No legacy index at ${file}`);
    const r = db.importLegacy(file, { outRoot: path.dirname(file) });
    console.log(`Migrated ${r.files} files and ${r.keys} URL/ID keys (${r.skipped} skipped).`);
    if (r.archivedTo) console.log(`Old index archived to ${r.archivedTo}`);
  }
  const s = db.stats({ recent: 0, profiles: 5, runs: 0 });
  console.log(`Database: ${s.path} (${fmtBytes(s.sizeOnDisk)})`);
  console.log(
    `  ${s.totals.files} files · ${fmtBytes(s.totals.bytes)} · ${s.totals.keys} keys · ${s.totals.runs} runs · ${s.totals.missing} missing`
  );
  for (const p of s.topProfiles) console.log(`  ${p.profile}: ${p.files} files, ${fmtBytes(p.bytes)}`);
  db.flushNow();
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "db" || cmd === "migrate") {
    await dbCommand(cmd, arg);
    return;
  }
  console.log("");
  console.log("Xaver CLI");
  console.log("Reads a cookie export, scans a profile and saves the media to a folder.");
  console.log("Keep your cookies private. If they ever leak, log out of X to rotate them.");
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const defaultCookies = fs.existsSync(path.join(ROOT, "cookies.txt"))
      ? path.join(ROOT, "cookies.txt")
      : path.join(process.cwd(), "cookies.txt");

    const cookiePath = resolvePathMaybe(
      await ask(rl, "Cookie file path (EditThisCookie Set-Cookie3)", defaultCookies)
    );
    if (!fs.existsSync(cookiePath)) {
      throw new Error(
        `Cookie file not found: ${cookiePath}\nCopy docs/cookies.example.txt to cookies.txt and paste your export into it.`
      );
    }

    const targetRaw = await ask(
      rl,
      "Target (me | @user | https://x.com/user | user/media)",
      "me"
    );
    const outRoot = resolvePathMaybe(
      await ask(rl, "Output folder", path.join(ROOT, "output"))
    );
    const zipAns = (await ask(rl, "Also build one ZIP when done? (y/n)", "y")).toLowerCase();
    const wantZip = zipAns === "y" || zipAns === "yes";
    const headlessAns = (await ask(rl, "Headless browser? (y/n)", "n")).toLowerCase();
    const headless = headlessAns === "y" || headlessAns === "yes";
    const scrollAns = await ask(rl, "Max scroll steps", "800");
    const maxScrolls = Math.max(50, parseInt(scrollAns, 10) || 800);

    rl.close();

    const result = await runScrapeJob(
      {
        cookies: cookiePath,
        target: targetRaw,
        outRoot,
        wantZip,
        headless,
        maxScrolls
      },
      {
        onLog: (msg) => console.log(msg),
        onProgress: (p) => {
          if (p.phase === "downloading" && p.downloadDone != null) {
            process.stdout.write(
              `\rDownload ${p.downloadDone}/${p.downloadTotal} · ok ${p.saved} · skip ${p.skipped || 0} · fail ${p.failed}   `
            );
          }
        }
      }
    );

    console.log("");
    console.log("Done.");
    console.log(`  Folder: ${result.runDir}`);
    console.log(`  Saved:  ${result.saved.length}`);
    console.log(`  Dupes skipped (sha256/url): ${result.skipped.length}`);
    console.log(`  Failed: ${result.errors.length}`);
    if (result.zipPath) console.log(`  ZIP:    ${result.zipPath}`);
    if (result.errors.length) {
      console.log("  First failures:");
      for (const e of result.errors.slice(0, 5)) {
        console.log(`    - ${e.err} · ${e.url.slice(0, 80)}`);
      }
    }
  } catch (e) {
    try {
      rl.close();
    } catch {}
    console.error("\nError:", e.message || e);
    process.exitCode = 1;
  }
}

main();
