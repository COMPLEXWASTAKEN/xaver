import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../../electron/shared/types";
import { playSrc, proxyUrl, tilePreviewSrc } from "../../lib/mediaUrl";
import { VideoPlayer } from "./VideoPlayer";

export function MediaViewer({
  items,
  current,
  selected,
  busy,
  onClose,
  onChange,
  onToggleSelect,
  onDownload,
  downloadLabel = "Download"
}: {
  items: MediaItem[];
  current: MediaItem;
  selected: Set<string>;
  busy?: boolean;
  onClose: () => void;
  onChange: (item: MediaItem) => void;
  onToggleSelect: (url: string) => void;
  onDownload: (url: string) => void;
  downloadLabel?: string;
}) {
  const [playUrl, setPlayUrl] = useState("");
  const [status, setStatus] = useState("");
  const stripRef = useRef<HTMLDivElement | null>(null);

  const index = useMemo(() => items.findIndex((x) => x.url === current.url), [items, current.url]);
  const isVid = current.kind === "video" || Boolean(current.gif);

  useEffect(() => {
    if (!isVid) {
      setPlayUrl("");
      setStatus("");
      return;
    }
    if (current.localPath) {
      setPlayUrl(playSrc(current));
      setStatus("");
      return;
    }
    let cancelled = false;
    setPlayUrl("");
    setStatus("Staging stream…");
    void window.xaver.media
      .stagePreview(current.url)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setPlayUrl(`xaver-media://local/${encodeURIComponent(res.path)}`);
          setStatus("");
          return;
        }
        setPlayUrl(current.url);
        setStatus(res.error || "");
      })
      .catch((e) => {
        if (cancelled) return;
        setPlayUrl(current.url);
        setStatus(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [current, isVid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (index >= 0) onChange(items[(index + 1) % items.length]);
      }
      if (e.key === "ArrowLeft" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (index >= 0) onChange(items[(index - 1 + items.length) % items.length]);
      }
      if (e.key === "s") onToggleSelect(current.url);
      if (e.key === "d") onDownload(current.url);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, index, items, onChange, onClose, onDownload, onToggleSelect]);

  useEffect(() => {
    const root = stripRef.current;
    if (!root) return;
    const el = Array.from(root.querySelectorAll<HTMLElement>("[data-url]")).find(
      (node) => node.dataset.url === current.url
    );
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [current.url]);

  const go = (dir: -1 | 1) => {
    if (index < 0 || !items.length) return;
    onChange(items[(index + dir + items.length) % items.length]);
  };

  const label = current.gif ? "GIF" : current.kind === "video" ? "Video" : "Photo";

  return (
    <div className="mv" onClick={onClose}>
      <div className="mv-shell" onClick={(e) => e.stopPropagation()}>
        <header className="mv-top">
          <div className="mv-meta">
            <span className="mv-kind">{label}</span>
            <span className="mono muted">
              {index >= 0 ? `${index + 1} / ${items.length}` : "—"}
            </span>
            {status ? <span className="muted">{status}</span> : null}
          </div>
          <div className="mv-actions">
            <button type="button" className="btn sm" onClick={() => onToggleSelect(current.url)}>
              {selected.has(current.url) ? "Deselect" : "Select"}
            </button>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={() => onDownload(current.url)}
            >
              {downloadLabel}
            </button>
            <button type="button" className="btn sm" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="mv-stage">
          <button type="button" className="mv-nav mv-prev" aria-label="Previous" onClick={() => go(-1)} />
          <div className="mv-canvas">
            {isVid ? (
              playUrl ? (
                <VideoPlayer
                  key={playUrl}
                  src={playUrl}
                  poster={current.thumb ? proxyUrl(current.thumb) : undefined}
                  title={label}
                />
              ) : (
                <div className="mv-loading">
                  <div className="vp-wait" />
                  <span className="muted">{status || "Preparing playback…"}</span>
                </div>
              )
            ) : (
              <img className="mv-image" src={tilePreviewSrc(current)} alt="" />
            )}
          </div>
          <button type="button" className="mv-nav mv-next" aria-label="Next" onClick={() => go(1)} />
        </div>

        <div className="mv-strip" ref={stripRef}>
          {items.map((it, i) => {
            const src = tilePreviewSrc(it);
            const active = it.url === current.url;
            const vid = it.kind === "video" || Boolean(it.gif);
            return (
              <button
                key={it.url}
                type="button"
                data-url={it.url}
                className={`mv-thumb ${active ? "active" : ""} ${selected.has(it.url) ? "sel" : ""}`}
                onClick={() => onChange(it)}
                title={`${i + 1}`}
              >
                {src ? <img src={src} alt="" loading="lazy" /> : <div className="tile-fallback" />}
                {vid ? <span className="tile-play mv-thumb-play" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        <footer className="mv-hint muted">
          ← → browse · Space play/pause · S select · D download · F fullscreen · Esc close
        </footer>
      </div>
    </div>
  );
}
