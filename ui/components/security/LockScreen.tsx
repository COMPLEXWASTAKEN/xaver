import { useCallback, useEffect, useRef, useState } from "react";
import type { SecurityStatus, UnlockResult } from "../../../electron/shared/types";
import logoUrl from "../../assets/logo.png";

function fmtWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

export function LockScreen({
  status,
  unlocked,
  onGone
}: {
  status: SecurityStatus;
  unlocked: boolean;
  onGone: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; err?: boolean } | null>(null);
  const [shake, setShake] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(() => (status.lockoutMs ? Date.now() + status.lockoutMs : 0));
  const [now, setNow] = useState(Date.now());
  const [pressed, setPressed] = useState<string | null>(null);
  const helloTried = useRef(false);
  const busyRef = useRef(false);
  const pinRef = useRef("");

  const updatePin = (v: string) => {
    pinRef.current = v;
    setPin(v);
  };
  const maxLen = status.pinLength || 12;
  const clickForHello = status.hello && (status.lockReason === "minimize" || status.lockReason === "panic");

  useEffect(() => {
    if (status.lockoutMs) setLockoutUntil(Date.now() + status.lockoutMs);
  }, [status.lockoutMs]);

  useEffect(() => {
    if (!unlocked) return;
    const t = setTimeout(onGone, 380);
    return () => clearTimeout(t);
  }, [unlocked, onGone]);

  useEffect(() => {
    if (lockoutUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lockoutUntil]);

  const waitMs = Math.max(0, lockoutUntil - now);
  const lockedOut = waitMs > 0;

  const handleResult = useCallback((r: UnlockResult) => {
    if (r.ok) {
      setMessage({ text: "Unlocked" });
      return;
    }
    updatePin("");
    setShake((n) => n + 1);
    if (r.reason === "lockout" && r.lockoutMs) {
      setLockoutUntil(Date.now() + r.lockoutMs);
      setNow(Date.now());
      setMessage({ text: "Too many attempts", err: true });
    } else if (r.reason === "cancelled") {
      setMessage({ text: "Windows Hello was cancelled. Use your PIN instead." });
    } else if (r.reason === "hello-failed") {
      setMessage({ text: "Windows Hello couldn't verify you. Use your PIN instead.", err: true });
    } else {
      const left = r.attemptsLeft ?? 0;
      setMessage({
        text: left > 0 ? `Wrong PIN · ${left} ${left === 1 ? "try" : "tries"} before a timeout` : "Wrong PIN",
        err: true
      });
    }
  }, []);

  const submit = useCallback(
    async (value: string) => {
      if (busyRef.current || !value) return;
      busyRef.current = true;
      setBusy(true);
      try {
        handleResult(await window.xaver.security.unlockPin(value));
      } catch (e) {
        updatePin("");
        setMessage({ text: String((e as Error)?.message || e), err: true });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [handleResult]
  );

  const tryHello = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage({ text: "Waiting for Windows Hello…" });
    try {
      handleResult(await window.xaver.security.unlockHello());
    } catch (e) {
      setMessage({ text: String((e as Error)?.message || e), err: true });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [handleResult]);

  useEffect(() => {
    if (status.hello && !clickForHello && !helloTried.current && !lockedOut && !unlocked) {
      helloTried.current = true;
      void tryHello();
    }
  }, [status.hello, clickForHello, lockedOut, unlocked, tryHello]);

  const press = useCallback(
    (key: string) => {
      if (busyRef.current || lockedOut || unlocked) return;
      setPressed(key);
      setTimeout(() => setPressed((p) => (p === key ? null : p)), 120);
      if (key === "back") {
        updatePin(pinRef.current.slice(0, -1));
        return;
      }
      if (key === "enter") {
        void submit(pinRef.current);
        return;
      }
      setMessage(null);
      if (pinRef.current.length >= maxLen) return;
      const next = pinRef.current + key;
      updatePin(next);
      if (status.pinLength && next.length === status.pinLength) void submit(next);
    },
    [lockedOut, unlocked, submit, maxLen, status.pinLength]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter") press("enter");
      else if (e.key === "Escape") updatePin("");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const dots = status.pinLength || Math.max(4, pin.length);
  const sub = lockedOut
    ? { text: `Too many attempts · try again in ${fmtWait(waitMs)}`, err: true }
    : message || {
        text: clickForHello
          ? `Locked ${status.lockReason === "panic" ? "by the panic shortcut" : "when minimised"}. Click Use Windows Hello or enter your PIN.`
          : status.hello
            ? "Use Windows Hello or enter your PIN"
            : "Enter your PIN to continue"
      };

  return (
    <div className={`lock ${unlocked ? "leaving" : ""}`} role="dialog" aria-modal="true" aria-label="App locked">
      <div className="lock-orb a" />
      <div className="lock-orb b" />
      <div className="lock-card">
        <img className="lock-logo" src={logoUrl} alt="" />
        <div>
          <div className="lock-title">Xaver is locked</div>
          <div className={`lock-sub ${sub.err ? "err" : ""}`} aria-live="polite">
            {sub.text}
          </div>
        </div>
        <div key={shake} className={`pin-dots ${shake ? "shake" : ""}`} aria-hidden>
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} className={`pin-dot ${i < pin.length ? "on" : ""}`} />
          ))}
        </div>
        <div className="pin-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button
              key={k}
              type="button"
              className={`pin-key ${pressed === k ? "pressed" : ""}`}
              disabled={busy || lockedOut}
              onClick={() => press(k)}
            >
              {k}
            </button>
          ))}
          <button type="button" className="pin-key ghost" disabled={busy || lockedOut || !pin} onClick={() => updatePin("")}>
            Clear
          </button>
          <button
            type="button"
            className={`pin-key ${pressed === "0" ? "pressed" : ""}`}
            disabled={busy || lockedOut}
            onClick={() => press("0")}
          >
            0
          </button>
          {status.pinLength ? (
            <button type="button" className="pin-key ghost" disabled={busy || !pin} onClick={() => press("back")}>
              ⌫
            </button>
          ) : (
            <button type="button" className="pin-key ghost" disabled={busy || lockedOut || pin.length < 4} onClick={() => press("enter")}>
              OK
            </button>
          )}
        </div>
        {status.hello ? (
          <button
            type="button"
            className={`btn sm ${clickForHello ? "primary lock-hello-cta" : ""}`}
            autoFocus={clickForHello}
            disabled={busy || lockedOut}
            onClick={() => void tryHello()}
          >
            Use Windows Hello
          </button>
        ) : null}
        <div className="lock-foot">
          {status.encryptDatabase ? "Your library stays encrypted on this PC." : "Your library is hidden until you unlock."}
        </div>
      </div>
    </div>
  );
}
