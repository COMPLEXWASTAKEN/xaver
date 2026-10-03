type FileItem = {
  id: string;
  name: string;
  path: string;
  kind: "image" | "video" | "gif";
  bytes: number;
  runId: string;
  rel: string;
};

export function MediaGrid({
  files,
  selected,
  onToggle,
  onOpen
}: {
  files: FileItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (f: FileItem) => void;
}) {
  return (
    <div className="grid">
      {files.map((f, i) => {
        const src = `xaver-media://local/${encodeURIComponent(f.path)}`;
        const isSel = selected.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            className={`tile ${isSel ? "selected" : ""}`}
            style={{ animationDelay: `${Math.min(i, 24) * 10}ms` }}
            onClick={(e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) onToggle(f.id);
              else onOpen(f);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onToggle(f.id);
            }}
            title={f.name}
          >
            {f.kind === "video" || f.kind === "gif" ? (
              <video src={src} muted preload="metadata" />
            ) : (
              <img src={src} alt="" loading="lazy" />
            )}
            <span className="tag">{f.kind}</span>
          </button>
        );
      })}
    </div>
  );
}
