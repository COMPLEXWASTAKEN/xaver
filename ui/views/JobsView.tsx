import type { JobRecord } from "../../electron/shared/types";

function statusClass(s: string): string {
  if (s === "done" || s === "ready") return "ok";
  if (s === "failed") return "err";
  if (s === "cancelled") return "warn";
  if (["running", "scraping", "downloading", "zipping", "queued"].includes(s)) return "run";
  return "";
}

export function JobsView({
  queue,
  history,
  activeJobId,
  onCancel,
  onOpen,
  failedCount = 0,
  onFailed
}: {
  queue: JobRecord[];
  history: JobRecord[];
  activeJobId: string | null;
  onCancel: (id: string) => void;
  onOpen: (path: string) => void;
  failedCount?: number;
  onFailed?: () => void;
}) {
  return (
    <div className="panel">
      <div className="card stack">
        <div className="label">Queue</div>
        {queue.length === 0 ? (
          <div className="empty">Queue empty.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.target}</td>
                  <td>
                    <span className={`badge ${statusClass(j.status)}`}>
                      <span className="dot" />
                      {j.status}
                      {j.id === activeJobId ? " · active" : ""}
                    </span>
                  </td>
                  <td className="muted">{new Date(j.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className="btn sm danger" onClick={() => onCancel(j.id)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stack">
        <div className="label">History</div>
        {history.length === 0 ? (
          <div className="empty">No completed jobs yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Status</th>
                <th>Counts</th>
                <th>Finished</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((j) => (
                <tr key={j.id}>
                  <td>
                    <div className="mono">{j.target}</div>
                    {j.profilePath ? <div className="muted">{j.profilePath}</div> : null}
                    {j.errorMessage ? <div className="muted">{j.errorMessage}</div> : null}
                  </td>
                  <td>
                    <span className={`badge ${statusClass(j.status)}`}>
                      <span className="dot" />
                      {j.status}
                    </span>
                  </td>
                  <td className="mono muted">
                    {j.saved}s / {j.skipped}k / {j.errors}e · {j.mediaCount} found
                  </td>
                  <td className="muted">
                    {j.finishedAt ? new Date(j.finishedAt).toLocaleString() : "—"}
                  </td>
                  <td className="row">
                    {j.errors > 0 && failedCount > 0 && onFailed ? (
                      <button type="button" className="btn sm" onClick={onFailed}>
                        Retry failed
                      </button>
                    ) : null}
                    {j.runDir ? (
                      <button type="button" className="btn sm" onClick={() => onOpen(j.runDir!)}>
                        Folder
                      </button>
                    ) : null}
                    {j.zipPath ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void window.xaver.library.reveal(j.zipPath!)}
                      >
                        ZIP
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
