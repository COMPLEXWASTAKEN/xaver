import type { MediaItem } from "../../electron/shared/types";

const LIMIT = 4000;

function itemKey(it: MediaItem): string {
  return it.id || it.url;
}

function indexOf(list: MediaItem[]): Map<string, number> {
  const index = new Map<string, number>();
  list.forEach((it, i) => {
    index.set(itemKey(it), i);
    index.set(it.url, i);
  });
  return index;
}

export function mergeItems(base: MediaItem[], extra: MediaItem[]): MediaItem[] {
  const out = base.map((it) => ({ ...it }));
  const index = indexOf(out);
  for (const it of extra) {
    const at = index.get(itemKey(it)) ?? index.get(it.url);
    if (at != null) {
      out[at] = { ...it, ...out[at], localPath: out[at].localPath || it.localPath };
      continue;
    }
    index.set(itemKey(it), out.length);
    index.set(it.url, out.length);
    out.push(it);
  }
  return out;
}

export function upsertItems(prev: MediaItem[], batch: MediaItem[]): MediaItem[] {
  if (!batch.length) return prev;
  const next = [...prev];
  const index = indexOf(next);
  for (const it of batch) {
    const at = index.get(itemKey(it)) ?? index.get(it.url);
    if (at != null) {
      next[at] = { ...next[at], ...it };
      index.set(it.url, at);
      continue;
    }
    index.set(itemKey(it), next.length);
    index.set(it.url, next.length);
    next.push(it);
  }
  return next.length > LIMIT ? next.slice(-LIMIT) : next;
}
