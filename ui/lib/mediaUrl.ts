import type { MediaItem } from "../../electron/shared/types";

export function proxyUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("xaver-media:") || url.startsWith("xaver-proxy:") || url.startsWith("blob:")) {
    return url;
  }
  return `xaver-proxy://x/?u=${encodeURIComponent(url)}`;
}

export function tilePreviewSrc(it: MediaItem): string {
  if (it.localPath) {
    if (it.kind === "image" && !it.gif) {
      return `xaver-media://local/${encodeURIComponent(it.localPath)}`;
    }
    if (it.thumb) return proxyUrl(it.thumb);
    if (it.kind === "video" || it.gif) {
      return `xaver-media://local/${encodeURIComponent(it.localPath)}`;
    }
    return `xaver-media://local/${encodeURIComponent(it.localPath)}`;
  }
  if (it.kind === "video" || it.gif) {
    if (it.thumb) return proxyUrl(it.thumb);
    return "";
  }
  return proxyUrl(it.url) || it.url;
}

export function playSrc(it: MediaItem): string {
  if (it.localPath) return `xaver-media://local/${encodeURIComponent(it.localPath)}`;
  return it.url;
}
