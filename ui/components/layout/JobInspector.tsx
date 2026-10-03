import type { JobProgress, JobRecord } from "../../../electron/shared/types";

export function JobInspector({
  job,
  progress,
  found
}: {
  job: JobRecord | null;
  progress: JobProgress | null;
  found: number;
}) {
  const hasDownload =
    progress?.downloadTotal != null && progress.downloadTotal > 0 && progress.downloadDone != null;
  const hasScroll = progress?.maxScrolls != null && progress.scroll != null;
  const pct = hasDownload
    ? Math.min(100, Math.round((progress!.downloadDone! / progress!.downloadTotal!) * 100))
    : hasScroll
      ? Math.min(100, Math.round((progress!.scroll! / progress!.maxScrolls!) * 100))
      : job?.status === "ready" || job?.status === "done"
        ? 100
        : 0;

  const indeterminate =
    Boolean(job) &&
    !["done", "ready", "failed", "cancelled"].includes(job!.status) &&
    !hasDownload &&
    !hasScroll;

  const line =
    progress?.message ||
    job?.errorMessage ||
    (job?.status === "ready" ? `${found} ready` : "Idle");

  return (
    <aside className="dock">
      <div className="dock-stat">
        <span className="k">Found</span>
        <span className="v">{found}</span>
      </div>
      <div className="dock-stat">
        <span className="k">Saved</span>
        <span className="v">{progress?.saved ?? job?.saved ?? 0}</span>
      </div>
      <div
        className={`progress ${indeterminate ? "indeterminate" : ""} ${
          job && !indeterminate && !["done", "ready", "failed", "cancelled"].includes(job.status) ? "active" : ""
        }`}
      >
        <span style={{ width: indeterminate ? "40%" : `${pct}%` }} />
      </div>
      <div className="dock-line">
        <strong>{job ? job.status : "idle"}</strong>
        {job?.target ? ` · ${job.target}` : ""}
        <span className="muted"> · {line}</span>
      </div>
      {(progress?.skipped != null || progress?.failed != null || (job && (job.skipped || job.errors))) && (
        <span className="muted mono">
          skip {progress?.skipped ?? job?.skipped ?? 0} · fail {progress?.failed ?? job?.errors ?? 0}
        </span>
      )}
      {job?.runDir ? (
        <button
          type="button"
          className="btn sm"
          onClick={() => void window.xaver.library.openPath(job.runDir!)}
        >
          Folder
        </button>
      ) : null}
    </aside>
  );
}
