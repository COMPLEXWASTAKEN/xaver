import { useEffect, useState } from "react";
import { PANIC_KEYS, type SecurityStatus, type UnlockResult } from "../../../electron/shared/types";
import { Row, Toggle } from "../common/controls";

type Mode = "idle" | "set" | "change" | "remove";

function explain(r: UnlockResult): string {
  if (r.reason === "invalid") return "PINs are 4–12 digits.";
  if (r.reason === "lockout") return `Too many attempts. Try again in ${Math.ceil((r.lockoutMs || 0) / 1000)}s.`;
  if (r.reason === "wrong") return `Current PIN is wrong${r.attemptsLeft ? ` · ${r.attemptsLeft} tries left` : ""}.`;
  return "That didn't work.";
}

const IDLE_OPTIONS = [0, 1, 5, 10, 15, 30, 60];

export function keyLabel(acc: string): string {
  return acc.replace(/Control/g, "Ctrl").split("+").join(" + ");
}

function captureHint(status: SecurityStatus): string {
  if (status.captureSupport === "none") return "Not supported on this system.";
  if (status.captureSupport === "black")
    return "Screenshots and screen shares show a black box instead of the app. Update Windows for full hiding.";
  return "Screenshots, recordings, screen sharing and the Snipping Tool skip this window, as if it weren't there.";
}

export function SecurityPanel({
  status,
  onStatus,
  variant = "settings"
}: {
  status: SecurityStatus;
  onStatus: (s: SecurityStatus) => void;
  variant?: "settings" | "setup";
}) {
  const [mode, setMode] = useState<Mode>(status.pinSet ? "idle" : variant === "setup" ? "set" : "idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    void window.xaver.security.probeHello().then(() => window.xaver.security.status().then(onStatus)).catch(() => {});
  }, [onStatus]);

  const reset = (m: Mode = "idle") => {
    setMode(m);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 12);

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "err", text: String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    } finally {
      setBusy(false);
      onStatus(await window.xaver.security.status());
    }
  };

  const savePin = () =>
    act(async () => {
      if (!/^\d{4,12}$/.test(next)) {
        setMsg({ tone: "err", text: "Choose 4–12 digits." });
        return;
      }
      if (next !== confirm) {
        setMsg({ tone: "err", text: "The two PINs don't match." });
        return;
      }
      const r = await window.xaver.security.setPin(current, next);
      if (!r.ok) {
        setMsg({ tone: "err", text: explain(r) });
        return;
      }
      setMsg({ tone: "ok", text: mode === "change" ? "PIN changed." : "PIN set. You'll need it whenever the app locks." });
      reset();
    });

  const dropPin = () =>
    act(async () => {
      const r = await window.xaver.security.removePin(current);
      if (!r.ok) {
        setMsg({ tone: "err", text: explain(r) });
        return;
      }
      setMsg({ tone: "ok", text: "PIN removed. The app no longer locks." });
      reset();
    });

  const pref = (patch: Parameters<typeof window.xaver.security.setPrefs>[0]) =>
    act(async () => {
      onStatus(await window.xaver.security.setPrefs(patch));
    });

  const pinForm = mode === "set" || mode === "change" || mode === "remove";

  return (
    <div className="stagger">
      {msg ? <div className={`alert ${msg.tone}`}>{msg.text}</div> : null}

      <div className="sec-group">
        <span>Lock</span>
      </div>

      <Row
        title="App PIN"
        hint={
          status.pinSet
            ? `A ${status.pinLength}-digit PIN protects this app.`
            : "Lock the app behind a 4–12 digit PIN. Required for Windows Hello."
        }
      >
        <div className="row">
          {status.pinSet ? <span className="sec-badge ok">● On</span> : <span className="sec-badge">Off</span>}
          {!pinForm && !status.pinSet ? (
            <button type="button" className="btn primary sm" onClick={() => reset("set")}>
              Set PIN
            </button>
          ) : null}
          {!pinForm && status.pinSet ? (
            <>
              <button type="button" className="btn sm" onClick={() => reset("change")}>
                Change
              </button>
              <button type="button" className="btn danger sm" onClick={() => reset("remove")}>
                Remove
              </button>
            </>
          ) : null}
        </div>
      </Row>

      {pinForm ? (
        <div className="card pin-setup">
          {mode !== "set" ? (
            <input
              className="field pin-input"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Current PIN"
              value={current}
              onChange={(e) => setCurrent(digits(e.target.value))}
            />
          ) : null}
          {mode !== "remove" ? (
            <>
              <input
                className="field pin-input"
                type="password"
                inputMode="numeric"
                autoFocus={mode === "set"}
                placeholder="New PIN"
                value={next}
                onChange={(e) => setNext(digits(e.target.value))}
              />
              <input
                className="field pin-input"
                type="password"
                inputMode="numeric"
                placeholder="Confirm PIN"
                value={confirm}
                onChange={(e) => setConfirm(digits(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void savePin();
                }}
              />
            </>
          ) : null}
          <div className="row">
            {mode === "remove" ? (
              <button type="button" className="btn danger sm" disabled={busy || current.length < 4} onClick={() => void dropPin()}>
                Remove PIN
              </button>
            ) : (
              <button
                type="button"
                className="btn primary sm"
                disabled={busy || next.length < 4 || confirm.length < 4 || (mode === "change" && current.length < 4)}
                onClick={() => void savePin()}
              >
                {busy ? "Saving…" : "Save PIN"}
              </button>
            )}
            {variant === "setup" && !status.pinSet ? null : (
              <button type="button" className="btn ghost sm" onClick={() => reset()}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : null}

      <Row
        title="Windows Hello"
        hint={
          status.helloAvailable
            ? "Unlock with your face, fingerprint or Windows PIN. Your app PIN stays as a backup."
            : "Windows Hello isn't set up on this PC."
        }
      >
        <Toggle
          on={status.hello}
          disabled={busy || !status.pinSet || !status.helloAvailable}
          onChange={(v) => void pref({ hello: v })}
        />
      </Row>

      <Row title="Lock when the app opens">
        <Toggle on={status.lockOnLaunch} disabled={busy || !status.pinSet} onChange={(v) => void pref({ lockOnLaunch: v })} />
      </Row>

      <Row title="Auto-lock when idle" hint="Locks after this long without using the app.">
        <select
          className="field"
          disabled={busy || !status.pinSet}
          value={status.idleMinutes}
          onChange={(e) => void pref({ idleMinutes: Number(e.target.value) })}
        >
          {IDLE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "Never" : `${m} minute${m === 1 ? "" : "s"}`}
            </option>
          ))}
        </select>
      </Row>

      <Row title="Lock when Windows locks or sleeps">
        <Toggle
          on={status.lockOnSystemLock}
          disabled={busy || !status.pinSet}
          onChange={(v) => void pref({ lockOnSystemLock: v })}
        />
      </Row>

      <Row title="Lock when minimised">
        <Toggle on={status.lockOnMinimize} disabled={busy || !status.pinSet} onChange={(v) => void pref({ lockOnMinimize: v })} />
      </Row>

      <div className="sec-group">
        <span>Privacy</span>
        {status.hideFromCapture ? <span className="sec-badge ok">● Hidden from capture</span> : null}
      </div>

      <Row title="Hide from screenshots & screen sharing" hint={captureHint(status)}>
        <Toggle
          on={status.hideFromCapture}
          disabled={busy || status.captureSupport === "none"}
          onChange={(v) => void pref({ hideFromCapture: v })}
        />
      </Row>

      <Row title="Blur when the window isn't active" hint="Covers the app while you're using another window. Click to bring it back.">
        <Toggle on={status.blurWhenInactive} disabled={busy} onChange={(v) => void pref({ blurWhenInactive: v })} />
      </Row>

      <Row
        title="Panic shortcut"
        hint={
          status.panicKey && !status.panicActive
            ? "Another app is already using that shortcut. Pick a different one."
            : `Instantly hides the app${status.pinSet ? " and locks it" : ""}, muting any video. Press it again to bring it back. Works from any app.`
        }
      >
        <select
          className="field"
          disabled={busy}
          value={status.panicKey}
          onChange={(e) => void pref({ panicKey: e.target.value })}
        >
          <option value="">Off</option>
          {PANIC_KEYS.map((k) => (
            <option key={k} value={k}>
              {keyLabel(k)}
            </option>
          ))}
        </select>
      </Row>

      <div className="sec-group">
        <span>Encryption</span>
      </div>

      <Row
        title="Encrypt media database"
        hint={
          status.encryptionAvailable
            ? "AES-256 encrypts your download history; the key is protected by your Windows account."
            : "Windows data protection isn't available for this account."
        }
      >
        <Toggle
          on={status.encryptDatabase}
          disabled={busy || !status.encryptionAvailable}
          onChange={(v) =>
            void act(async () => {
              onStatus(await window.xaver.security.setEncryptDatabase(v));
              setMsg({ tone: "ok", text: v ? "Database encrypted." : "Database encryption turned off." });
            })
          }
        />
      </Row>

      <Row
        title="Settings, session & history"
        hint="Your X login cookies, settings and job history are sealed with Windows data protection."
      >
        {status.encryptionAvailable ? <span className="sec-badge ok">● Encrypted</span> : <span className="sec-badge">Unavailable</span>}
      </Row>

      {variant === "settings" && status.pinSet ? (
        <Row title="Lock now" hint="Shortcut: Ctrl + L">
          <button type="button" className="btn sm" onClick={() => void window.xaver.security.lock()}>
            Lock
          </button>
        </Row>
      ) : null}
    </div>
  );
}
