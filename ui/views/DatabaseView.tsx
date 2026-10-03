import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DbFileRow, DbOverview } from "../../electron/shared/types";
import { useCountUp } from "../lib/hooks/useCountUp";

type Notice = { tone: "ok" | "warn" | "err"; text: string } | null;
type Action = "migrate" | "migrateFile" | "verify" | "prune" | "rescan" | "compact" | "backup";

function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function fmtNum(n: number): string {
  return (Number(n) || 0).toLocaleString();
}

function ago(ts: number | null | undefined): string {
  if (!ts) return "never";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function baseName(p: string): string {
  return String(p || "").split(/[\\/]/).pop() || p;
}

function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const v = useCountUp(value);
  return <>{format(Math.round(v))}</>;
}

function Thumb({ row }: { row: DbFileRow }) {
  const [broken, setBroken] = useState(false);
  if (row.kind === "image" && !row.missing && !broken) {
    return (
      <img
        className="db-thumb"
        src={`xaver-media://local/${encodeURIComponent(row.path)}`}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className={`db-thumb db-thumb-${row.kind}`}>{row.kind === "image" ? "IMG" : row.kind === "gif" ? "GIF" : "▶"}</span>;
}

function FileRows({ rows, empty }: { rows: DbFileRow[]; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="db-files">
      {rows.map((r) => (
        <button
          key={r.sha256}
          type="button"
          className={`db-file ${r.missing ? "missing" : ""}`}
          title={`${r.path}\nsha256 ${r.sha256}`}
          onClick={() => void window.xaver.library.reveal(r.path)}
        >
          <Thumb row={r} />
          <span className="db-file-main">
            <span className="db-file-name">{baseName(r.path)}</span>
            <span className="db-file-sub muted">
              {r.profile ? `@${r.profile} · ` : ""}
              <span className="mono">{r.sha256.slice(0, 12)}</span>
            </span>
          </span>
          <span className={`db-chip origin-${r.origin}`}>{r.origin}</span>
          {r.missing ? <span className="db-chip missing">missing</span> : null}
          <span className="db-file-size mono">{fmtBytes(r.bytes)}</span>
          <span className="db-file-when muted">{ago(r.created_at)}</span>
        </button>
      ))}
    </div>
  );
}

export function DatabaseView({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<DbOverview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DbFileRow[] | null>(null);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      setData(await window.xaver.db.overview());
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String((e as Error)?.message || e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const term = q.trim();
    const seq = ++searchSeq.current;
    if (!term) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void window.xaver.db
        .search(term)
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(action);
    setNotice(null);
    try {
      switch (action) {
        case "migrate":
        case "migrateFile": {
          const r = action === "migrate" ? await window.xaver.db.migrate() : await window.xaver.db.migrateFile();
          if (!r) break;
          setNotice({
            tone: "ok",
            text: `Migrated ${fmtNum(r.files)} files and ${fmtNum(r.keys)} URL/ID keys${r.skipped ? ` · ${fmtNum(r.skipped)} unusable entries skipped` : ""}.${r.archivedTo ? " The old JSON was renamed so it won't be read again." : ""}`
          });
          break;
        }
        case "verify": {
          const r = await window.xaver.db.verify();
          setNotice({
            tone: r.missing ? "warn" : "ok",
            text: r.missing
              ? `Checked ${fmtNum(r.checked)} files · ${fmtNum(r.missing)} are missing on disk. "Remove missing" clears them so they can be downloaded again.`
              : `Checked ${fmtNum(r.checked)} files · everything is on disk.`
          });
          break;
        }
        case "prune": {
          const r = await window.xaver.db.prune();
          setNotice({
            tone: "ok",
            text: `Removed ${fmtNum(r.removedFiles)} missing files and ${fmtNum(r.removedKeys)} keys. Database compacted.`
          });
          break;
        }
        case "rescan": {
          const r = await window.xaver.db.rescan();
          setNotice({
            tone: "ok",
            text: `Scanned ${fmtNum(r.scanned)} media files · ${fmtNum(r.added)} new ${r.added === 1 ? "file" : "files"} indexed.`
          });
          break;
        }
        case "compact":
          await window.xaver.db.compact();
          setNotice({ tone: "ok", text: "Database compacted." });
          break;
        case "backup": {
          const dest = await window.xaver.db.backup();
          if (dest) setNotice({ tone: "ok", text: `Backup saved to ${dest}` });
          break;
        }
      }
    } catch (e) {
      setNotice({ tone: "err", text: String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const mix = useMemo(() => {
    const t = data?.totals;
    const total = t ? t.images + t.videos + t.gifs : 0;
    const pct = (n: number) => (total ? (n / total) * 100 : 0);
    return {
      total,
      parts: [
        { k: "Photos", n: t?.images || 0, cls: "img", pct: pct(t?.images || 0) },
        { k: "Videos", n: t?.videos || 0, cls: "vid", pct: pct(t?.videos || 0) },
        { k: "GIFs", n: t?.gifs || 0, cls: "gif", pct: pct(t?.gifs || 0) }
      ]
    };
  }, [data]);

  if (!data) {
    return (
      <div className="panel db-panel">
        {loadErr ? (
          <div className="alert err">Could not open the media database: {loadErr}</div>
        ) : (
          <>
            <div className="skeleton-stats">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
            <div className="skeleton" style={{ height: 64 }} />
            <div className="skeleton" style={{ height: 240 }} />
          </>
        )}
      </div>
    );
  }

  const t = data.totals;
  const legacy = data.legacy && !data.legacy.importedAt ? data.legacy : null;
  const topMax = Math.max(1, ...data.topProfiles.map((p) => p.files));
  const btn = (action: Action, label: string, cls = "btn sm") => (
    <button type="button" className={cls} disabled={Boolean(busy)} onClick={() => void run(action)}>
      {busy === action ? "Working…" : label}
    </button>
  );

  return (
    <div className="panel db-panel">
      {data.recoveredFrom ? (
        <div className="alert warn">
          The previous database file was unreadable and was set aside as{" "}
          <span className="mono">{baseName(data.recoveredFrom)}</span>. A fresh one was created. Use “Rescan output folder” to rebuild it.
        </div>
      ) : null}

      {legacy ? (
        <div className="db-legacy">
          <div className="db-legacy-text">
            <strong>Old index found</strong>
            <span className="muted">
              {legacy.readable
                ? `${fmtNum(legacy.files)} files and ${fmtNum(legacy.keys)} URL/ID entries are still in the old JSON file. Migrate them so scans keep hiding media you already have.`
                : "The old JSON index could not be read. You can still try importing another copy."}
            </span>
            <span className="mono db-legacy-path">{legacy.path}</span>
          </div>
          <div className="row">
            {legacy.readable ? btn("migrate", "Migrate to database", "btn primary sm") : null}
            {btn("migrateFile", "Import other file…")}
          </div>
        </div>
      ) : null}

      {notice ? <div className={`alert ${notice.tone}`}>{notice.text}</div> : null}

      <div className="db-stats stagger">
        <div className="stat">
          <div className="k">Files indexed</div>
          <div className="v">
            <CountUp value={t.files} format={fmtNum} />
          </div>
          <div className="db-stat-sub muted">{t.missing ? `${fmtNum(t.missing)} missing on disk` : "all accounted for"}</div>
        </div>
        <div className="stat">
          <div className="k">Library size</div>
          <div className="v">
            <CountUp value={t.bytes} format={fmtBytes} />
          </div>
          <div className="db-stat-sub muted">{t.files ? `avg ${fmtBytes(t.bytes / t.files)}` : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">URL & ID keys</div>
          <div className="v">
            <CountUp value={t.keys} format={fmtNum} />
          </div>
          <div className="db-stat-sub muted">used to hide re-found media</div>
        </div>
        <div className="stat">
          <div className="k">Download runs</div>
          <div className="v">
            <CountUp value={t.runs} format={fmtNum} />
          </div>
          <div className="db-stat-sub muted">last {ago(data.recentRuns[0]?.started_at)}</div>
        </div>
      </div>

      <div className="card db-mix">
        <div className="db-mix-bar">
          {mix.total ? (
            mix.parts.map((p) => (p.n ? <span key={p.k} className={`seg-${p.cls}`} style={{ width: `${p.pct}%` }} /> : null))
          ) : (
            <span className="seg-empty" style={{ width: "100%" }} />
          )}
        </div>
        <div className="db-mix-legend">
          {mix.parts.map((p) => (
            <span key={p.k}>
              <i className={`dot seg-${p.cls}`} />
              {p.k} <strong>{fmtNum(p.n)}</strong>
              <span className="muted">{mix.total ? ` · ${p.pct.toFixed(0)}%` : ""}</span>
            </span>
          ))}
          <span className="gb-spacer" />
          {data.origins.map((o) => (
            <span key={o.origin} className={`db-chip origin-${o.origin}`}>
              {o.origin} {fmtNum(o.n)}
            </span>
          ))}
        </div>
      </div>

      <div className="db-cols">
        <div className="card">
          <div className="db-card-head">Top profiles</div>
          {data.topProfiles.length ? (
            <div className="db-profiles">
              {data.topProfiles.map((p) => (
                <button key={p.profile} type="button" className="db-profile" onClick={() => setQ(p.profile === "(unknown)" ? "" : p.profile)}>
                  <span className="db-profile-name">{p.profile === "(unknown)" ? "Unattributed" : `@${p.profile}`}</span>
                  <span className="db-profile-bar">
                    <span style={{ width: `${(p.files / topMax) * 100}%` }} />
                  </span>
                  <span className="mono muted">{fmtNum(p.files)}</span>
                  <span className="mono muted">{fmtBytes(p.bytes)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">No downloads yet.</div>
          )}
        </div>

        <div className="card">
          <div className="db-card-head">Recent runs</div>
          {data.recentRuns.length ? (
            <div className="db-runs">
              {data.recentRuns.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="db-run"
                  disabled={!r.run_dir}
                  onClick={() => r.run_dir && void window.xaver.library.openPath(r.run_dir)}
                  title={r.run_dir || ""}
                >
                  <span className={`badge ${r.status === "done" ? "ok" : r.status === "running" ? "run" : r.status === "cancelled" ? "warn" : "err"}`}>
                    <span className="dot" />
                    {r.status}
                  </span>
                  <span className="db-run-name">{r.profile ? `@${r.profile}` : "selection"}</span>
                  <span className="muted mono">
                    +{fmtNum(r.saved)} · skip {fmtNum(r.skipped)}
                    {r.failed ? ` · fail ${fmtNum(r.failed)}` : ""}
                  </span>
                  <span className="muted mono">{fmtBytes(r.bytes)}</span>
                  <span className="muted">{ago(r.started_at)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">No runs recorded yet.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="db-card-head row">
          <span>{results ? `Search results (${results.length})` : "Recently added"}</span>
          <span className="gb-spacer" />
          <input
            className="field db-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search URL, media ID, hash, file or @profile…"
          />
        </div>
        <FileRows
          rows={results ?? data.recentFiles}
          empty={results ? "Nothing matches that search." : "Nothing indexed yet. Download something or rescan your output folder."}
        />
      </div>

      <div className="card">
        <div className="db-card-head">Maintenance</div>
        <div className="db-actions">
          <div className="db-action">
            {btn("rescan", "Rescan output folder")}
            <span className="muted">Hash and index media already on disk. Last run {ago(data.lastRescanAt)}.</span>
          </div>
          <div className="db-action">
            {btn("verify", "Verify files")}
            <span className="muted">Check that every indexed file still exists. Last run {ago(data.lastVerifyAt)}.</span>
          </div>
          <div className="db-action">
            {btn("prune", "Remove missing", "btn danger sm")}
            <span className="muted">Forget files you deleted so they can be downloaded again.</span>
          </div>
          <div className="db-action">
            {btn("migrateFile", "Import old index…")}
            <span className="muted">Merge any old <span className="mono">.media-hashes.json</span>, even from another output folder.</span>
          </div>
          <div className="db-action">
            {btn("compact", "Compact")}
            <span className="muted">Reclaim unused space in the database file.</span>
          </div>
          <div className="db-action">
            {btn("backup", "Back up…")}
            <span className="muted">Save a copy of the database anywhere.</span>
          </div>
        </div>
      </div>

      <div className="db-foot muted">
        <button type="button" className="btn ghost sm" onClick={() => void window.xaver.db.reveal()}>
          Show file
        </button>
        <span className="mono db-foot-path" title={data.path}>
          {data.path}
        </span>
        <span>{fmtBytes(data.sizeOnDisk)}</span>
        <span>schema v{data.schemaVersion}</span>
        <span className={`sec-badge ${data.encrypted ? "ok" : ""}`}>{data.encrypted ? "● AES-256 encrypted" : "Not encrypted"}</span>
        <span>created {ago(data.createdAt)}</span>
        <span>saved {ago(data.lastSavedAt)}</span>
      </div>
    </div>
  );
}
