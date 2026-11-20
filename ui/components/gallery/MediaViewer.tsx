import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MediaItem } from "../../../electron/shared/types";
import { fullImageSrc, playSrc, proxyUrl, tilePreviewSrc } from "../../lib/mediaUrl";
import { VideoPlayer } from "./VideoPlayer";

const STRIP_SPAN = 40;

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
}

export function MediaViewer({
  items,
  current,
  selected,
  busy,
  onClose,
  onChange,
  onToggleSelect,
  onDownload,
  downloadLabel = "Download",
  note,
  hint = "← → browse · Space play/pause · S select · D download · F fullscreen · Esc close"
}: {
  items: MediaItem[];
  current: MediaItem;
  selected: Set<string>;
  busy?: boolean;
  onClose: () => void;
  onChange: (item: MediaItem) => void;
  onToggleSelect?: (url: string) => void;
  onDownload: (url: string) => void;
  downloadLabel?: string;
  note?: (item: MediaItem) => ReactNode;
  hint?: string;
}) {
  const [playUrl, setPlayUrl] = useState("");
  const [status, setStatus] = useState("");
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const markBroken = (url: string) => setBroken((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  const stripRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    shellRef.current?.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

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
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (isTypingTarget(e.target) || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (index >= 0 && items.length) onChange(items[(index + 1) % items.length]);
      }
      if (e.key === "ArrowLeft" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (index >= 0 && items.length) onChange(items[(index - 1 + items.length) % items.length]);
      }
      if (e.repeat || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s" && onToggleSelect) onToggleSelect(current.url);
      if (k === "d" && !busy) onDownload(current.url);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, index, items, busy, onChange, onClose, onDownload, onToggleSelect]);

  const stripStart = Math.max(0, index - STRIP_SPAN);
  const strip = useMemo(
    () => (index >= 0 ? items.slice(stripStart, index + STRIP_SPAN + 1) : items.slice(0, STRIP_SPAN * 2)),
    [items, index, stripStart]
  );

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(".mv-thumb.active")
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [current.url]);

  const go = (dir: -1 | 1) => {
    if (index < 0 || !items.length) return;
    onChange(items[(index + dir + items.length) % items.length]);
  };

  const label = current.gif ? "GIF" : current.kind === "video" ? "Video" : "Photo";

  return (
    <div className="mv" onClick={onClose}>
      <div
        className="mv-shell"
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} viewer`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mv-top">
          <div className="mv-meta">
            <span className="mv-kind">{label}</span>
            <span className="mono muted">
              {index >= 0 ? `${index + 1} / ${items.length}` : "—"}
            </span>
            {status ? (
              <span className="muted mv-status" title={status}>
                {status}
              </span>
            ) : null}
            {note ? note(current) : null}
          </div>
          <div className="mv-actions">
            {onToggleSelect ? (
              <button type="button" className="btn sm" onClick={() => onToggleSelect(current.url)}>
                {selected.has(current.url) ? "Deselect" : "Select"}
              </button>
            ) : null}
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
              !broken.has(current.url) && fullImageSrc(current) ? (
                <img
                  className="mv-image"
                  src={fullImageSrc(current)}
                  alt=""
                  decoding="async"
                  onError={() => markBroken(current.url)}
                />
              ) : (
                <div className="mv-loading">
                  <span className="muted">Preview not available</span>
                </div>
              )
            )}
          </div>
          <button type="button" className="mv-nav mv-next" aria-label="Next" onClick={() => go(1)} />
        </div>

        <div className="mv-strip" ref={stripRef}>
          {strip.map((it, n) => {
            const i = stripStart + n;
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
                {src && !broken.has(it.url) ? (
                  <img src={src} alt="" loading="lazy" decoding="async" onError={() => markBroken(it.url)} />
                ) : (
                  <div className="tile-fallback" />
                )}
                {vid ? <span className="tile-play mv-thumb-play" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        <footer className="mv-hint muted">{hint}</footer>
      </div>
    </div>
  );
}
