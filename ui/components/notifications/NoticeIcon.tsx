import type { ReactNode } from "react";
import type { NoticeKind, NoticeTone } from "../../../electron/shared/types";

const PATHS: Record<string, ReactNode> = {
  ok: <path d="M5 12.5l4.2 4.2L19 7" />,
  error: (
    <>
      <path d="M12 7.5v5.5" />
      <path d="M12 16.6v.01" />
    </>
  ),
  warn: (
    <>
      <path d="M12 8v4.5" />
      <path d="M12 16v.01" />
    </>
  ),
  info: (
    <>
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.01" />
    </>
  ),
  session: (
    <>
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.5 19c1.2-3.2 3.7-4.8 6.5-4.8s5.3 1.6 6.5 4.8" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v10" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  scan: (
    <>
      <circle cx="11" cy="11" r="5.5" />
      <path d="M15.2 15.2L19.5 19.5" />
    </>
  )
};

export function NoticeIcon({ tone, kind, size = 18 }: { tone: NoticeTone; kind?: NoticeKind; size?: number }) {
  const glyph =
    tone === "error" || tone === "warn"
      ? kind === "session"
        ? PATHS.session
        : PATHS[tone]
      : kind === "download"
        ? PATHS.download
        : kind === "scan" && tone === "info"
          ? PATHS.scan
          : PATHS[tone];
  return (
    <span className={`notice-icon tone-${tone}`} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {glyph}
      </svg>
    </span>
  );
}
