import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem } from "../../../electron/shared/types";
import { tilePreviewSrc } from "../../lib/mediaUrl";

export type GalleryFilter = "all" | "image" | "video";
export type GalleryDensity = "cozy" | "compact" | "dense";
export type GallerySort = "found" | "photos" | "videos";

const PAGE_SIZES = [24, 48, 96] as const;

const Tile = memo(function Tile({
  it,
  index,
  selected,
  selectMode,
  onOpen,
  onToggle
}: {
  it: MediaItem;
  index: number;
  selected: boolean;
  selectMode: boolean;
  onOpen: (item: MediaItem) => void;
  onToggle: (url: string) => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = tilePreviewSrc(it);
  const isVid = it.kind === "video" || Boolean(it.gif);
  useEffect(() => setBroken(false), [src]);
  return (
    <button
      type="button"
      className={`tile ${selected ? "selected" : ""} ${isVid ? "tile-video" : ""}`}
      style={{ animationDelay: `${Math.min(index, 24) * 8}ms` }}
      onClick={(e) => {
        if (selectMode || e.shiftKey || e.ctrlKey || e.metaKey) onToggle(it.url);
        else onOpen(it);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onToggle(it.url);
      }}
      aria-pressed={selected}
      title={selectMode ? "Click to select" : "Click to open · right-click to select"}
    >
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <div className="tile-fallback" />
      )}
      {isVid ? <span className="tile-play" aria-hidden /> : null}
      <span className="tag">{it.gif ? "gif" : it.kind}</span>
      {it.localPath && /^https?:/i.test(it.url) ? <span className="tile-saved">saved</span> : null}
      {selected ? <span className="tile-check">✓</span> : null}
    </button>
  );
});

export function GalleryBoard({
  items,
  selected,
  selectMode,
  scanning,
  filter,
  onFilter,
  onOpen,
  onToggle,
  onSelectPage,
  onClear,
  selectable = true,
  emptyText = "Drop a handle above and scan."
}: {
  items: MediaItem[];
  selected: Set<string>;
  selectMode: boolean;
  scanning?: boolean;
  filter: GalleryFilter;
  onFilter: (f: GalleryFilter) => void;
  onOpen: (item: MediaItem, visible: MediaItem[]) => void;
  onToggle: (url: string) => void;
  onSelectPage: (urls: string[]) => void;
  onClear: () => void;
  selectable?: boolean;
  emptyText?: string;
}) {
  const [density, setDensity] = useState<GalleryDensity>("cozy");
  const [sort, setSort] = useState<GallerySort>("found");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(24);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const unique = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((it) => {
      const keys = [it.id, it.url, it.sha256, it.localPath].filter(Boolean) as string[];
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = unique.filter((it) => {
      if (filter === "image" && it.kind === "video" && !it.gif) return false;
      if (filter === "video" && it.kind !== "video") return false;
      if (needle) {
        const hay = `${it.url} ${it.kind} ${it.gif ? "gif" : ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "photos") {
      list = [...list].sort((a, b) => Number(a.kind === "video") - Number(b.kind === "video"));
    } else if (sort === "videos") {
      list = [...list].sort((a, b) => Number(b.kind === "video") - Number(a.kind === "video"));
    }
    return list;
  }, [unique, filter, sort, q]);

  const live = useRef({ onOpen, onToggle, filtered });
  live.current = { onOpen, onToggle, filtered };
  const open = useCallback((it: MediaItem) => live.current.onOpen(it, live.current.filtered), []);
  const toggle = useCallback((url: string) => live.current.onToggle(url), []);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [filter, sort, pageSize, q]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const counts = useMemo(() => {
    let photos = 0;
    let videos = 0;
    let gifs = 0;
    for (const it of unique) {
      if (it.gif) gifs++;
      else if (it.kind === "video") videos++;
      else photos++;
    }
    return { photos, videos, gifs };
  }, [unique]);

  const pageNums = useMemo(() => {
    const out: number[] = [];
    const span = 5;
    let start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + span - 1);
    start = Math.max(1, end - span + 1);
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [safePage, totalPages]);

  const empty = !unique.length
    ? scanning
      ? "Collecting media…"
      : emptyText
    : q.trim()
      ? `Nothing matches "${q.trim()}".`
      : filter === "image"
        ? "No photos here."
        : filter === "video"
          ? "No videos here."
          : "Nothing to show.";

  return (
    <div className="gb">
      <div className="gb-toolbar">
        <div className="seg">
          {(["all", "image", "video"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={filter === k ? "active" : ""}
              onClick={() => onFilter(k)}
            >
              {k === "image" ? "Photos" : k === "video" ? "Videos" : "All"}
              <span className="seg-count">
                {k === "all"
                  ? unique.length
                  : k === "image"
                    ? counts.photos + counts.gifs
                    : counts.videos + counts.gifs}
              </span>
            </button>
          ))}
        </div>
        <input
          className="field gb-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          aria-label="Search the gallery"
        />
        <select className="field" value={sort} onChange={(e) => setSort(e.target.value as GallerySort)} aria-label="Sort">
          <option value="found">Found</option>
          <option value="photos">Photos first</option>
          <option value="videos">Videos first</option>
        </select>
        <select
          className="field"
          value={density}
          onChange={(e) => setDensity(e.target.value as GalleryDensity)}
          aria-label="Tile size"
        >
          <option value="cozy">Cozy</option>
          <option value="compact">Compact</option>
          <option value="dense">Dense</option>
        </select>
        <span className="muted mono gb-range">
          {filtered.length
            ? `${(safePage - 1) * pageSize + 1}–${(safePage - 1) * pageSize + pageItems.length} / ${filtered.length}`
            : "0"}
        </span>
        <span className="gb-spacer" />
        {selectable ? (
          <div className="gb-select" role="group" aria-label="Select">
            <span className="muted gb-select-label">Select</span>
            <button
              type="button"
              className="btn sm"
              disabled={!pageItems.length}
              onClick={() => onSelectPage(pageItems.map((i) => i.url))}
              title="Select everything on this page"
            >
              Page
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!filtered.length}
              onClick={() => onSelectPage(filtered.map((i) => i.url))}
              title="Select everything matching the current filter"
            >
              All
            </button>
            <button type="button" className="btn sm" disabled={!selected.size} onClick={onClear} title="Deselect everything">
              None
            </button>
          </div>
        ) : null}
      </div>

      {pageItems.length === 0 ? (
        <div className="empty gb-empty">{empty}</div>
      ) : (
        <div className={`grid gb-grid density-${density}`}>
          {pageItems.map((it, i) => (
            <Tile
              key={it.id || it.url}
              it={it}
              index={i}
              selected={selected.has(it.url)}
              selectMode={selectMode}
              onOpen={open}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      {totalPages > 1 || pageSize !== 24 ? (
        <div className="gb-pager">
          <button
            type="button"
            className="btn sm"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <div className="gb-pages">
            {pageNums.map((n) => (
              <button
                key={n}
                type="button"
                className={`btn sm gb-page ${n === safePage ? "primary" : ""}`}
                onClick={() => setPage(n)}
                aria-current={n === safePage ? "page" : undefined}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn sm"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
          <select
            className="field gb-size"
            aria-label="Items per page"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
