import { useEffect, useMemo, useState } from "react";
import type { FailedDownload, FailedState, FailReason, MediaItem } from "../../electron/shared/types";
import { MediaViewer } from "../components/gallery/MediaViewer";
import { tilePreviewSrc } from "../lib/mediaUrl";
import { relativeTime } from "../lib/time";
import { errorText, toast } from "../lib/toasts";

const REASONS: Record<FailReason, { label: string; tip: string; tone: "warn" | "err" | "mute" }> = {
  gone: { label: "Removed", tip: "X says this file no longer exists. Retrying rarely helps.", tone: "err" },
  denied: { label: "No access", tip: "X refused the request. Check you're signed in and can see this account.", tone: "err" },
  limited: { label: "Rate limited", tip: "X asked to slow down. Wait a few minutes, then retry.", tone: "warn" },
  timeout: { label: "Timed out", tip: "The file took too long. A retry usually works.", tone: "warn" },
  network: { label: "Network", tip: "The connection dropped. A retry usually works.", tone: "warn" },
  notmedia: { label: "Not media", tip: "X sent back a page instead of the file.", tone: "err" },
  other: { label: "Failed", tip: "Something else went wrong. Try again.", tone: "mute" }
};

type Filter = "all" | FailReason;

function kindLabel(it: MediaItem): string {
  return it.gif ? "GIF" : it.kind === "video" ? "Video" : "Photo";
}

export function FailedView({ busy, onOpenJobs }: { busy: boolean; onOpenJobs: () => void }) {
  const [state, setState] = useState<FailedState | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void window.xaver.failures.list().then(setState);
    const off = window.xaver.failures.onChanged(setState);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, []);

  const items = useMemo(() => state?.items || [], [state]);
  const retrying = useMemo(() => new Set(state?.retrying || []), [state]);
  const byUrl = useMemo(() => new Map(items.map((f) => [f.item.url, f])), [items]);

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((u) => byUrl.has(u)));
      return next.size === prev.size ? prev : next;
    });
  }, [byUrl]);

  const counts = useMemo(() => {
    const c: Partial<Record<FailReason, number>> = {};
    for (const f of items) c[f.reason] = (c[f.reason] || 0) + 1;
    return c;
  }, [items]);

  const shown = useMemo(() => (filter === "all" ? items : items.filter((f) => f.reason === filter)), [items, filter]);
  const shownItems = useMemo(() => shown.map((f) => f.item), [shown]);

  useEffect(() => {
    if (filter !== "all" && !counts[filter]) setFilter("all");
  }, [counts, filter]);

  const keysFor = (urls: Iterable<string>) => [...urls].map((u) => byUrl.get(u)?.key).filter(Boolean) as string[];

  const retry = (keys?: string[]) => {
    if (busy) {
      toast({ tone: "warn", title: "Busy", body: "Wait for the current scan or download to finish." });
      return;
    }
    void window.xaver.failures.retry(keys).catch((e) => toast({ tone: "error", title: "Couldn't retry", body: errorText(e) }));
    setSelected(new Set());
  };

  const dismiss = (keys?: string[]) => {
    void window.xaver.failures.dismiss(keys).catch(() => {});
    setSelected(new Set());
    if (preview && keys?.includes(byUrl.get(preview.url)?.key || "")) setPreview(null);
  };

  const toggle = (url: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  if (!state) return <div className="skeleton" style={{ height: 320 }} />;

  if (!items.length) {
    return (
      <div className="card failed-empty">
        <div className="failed-empty-mark">✓</div>
        <h3>Nothing failed</h3>
        <p className="muted">When a photo, video or GIF can't be saved, it shows up here so you can see it and try again.</p>
        <button type="button" className="btn sm" onClick={onOpenJobs}>
          View job history
        </button>
      </div>
    );
  }

  const anyRetrying = retrying.size > 0;
  const sel = selected.size;
  const fixable = items.filter((f) => f.reason !== "gone" && f.reason !== "notmedia").length;

  return (
    <div className="failed stagger">
      <div className="card failed-head">
        <div className="failed-summary">
          <strong>
            {items.length} {items.length === 1 ? "download" : "downloads"} failed
          </strong>
          <span className="muted">
            {fixable === items.length
              ? "These usually work on a second try."
              : fixable
                ? `${fixable} look worth retrying. Files X removed won't come back.`
                : "X removed these, so retrying probably won't help. Dismiss them when you're done."}
          </span>
        </div>
        <div className="failed-actions">
          {sel ? (
            <>
              <span className="muted mono">{sel} selected</span>
              <button type="button" className="btn sm" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="btn sm" onClick={() => dismiss(keysFor(selected))}>
                Dismiss
              </button>
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => retry(keysFor(selected))}>
                Retry {sel}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn sm" onClick={() => setSelected(new Set(shown.map((f) => f.item.url)))}>
                Select all
              </button>
              <button type="button" className="btn danger sm" disabled={anyRetrying} onClick={() => dismiss(filter === "all" ? undefined : shown.map((f) => f.key))}>
                {filter === "all" ? "Clear all" : "Clear these"}
              </button>
              <button
                type="button"
                className="btn primary sm"
                disabled={busy || anyRetrying}
                onClick={() => retry(filter === "all" ? undefined : shown.map((f) => f.key))}
              >
                {anyRetrying ? "Retrying…" : filter === "all" ? "Retry all" : `Retry ${shown.length}`}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="failed-filters" role="tablist">
        <button type="button" role="tab" aria-selected={filter === "all"} className={`failed-chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All <span>{items.length}</span>
        </button>
        {(Object.keys(REASONS) as FailReason[])
          .filter((r) => counts[r])
          .map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              title={REASONS[r].tip}
              aria-selected={filter === r}
              className={`failed-chip tone-${REASONS[r].tone} ${filter === r ? "on" : ""}`}
              onClick={() => setFilter(r)}
            >
              {REASONS[r].label} <span>{counts[r]}</span>
            </button>
          ))}
      </div>

      <div className="failed-grid">
        {shown.map((f) => (
          <FailedCard
            key={f.key}
            f={f}
            now={now}
            selected={selected.has(f.item.url)}
            retrying={retrying.has(f.key)}
            busy={busy}
            onToggle={() => toggle(f.item.url)}
            onOpen={() => setPreview(f.item)}
            onRetry={() => retry([f.key])}
            onDismiss={() => dismiss([f.key])}
          />
        ))}
      </div>

      {preview && byUrl.has(preview.url) ? (
        <MediaViewer
          items={shownItems}
          current={preview}
          selected={selected}
          busy={busy || retrying.has(byUrl.get(preview.url)!.key)}
          onClose={() => setPreview(null)}
          onChange={setPreview}
          onToggleSelect={toggle}
          onDownload={(url) => retry(keysFor([url]))}
          downloadLabel={retrying.has(byUrl.get(preview.url)!.key) ? "Retrying…" : "Retry"}
          hint="← → browse · Space play/pause · S select · D retry · F fullscreen · Esc close"
          note={(it) => {
            const ff = byUrl.get(it.url);
            return ff ? (
              <span className={`failed-pill tone-${REASONS[ff.reason].tone}`} title={ff.error}>
                {REASONS[ff.reason].label}
              </span>
            ) : null;
          }}
        />
      ) : null}
    </div>
  );
}

function FailedCard({
  f,
  now,
  selected,
  retrying,
  busy,
  onToggle,
  onOpen,
  onRetry,
  onDismiss
}: {
  f: FailedDownload;
  now: number;
  selected: boolean;
  retrying: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = tilePreviewSrc(f.item);
  const vid = f.item.kind === "video" || Boolean(f.item.gif);
  const reason = REASONS[f.reason];
  return (
    <div className={`failed-card ${selected ? "sel" : ""} ${retrying ? "busy" : ""}`}>
      <button type="button" className="failed-thumb" onClick={onOpen} title="Preview">
        {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : <div className="failed-thumb-none">{kindLabel(f.item)}</div>}
        {vid ? <span className="tile-play" aria-hidden /> : null}
        <span className="failed-kind">{kindLabel(f.item)}</span>
        {retrying ? (
          <span className="failed-spin">
            <span />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className={`failed-check ${selected ? "on" : ""}`}
        aria-label={selected ? "Deselect" : "Select"}
        aria-pressed={selected}
        onClick={onToggle}
      />
      <div className="failed-body">
        <div className="failed-line">
          <span className={`failed-pill tone-${reason.tone}`} title={reason.tip}>
            {reason.label}
          </span>
          {f.attempts > 1 ? <span className="muted mono failed-tries">×{f.attempts}</span> : null}
        </div>
        <div className="failed-err mono" title={f.error}>
          {f.error}
        </div>
        <div className="failed-meta muted">
          {f.profile ? `@${f.profile.split("/").filter(Boolean)[0]}` : "selection"} · {relativeTime(f.lastFailedAt, now)}
        </div>
      </div>
      <div className="failed-card-actions">
        <button type="button" className="btn primary sm" disabled={busy || retrying} onClick={onRetry}>
          {retrying ? "Retrying…" : "Retry"}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          title="Copy link"
          onClick={() =>
            void navigator.clipboard
              .writeText(f.item.url)
              .then(() => toast({ tone: "ok", title: "Link copied", ttl: 2000 }))
              .catch(() => {})
          }
        >
          Copy link
        </button>
        <button type="button" className="btn ghost sm" disabled={retrying} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
