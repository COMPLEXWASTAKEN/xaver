import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast } from "../../lib/toasts";
import { NoticeIcon } from "./NoticeIcon";

function ToastCard({ t }: { t: Toast }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => dismissToast(t.id), 220);
    return () => clearTimeout(timer);
  }, [leaving, t.id]);

  const close = () => setLeaving(true);

  return (
    <div
      className={`toast-card tone-${t.tone} ${leaving ? "leaving" : ""}`}
      role={t.tone === "error" ? "alert" : "status"}
      style={{ ["--ttl" as string]: `${t.ttl}ms` }}
    >
      <NoticeIcon tone={t.tone} size={16} />
      <div className="toast-text">
        <strong>
          {t.title}
          {t.count > 1 ? <span className="toast-count">×{t.count}</span> : null}
        </strong>
        {t.body ? <span>{t.body}</span> : null}
      </div>
      {t.action ? (
        <button
          type="button"
          className="btn sm toast-action"
          onClick={() => {
            t.action?.run();
            close();
          }}
        >
          {t.action.label}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={close}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <span className="toast-timer" onAnimationEnd={close} />
    </div>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}
