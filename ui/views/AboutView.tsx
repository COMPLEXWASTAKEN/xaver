import { useEffect, useMemo, useState } from "react";
import type { AppConfig, AppInfo, UpdateState } from "../../electron/shared/types";
import logoUrl from "../assets/logo.png";
import { Row, Toggle } from "../components/common/controls";
import { relativeTime } from "../lib/time";
import { errorText, toast } from "../lib/toasts";

function mb(n: number): string {
  return `${(n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)} MB`;
}

function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function Notes({ body }: { body: string }) {
  const blocks = useMemo(() => {
    const out: { kind: "h" | "li" | "p"; text: string }[] = [];
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("**[Download") || line.startsWith("<") || line.startsWith(">")) continue;
      if (line.startsWith("#")) out.push({ kind: "h", text: plain(line.replace(/^#+\s*/, "")) });
      else if (/^[-*]\s+/.test(line)) out.push({ kind: "li", text: plain(line.replace(/^[-*]\s+/, "")) });
      else out.push({ kind: "p", text: plain(line) });
    }
    return out;
  }, [body]);
  if (!blocks.length) return null;
  return (
    <div className="about-notes">
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <h4 key={i}>{b.text}</h4>
        ) : b.kind === "li" ? (
          <div key={i} className="about-note-item">
            {b.text}
          </div>
        ) : (
          <p key={i}>{b.text}</p>
        )
      )}
    </div>
  );
}

function UpdateCard({ state, info, onCheck }: { state: UpdateState; info: AppInfo; onCheck: () => void }) {
  const r = state.release;
  const pct = state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : 0;
  const act = (fn: () => Promise<unknown>, title: string) =>
    void fn().catch((e) => toast({ tone: "error", title, body: errorText(e) }));
  const openReleases = () => void window.xaver.shell.openExternal(r?.url || info.releasesUrl);

  if (state.status === "checking" || state.status === "idle") {
    return (
      <div className="about-update">
        <span className="about-spinner" />
        <div>
          <strong>Checking for updates…</strong>
          <span className="muted">Looking at the latest release on GitHub.</span>
        </div>
      </div>
    );
  }

  if (state.status === "current") {
    return (
      <div className="about-update tone-ok">
        <span className="about-badge ok">✓</span>
        <div>
          <strong>You're up to date</strong>
          <span className="muted">
            {info.version} is the newest release · checked {relativeTime(state.checkedAt)}
          </span>
        </div>
        <button type="button" className="btn sm" onClick={onCheck}>
          Check again
        </button>
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="about-update">
        <span className="about-badge">i</span>
        <div>
          <strong>Update checks aren't available yet</strong>
          <span className="muted">Releases aren't public yet. Grab new versions from the Releases page for now.</span>
        </div>
        <button type="button" className="btn sm" onClick={openReleases}>
          Open Releases
        </button>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="about-update tone-err">
        <span className="about-badge err">!</span>
        <div>
          <strong>Couldn't check for updates</strong>
          <span className="muted">{state.error || "Something went wrong."}</span>
        </div>
        <button type="button" className="btn sm" onClick={onCheck}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="about-update tone-new">
      <span className="about-badge new">↑</span>
      <div className="about-update-main">
        <strong>
          {state.status === "ready" ? "Ready to install" : state.status === "installing" ? "Opening the installer…" : "Update available"}{" "}
          <span className="about-new-ver">Xaver {r?.version}</span>
        </strong>
        <span className="muted">
          {r?.publishedAt ? `Released ${relativeTime(new Date(r.publishedAt).getTime())}` : ""}
          {r?.asset ? ` · ${mb(r.asset.size)}` : ""} · you have {info.version}
        </span>
        {state.status === "downloading" ? (
          <div className="about-progress">
            <div className="about-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="muted mono">
              {mb(state.received)} of {mb(state.total)} · {pct}%
            </span>
          </div>
        ) : null}
        {state.status === "ready" ? (
          <span className="muted">Checksum verified. Xaver closes while the installer runs, and your library, settings, PIN and session are kept.</span>
        ) : null}
        {r?.notes && state.status !== "downloading" ? <Notes body={r.notes} /> : null}
      </div>
      <div className="about-update-actions">
        {state.status === "available" ? (
          r?.asset ? (
            <button type="button" className="btn primary sm" onClick={() => act(() => window.xaver.updates.download(), "Download failed")}>
              Download and install
            </button>
          ) : (
            <button type="button" className="btn primary sm" onClick={openReleases}>
              Get it on GitHub
            </button>
          )
        ) : null}
        {state.status === "downloading" ? (
          <button type="button" className="btn sm" onClick={() => void window.xaver.updates.cancel()}>
            Cancel
          </button>
        ) : null}
        {state.status === "ready" ? (
          <button type="button" className="btn primary sm" onClick={() => act(() => window.xaver.updates.install(), "Couldn't start the installer")}>
            Restart and install
          </button>
        ) : null}
        <button type="button" className="btn ghost sm" onClick={openReleases}>
          Release notes
        </button>
      </div>
    </div>
  );
}

export function AboutView({
  config,
  onChange
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => Promise<AppConfig>;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.xaver.updates.info(), window.xaver.updates.state()]).then(([i, s]) => {
      if (!alive) return;
      setInfo(i);
      setState(s);
      if (s.status === "idle" || Date.now() - s.checkedAt > 10 * 60 * 1000) void window.xaver.updates.check().then((n) => alive && setState(n));
    });
    const off = window.xaver.updates.onChanged(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!info || !state) return <div className="skeleton" style={{ height: 320 }} />;

  const details = [
    ["Version", info.version],
    ["Build", info.packaged ? "Installed" : "Development"],
    ["Electron", info.electron],
    ["Chromium", info.chrome],
    ["Node", info.node],
    ["System", `${info.os} · ${info.arch}`]
  ];

  const copyDetails = () => {
    const text = details.map(([k, v]) => `${k}: ${v}`).join("\n");
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ tone: "ok", title: "Copied", body: "Version details are on your clipboard.", ttl: 2500 }))
      .catch(() => toast({ tone: "error", title: "Couldn't copy" }));
  };

  return (
    <div className="about stagger">
      <div className="card about-hero">
        <img src={logoUrl} alt="" width={64} height={64} className="about-logo" />
        <div className="about-hero-text">
          <h2>
            Xaver <span className="about-ver">{info.version}</span>
            <span className={`sec-badge ${info.packaged ? "ok" : ""}`}>{info.packaged ? "● Stable" : "Development build"}</span>
          </h2>
          <span className="muted">Save photos, videos and GIFs from X profiles.</span>
        </div>
      </div>

      <div className="card about-card">
        <div className="sec-group">
          <span>Updates</span>
        </div>
        <UpdateCard state={state} info={info} onCheck={() => void window.xaver.updates.check()} />
        <Row
          title="Check for updates automatically"
          hint={info.packaged ? "Looks for a new release when Xaver starts and every 12 hours." : "Automatic checks only run in installed builds."}
        >
          <Toggle on={config.autoUpdateCheck} onChange={(v) => void onChange({ autoUpdateCheck: v })} />
        </Row>
      </div>

      <div className="card about-card">
        <div className="sec-group">
          <span>Details</span>
          <button type="button" className="btn ghost sm" onClick={copyDetails}>
            Copy
          </button>
        </div>
        <div className="about-grid">
          {details.map(([k, v]) => (
            <div key={k}>
              <span className="muted">{k}</span>
              <strong className="mono">{v}</strong>
            </div>
          ))}
        </div>
        <Row title="Installed in" hint={<span className="mono">{info.installDir}</span>}>
          <span />
        </Row>
        <Row title="Your data" hint={<span className="mono">{info.dataDir}</span>}>
          <button type="button" className="btn sm" onClick={() => void window.xaver.library.openPath(info.dataDir)}>
            Open folder
          </button>
        </Row>
      </div>

      <div className="card about-card about-ideas">
        <div className="about-ideas-text">
          <strong>Want something added?</strong>
          <span className="muted">
            Request a feature and vote on others on the Feature board. Requests with the most 👍 come first, and a pull request is the fastest way to get one in.
          </span>
        </div>
        <div className="about-ideas-actions">
          <button type="button" className="btn ghost sm" onClick={() => void window.xaver.shell.openExternal(info.boardUrl)}>
            Feature board
          </button>
          <button type="button" className="btn primary sm" onClick={() => void window.xaver.shell.openExternal(info.requestUrl)}>
            Request a feature
          </button>
        </div>
      </div>

      <div className="card about-card about-links">
        <button type="button" className="btn sm" onClick={() => void window.xaver.shell.openExternal(info.releasesUrl)}>
          All releases
        </button>
        <button type="button" className="btn sm" onClick={() => void window.xaver.shell.openExternal(info.bugUrl)}>
          Report a problem
        </button>
        <span className="muted about-legal">© 2026 COMPLEX · Proprietary, all rights reserved</span>
      </div>
    </div>
  );
}
