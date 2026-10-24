import { useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, AuthStatus, JobProgress, JobRecord, MediaItem, ScanSource } from "../../electron/shared/types";
import { GalleryBoard, type GalleryFilter } from "../components/gallery/GalleryBoard";
import { ClearMenu, type ClearChoice } from "../components/gallery/ClearMenu";
import { MediaViewer } from "../components/gallery/MediaViewer";
import { errorText, toast } from "../lib/toasts";

const SCAN_SOURCES: { id: ScanSource; label: string; hint: string }[] = [
  { id: "media", label: "Media", hint: "Photos & videos grid" },
  { id: "posts", label: "Posts", hint: "Original posts" },
  { id: "reposts", label: "Reposts", hint: "Retweets only" },
  { id: "replies", label: "Replies", hint: "Posts + replies" },
  { id: "likes", label: "Likes", hint: "Liked posts" },
  { id: "highlights", label: "Highlights", hint: "Highlights tab" }
];

function tabFromInput(raw: string): ScanSource | null {
  try {
    let path = String(raw || "").trim();
    if (/^https?:/i.test(path)) path = new URL(path).pathname;
    path = path.replace(/^@/, "");
    const segs = path.split("/").filter(Boolean);
    const second = (segs[1] || "").toLowerCase();
    const map: Record<string, ScanSource> = {
      media: "media",
      reposts: "reposts",
      with_replies: "replies",
      replies: "replies",
      likes: "likes",
      highlights: "highlights"
    };
    return map[second] || null;
  } catch {
    return null;
  }
}

export function RunView({
  config,
  auth,
  progress,
  activeJob,
  items,
  hiddenCount = 0,
  onStart,
  onCancel,
  onGotoAccount,
  onDownload,
  downloading,
  scanning
}: {
  config: AppConfig;
  auth: AuthStatus | null;
  progress: JobProgress | null;
  activeJob: JobRecord | null;
  items: MediaItem[];
  hiddenCount?: number;
  onStart: (target: string, sources: ScanSource[]) => Promise<void>;
  onCancel: () => void;
  onGotoAccount: () => void;
  onDownload: (urls?: string[]) => Promise<void>;
  downloading: boolean;
  scanning: boolean;
}) {
  const [target, setTarget] = useState("me");
  const [sources, setSources] = useState<ScanSource[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [busyDl, setBusyDl] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [cleared, setCleared] = useState(false);
  const seenAuto = useRef<Set<string>>(new Set());
  const urlLocked = useRef(false);
  const urlById = useRef<Map<string, string>>(new Map());

  const ready = items.length > 0 && !scanning;
  const blocked = scanning || downloading || busyDl;
  const savedCount = useMemo(() => items.filter((it) => it.localPath && /^https?:/i.test(it.url)).length, [items]);
  const urlTab = tabFromInput(target);

  useEffect(() => {
    const tab = tabFromInput(target);
    if (tab) {
      urlLocked.current = true;
      setSources([tab]);
      setAskOpen(false);
      return;
    }
    urlLocked.current = false;
  }, [target]);

  const viewerItems = useMemo(() => {
    return items.filter((it) => {
      if (filter === "image" && it.kind === "video" && !it.gif) return false;
      if (filter === "video" && it.kind !== "video") return false;
      return true;
    });
  }, [items, filter]);

  useEffect(() => {
    const prevUrls = urlById.current;
    const nextUrls = new Map<string, string>();
    for (const it of items) nextUrls.set(it.id || it.url, it.url);
    urlById.current = nextUrls;
    const oldToNew = new Map<string, string>();
    for (const [id, url] of nextUrls) {
      const old = prevUrls.get(id);
      if (old && old !== url) oldToNew.set(old, url);
    }
    const live = new Set(nextUrls.values());

    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const u of prev) {
        const mapped = oldToNew.get(u) ?? u;
        if (mapped !== u) changed = true;
        if (live.has(mapped)) next.add(mapped);
        else changed = true;
      }
      if (scanning) {
        for (const [id, url] of nextUrls) {
          if (!seenAuto.current.has(id)) {
            seenAuto.current.add(id);
            next.add(url);
            changed = true;
          }
        }
      } else {
        seenAuto.current = new Set(nextUrls.keys());
      }
      return changed ? next : prev;
    });
  }, [items, scanning]);

  const statusText = scanning
    ? progress?.message || "Scanning…"
    : downloading || busyDl
      ? progress?.message || "Downloading…"
      : ready
        ? `${items.length} in gallery${hiddenCount ? ` · ${hiddenCount} already downloaded (hidden)` : ""}`
        : cleared
          ? "Gallery cleared · scan again to fill it"
          : hiddenCount
          ? `Nothing new · ${hiddenCount} already downloaded (hidden)`
          : "Enter a target and scan";

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const doDownload = async (urls?: string[]) => {
    setBusyDl(true);
    try {
      await onDownload(urls);
      const done = new Set(urls?.length ? urls : items.map((i) => i.url));
      setSelected((prev) => {
        const next = new Set([...prev].filter((u) => !done.has(u)));
        return next.size === prev.size ? prev : next;
      });
    } catch {
    } finally {
      setBusyDl(false);
    }
  };

  const clearGallery = (mode: ClearChoice) => {
    const urls = mode === "selected" ? [...selected] : undefined;
    void window.xaver.jobs
      .clearLive(mode, urls)
      .then(({ removed, left }) => {
        if (mode === "selected" || !left) setSelected(new Set());
        if (!left) {
          setCleared(true);
          setPreview(null);
        }
        toast({
          tone: "ok",
          title: left ? `Removed ${removed}` : "Gallery cleared",
          body: left ? `${left} still in the gallery.` : "Saved files are still on disk.",
          ttl: 2500
        });
      })
      .catch((e) => toast({ tone: "error", title: "Couldn't clear", body: errorText(e) }));
  };

  const launchScan = (picked?: ScanSource[]) => {
    const next = picked?.length ? picked : sources;
    if (!next.length) {
      setAskOpen(true);
      return;
    }
    setSources(next);
    setAskOpen(false);
    seenAuto.current = new Set();
    setSelected(new Set());
    setCleared(false);
    void onStart(target.trim(), next);
  };

  const requestScan = () => {
    if (!target.trim() || !auth?.authenticated || blocked) return;
    if (urlTab) {
      launchScan([urlTab, ...sources.filter((s) => s !== urlTab)]);
      return;
    }
    if (!sources.length) {
      setAskOpen(true);
      return;
    }
    launchScan(sources);
  };

  const toggleSource = (id: ScanSource) => {
    setSources((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      return [...prev, id];
    });
  };

  return (
    <div className="panel run-panel">
      {!auth?.authenticated ? (
        <div className="alert warn">
          No session.{" "}
          <button type="button" className="btn ghost sm" onClick={onGotoAccount}>
            Account
          </button>
        </div>
      ) : null}

      <div className="cmd">
        <input
          className="field"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="me  ·  @user  ·  url  ·  /reposts"
          disabled={blocked}
          onKeyDown={(e) => {
            if (e.key === "Enter") requestScan();
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!auth?.authenticated || blocked || !target.trim()}
          onClick={requestScan}
        >
          {scanning ? "Scanning…" : "Scan"}
        </button>
        <button type="button" className="btn danger" disabled={!scanning && !downloading && !busyDl} onClick={onCancel}>
          Stop
        </button>
      </div>

      <div className="src-chips">
        {SCAN_SOURCES.filter((s) => advanced || ["media", "posts", "reposts"].includes(s.id)).map((s) => {
          const on = sources.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`src-chip ${on ? "on" : ""}`}
              disabled={blocked}
              title={s.hint}
              onClick={() => toggleSource(s.id)}
            >
              {s.label}
            </button>
          );
        })}
        {urlTab ? <span className="src-lock muted">{urlTab}</span> : null}
        <span className="gb-spacer" />
        <button type="button" className={`btn ghost sm ${advanced ? "primary" : ""}`} onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "Less" : "More"}
        </button>
      </div>

      {askOpen ? (
        <div className="src-ask" onClick={() => setAskOpen(false)}>
          <div className="src-ask-card" onClick={(e) => e.stopPropagation()}>
            <div className="src-ask-title">What should we collect?</div>
            <div className="muted">
              Some profiles have nothing on Media and keep everything in Reposts or Posts.
            </div>
            <div className="src-ask-grid">
              {SCAN_SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`src-ask-btn ${sources.includes(s.id) ? "on" : ""}`}
                  onClick={() => toggleSource(s.id)}
                >
                  <strong>{s.label}</strong>
                  <span>{s.hint}</span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn sm" onClick={() => setSources(["media", "reposts"])}>
                Media + Reposts
              </button>
              <button type="button" className="btn sm" onClick={() => setSources(SCAN_SOURCES.map((s) => s.id))}>
                All timelines
              </button>
              <span className="gb-spacer" />
              <button type="button" className="btn sm" onClick={() => setAskOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary sm"
                disabled={!sources.length}
                onClick={() => launchScan(sources)}
              >
                Scan {sources.length ? sources.join(" + ") : "…"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="row run-meta">
        <span className="muted">
          {statusText}
          {selected.size ? ` · ${selected.size} selected` : ""}
        </span>
        <span className="gb-spacer" />
        <button
          type="button"
          className={`btn sm ${selectMode ? "primary" : ""}`}
          onClick={() => setSelectMode((v) => !v)}
        >
          {selectMode ? "Selecting" : "Select"}
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={!selected.size || blocked}
          onClick={() => void doDownload([...selected])}
        >
          Download
        </button>
        <button type="button" className="btn sm" disabled={!items.length || blocked} onClick={() => void doDownload()}>
          Save all
        </button>
        <ClearMenu total={items.length} saved={savedCount} selected={selected.size} disabled={blocked} onClear={clearGallery} />
      </div>

      <GalleryBoard
        items={items}
        selected={selected}
        selectMode={selectMode}
        scanning={scanning}
        filter={filter}
        onFilter={setFilter}
        onOpen={setPreview}
        onToggle={toggle}
        onSelectPage={(urls) =>
          setSelected((prev) => {
            const next = new Set(prev);
            for (const u of urls) next.add(u);
            return next;
          })
        }
        onClear={() => setSelected(new Set())}
      />

      {preview ? (
        <MediaViewer
          items={viewerItems}
          current={preview}
          selected={selected}
          busy={blocked}
          onClose={() => setPreview(null)}
          onChange={setPreview}
          onToggleSelect={toggle}
          onDownload={(url) => void doDownload([url])}
        />
      ) : null}

      <div className="run-foot muted">
        Output → <span className="mono">{config.outputRoot}</span>
        {activeJob?.runDir ? (
          <>
            {" · "}
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => void window.xaver.library.openPath(activeJob.runDir!)}
            >
              Open folder
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
