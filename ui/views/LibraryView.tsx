import { useEffect, useMemo, useState } from "react";
import type { MediaItem } from "../../electron/shared/types";
import { GalleryBoard, type GalleryFilter } from "../components/gallery/GalleryBoard";
import { MediaViewer } from "../components/gallery/MediaViewer";

type Run = {
  id: string;
  name: string;
  path: string;
  photoCount: number;
  videoCount: number;
  gifCount: number;
};

type FileItem = {
  id: string;
  name: string;
  path: string;
  kind: "image" | "video" | "gif";
  bytes: number;
  runId: string;
  rel: string;
};

function fileToMedia(f: FileItem): MediaItem {
  return {
    url: f.path,
    kind: f.kind === "gif" ? "video" : f.kind,
    gif: f.kind === "gif",
    localPath: f.path
  };
}

export function LibraryView({ liveItems }: { liveItems: MediaItem[] }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [mode, setMode] = useState<"runs" | "live">("runs");
  const [selectMode, setSelectMode] = useState(false);

  const refresh = async () => {
    const list = await window.xaver.library.listRuns();
    setRuns(list);
    if (!runId && list[0]) setRunId(list[0].id);
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!runId || mode !== "runs") return;
    void window.xaver.library.listItems(runId).then(setFiles);
    setSelected(new Set());
  }, [runId, mode]);

  const runMedia = useMemo(() => files.map(fileToMedia), [files]);
  const boardItems = mode === "live" ? liveItems : runMedia;

  const viewerItems = useMemo(() => {
    return boardItems.filter((it) => {
      if (filter === "image" && it.kind === "video" && !it.gif) return false;
      if (filter === "video" && it.kind !== "video") return false;
      return true;
    });
  }, [boardItems, filter]);

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const activeRun = runs.find((r) => r.id === runId);

  return (
    <div className="panel run-panel">
      <div className="row run-meta">
        <div className="seg">
          <button type="button" className={mode === "runs" ? "active" : ""} onClick={() => setMode("runs")}>
            Runs
          </button>
          <button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>
            Live
            <span className="seg-count">{liveItems.length}</span>
          </button>
        </div>

        {mode === "runs" ? (
          <select className="field" style={{ maxWidth: 320 }} value={runId} onChange={(e) => setRunId(e.target.value)}>
            {!runs.length ? <option value="">No runs yet</option> : null}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.photoCount}p / {r.videoCount}v / {r.gifCount}g
              </option>
            ))}
          </select>
        ) : null}

        <span className="gb-spacer" />
        <button
          type="button"
          className={`btn sm ${selectMode ? "primary" : ""}`}
          onClick={() => setSelectMode((v) => !v)}
        >
          {selectMode ? "Selecting" : "Select"}
        </button>
        <button type="button" className="btn sm" onClick={() => void refresh()}>
          Refresh
        </button>
        {activeRun && mode === "runs" ? (
          <button type="button" className="btn sm" onClick={() => void window.xaver.library.openPath(activeRun.path)}>
            Open folder
          </button>
        ) : null}
      </div>

      <GalleryBoard
        items={boardItems}
        selected={selected}
        selectMode={selectMode}
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
          onClose={() => setPreview(null)}
          onChange={setPreview}
          onToggleSelect={toggle}
          downloadLabel="Reveal"
          onDownload={(url) => {
            const item = boardItems.find((x) => x.url === url);
            if (item?.localPath) void window.xaver.library.reveal(item.localPath);
          }}
        />
      ) : null}
    </div>
  );
}
