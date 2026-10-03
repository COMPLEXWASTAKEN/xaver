import { walkMediaFromJson, upgradeImageUrl, mediaIdentity, preferMedia } from "./media.js";

function dedupeKey(item) {
  return mediaIdentity(item);
}

export function resolveTargetPath(input, screenName) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Empty target");
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    if (!/^(?:www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) {
      throw new Error("URL must be an x.com / twitter.com profile");
    }
    return u.pathname.replace(/\/+$/, "") || "/home";
  }
  if (/^(me|self|profile)$/i.test(raw)) {
    if (!screenName) throw new Error("Could not resolve logged-in username for 'me'");
    return `/${screenName}`;
  }
  const user = raw.replace(/^@/, "").split("/")[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(user)) {
    throw new Error("Invalid username. Use me, @handle, handle, or a full profile URL.");
  }
  const stripped = raw.replace(/^@/, "");
  if (!stripped.includes("/")) {
    return `/${user}`;
  }
  const rest = stripped.slice(user.length);
  if (!rest || rest === "/") return `/${user}`;
  return `/${user}${rest.startsWith("/") ? rest : `/${rest}`}`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Cancelled");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (!signal) return;
    function onAbort() {
      clearTimeout(t);
      const err = new Error("Cancelled");
      err.name = "AbortError";
      reject(err);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const PAGE_GRAPHQL_CAPTURE = String.raw`(() => {
  function shouldCapturePath(pathname) {
    return typeof pathname === "string" && pathname.includes("/graphql/");
  }
  function emit(body) {
    if (typeof body !== "string" || body.length < 32) return;
    try {
      window.__xvGqlBuf = window.__xvGqlBuf || [];
      window.__xvGqlBuf.push(body);
      if (window.__xvGqlBuf.length > 80) {
        window.__xvGqlBuf.splice(0, window.__xvGqlBuf.length - 80);
      }
    } catch (e) {}
  }
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    const url = arguments[1];
    let u = null;
    try {
      u = typeof url === "string" ? new URL(url, location.origin) : null;
    } catch (e) {
      u = null;
    }
    if (u && shouldCapturePath(u.pathname)) {
      this.addEventListener("load", function () {
        if (this.status === 200) emit(this.responseText);
      });
    }
    return xo.apply(this, arguments);
  };
  const ofetch = window.fetch;
  window.fetch = function () {
    const input = arguments[0];
    let urlStr = "";
    if (typeof input === "string") urlStr = input;
    else if (input && typeof input === "object" && typeof input.url === "string") urlStr = input.url;
    let cap = false;
    try {
      const u = urlStr ? new URL(urlStr, location.origin) : null;
      if (u && shouldCapturePath(u.pathname)) cap = true;
    } catch (e) {}
    const p = ofetch.apply(this, arguments);
    if (cap) {
      p.then(
        function (res) {
          if (res.status === 200) {
            res.clone().text().then(function (t) { emit(t); }).catch(function () {});
          }
        },
        function () {}
      );
    }
    return p;
  };
})()`;

function pageFn(source) {
  return new Function(`return (${source});`)();
}

const PAGE_READ_HANDLE = String.raw`() => {
  const selectors = [
    '[data-testid="AppTabBar_Profile_Link"]',
    'a[aria-label="Profile"]',
    'a[data-testid="AppTabBar_Profile_Link"]'
  ];
  const skip = ["home", "explore", "i", "settings", "messages", "notifications"];
  for (let i = 0; i < selectors.length; i++) {
    const a = document.querySelector(selectors[i]);
    const href = (a && a.getAttribute("href")) || "";
    const part = href.split("/").filter(Boolean)[0];
    if (part && skip.indexOf(part.toLowerCase()) === -1) return part;
  }
  return null;
}`;

const PAGE_DRAIN_GQL = String.raw`() => {
  const buf = window.__xvGqlBuf || [];
  window.__xvGqlBuf = [];
  return buf;
}`;

const PAGE_SCRAPE_VISIBLE = String.raw`() => {
  const out = [];
  const tweets = new Set();
  document.querySelectorAll('article[data-testid="tweet"]').forEach(function (art) {
    const links = art.querySelectorAll('a[href*="/status/"]');
    for (let i = 0; i < links.length; i++) {
      const m = (links[i].getAttribute("href") || "").match(/\/status\/(\d+)/);
      if (m) tweets.add(m[1]);
    }
  });
  function pushImg(src) {
    if (!src || !/pbs\.twimg\.com\/media\//i.test(src)) return;
    out.push({ url: src, kind: "image", gif: false });
  }
  document.querySelectorAll('img[src*="pbs.twimg.com/media"],img[srcset*="pbs.twimg.com/media"]').forEach(function (img) {
    if (img.src) pushImg(img.src);
    const ss = img.getAttribute("srcset") || "";
    ss.split(",").forEach(function (part) {
      const u = part.trim().split(/\s+/)[0];
      if (u) pushImg(u);
    });
  });
  document.querySelectorAll("video").forEach(function (v) {
    const poster = v.getAttribute("poster") || "";
    const wrap = v.closest('[data-testid="videoComponent"], [data-testid="videoPlayer"], article, div');
    const nearby = (wrap && wrap.querySelector('img[src*="twimg.com"]') && wrap.querySelector('img[src*="twimg.com"]').getAttribute("src")) || "";
    const thumb = poster || nearby || "";
    function pushVid(src) {
      if (!src || src.indexOf("blob:") === 0) return;
      if (!/video\.twimg\.com|\.mp4|\.m3u8/i.test(src)) return;
      const item = { url: src, kind: "video", gif: /\/tweet_video\//i.test(src) };
      if (thumb) item.thumb = thumb;
      out.push(item);
    }
    pushVid(v.currentSrc || v.src);
    v.querySelectorAll("source").forEach(function (s) { pushVid(s.src); });
  });
  document.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]').forEach(function (el) {
    const vid = el.querySelector("video");
    const img = el.querySelector('img[src*="twimg.com"]');
    const poster = (vid && vid.getAttribute("poster")) || (img && img.getAttribute("src")) || "";
    el.querySelectorAll("source, video").forEach(function (n) {
      const src = n.getAttribute("src") || n.currentSrc || "";
      if (src && src.indexOf("blob:") !== 0 && /video\.twimg\.com|\.mp4|\.m3u8/i.test(src)) {
        const item = { url: src, kind: "video", gif: false };
        if (poster) item.thumb = poster;
        out.push(item);
      }
    });
  });
  const endMarkers = Array.from(document.querySelectorAll('[data-testid="emptyState"], [role="status"]'))
    .map(function (el) { return (el.textContent || "").trim(); })
    .some(function (t) { return /nothing to see|no posts|doesn.?t have any posts/i.test(t); });
  return { media: out, tweetIds: Array.from(tweets), endMarkers: endMarkers };
}`;

const PAGE_SCROLL = String.raw`() => {
  const root =
    document.querySelector('[data-testid="primaryColumn"]') ||
    document.querySelector('main[role="main"]') ||
    document.scrollingElement ||
    document.documentElement;
  const step = Math.max(1100, Math.floor(window.innerHeight * 1.15));
  if (root && root !== document.documentElement && root !== document.scrollingElement) {
    root.scrollBy(0, step);
  }
  window.scrollBy(0, step);
  if (document.scrollingElement) document.scrollingElement.scrollBy(0, step);
}`;

const PAGE_DISMISS = String.raw`() => {
  const want = /^(retry|try again|show more replies|yes,? view profile|yes,? view|view profile|see more|view posts)$/i;
  const buttons = Array.from(document.querySelectorAll('[role="button"], button, div[role="button"]'));
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    const t = (b.textContent || "").replace(/\s+/g, " ").trim();
    if (want.test(t) || (/sensitive/i.test(t) && /view/i.test(t) && t.length < 64)) {
      try { b.click(); } catch (e) {}
    }
  }
}`;

const PAGE_OPEN_TAB = String.raw`(wantPath) => {
  const want = String(wantPath || "").replace(/\/+$/, "") || "/";
  const links = Array.from(document.querySelectorAll("a[href]"));
  for (let i = 0; i < links.length; i++) {
    const a = links[i];
    const href = (a.getAttribute("href") || "").split("?")[0].replace(/\/+$/, "") || "/";
    if (href === want || href.endsWith(want)) {
      try { a.click(); return; } catch (e) {}
    }
  }
}`;

const PAGE_PROTECTED = String.raw`() => {
  const t = (document.body && document.body.innerText) || "";
  return /These posts are protected|Only approved followers/i.test(t);
}`;

const PAGE_AT_BOTTOM = String.raw`() => {
  const el = document.scrollingElement || document.documentElement;
  const y = window.scrollY || el.scrollTop || 0;
  const view = window.innerHeight || 0;
  const height = Math.max(el.scrollHeight || 0, document.documentElement.scrollHeight || 0);
  return y + view >= height - 120;
}`;

const PAGE_X_STATE = String.raw`() => {
  if (document.querySelector('[data-testid="loginButton"], input[autocomplete="username"], a[href="/login"][role="link"]')) return "login";
  if (document.querySelector('[data-testid="primaryColumn"], [data-testid="AppTabBar_Profile_Link"], [data-testid="emptyState"]')) return "ready";
  const text = (document.body && document.body.innerText) || "";
  if (/Something went wrong|Try reloading|Etwas ist schiefgelaufen|Coś poszło nie tak/i.test(text) && text.length < 600) return "error";
  return "loading";
}`;

export class XLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "XLoadError";
  }
}

export async function openX(page, url, { signal, onLog, attempts = 3, waitMs = 25000 } = {}) {
  let last = "loading";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      onLog?.(`X ${last === "error" ? "showed an error" : "is still loading"}, retrying (${attempt}/${attempts})…`);
      await sleep(1500 * attempt, signal);
    }
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      if (signal?.aborted || /closed/i.test(String(e?.message))) throw e;
      last = "loading";
      continue;
    }
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(500, signal);
      last = await page.evaluate(pageFn(PAGE_X_STATE)).catch(() => "loading");
      if (last === "ready" || last === "login" || last === "error") break;
    }
    if (last === "ready") return "ready";
    if (last === "login") return "login";
  }
  throw new XLoadError(
    last === "error"
      ? "X keeps showing “Something went wrong”. X may be having problems. Try again in a few minutes."
      : "X didn't finish loading after 3 tries. X may be down or your connection is blocking it. Try again in a few minutes."
  );
}

export async function readLoggedInScreenName(page, opts = {}) {
  const state = await openX(page, "https://x.com/home", opts);
  if (state === "login") return null;
  for (let i = 0; i < 10; i++) {
    const handle = await page.evaluate(pageFn(PAGE_READ_HANDLE));
    if (handle) return handle;
    await sleep(500);
  }
  return null;
}

async function drainGraphqlBuffer(page, addItems) {
  const bodies = await page.evaluate(pageFn(PAGE_DRAIN_GQL));
  for (const body of bodies) {
    try {
      const json = JSON.parse(body);
      const batch = [];
      walkMediaFromJson(json, batch);
      addItems(batch);
    } catch {}
  }
}

async function scrapeVisible(page, addItems, tweetIds) {
  const snap = await page.evaluate(pageFn(PAGE_SCRAPE_VISIBLE));

  for (const id of snap.tweetIds) tweetIds.add(id);
  addItems(
    snap.media.map((it) =>
      it.kind === "image" ? { ...it, url: upgradeImageUrl(it.url) || it.url } : it
    )
  );
  return snap.endMarkers;
}

async function scrollTimeline(page) {
  await page.evaluate(pageFn(PAGE_SCROLL));
}

async function dismissNoise(page) {
  await page.evaluate(pageFn(PAGE_DISMISS)).catch(() => {});
}

const TAB_SUFFIX = {
  posts: "",
  media: "/media",
  reposts: "/reposts",
  replies: "/with_replies",
  likes: "/likes",
  highlights: "/highlights"
};

const TAB_FROM_SEG = {
  media: "media",
  reposts: "reposts",
  with_replies: "replies",
  replies: "replies",
  likes: "likes",
  highlights: "highlights"
};

export function detectProfileTab(profilePath) {
  const segs = String(profilePath || "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const user = segs[0] || "";
  const second = (segs[1] || "").toLowerCase();
  if (segs.length <= 1) return { user, tab: null, passthrough: null };
  if (TAB_FROM_SEG[second]) return { user, tab: TAB_FROM_SEG[second], passthrough: null };
  return { user, tab: null, passthrough: String(profilePath).replace(/\/+$/, "") || `/${user}` };
}

export function pathsForSources(profilePath, sources) {
  const det = detectProfileTab(profilePath);
  if (det.passthrough) return [{ tab: det.tab || "custom", path: det.passthrough }];
  const wanted = [];
  const push = (tab) => {
    if (!tab || wanted.includes(tab) || !Object.prototype.hasOwnProperty.call(TAB_SUFFIX, tab)) return;
    wanted.push(tab);
  };
  if (Array.isArray(sources) && sources.length) sources.forEach(push);
  else if (det.tab) push(det.tab);
  if (!wanted.length) wanted.push("media");
  return wanted.map((tab) => ({
    tab,
    path: `/${det.user}${TAB_SUFFIX[tab] || ""}`
  }));
}

async function openProfileTab(page, tabPath) {
  await page.evaluate(pageFn(PAGE_OPEN_TAB), tabPath).catch(() => {});
}

export async function collectMediaFromProfile(page, profilePath, options = {}) {
  const maxIdleRounds = options.maxIdleRounds ?? 45;
  const maxScrolls = options.maxScrolls ?? 800;
  const pauseMs = options.pauseMs ?? 1200;
  const signal = options.signal;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const onItem = typeof options.onItem === "function" ? options.onItem : null;

  const seen = new Map();
  const tweetIds = new Set();
  const addItems = (items) => {
    for (const it of items) {
      if (!it?.url || !/^https?:/i.test(it.url)) continue;
      if (/profile_images|profile_banners/i.test(it.url)) continue;
      const key = dedupeKey(it);
      const tagged = { ...it, id: it.id || key };
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, tagged);
        if (onItem) onItem(tagged);
      } else {
        const better = preferMedia(prev, tagged);
        if (better.url !== prev.url) {
          seen.set(key, better);
          if (onItem) onItem(better);
        }
      }
    }
  };

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error("Cancelled");
      err.name = "AbortError";
      throw err;
    }
  };

  await page.addInitScript({ content: PAGE_GRAPHQL_CAPTURE });

  const onResponse = async (res) => {
    try {
      const url = res.url();
      if (!/\/graphql\//i.test(url) && !/\/i\/api\//i.test(url)) return;
      const status = res.status();
      if (status < 200 || status >= 300) return;
      const ct = String(res.headers()["content-type"] || "");
      if (ct && !/json|javascript/i.test(ct) && !/graphql/i.test(url)) return;
      const text = await res.text().catch(() => "");
      if (!text || text.length < 32 || (text[0] !== "{" && text[0] !== "[")) return;
      try {
        const json = JSON.parse(text);
        const batch = [];
        walkMediaFromJson(json, batch);
        addItems(batch);
      } catch {}
    } catch {}
  };
  page.on("response", onResponse);

  try {
    const routes = pathsForSources(profilePath, options.sources);
    let authedChecked = false;
    let totalScrolls = 0;

    for (let r = 0; r < routes.length; r++) {
      throwIfAborted();
      const route = routes[r];
      const targetUrl = `https://x.com${route.path.startsWith("/") ? route.path : `/${route.path}`}`;
      console.log(`Opening ${targetUrl}`);
      if (onProgress) {
        onProgress({
          mediaCount: seen.size,
          tweetCount: tweetIds.size,
          scroll: totalScrolls,
          maxScrolls,
          idle: 0,
          maxIdleRounds,
          tab: route.tab,
          message: `Scanning ${route.tab} (${r + 1}/${routes.length})`
        });
      }
      const xState = await openX(page, targetUrl, { signal, onLog: options.onLog });
      await sleep(800, signal);
      await dismissNoise(page);
      await openProfileTab(page, route.path);
      await sleep(900, signal);

      if (!authedChecked) {
        const title = await page.title().catch(() => "");
        if (xState === "login" || /log in|sign in/i.test(title)) {
          throw new Error("Not logged in. Your X session expired, so sign in again on the Account page.");
        }
        authedChecked = true;
      }

      const protectedLock = await page.evaluate(pageFn(PAGE_PROTECTED));
      if (protectedLock) {
        console.warn(
          "Profile shows protected posts. Media only appears if this account can see them."
        );
      }

      let idle = 0;
      let scrolls = 0;
      let lastTweetCount = tweetIds.size;
      let lastMediaCount = seen.size;
      let stuckAtBottom = 0;

      while (scrolls < maxScrolls && idle < maxIdleRounds) {
        throwIfAborted();
        await drainGraphqlBuffer(page, addItems);
        await scrapeVisible(page, addItems, tweetIds);
        await dismissNoise(page);

        const mediaCount = seen.size;
        const tweetCount = tweetIds.size;
        process.stdout.write(
          `\r[${route.tab}] Media ${mediaCount} · posts ${tweetCount} · scroll ${scrolls + 1}/${maxScrolls} · idle ${idle}/${maxIdleRounds}   `
        );
        if (onProgress) {
          onProgress({
            mediaCount,
            tweetCount,
            scroll: totalScrolls + scrolls + 1,
            maxScrolls: maxScrolls * routes.length,
            idle,
            maxIdleRounds,
            tab: route.tab,
            message: `${route.tab} · ${mediaCount} found`
          });
        }

        const progress = tweetCount > lastTweetCount || mediaCount > lastMediaCount;
        if (progress) idle = 0;
        else idle++;

        lastTweetCount = tweetCount;
        lastMediaCount = mediaCount;

        await scrollTimeline(page);
        await sleep(pauseMs, signal);
        scrolls++;

        await drainGraphqlBuffer(page, addItems);

        const bottom = await page.evaluate(pageFn(PAGE_AT_BOTTOM));

        if (bottom && !progress) stuckAtBottom++;
        else if (!bottom) stuckAtBottom = 0;

        if (stuckAtBottom >= 12 && idle >= 20) break;
      }

      totalScrolls += scrolls;
      await drainGraphqlBuffer(page, addItems);
      await scrapeVisible(page, addItems, tweetIds);
    }

    process.stdout.write(
      `\nFinished scroll: ${seen.size} media from ${tweetIds.size} posts (${totalScrolls} scrolls).\n`
    );
    return [...seen.values()];
  } finally {
    try {
      page.off("response", onResponse);
    } catch {}
  }
}
