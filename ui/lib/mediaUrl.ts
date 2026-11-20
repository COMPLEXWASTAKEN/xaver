import type { MediaItem } from "../../electron/shared/types";

export function proxyUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("xaver-media:") || url.startsWith("xaver-proxy:") || url.startsWith("blob:")) {
    return url;
  }
  return `xaver-proxy://x/?u=${encodeURIComponent(url)}`;
}

function localSrc(p: string): string {
  return `xaver-media://local/${encodeURIComponent(p)}`;
}

function thumbSrc(p: string): string {
  return `xaver-media://thumb/${encodeURIComponent(p)}`;
}

export function tilePreviewSrc(it: MediaItem): string {
  const isVid = it.kind === "video" || Boolean(it.gif);
  if (it.localPath) return thumbSrc(it.localPath);
  if (isVid) return it.thumb ? proxyUrl(it.thumb) : "";
  return proxyUrl(it.url);
}

export function fullImageSrc(it: MediaItem): string {
  if (it.localPath) return localSrc(it.localPath);
  return proxyUrl(it.url);
}

export function playSrc(it: MediaItem): string {
  if (it.localPath) return localSrc(it.localPath);
  return it.url;
}
