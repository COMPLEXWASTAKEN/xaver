import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCookieFile, parseCookieText, expandCookiesForX } from "./core/cookies.js";
import { openShardxContext, defaultCliProfileDir } from "./core/browser.js";
import {
  collectMediaFromProfile,
  readLoggedInScreenName,
  resolveTargetPath,
  XLoadError
} from "./scrape/scrape.js";
import { collapseMediaItems } from "./scrape/media.js";
import {
  createHttpContext,
  downloadAll,
  zipFolderToFile,
  zipFilesToFile,
  defaultStamp,
  labelFromPath,
  createKnownMediaCheck
} from "./download/download.js";
import { openMediaDb, defaultDbPath } from "./db/mediadb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function resolveCookies(input) {
  if (Array.isArray(input)) return expandCookiesForX(input);
  if (typeof input === "string") {
    const raw = input;
    if (fs.existsSync(raw) && !raw.includes("\n") && raw.length < 512) {
      return expandCookiesForX(parseCookieFile(raw));
    }
    return expandCookiesForX(parseCookieText(raw));
  }
  throw new Error("cookies required");
}

function filterItems(items, options) {
  const includePhotos = options.includePhotos !== false;
  const includeVideos = options.includeVideos !== false;
  const includeGifs = options.includeGifs !== false;
  let out = items.filter((it) => {
    if (it.gif) return includeGifs;
    if (it.kind === "image") return includePhotos;
    if (it.kind === "video") return includeVideos;
    return true;
  });
  if (options.skipHls !== false) {
    out = out.filter((it) => !/\.m3u8(\?|$)/i.test(it.url));
  }
  return collapseMediaItems(out);
}

function openDb(options) {
  const opts = Object.prototype.hasOwnProperty.call(options, "dbKey") ? { key: options.dbKey || null } : {};
  return openMediaDb(options.dbPath || defaultDbPath(), opts);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("Cancelled");
    err.name = "AbortError";
    throw err;
  }
}

export async function runCollectJob(options, hooks = {}) {
  const onLog = hooks.onLog || (() => {});
  const onProgress = hooks.onProgress || (() => {});
  const onItem = hooks.onItem || (() => {});
  const signal = options.signal;

  const cookies = resolveCookies(options.cookies);
  const userDataDir =
    options.userDataDir || options.cloakProfileDir || defaultCliProfileDir(ROOT);
  const extraArgs = Array.isArray(options.launchArgs)
    ? options.launchArgs.filter(
        (a) => !/disable-blink-features=AutomationControlled/i.test(String(a))
      )
    : [];

  let handle = null;
  const closeBrowser = async () => {
    if (!handle) return;
    const h = handle;
    handle = null;
    try {
      await h.close();
    } catch {}
  };
  const onAbort = () => {
    void closeBrowser();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    throwIfAborted(signal);
    handle = await openShardxContext({
      cacheDir: userDataDir,
      userDataDir,
      headless: Boolean(options.headless),
      proxyUrl: options.proxyUrl || undefined,
      humanize: options.humanize !== false,
      template: options.template || options.fingerprintSeed,
      profileId: options.profileId,
      timezone: options.timezone,
      webrtc: options.webrtc,
      extraArgs,
      onLog
    });

    const { context, page } = handle;
    try {
      await context.addCookies(cookies);
    } catch {}

    let screenName = null;
    try {
      screenName = await readLoggedInScreenName(page, { signal, onLog });
    } catch (e) {
      if (e instanceof XLoadError || e?.name === "AbortError") throw e;
    }

    throwIfAborted(signal);
    const targetRaw = String(options.target || "me").trim();
    if (!screenName && options.screenName && /^me$/i.test(targetRaw)) {
      screenName = String(options.screenName).replace(/^@/, "");
      onLog(`Using your saved account @${screenName}`);
    }
    let profilePath;
    try {
      profilePath = resolveTargetPath(targetRaw, screenName);
    } catch (e) {
      if (/^me$/i.test(targetRaw) && !screenName) {
        await page.goto("https://x.com/settings/profile", {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });
        await new Promise((r) => setTimeout(r, 1500));
        const again = await page.evaluate(String.raw`(() => {
          const m = location.pathname.match(/^\/([^/]+)/);
          return m && ["settings", "i", "home"].indexOf(m[1]) === -1 ? m[1] : null;
        })()`);
        const fromUrl = await page.evaluate(String.raw`(() => {
          const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
          const href = a && a.getAttribute("href");
          return (href && href.split("/").filter(Boolean)[0]) || null;
        })()`);
        screenName = again || fromUrl;
        profilePath = resolveTargetPath(targetRaw, screenName);
      } else {
        throw e;
      }
    }

    onLog(`Scanning @${labelFromPath(profilePath)}…`);
    onProgress({
      phase: "scraping",
      message: `Scanning ${profilePath}`,
      mediaCount: 0,
      profilePath,
      screenName
    });

    let knownMedia = () => null;
    if (options.sha256Dedupe !== false && options.hideDownloaded !== false) {
      try {
        const db = await openDb(options);
        knownMedia = createKnownMediaCheck(db, { remember: options.rememberDownloads !== false });
        const legacy = db.legacyStatus(options.outRoot);
        if (legacy && !legacy.importedAt) {
          onLog(`Old index found (${legacy.keys} entries). Migrate it on the Database page to hide those too.`);
        }
      } catch (e) {
        onLog(`Media database unavailable: ${String(e?.message || e)}`);
      }
    }
    const hidden = new Set();
    const seen = new Set();
    let withheld = 0;
    const maxScrolls = Math.max(50, Number(options.maxScrolls) || 800);
    const itemsRaw = await collectMediaFromProfile(page, profilePath, {
      maxScrolls,
      pauseMs: options.pauseMs ?? 1200,
      maxIdleRounds: options.maxIdleRounds ?? 45,
      sources: Array.isArray(options.sources) ? options.sources : [],
      signal,
      onLog,
      onWithheld: (item, count) => {
        withheld = count;
        if (item && hooks.onDrop) hooks.onDrop(item);
      },
      onProgress: (p) => {
        const shown =
          typeof p.mediaCount === "number" ? Math.max(0, p.mediaCount - hidden.size) : p.mediaCount;
        const base = String(p.message || `${shown} found`).replace(
          /(\d+) found/,
          () => `${shown} found`
        );
        onProgress({
          phase: "scraping",
          message: hidden.size ? `${base} · ${hidden.size} already saved` : base,
          scroll: p.scroll,
          maxScrolls: p.maxScrolls,
          mediaCount: shown,
          hidden: hidden.size,
          tweetCount: p.tweetCount,
          idle: p.idle
        });
      },
      onItem: (item) => {
        const id = item.id || item.url;
        if (hidden.has(id)) return;
        if (knownMedia(item)) {
          hidden.add(id);
          return;
        }
        const key = `${id}|${item.url}`;
        if (seen.has(key)) return;
        seen.add(key);
        onItem(item);
      }
    });

    const all = filterItems(itemsRaw, { ...options, skipHls: false });
    const items = all.filter((it) => !hidden.has(it.id || it.url) && !knownMedia(it));
    const hiddenCount = all.length - items.length;
    onLog(
      hiddenCount
        ? `Found ${items.length} media (${hiddenCount} already downloaded, hidden)`
        : `Found ${items.length} media`
    );
    if (withheld) onLog(`Skipped ${withheld} that X removed (copyright or withheld)`);
    await closeBrowser();

    return { profilePath, screenName, items, hiddenCount, withheldCount: withheld };
  } catch (e) {
    await closeBrowser();
    if (signal?.aborted || e?.name === "AbortError") throw e;
    if (/Target page, context or browser has been closed|browser has disconnected|Target closed/i.test(String(e?.message))) {
      throw new Error("The ShardX browser closed unexpectedly. Run the scan again. If it keeps happening, use Account → Reset browser profile.");
    }
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function runDownloadJob(options, hooks = {}) {
  const onLog = hooks.onLog || (() => {});
  const onProgress = hooks.onProgress || (() => {});
  const onItem = hooks.onItem || (() => {});
  const signal = options.signal;

  const cookies = resolveCookies(options.cookies);
  let items = Array.isArray(options.items) ? options.items : [];
  items = filterItems(items, options);
  if (!items.length) throw new Error("Nothing selected to download.");

  const outRoot = options.outRoot;
  fs.mkdirSync(outRoot, { recursive: true });
  const stamp = defaultStamp();
  const label = sanitizeLabel(options.label || options.profilePath || "media");
  const layout = options.folderLayout === "profile" || options.folderLayout === "single" ? options.folderLayout : "run";
  const reuse = Boolean(options.runDir && path.isAbsolute(options.runDir) && isInside(options.runDir, outRoot));
  const runDir = reuse
    ? options.runDir
    : layout === "single"
      ? path.join(outRoot, folderName(options.singleFolderName))
      : path.join(outRoot, layout === "profile" ? label : `${label}_${stamp}`);

  const dedupe = options.sha256Dedupe !== false;
  let db = null;
  try {
    db = await openDb(options);
  } catch (e) {
    onLog(`Media database unavailable (${String(e?.message || e)}). Continuing without history.`);
  }
  if (dedupe && db) {
    onProgress({ phase: "downloading", message: "Indexing output folder…", downloadDone: 0, downloadTotal: items.length });
    const seeded = db.seedFromDisk(outRoot, { signal });
    if (seeded.added > 0) onLog(`Indexed ${seeded.added} existing file${seeded.added === 1 ? "" : "s"}`);
  }
  throwIfAborted(signal);
  const profile = labelFromPath(options.profilePath || options.label || "media");
  const runId = db ? db.startRun({ profile, runDir, outRoot, requested: items.length }) : null;
  let runStatus = "failed";
  let result = null;

  onLog(`Downloading ${items.length}…`);
  onProgress({
    phase: "downloading",
    message: `Downloading ${items.length}`,
    downloadDone: 0,
    downloadTotal: items.length,
    mediaCount: items.length
  });

  const cookieHeader = cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const req = createHttpContext({
    extraHTTPHeaders: {
      Accept: "*/*",
      Referer: "https://x.com/",
      "User-Agent":
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    timeout: options.requestTimeoutMs || 120000,
    proxyUrl: options.proxyUrl || ""
  });

  try {
    throwIfAborted(signal);
    const { saved, skipped, errors } = (result = await downloadAll(req, items, runDir, {
      db,
      dedupe,
      runId,
      profile,
      remember: options.rememberDownloads !== false,
      shared: reuse || layout !== "run",
      split: options.splitByType !== false,
      prefix: layout === "single" ? label : "",
      signal,
      concurrency: options.concurrency,
      retries: options.retries ?? 2,
      onProgress: (done, total, ok, fail, skip) => {
        onProgress({
          phase: "downloading",
          message: `${done}/${total}`,
          downloadDone: done,
          downloadTotal: total,
          saved: ok,
          failed: fail,
          skipped: skip
        });
      },
      onSaved: (entry, item) => {
        onItem({ ...item, localPath: entry.path, rel: entry.rel, sha256: entry.sha256 });
      }
    }));

    let zipPath = null;
    if (options.wantZip && saved.length > 0) {
      throwIfAborted(signal);
      zipPath = path.join(outRoot, `${label}_${stamp}.zip`);
      onProgress({ phase: "zipping", message: "Building ZIP…" });
      if (layout === "run" && !reuse) await zipFolderToFile(runDir, zipPath);
      else await zipFilesToFile(saved.map((f) => f.path), runDir, zipPath);
    }

    onLog(`Saved ${saved.length}`);
    runStatus = "done";
    return { runDir, zipPath, saved, skipped, errors, items };
  } catch (e) {
    runStatus = e?.name === "AbortError" || /cancel/i.test(String(e?.message)) ? "cancelled" : "failed";
    throw e;
  } finally {
    await req.dispose().catch(() => {});
    try {
      db?.finishRun(runId, {
        status: runStatus,
        saved: result?.saved.length || 0,
        skipped: result?.skipped.length || 0,
        failed: result?.errors.length || 0,
        bytes: (result?.saved || []).reduce((n, s) => n + (s.bytes || 0), 0)
      });
      db?.flushNow();
    } catch {}
  }
}

function isInside(target, root) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function folderName(raw) {
  const name = String(raw || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 60)
    .trim();
  return !name || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name) ? "All media" : name;
}

function sanitizeLabel(raw) {
  try {
    return labelFromPath(String(raw));
  } catch {
    return "media";
  }
}

export async function runScrapeJob(options, hooks = {}) {
  const collected = await runCollectJob(options, hooks);
  if (!collected.items.length) {
    if (collected.hiddenCount) {
      throw new Error(`All ${collected.hiddenCount} media on this profile are already downloaded.`);
    }
    throw new Error(
      "No media found. Confirm the Posts tab loads while logged in (protected accounts need follow approval)."
    );
  }
  const downloaded = await runDownloadJob(
    {
      ...options,
      items: collected.items,
      profilePath: collected.profilePath,
      label: collected.profilePath
    },
    hooks
  );
  return {
    profilePath: collected.profilePath,
    screenName: collected.screenName,
    items: collected.items,
    ...downloaded
  };
}
