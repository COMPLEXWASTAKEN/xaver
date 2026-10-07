export function upgradeImageUrl(src) {
  try {
    if (!/^https:\/\/pbs\.twimg\.com\//i.test(src)) return src;
    const u = new URL(src);
    if (/profile_images|profile_banners|emoji|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb/i.test(u.pathname)) {
      return "";
    }
    const m = u.pathname.match(/^(.*\/media\/)([^/.]+)(?:\.[a-z0-9]+)?$/i);
    if (!m) return src;
    const id = m[2];
    const out = new URL(`https://pbs.twimg.com${m[1]}${id}`);
    const fmt = u.searchParams.get("format") || "jpg";
    out.searchParams.set("format", fmt === "png" || fmt === "webp" ? fmt : "jpg");
    out.searchParams.set("name", "large");
    return out.href;
  } catch {
    return src;
  }
}

export function videoThumbUrl(src) {
  try {
    if (!src || !/^https:\/\//i.test(src)) return "";
    if (/video\.twimg\.com/i.test(src)) return "";
    const u = new URL(src);
    if (/pbs\.twimg\.com/i.test(u.hostname)) {
      if (/profile_images|profile_banners|emoji/i.test(u.pathname)) return "";
      if (!u.searchParams.get("name")) u.searchParams.set("name", "small");
      if (!u.searchParams.get("format") && !/\.(jpe?g|png|webp)$/i.test(u.pathname)) {
        u.searchParams.set("format", "jpg");
      }
      return u.href;
    }
    return src;
  } catch {
    return "";
  }
}

export function imageFetchCandidates(url) {
  const list = [];
  const push = (u) => {
    if (u && !list.includes(u)) list.push(u);
  };
  push(url);
  try {
    if (!/pbs\.twimg\.com/i.test(url)) return list;
    const u = new URL(url);
    const m = u.pathname.match(/^(.*\/media\/)([^/.]+)(?:\.[a-z0-9]+)?$/i);
    if (!m) return list;
    const base = `https://pbs.twimg.com${m[1]}${m[2]}`;
    const fmt = u.searchParams.get("format") || "jpg";
    for (const name of ["large", "orig", "4096x4096", "medium"]) {
      push(`${base}?format=${fmt}&name=${name}`);
    }
    if (fmt !== "jpg") push(`${base}?format=jpg&name=large`);
  } catch {}
  return list;
}

function variantBitrate(v) {
  return Number(v?.bitrate || v?.bit_rate || v?.bitRate || 0);
}

export function pickBestVideoVariant(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const usable = variants.filter((x) => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url));
  const mp4 = usable.filter(
    (x) => /video\/mp4/i.test(String(x.content_type || x.contentType || "")) || /\.mp4(\?|$)/i.test(x.url)
  );
  if (mp4.length) {
    return mp4.reduce((a, b) => (variantBitrate(b) > variantBitrate(a) ? b : a)).url;
  }
  const hls = usable.filter(
    (x) =>
      /mpegURL|application\/x-mpegURL|mp2t/i.test(String(x.content_type || x.contentType || "")) ||
      /\.m3u8(\?|$)/i.test(x.url)
  );
  if (hls.length) {
    return hls.reduce((a, b) => (variantBitrate(b) > variantBitrate(a) ? b : a)).url;
  }
  return usable[0]?.url || null;
}

function variantsFrom(node) {
  if (!node || typeof node !== "object") return [];
  const lists = [
    node.video_info?.variants,
    node.media_info?.variants,
    node.legacy?.video_info?.variants,
    node.media_results?.result?.video_info?.variants,
    node.media_results?.result?.media_info?.variants,
    node.media_results?.result?.legacy?.video_info?.variants
  ];
  for (const list of lists) {
    if (Array.isArray(list) && list.length) return list;
  }
  return [];
}

function thumbFrom(node) {
  if (!node || typeof node !== "object") return "";
  const result = node.media_results?.result || node;
  const info = result.media_info || result;
  const candidates = [
    node.media_url_https,
    node.media_url,
    result.media_url_https,
    info.original_img_url,
    info.original_img_large_url,
    result.original_img_url,
    info.preview_image?.url,
    result.preview_image?.url
  ];
  for (const c of candidates) {
    const t = videoThumbUrl(typeof c === "string" ? c : "");
    if (t) return t;
  }
  return "";
}

function isGifNode(node) {
  const t = String(node?.type || node?.media_info?.__typename || node?.__typename || "");
  return /animated_gif|ApiGif|Gif/i.test(t);
}

function isVideoNode(node) {
  if (!node || typeof node !== "object") return false;
  const t = String(node.type || "");
  const tn = String(node.__typename || node.media_info?.__typename || "");
  if (t === "video" || t === "animated_gif") return true;
  if (/^(ApiVideo|ApiGif|Video|AnimatedGif|Gif)$/i.test(tn)) return true;
  if (node.video_info || node.media_info?.variants) return true;
  return false;
}

function ingestVideo(node, out) {
  const vurl = pickBestVideoVariant(variantsFrom(node));
  if (!vurl) return false;
  const thumb = thumbFrom(node);
  out.push({
    url: vurl,
    kind: "video",
    gif: isGifNode(node) || /\/tweet_video\//i.test(vurl),
    ...(thumb ? { thumb } : {})
  });
  return true;
}

function imageMediaId(pathname) {
  const m = String(pathname || "").match(/\/media\/([^/]+)/i);
  if (!m) return "";
  let id = m[1];
  const colon = id.indexOf(":");
  if (colon >= 0) id = id.slice(0, colon);
  const dot = id.lastIndexOf(".");
  if (dot > 0) id = id.slice(0, dot);
  return id;
}

function imageRank(url) {
  try {
    const u = new URL(url);
    const name = (u.searchParams.get("name") || "").toLowerCase();
    if (name === "orig") return 1_000_000;
    const mw = name.match(/^(\d+)x(\d+)$/);
    if (mw) return Math.min(Number(mw[1]) * Number(mw[2]), 999_999);
    if (name === "large") return 500_000;
    if (name === "medium") return 200_000;
    if (name === "small" || name === "thumb" || name === "240x240") return 1_000;
    return 10_000;
  } catch {
    return 0;
  }
}

function videoRank(url) {
  let s = 0;
  try {
    const path = new URL(url).pathname;
    const res = path.match(/(\d{2,5})x(\d{2,5})/i);
    const pixels = res ? Number(res[1]) * Number(res[2]) : 0;
    if (/\.mp4$/i.test(path)) {
      s += 1_000_000 + Math.min(pixels, 500_000);
      if (/\/vid\//i.test(path)) s += 1000;
    } else if (/\.m3u8$/i.test(path)) {
      s += 1000;
    }
  } catch {}
  return s;
}

function videoGroupKey(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/(?:ext_tw_video|amplify_video|tweet_video|amplify_video_thumb|ext_tw_video_thumb)\/(\d+)/i
    );
    if (m) return m[1];
    return u.pathname.replace(/\/vid\/[^/]+\/[^/]+$/i, "");
  } catch {
    return url;
  }
}

function mp4Score(url) {
  try {
    const m = new URL(url).pathname.match(/\/(\d+)x(\d+)\//);
    if (m) return Number(m[1]) * Number(m[2]);
  } catch {}
  return 0;
}

function harvestVideoStrings(root, out) {
  const best = new Map();
  const seen = new WeakSet();
  const stack = [root];
  const re =
    /https:\/\/video\.twimg\.com\/[^\s"'\\<>]+?\.(?:mp4|m3u8)(?:\?[^\s"'\\<>]*)?/gi;
  while (stack.length) {
    const node = stack.pop();
    if (node == null) continue;
    if (typeof node === "string") {
      if (node.length < 24 || !node.includes("video.twimg.com")) continue;
      const matches = node.match(re);
      if (!matches) continue;
      for (const raw of matches) {
        const url = raw.replace(/[),.;]+$/, "");
        const key = videoGroupKey(url);
        const isMp4 = /\.mp4(\?|$)/i.test(url);
        const prev = best.get(key);
        if (!prev) {
          best.set(key, url);
          continue;
        }
        const prevMp4 = /\.mp4(\?|$)/i.test(prev);
        if (isMp4 && !prevMp4) best.set(key, url);
        else if (isMp4 === prevMp4 && mp4Score(url) > mp4Score(prev)) best.set(key, url);
      }
      continue;
    }
    if (typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push(node[i]);
      continue;
    }
    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  for (const url of best.values()) {
    out.push({
      url,
      kind: "video",
      gif: /\/tweet_video\//i.test(url)
    });
  }
}

const UNAVAILABLE_REASON = /copyright|dmca|withheld|legal|removed|suspend/i;

function availabilityOf(node) {
  if (!node || typeof node !== "object") return null;
  const result = node.media_results?.result || node;
  const list = [
    node.ext_media_availability,
    node.media_availability,
    node.media_availability_v2,
    result.ext_media_availability,
    result.media_availability,
    result.media_availability_v2,
    result.mediaAvailability,
    result.media_info?.media_availability
  ];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const status = String(a.status || "");
    const reason = String(a.reason || "");
    if (/^unavailable$/i.test(status) || UNAVAILABLE_REASON.test(reason)) return reason || status;
  }
  return null;
}

export function isPlaceholderThumb(url) {
  return /\/(dmca|copyright|withheld|unavailable)[^/]*\.(jpe?g|png|webp)|\/static\/(dmca|media_unavailable)/i.test(String(url || ""));
}

export function blockKeysFor(node) {
  const keys = new Set();
  const result = node?.media_results?.result || node;
  for (const v of [...variantsFrom(node), ...variantsFrom(result)]) {
    if (typeof v?.url === "string") keys.add(`v:${videoGroupKey(v.url)}`);
  }
  for (const u of [node?.media_url_https, node?.media_url, result?.media_url_https, result?.media_info?.original_img_url]) {
    if (typeof u !== "string" || !u) continue;
    keys.add(`v:${videoGroupKey(u)}`);
    const id = (() => {
      try {
        return imageMediaId(new URL(u).pathname);
      } catch {
        return "";
      }
    })();
    if (id) keys.add(`i:${id}`);
  }
  for (const id of [node?.id_str, node?.media_key, result?.id_str, result?.media_key, result?.rest_id]) {
    if (id) keys.add(`m:${String(id).replace(/^\d+_/, "")}`);
  }
  return keys;
}

export function itemBlockKeys(item) {
  const keys = [];
  for (const u of [item?.url, item?.thumb]) {
    if (!u) continue;
    keys.push(`v:${videoGroupKey(u)}`);
    try {
      const id = imageMediaId(new URL(u).pathname);
      if (id) keys.push(`i:${id}`);
    } catch {}
  }
  return keys;
}

export function walkMediaFromJson(root, out, blocked = new Set()) {
  const batch = [];
  walkMediaNodes(root, batch, 0, blocked);
  harvestVideoStrings(root, batch);
  for (const it of batch) {
    if (isPlaceholderThumb(it.thumb)) for (const k of itemBlockKeys({ url: it.url })) blocked.add(k);
  }
  for (const it of batch) {
    if (isPlaceholderThumb(it.thumb)) continue;
    if (blocked.size && itemBlockKeys(it).some((k) => blocked.has(k))) continue;
    out.push(it);
  }
  return blocked;
}

function walkMediaNodes(root, out, depth, blocked) {
  const seen = new WeakSet();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node == null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push(node[i]);
      continue;
    }

    const isEntity =
      typeof node.type === "string" &&
      (node.type === "photo" || node.type === "video" || node.type === "animated_gif");
    if ((isEntity || isVideoNode(node) || node.media_results?.result) && availabilityOf(node)) {
      for (const k of blockKeysFor(node)) blocked.add(k);
    } else if (isEntity) {
      ingestEntity(node, out);
    } else if (isVideoNode(node) || node.media_results?.result) {
      ingestVideo(node.media_results?.result || node, out);
    }

    const legacy = node.legacy;
    if (legacy && typeof legacy === "object") {
      const media = legacy.extended_entities?.media || legacy.entities?.media || null;
      if (Array.isArray(media)) {
        for (let j = 0; j < media.length; j++) {
          if (availabilityOf(media[j])) for (const k of blockKeysFor(media[j])) blocked.add(k);
          else ingestEntity(media[j], out);
        }
      }
    }

    if (depth < 3) {
      if (Array.isArray(node.binding_values)) ingestCardBindings(node.binding_values, out, depth, blocked);
      else if (node.legacy && Array.isArray(node.legacy.binding_values)) {
        ingestCardBindings(node.legacy.binding_values, out, depth, blocked);
      }
    }

    for (const k of Object.keys(node)) stack.push(node[k]);
  }
}

function ingestCardBindings(bindings, out, depth, blocked) {
  const map = {};
  for (const b of bindings) {
    const key = b?.key;
    const val = b?.value?.string_value || b?.value?.image_value?.url || "";
    if (key) map[key] = val;
  }
  const stream =
    map.player_stream_url ||
    map.amplify_url ||
    map.broadcast_url ||
    map.player_url ||
    "";
  if (/video\.twimg\.com|\.mp4|\.m3u8/i.test(stream)) {
    const thumb = videoThumbUrl(map.player_image || map.thumbnail_image || map.poster || "");
    out.push({
      url: stream,
      kind: "video",
      gif: false,
      ...(thumb ? { thumb } : {})
    });
  }
  const unified = map.unified_card;
  if (typeof unified === "string" && unified.length > 20 && depth < 3) {
    try {
      walkMediaNodes(JSON.parse(unified), out, depth + 1, blocked);
    } catch {}
  }
}

export function mediaIdentity(item) {
  const url = item?.url || "";
  if (item?.kind === "video" || item?.gif) {
    return `video:${videoGroupKey(url)}`;
  }
  try {
    const u = new URL(url);
    if (/pbs\.twimg\.com/i.test(u.hostname)) {
      const id = imageMediaId(u.pathname);
      if (id) return `image:${id}`;
    }
    u.hash = "";
    u.searchParams.delete("tag");
    u.searchParams.delete("name");
    u.searchParams.delete("format");
    return `${item.kind || "image"}:${u.origin}${u.pathname}`;
  } catch {
    return `${item?.kind || "file"}:${url}`;
  }
}

export function preferMedia(cur, next) {
  if (!cur) return next;
  if (!next) return cur;
  const pick = (better, worse) => ({
    ...better,
    id: better.id || worse.id || mediaIdentity(better),
    thumb: better.thumb || worse.thumb
  });
  if ((cur.kind === "video" || cur.gif) && (next.kind === "video" || next.gif)) {
    return videoRank(next.url) > videoRank(cur.url) ? pick(next, cur) : pick(cur, next);
  }
  if (cur.kind === "image" && next.kind === "image") {
    return imageRank(next.url) > imageRank(cur.url) ? pick(next, cur) : pick(cur, next);
  }
  return cur.thumb ? pick(cur, next) : pick(next, cur);
}

export function collapseMediaItems(items) {
  const map = new Map();
  for (const it of items || []) {
    if (!it?.url) continue;
    const key = mediaIdentity(it);
    const tagged = { ...it, id: it.id || key };
    map.set(key, preferMedia(map.get(key), tagged));
  }
  return [...map.values()];
}

function ingestEntity(m, out) {
  if (!m || typeof m !== "object") return;
  if (availabilityOf(m)) return;

  if (ingestVideo(m, out)) return;

  const type = m.type || "";
  const looksPhoto =
    type === "photo" ||
    m.media_info?.__typename === "ApiImage" ||
    (!type && (m.media_url_https || m.media_url) && !isVideoNode(m));
  if (looksPhoto) {
    const raw = m.media_url_https || m.media_url || m.media_info?.original_img_url || "";
    const url = upgradeImageUrl(raw);
    if (url) out.push({ url, kind: "image", gif: false });
  }
}

export function sanitizeName(s, max = 120) {
  return String(s || "file")
    .replace(/[^\w.\-()+]+/g, "_")
    .slice(0, max);
}

export function filenameFor(item, index) {
  const label = item.kind === "image" ? "photo" : item.gif ? "gif" : "video";
  try {
    const u = new URL(item.url);
    const seg = u.pathname.split("/").filter(Boolean);
    let tail = sanitizeName(seg[seg.length - 1] || `${label}_${index}`);
    if (item.kind === "video" && !/\.(mp4|m3u8)$/i.test(tail)) tail += ".mp4";
    if (item.kind === "image") {
      const fmt = u.searchParams.get("format");
      const ext = fmt === "png" ? ".png" : fmt === "webp" ? ".webp" : ".jpg";
      if (!/\.(jpe?g|png|webp|gif)$/i.test(tail)) {
        const base = tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail;
        tail = base + ext;
      }
    }
    return `${label}_${String(index).padStart(4, "0")}_${tail}`;
  } catch {
    return `${label}_${String(index).padStart(4, "0")}.bin`;
  }
}
