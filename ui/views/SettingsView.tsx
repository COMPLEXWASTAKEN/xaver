import { useMemo, useState } from "react";
import { Row, Toggle } from "../components/common/controls";
import { AppearancePicker } from "../components/setup/AppearancePicker";
import { SecurityPanel } from "../components/security/SecurityPanel";
import { NotificationSettings } from "../components/settings/NotificationSettings";
import { FolderLayoutPicker } from "../components/settings/FolderLayoutPicker";
import type { Appearance, SecurityStatus } from "../../electron/shared/types";
import type { AppConfig } from "../../electron/shared/types";
import { DEFAULT_CONFIG } from "../../electron/shared/types";

export type SettingsCat = "appearance" | "security" | "notifications" | "general" | "scrape" | "media" | "auth" | "stealth" | "advanced";

const CATS: { id: SettingsCat; label: string; keys: (keyof AppConfig)[] }[] = [
  {
    id: "appearance",
    label: "Appearance",
    keys: ["theme", "accent", "motion", "cornerStyle", "uiScale", "themeDensity"]
  },
  {
    id: "security",
    label: "Security",
    keys: []
  },
  {
    id: "notifications",
    label: "Notifications",
    keys: [
      "notifyDesktop",
      "notifyWhenAway",
      "notifySound",
      "notifyPrivate",
      "notifyScans",
      "notifyDownloads",
      "notifyFailures",
      "notifyQuiet",
      "notifyQuietFrom",
      "notifyQuietTo"
    ]
  },
  {
    id: "general",
    label: "General",
    keys: ["outputRoot", "folderLayout", "singleFolderName", "splitByType", "defaultZip", "openFolderOnComplete", "themeDensity"]
  },
  {
    id: "scrape",
    label: "Scrape",
    keys: [
      "maxScrolls",
      "scrollDelayMs",
      "maxIdleRounds",
      "headless",
      "viewportWidth",
      "viewportHeight",
      "downloadConcurrency"
    ]
  },
  {
    id: "media",
    label: "Media",
    keys: [
      "includePhotos",
      "includeVideos",
      "includeGifs",
      "skipHls",
      "sha256Dedupe",
      "rememberDownloads",
      "retryFailedPass",
      "hideDownloaded",
      "filenamePattern"
    ]
  },
  {
    id: "auth",
    label: "Auth",
    keys: ["cookiePathOverride", "autoCheckAuthOnLaunch"]
  },
  {
    id: "stealth",
    label: "Stealth",
    keys: [
      "shardxHumanize",
      "shardxTemplate",
      "shardxWebrtc",
      "shardxTimezone",
      "shardxCacheDir",
      "overrideUserAgent",
      "userAgent",
      "proxyUrl"
    ]
  },
  {
    id: "advanced",
    label: "Advanced",
    keys: ["playwrightArgs", "requestTimeoutMs", "retryCount", "logLevel", "chromiumChannel"]
  }
];

export function SettingsView({
  config,
  onChange,
  security,
  onSecurity,
  onRerunSetup,
  appearance,
  onAppearance,
  initialCat = "appearance"
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  security: SecurityStatus | null;
  onSecurity: (s: SecurityStatus) => void;
  onRerunSetup: () => void;
  appearance: Appearance;
  onAppearance: (patch: Partial<Appearance>) => void;
  initialCat?: SettingsCat;
}) {
  const [cat, setCat] = useState<SettingsCat>(initialCat);
  const [filter, setFilter] = useState("");

  const active = useMemo(() => CATS.find((c) => c.id === cat)!, [cat]);

  const set = async <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    await onChange({ [key]: value } as Partial<AppConfig>);
  };

  const visible = (title: string, hint?: string) => {
    if (!filter.trim()) return true;
    const hay = `${title} ${hint || ""}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  };

  return (
    <div className="settings-layout">
      <div className="card stack">
        <input
          className="field"
          placeholder="Search settings…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="settings-cats">
          {CATS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cat === c.id ? "active" : ""}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {active.keys.length ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => void window.xaver.config.reset(active.keys).then((c) => onChange(c))}
          >
            Reset {active.label}
          </button>
        ) : null}
        <button type="button" className="btn ghost sm" onClick={onRerunSetup}>
          Run setup again
        </button>
      </div>

      <div className="setting-block" key={cat}>
        {cat === "appearance" && (
          <div className="setting-pad">
            <AppearancePicker value={appearance} onChange={onAppearance} compact />
          </div>
        )}
        {cat === "security" &&
          (security ? (
            <SecurityPanel status={security} onStatus={onSecurity} />
          ) : (
            <div className="skeleton" style={{ height: 200 }} />
          ))}
        {cat === "notifications" && <NotificationSettings config={config} set={set} visible={visible} />}
        {cat === "general" && (
          <>
            {visible("Output folder", "Where runs are written") && (
              <Row title="Output folder" hint="Everything Xaver saves goes in here.">
                <div className="row">
                  <input
                    className="field"
                    value={config.outputRoot}
                    onChange={(e) => void set("outputRoot", e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      const p = await window.xaver.dialog.pickFolder();
                      if (p) await set("outputRoot", p);
                    }}
                  >
                    Browse
                  </button>
                </div>
              </Row>
            )}
            <FolderLayoutPicker config={config} set={set} visible={visible} />
            {visible("ZIP on complete") && (
              <Row title="ZIP on complete" hint="Also build a ZIP of each download's new files.">
                <Toggle on={config.defaultZip} onChange={(v) => void set("defaultZip", v)} />
              </Row>
            )}
            {visible("Open folder on complete") && (
              <Row title="Open folder on complete">
                <Toggle
                  on={config.openFolderOnComplete}
                  onChange={(v) => void set("openFolderOnComplete", v)}
                />
              </Row>
            )}
            {visible("UI density") && (
              <Row title="UI density">
                <select
                  className="field"
                  value={config.themeDensity}
                  onChange={(e) =>
                    void set("themeDensity", e.target.value as AppConfig["themeDensity"])
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </Row>
            )}
          </>
        )}

        {cat === "scrape" && (
          <>
            {visible("Max scroll steps") && (
              <Row title="Max scroll steps" hint="Hard ceiling for timeline scrolling.">
                <input
                  className="field"
                  type="number"
                  min={50}
                  value={config.maxScrolls}
                  onChange={(e) => void set("maxScrolls", Number(e.target.value) || 800)}
                />
              </Row>
            )}
            {visible("Scroll delay") && (
              <Row title="Scroll delay (ms)" hint="Pause between scroll steps.">
                <input
                  className="field"
                  type="number"
                  min={200}
                  value={config.scrollDelayMs}
                  onChange={(e) => void set("scrollDelayMs", Number(e.target.value) || 1200)}
                />
              </Row>
            )}
            {visible("Max idle rounds") && (
              <Row title="Max idle rounds" hint="Stop after this many scrolls with no new posts.">
                <input
                  className="field"
                  type="number"
                  min={5}
                  value={config.maxIdleRounds}
                  onChange={(e) => void set("maxIdleRounds", Number(e.target.value) || 45)}
                />
              </Row>
            )}
            {visible("Headless browser") && (
              <Row title="Headless browser" hint="Hide Chromium while scraping.">
                <Toggle on={config.headless} onChange={(v) => void set("headless", v)} />
              </Row>
            )}
            {visible("Viewport") && (
              <Row title="Viewport" hint="Preferred window size. ShardX still matches the device profile screen.">
                <div className="split-2">
                  <input
                    className="field"
                    type="number"
                    value={config.viewportWidth}
                    onChange={(e) => void set("viewportWidth", Number(e.target.value) || 1280)}
                  />
                  <input
                    className="field"
                    type="number"
                    value={config.viewportHeight}
                    onChange={(e) => void set("viewportHeight", Number(e.target.value) || 900)}
                  />
                </div>
              </Row>
            )}
            {visible("Download concurrency") && (
              <Row
                title="Download concurrency"
                hint={`Files downloaded in parallel (1–8). Lower it if you hit rate limits. Default ${DEFAULT_CONFIG.downloadConcurrency}.`}
              >
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={8}
                  value={config.downloadConcurrency}
                  onChange={(e) =>
                    void set("downloadConcurrency", Math.max(1, Math.min(8, Number(e.target.value) || 1)))
                  }
                />
              </Row>
            )}
          </>
        )}

        {cat === "media" && (
          <>
            {visible("Include photos") && (
              <Row title="Include photos">
                <Toggle on={config.includePhotos} onChange={(v) => void set("includePhotos", v)} />
              </Row>
            )}
            {visible("Include videos") && (
              <Row title="Include videos">
                <Toggle on={config.includeVideos} onChange={(v) => void set("includeVideos", v)} />
              </Row>
            )}
            {visible("Include gifs") && (
              <Row title="Include gifs">
                <Toggle on={config.includeGifs} onChange={(v) => void set("includeGifs", v)} />
              </Row>
            )}
            {visible("Skip HLS") && (
              <Row title="Skip HLS (.m3u8)" hint="Desktop v1 skips HLS playlists; prefer mp4 variants.">
                <Toggle on={config.skipHls} onChange={(v) => void set("skipHls", v)} />
              </Row>
            )}
            {visible("SHA-256 dedupe") && (
              <Row title="SHA-256 dedupe" hint="Never save the same file twice, even if it was posted again.">
                <Toggle on={config.sha256Dedupe} onChange={(v) => void set("sha256Dedupe", v)} />
              </Row>
            )}
            {visible("Second try for failed files", "retry failed downloads automatically") && (
              <Row
                title="Second try for failed files"
                hint="When a download finishes, wait a moment and try anything that failed once more. Anything still failing goes to Failed."
              >
                <Toggle on={config.retryFailedPass} onChange={(v) => void set("retryFailedPass", v)} />
              </Row>
            )}
            {visible("Remember downloads", "moved deleted files dedupe history") && (
              <Row
                title="Remember downloads"
                hint="Skip media you've saved before, even after you move or delete the files. Use Database → Remove missing to get specific ones again."
              >
                <Toggle
                  on={config.rememberDownloads}
                  disabled={!config.sha256Dedupe}
                  onChange={(v) => void set("rememberDownloads", v)}
                />
              </Row>
            )}
            {visible("Hide already downloaded", "gallery dedupe") && (
              <Row
                title="Hide already downloaded"
                hint="Scans skip media you already saved, so it never shows in the gallery. Needs SHA-256 dedupe."
              >
                <Toggle on={config.hideDownloaded} onChange={(v) => void set("hideDownloaded", v)} />
              </Row>
            )}
            {visible("Filename pattern") && (
              <Row title="Filename pattern" hint="Not used yet. Files are named by content hash for now.">
                <input
                  className="field"
                  value={config.filenamePattern}
                  onChange={(e) => void set("filenamePattern", e.target.value)}
                />
              </Row>
            )}
          </>
        )}

        {cat === "auth" && (
          <>
            {visible("Cookie path override") && (
              <Row title="Cookie path override" hint="Optional default file for CLI / future import.">
                <input
                  className="field"
                  value={config.cookiePathOverride}
                  onChange={(e) => void set("cookiePathOverride", e.target.value)}
                />
              </Row>
            )}
            {visible("Auto-check auth on launch") && (
              <Row title="Auto-check auth on launch" hint="Refresh @handle when session exists.">
                <Toggle
                  on={config.autoCheckAuthOnLaunch}
                  onChange={(v) => void set("autoCheckAuthOnLaunch", v)}
                />
              </Row>
            )}
          </>
        )}

        {cat === "stealth" && (
          <>
            <div className="alert">
              Powered by{" "}
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => void window.xaver.shell.openExternal("https://github.com/ProxyShard/ShardBrowser")}
              >
                ShardX / ShardBrowser
              </button>
              , a free anti-detect Chromium 152. Engine-level fingerprints, no license key. Keep headless off for login.
            </div>
            {visible("Canvas / WebGL noise") && (
              <Row title="Canvas / WebGL noise" hint="Per-profile noise so two runs do not share identical canvas hashes.">
                <Toggle on={config.shardxHumanize} onChange={(v) => void set("shardxHumanize", v)} />
              </Row>
            )}
            {visible("Device template") && (
              <Row title="Device template" hint="Library id. Used only when creating a new persistent profile.">
                <input
                  className="field"
                  value={config.shardxTemplate}
                  onChange={(e) => void set("shardxTemplate", e.target.value)}
                  placeholder="win-rtx4060"
                />
              </Row>
            )}
            {visible("WebRTC policy") && (
              <Row title="WebRTC policy">
                <select
                  className="field"
                  value={config.shardxWebrtc}
                  onChange={(e) =>
                    void set("shardxWebrtc", e.target.value as AppConfig["shardxWebrtc"])
                  }
                >
                  <option value="auto">Auto (UDP relay when proxy allows)</option>
                  <option value="tcp_only">TCP only</option>
                  <option value="block">Block</option>
                </select>
              </Row>
            )}
            {visible("Proxy URL") && (
              <Row title="Proxy URL" hint="socks5://user:pass@host:port or http://…. Timezone and location follow the exit IP.">
                <input
                  className="field"
                  value={config.proxyUrl}
                  onChange={(e) => void set("proxyUrl", e.target.value)}
                  placeholder="optional residential proxy"
                />
              </Row>
            )}
            {visible("Timezone") && (
              <Row title="Timezone" hint="IANA id, e.g. America/New_York. Empty = auto from proxy / system.">
                <input
                  className="field"
                  value={config.shardxTimezone}
                  onChange={(e) => void set("shardxTimezone", e.target.value)}
                />
              </Row>
            )}
            {visible("ShardX cache dir") && (
              <Row title="ShardX cache dir" hint="Engine + persistent profile. Empty = app userData/shardx.">
                <input
                  className="field"
                  value={config.shardxCacheDir}
                  onChange={(e) => void set("shardxCacheDir", e.target.value)}
                />
              </Row>
            )}
            {visible("Override User-Agent") && (
              <Row
                title="Override User-Agent"
                hint="Leave this off. The ShardX user agent has to match its device fingerprint and TLS."
              >
                <Toggle
                  on={config.overrideUserAgent}
                  onChange={(v) => void set("overrideUserAgent", v)}
                />
              </Row>
            )}
            {config.overrideUserAgent && visible("Custom User-Agent") && (
              <Row title="Custom User-Agent">
                <textarea
                  className="field"
                  value={config.userAgent}
                  onChange={(e) => void set("userAgent", e.target.value)}
                />
              </Row>
            )}
          </>
        )}

        {cat === "advanced" && (
          <>
            {visible("Extra Chromium args") && (
              <Row title="Extra Chromium args" hint="Space-separated flags passed to ShardX.">
                <input
                  className="field"
                  value={config.playwrightArgs}
                  onChange={(e) => void set("playwrightArgs", e.target.value)}
                />
              </Row>
            )}
            {visible("Request timeout") && (
              <Row title="Request timeout (ms)" hint="Aborts a download after this long with no data received.">
                <input
                  className="field"
                  type="number"
                  value={config.requestTimeoutMs}
                  onChange={(e) => void set("requestTimeoutMs", Math.max(5000, Number(e.target.value) || 120000))}
                />
              </Row>
            )}
            {visible("Retry count") && (
              <Row title="Retry count" hint="Retries per file on rate limits (429), server errors and network drops, with backoff.">
                <input
                  className="field"
                  type="number"
                  min={0}
                  max={6}
                  value={config.retryCount}
                  onChange={(e) => void set("retryCount", Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
                />
              </Row>
            )}
            {visible("Log level") && (
              <Row title="Log level">
                <select
                  className="field"
                  value={config.logLevel}
                  onChange={(e) => void set("logLevel", e.target.value as AppConfig["logLevel"])}
                >
                  <option value="silent">Silent</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
              </Row>
            )}
            {visible("Chromium channel") && (
              <Row title="Chromium channel" hint="Not used. ShardX ships its own Chromium 152.">
                <input
                  className="field"
                  value={config.chromiumChannel}
                  onChange={(e) => void set("chromiumChannel", e.target.value)}
                />
              </Row>
            )}
          </>
        )}
      </div>
    </div>
  );
}
