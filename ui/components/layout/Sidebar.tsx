import { useEffect, useState } from "react";
import type { AuthStatus, JobRecord } from "../../../electron/shared/types";
import type { ViewId } from "../../app/views";
import logoUrl from "../../assets/logo.png";

function Icon({ name }: { name: ViewId }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "nav-ico"
  };
  switch (name) {
    case "run":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 5l7 7-7 7" />
        </svg>
      );
    case "library":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
          <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
        </svg>
      );
    case "jobs":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
        </svg>
      );
    case "account":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-4 14.5-4 16 0" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v4h-4" />
          <path d="M12 8.5v4" />
          <path d="M12 15.6v.01" />
        </svg>
      );
    case "about":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5.5" />
          <path d="M12 7.6v.01" />
        </svg>
      );
  }
}

const ITEMS: { id: ViewId; label: string }[] = [
  { id: "run", label: "Scan" },
  { id: "library", label: "Library" },
  { id: "database", label: "Database" },
  { id: "jobs", label: "Jobs" },
  { id: "failed", label: "Failed" },
  { id: "settings", label: "Settings" },
  { id: "account", label: "Account" },
  { id: "about", label: "About" }
];

export function Sidebar({
  view,
  onNavigate,
  auth,
  activeJob,
  onLock,
  shielded,
  unread = 0,
  updateReady = false,
  failedCount = 0,
  bellOpen = false,
  onBell
}: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  auth: AuthStatus | null;
  activeJob: JobRecord | null;
  onLock?: () => void;
  shielded?: boolean;
  unread?: number;
  updateReady?: boolean;
  failedCount?: number;
  bellOpen?: boolean;
  onBell?: () => void;
}) {
  const [version, setVersion] = useState(
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "2.0.1"
  );

  useEffect(() => {
    void window.xaver.app.version().then(setVersion).catch(() => {});
  }, []);

  return (
    <aside className="rail">
      <div className="brand">
        <img className="brand-logo" src={logoUrl} alt="Xaver" width={32} height={32} />
      </div>
      <nav className="nav">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            type="button"
            title={it.label}
            className={`nav-btn ${view === it.id ? "active" : ""} ${it.id === "account" && auth?.authenticated ? "authed" : ""}`}
            onClick={() => onNavigate(it.id)}
          >
            <Icon name={it.id} />
            {it.id === "account" ? (
              <span className={`nav-dot ${auth?.authenticated ? "ok" : ""}`} />
            ) : null}
            {it.id === "jobs" && activeJob ? <span className="nav-dot run" /> : null}
            {it.id === "about" && updateReady ? <span className="nav-dot run" /> : null}
            {it.id === "failed" && failedCount ? (
              <span key={failedCount} className="nav-badge nav-badge-err">
                {failedCount > 99 ? "99+" : failedCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {onBell ? (
        <button
          type="button"
          className={`nav-bell ${bellOpen ? "open" : ""} ${unread ? "has-unread" : ""}`}
          title={unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
          aria-label="Notifications"
          aria-expanded={bellOpen}
          onClick={onBell}
        >
          <svg
            width={19}
            height={19}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
          </svg>
          {unread ? (
            <span key={unread} className="nav-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      ) : null}
      {shielded ? (
        <button
          type="button"
          className="nav-shield"
          title="Hidden from screenshots & screen sharing"
          aria-label="Privacy settings"
          onClick={() => onNavigate("settings")}
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z" />
            <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
          </svg>
        </button>
      ) : null}
      {onLock ? (
        <button type="button" className="nav-lock" title="Lock (Ctrl + L)" aria-label="Lock app" onClick={onLock}>
          <svg
            width={19}
            height={19}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="11" width="14" height="10" rx="2.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </button>
      ) : null}
      <button type="button" className="brand-ver" title={`Xaver ${version} · About`} onClick={() => onNavigate("about")}>
        {version}
      </button>
    </aside>
  );
}
