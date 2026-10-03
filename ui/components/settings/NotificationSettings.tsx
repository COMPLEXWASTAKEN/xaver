import { useEffect, useState } from "react";
import type { AppConfig, NoticeFeed } from "../../../electron/shared/types";
import { hourLabel } from "../../lib/time";
import { errorText, toast } from "../../lib/toasts";
import { Row, Toggle } from "../common/controls";
import { NoticeIcon } from "../notifications/NoticeIcon";

type Setter = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<void>;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function ToastPreview({ config }: { config: AppConfig }) {
  const hidden = config.notifyPrivate;
  return (
    <div className={`os-toast ${config.notifyDesktop ? "" : "off"}`} aria-hidden>
      <div className="os-toast-app">
        <span className="os-toast-logo" />
        Xaver
        <span className="os-toast-time">now</span>
      </div>
      <div className="os-toast-body">
        <NoticeIcon tone="ok" kind="download" size={16} />
        <div>
          <strong>{hidden ? "Xaver" : "Download finished"}</strong>
          <span>{hidden ? "A task finished." : "42 files saved · 3 skipped"}</span>
        </div>
      </div>
    </div>
  );
}

export function NotificationSettings({
  config,
  set,
  visible
}: {
  config: AppConfig;
  set: Setter;
  visible: (title: string, hint?: string) => boolean;
}) {
  const [feed, setFeed] = useState<NoticeFeed | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void window.xaver.notices.list().then(setFeed).catch(() => {});
    return window.xaver.notices.onChanged(setFeed);
  }, []);

  const off = !config.notifyDesktop;

  const sendTest = async () => {
    setTesting(true);
    try {
      await window.xaver.notices.test();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't send a test", body: errorText(e) });
    } finally {
      setTimeout(() => setTesting(false), 800);
    }
  };

  return (
    <>
      <div className="setting-pad notify-hero">
        <ToastPreview config={config} />
        <div className="notify-hero-text">
          <strong>Desktop notifications</strong>
          <span className="muted">
            Get a Windows notification when a scan or download finishes, or when something needs you. Everything also lands
            in the bell in the sidebar.
          </span>
          <div className="row">
            <button type="button" className="btn primary sm" disabled={testing} onClick={() => void sendTest()}>
              {testing ? "Sent" : "Send a test"}
            </button>
          </div>
        </div>
      </div>

      {visible("Desktop notifications", "Windows notifications") && (
        <Row title="Desktop notifications" hint="Show Windows notifications. In-app alerts always appear.">
          <Toggle on={config.notifyDesktop} onChange={(v) => void set("notifyDesktop", v)} />
        </Row>
      )}
      {visible("Only when I'm away", "another app") && (
        <Row title="Only when I'm in another app" hint="Skip the Windows notification while you're looking at the app.">
          <Toggle on={config.notifyWhenAway} disabled={off} onChange={(v) => void set("notifyWhenAway", v)} />
        </Row>
      )}
      {visible("Play a sound") && (
        <Row title="Play a sound">
          <Toggle on={config.notifySound} disabled={off} onChange={(v) => void set("notifySound", v)} />
        </Row>
      )}
      {visible("Private notifications", "hide details") && (
        <Row
          title="Private notifications"
          hint="Hide titles and counts, so a glance at your screen gives nothing away. Always on while the app is locked."
        >
          <Toggle on={config.notifyPrivate} disabled={off} onChange={(v) => void set("notifyPrivate", v)} />
        </Row>
      )}

      <div className="sec-group">
        <span>Notify me about</span>
      </div>
      {visible("Scans finished") && (
        <Row title="Scans finished" hint="How many new items were found.">
          <Toggle on={config.notifyScans} disabled={off} onChange={(v) => void set("notifyScans", v)} />
        </Row>
      )}
      {visible("Downloads finished") && (
        <Row title="Downloads finished" hint="Saved, skipped and failed counts.">
          <Toggle on={config.notifyDownloads} disabled={off} onChange={(v) => void set("notifyDownloads", v)} />
        </Row>
      )}
      {visible("Problems", "failures sign-in") && (
        <Row title="Problems" hint="Failed scans or downloads, and when you need to sign in again.">
          <Toggle on={config.notifyFailures} disabled={off} onChange={(v) => void set("notifyFailures", v)} />
        </Row>
      )}

      <div className="sec-group">
        <span>Quiet hours</span>
        {config.notifyQuiet ? (
          <span className="sec-badge ok">
            ● {hourLabel(config.notifyQuietFrom)} – {hourLabel(config.notifyQuietTo)}
          </span>
        ) : null}
      </div>
      {visible("Quiet hours", "do not disturb") && (
        <Row title="Quiet hours" hint="No Windows notifications during these hours. They still collect in the bell.">
          <Toggle on={config.notifyQuiet} disabled={off} onChange={(v) => void set("notifyQuiet", v)} />
        </Row>
      )}
      {config.notifyQuiet && visible("Quiet hours") ? (
        <Row title="From – to">
          <div className="row">
            <select
              className="field"
              value={config.notifyQuietFrom}
              disabled={off}
              onChange={(e) => void set("notifyQuietFrom", Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span className="muted">to</span>
            <select
              className="field"
              value={config.notifyQuietTo}
              disabled={off}
              onChange={(e) => void set("notifyQuietTo", Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>
        </Row>
      ) : null}

      <div className="sec-group">
        <span>History</span>
      </div>
      {visible("Notification history", "clear") && (
        <Row
          title="Notification history"
          hint={feed ? `${feed.items.length} saved · ${feed.unread} unread · stored encrypted on this PC` : "Stored encrypted on this PC"}
        >
          <div className="row">
            <button type="button" className="btn sm" disabled={!feed?.unread} onClick={() => void window.xaver.notices.markRead()}>
              Mark all read
            </button>
            <button type="button" className="btn danger sm" disabled={!feed?.items.length} onClick={() => void window.xaver.notices.clear()}>
              Clear
            </button>
          </div>
        </Row>
      )}
    </>
  );
}
