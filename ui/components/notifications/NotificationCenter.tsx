import { useEffect, useMemo, useRef, useState } from "react";
import type { Notice, NoticeFeed } from "../../../electron/shared/types";
import { dayBucket, relativeTime } from "../../lib/time";
import { NoticeIcon } from "./NoticeIcon";

type Filter = "all" | "unread";

export function NotificationCenter({
  feed,
  onClose,
  onOpen,
  onSettings
}: {
  feed: NoticeFeed;
  onClose: () => void;
  onOpen: (n: Notice) => void;
  onSettings: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(Date.now());
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onClose, 200);
    return () => clearTimeout(t);
  }, [leaving, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLeaving(true);
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (panel.current?.contains(el) || el.closest(".nav-bell")) return;
      setLeaving(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const groups = useMemo(() => {
    const shown = filter === "unread" ? feed.items.filter((n) => !n.read) : feed.items;
    const out: { label: string; items: Notice[] }[] = [];
    for (const n of shown) {
      const label = dayBucket(n.at, now);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [feed.items, filter, now]);

  return (
    <div
      ref={panel}
      className={`notice-panel ${leaving ? "leaving" : ""}`}
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
    >
      <div className="notice-head">
        <div>
          <h3>Notifications</h3>
          <span className="muted">{feed.unread ? `${feed.unread} unread` : "You're all caught up"}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Notification settings" title="Notification settings" onClick={onSettings}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>

      <div className="notice-tools">
        <div className="seg sm">
          {(["all", "unread"] as Filter[]).map((f) => (
            <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : "Unread"}
            </button>
          ))}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn ghost sm"
            disabled={!feed.unread}
            onClick={() => void window.xaver.notices.markRead()}
          >
            Mark all read
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={!feed.items.length}
            onClick={() => void window.xaver.notices.clear()}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="notice-list">
        {groups.length ? (
          groups.map((g) => (
            <section key={g.label}>
              <div className="notice-group">{g.label}</div>
              {g.items.map((n, i) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  className={`notice-row ${n.read ? "" : "unread"}`}
                  style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}
                  onClick={() => onOpen(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(n);
                    }
                  }}
                >
                  <NoticeIcon tone={n.tone} kind={n.kind} />
                  <div className="notice-text">
                    <strong>{n.title}</strong>
                    {n.body ? <span>{n.body}</span> : null}
                    <time dateTime={new Date(n.at).toISOString()} title={new Date(n.at).toLocaleString()}>
                      {relativeTime(n.at, now)}
                    </time>
                  </div>
                  <button
                    type="button"
                    className="notice-dismiss"
                    aria-label="Remove notification"
                    onClick={(e) => {
                      e.stopPropagation();
                      void window.xaver.notices.remove(n.id);
                    }}
                  >
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </section>
          ))
        ) : (
          <div className="notice-empty">
            <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
            <strong>{filter === "unread" ? "Nothing unread" : "No notifications yet"}</strong>
            <span>Finished scans, downloads and anything that needs you will show up here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
