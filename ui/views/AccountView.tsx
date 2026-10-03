import { useEffect, useState } from "react";
import type { AuthStatus } from "../../electron/shared/types";

export function AccountView({
  auth,
  busy,
  setBusy,
  onAuth
}: {
  auth: AuthStatus | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onAuth: (a: AuthStatus) => void;
}) {
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [profileDir, setProfileDir] = useState("");

  useEffect(() => {
    void window.xaver.auth.profileDir().then(setProfileDir).catch(() => {});
    return window.xaver.auth.onLoginWaiting((p) => setStatusLine(p.message));
  }, []);

  const run = async (fn: () => Promise<AuthStatus | null>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fn();
      if (res) {
        onAuth(res);
        setMsg(
          res.authenticated
            ? `Session stored (${res.cookieCount} cookies)${res.screenName ? ` · @${res.screenName}` : ""}.`
            : "Session updated."
        );
      }
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
      setStatusLine(null);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 740 }}>
      <div className={`alert ${auth?.authenticated ? "ok" : "warn"}`}>
        {auth?.authenticated ? (
          <>
            Authenticated
            {auth.screenName ? ` as @${auth.screenName}` : ""}. Source: {auth.source}. Cookies:{" "}
            {auth.cookieCount}. Updated: {auth.updatedAt || "—"}.
          </>
        ) : (
          <>No valid session. Use ShardX login or import cookies (auth_token + ct0).</>
        )}
      </div>

      {statusLine ? <div className="alert">{statusLine}</div> : null}
      {msg ? <div className="alert ok">{msg}</div> : null}
      {err ? <div className="alert err">{err}</div> : null}

      <div className="card stack">
        <div className="label">ShardX login</div>
        <div className="muted">
          Opens anti-detect Chromium 152 from{" "}
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void window.xaver.shell.openExternal("https://github.com/ProxyShard/ShardBrowser")}
          >
            ProxyShard/ShardBrowser
          </button>
          . Persistent fingerprint + cookies. Log in to X in that window and we capture
          auth_token / ct0 automatically.
        </div>
        {profileDir ? (
          <div className="muted mono" style={{ fontSize: 11 }}>
            Profile: {profileDir}
          </div>
        ) : null}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run(() => window.xaver.auth.loginBrowser())}
          >
            Login with ShardX…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              setMsg(null);
              try {
                const res = await window.xaver.auth.ensureEngine();
                if (res.ok) setMsg("ShardX engine ready.");
                else setErr(res.error || "ShardX install failed");
              } catch (e) {
                setErr(String((e as Error)?.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Install / verify binary
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="label">Import cookie file</div>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run(() => window.xaver.auth.importFile())}
          >
            Choose cookie export…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !auth?.authenticated}
            onClick={() => void run(() => window.xaver.auth.refresh())}
          >
            Refresh @handle
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy || !auth?.authenticated}
            onClick={() => void run(async () => window.xaver.auth.clear())}
          >
            Clear session
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await window.xaver.auth.clearProfile();
                setMsg("ShardX profile wiped. Next login starts a new fingerprint.");
              } catch (e) {
                setErr(String((e as Error)?.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset browser profile
          </button>
        </div>
        <div className="muted">
          EditThisCookie Set-Cookie3 or Netscape exports. Session JSON lives in app userData.
        </div>
      </div>

      <div className="card stack">
        <div className="label">Paste cookie export</div>
        <textarea
          className="field"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste Set-Cookie3 / Netscape lines here…"
          disabled={busy}
        />
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy || !paste.trim()}
            onClick={() =>
              void run(async () => {
                const res = await window.xaver.auth.importText(paste);
                setPaste("");
                return res;
              })
            }
          >
            Import paste
          </button>
        </div>
      </div>
    </div>
  );
}
