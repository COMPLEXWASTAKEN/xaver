import fs from "node:fs";
import path from "node:path";
import { ShardX } from "@proxyshard/shardx";

const ID_FILE = "pms-profile-id.txt";

let cached = null;

function resolveCacheDir(options) {
  const raw = String(options.cacheDir || options.userDataDir || "").trim();
  if (raw) return path.resolve(raw);
  return path.join(process.cwd(), ".shardx");
}

function getSdk(cacheDir, onLog) {
  if (cached && cached.cacheDir === cacheDir) return cached.sdk;
  const sdk = new ShardX({
    cacheDir,
    progress: (label, received, total) => {
      const pct = total ? Math.floor((received / total) * 100) : 0;
      onLog(`${label}: ${pct}%`);
    }
  });
  cached = { sdk, cacheDir };
  return sdk;
}

function readSavedId(cacheDir) {
  const file = path.join(cacheDir, ID_FILE);
  if (!fs.existsSync(file)) return "";
  return String(fs.readFileSync(file, "utf8") || "").trim();
}

function writeSavedId(cacheDir, id) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, ID_FILE), String(id || "").trim());
}

async function loadOrCreateProfile(sdk, cacheDir, options, onLog) {
  const wantId = String(options.profileId || readSavedId(cacheDir) || "").trim();
  if (wantId) {
    try {
      return sdk.openProfile(wantId);
    } catch {
      onLog(`Saved ShardX profile ${wantId} is missing, so a new one was created.`);
    }
  }

  const template = String(options.template || options.fingerprintSeed || "").trim();
  let profile;
  if (template && /^(win-|mac-|linux-|android-)/i.test(template)) {
    onLog(`Creating ShardX profile from ${template}…`);
    try {
      profile = await sdk.createProfile(template);
    } catch (e) {
      onLog(`Template ${template} failed (${e?.message || e}). Using a random Windows profile instead.`);
      profile = await sdk.createProfile(undefined, { platform: "Windows" });
    }
  } else {
    onLog("Creating ShardX Windows profile…");
    profile = await sdk.createProfile(undefined, { platform: "Windows" });
  }
  writeSavedId(cacheDir, profile.id);
  return profile;
}

export async function openShardxContext(options) {
  const onLog = options.onLog || (() => {});
  const cacheDir = resolveCacheDir(options);
  fs.mkdirSync(cacheDir, { recursive: true });

  const sdk = getSdk(cacheDir, onLog);
  onLog("Preparing ShardX (first run downloads the Chromium 152 engine)…");
  await sdk.runtime.install();

  let profile = await loadOrCreateProfile(sdk, cacheDir, options, onLog);

  const timezone = String(options.timezone || "").trim();
  if (timezone && typeof profile.withOverride === "function") {
    profile = profile.withOverride({ timezone });
  }

  if (options.humanize !== false && typeof profile.setNoise === "function") {
    try {
      profile.setNoise("canvas", "audio", "webgl");
    } catch {}
  }

  const extraArgs = [];
  if (Array.isArray(options.extraArgs)) {
    for (const a of options.extraArgs) {
      const t = String(a || "").trim();
      if (t) extraArgs.push(t);
    }
  }

  const proxy = String(options.proxyUrl || "").trim();
  const webrtc = options.webrtc === "block" || options.webrtc === "tcp_only" ? options.webrtc : "auto";

  onLog(`Launching ShardX${proxy ? " · proxy" : ""}${options.headless ? " · headless" : ""}…`);

  const { browser, session, close } = await sdk.session(profile, {
    proxy: proxy || undefined,
    headless: Boolean(options.headless),
    extraArgs,
    webrtc,
    screenMode: "use_host"
  });

  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  const geoBit = session?.geo?.countryCode ? ` · ${session.geo.countryCode}` : "";
  onLog(
    `ShardX ready · QUIC ${session?.quicEnabled ? "on" : "off"} · WebRTC ${session?.webrtcMode || "auto"}${geoBit}`
  );

  return {
    context,
    page,
    browser,
    session,
    profileId: profile.id,
    async close() {
      try {
        await close();
      } catch {}
    }
  };
}

export function defaultCliProfileDir(rootDir) {
  return path.join(rootDir, ".shardx");
}

export async function ensureShardxReady(cacheDir, onLog = () => {}) {
  const dir = resolveCacheDir({ cacheDir });
  const sdk = getSdk(dir, onLog);
  onLog("Downloading / verifying ShardX engine…");
  await sdk.runtime.install();
  return {
    installed: true,
    cacheDir: dir,
    profiles: sdk.listSavedProfiles()
  };
}

export function clearShardxProfile(cacheDir) {
  const dir = resolveCacheDir({ cacheDir });
  const sdk = getSdk(dir, () => {});
  const id = readSavedId(dir);
  if (id) {
    try {
      sdk.deleteProfile(id);
    } catch {}
  }
  const idFile = path.join(dir, ID_FILE);
  if (fs.existsSync(idFile)) fs.unlinkSync(idFile);
  return dir;
}

export function getShardxCacheDir(rootDir) {
  return resolveCacheDir({ cacheDir: rootDir });
}
