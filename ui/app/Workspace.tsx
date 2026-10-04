import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppConfig,
  Appearance,
  AuthStatus,
  JobProgress,
  JobRecord,
  MediaItem,
  Notice,
  NoticeFeed,
  NoticeTarget,
  SecurityStatus
} from "../../electron/shared/types";
import { JobInspector } from "../components/layout/JobInspector";
import { Sidebar } from "../components/layout/Sidebar";
import { NotificationCenter } from "../components/notifications/NotificationCenter";
import { mergeItems, upsertItems } from "../lib/live-items";
import { errorText, toast } from "../lib/toasts";
import { AboutView } from "../views/AboutView";
import { AccountView } from "../views/AccountView";
import { DatabaseView } from "../views/DatabaseView";
import { JobsView } from "../views/JobsView";
import { LibraryView } from "../views/LibraryView";
import { RunView } from "../views/RunView";
import { SettingsView, type SettingsCat } from "../views/SettingsView";
import { VIEW_TITLES, type ViewId } from "./views";

type JobsSnapshot = {
  queue: JobRecord[];
  history: JobRecord[];
  activeJobId: string | null;
  downloading?: boolean;
  scanning?: boolean;
  generation?: number;
};

const ACTIVE = ["queued", "running", "scraping", "downloading", "zipping"];

export function Workspace({
  view,
  setView,
  security,
  onSecurity,
  onConfig,
  appearance,
  onAppearanceChange
}: {
  view: ViewId;
  setView: (v: ViewId) => void;
  security: SecurityStatus | null;
  onSecurity: (s: SecurityStatus) => void;
  onConfig: (c: Partial<AppConfig>) => void;
  appearance: Appearance;
  onAppearanceChange: (patch: Partial<Appearance>) => void;
}) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [queue, setQueue] = useState<JobRecord[]>([]);
  const [history, setHistory] = useState<JobRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [liveItems, setLiveItems] = useState<MediaItem[]>([]);
  const [busyAuth, setBusyAuth] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dbRefresh, setDbRefresh] = useState(0);
  const [feed, setFeed] = useState<NoticeFeed>({ items: [], unread: 0 });
  const [bellOpen, setBellOpen] = useState(false);
  const [settingsCat, setSettingsCat] = useState<SettingsCat | undefined>();
  const [updateReady, setUpdateReady] = useState(false);
  const genRef = useRef<number | null>(null);
  const pending = useRef<MediaItem[]>([]);
  const frame = useRef<number | null>(null);
  const lastFailure = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  const sameGen = (gen?: number) => {
    if (gen == null) return true;
    if (genRef.current == null) {
      genRef.current = gen;
      return true;
    }
    return gen === genRef.current;
  };

  const dropPending = () => {
    pending.current = [];
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  const applyJobs = useCallback((jobs: JobsSnapshot) => {
    setQueue(jobs.queue || []);
    setHistory(jobs.history || []);
    setActiveJobId(jobs.activeJobId || null);
    setDownloading(Boolean(jobs.downloading));
    setScanning(Boolean(jobs.scanning));
    if (typeof jobs.generation === "number") genRef.current = jobs.generation;
  }, []);

  const refreshMeta = useCallback(async () => {
    const [c, a, jobs] = await Promise.all([window.xaver.config.get(), window.xaver.auth.getStatus(), window.xaver.jobs.list()]);
    setConfig(c);
    setAuth(a);
    applyJobs(jobs);
  }, [applyJobs]);

  const go = useCallback(
    (target: NoticeTarget | ViewId, cat?: SettingsCat) => {
      setSettingsCat(cat);
      setView(target);
    },
    [setView]
  );

  const openNotice = useCallback(
    (n: Pick<Notice, "id" | "target" | "kind"> & { read?: boolean }) => {
      if (!n.read) void window.xaver.notices.markRead([n.id]).catch(() => {});
      setBellOpen(false);
      if (n.target) go(n.target, n.target === "settings" && n.kind === "system" ? "notifications" : undefined);
    },
    [go]
  );

  useEffect(() => {
    void refreshMeta().catch(() => {});
    void Promise.all([window.xaver.jobs.list(), window.xaver.jobs.liveItems()])
      .then(([jobs, items]) => {
        if (typeof jobs.generation === "number" && genRef.current != null && jobs.generation !== genRef.current) return;
        if (typeof jobs.generation === "number") genRef.current = jobs.generation;
        setLiveItems((prev) => mergeItems(items, prev));
      })
      .catch(() => {});

    const flush = () => {
      frame.current = null;
      const batch = pending.current;
      pending.current = [];
      setLiveItems((prev) => upsertItems(prev, batch));
    };

    const off = [
      window.xaver.jobs.onUpdated((p) => applyJobs(p as JobsSnapshot)),
      window.xaver.jobs.onProgress((p) => setProgress(p as JobProgress)),
      window.xaver.jobs.onItemsReset((p) => {
        const data = p as { generation?: number };
        if (typeof data.generation === "number") genRef.current = data.generation;
        dropPending();
        setLiveItems([]);
        setProgress(null);
      }),
      window.xaver.jobs.onItems((p) => {
        const data = p as { items: MediaItem[]; generation?: number };
        if (!sameGen(data.generation)) return;
        dropPending();
        setLiveItems(data.items || []);
      }),
      window.xaver.jobs.onItem((p) => {
        const data = p as { item: MediaItem; generation?: number };
        if (!sameGen(data.generation)) return;
        pending.current.push(data.item);
        if (frame.current == null) frame.current = requestAnimationFrame(flush);
      }),
      window.xaver.jobs.onDone((p) => {
        const data = p as { job?: JobRecord };
        if (data.job?.status === "cancelled") toast({ tone: "info", title: "Cancelled", ttl: 3000 });
        setProgress(null);
        setDbRefresh((n) => n + 1);
        void refreshMeta().catch(() => {});
        const gen = genRef.current;
        void window.xaver.jobs.liveItems().then((items) => {
          if (gen !== genRef.current) return;
          dropPending();
          setLiveItems(items);
        });
      }),
      window.xaver.notices.onChanged(setFeed),
      window.xaver.notices.onAdded((n) => {
        if (n.tone === "error" || n.tone === "warn") lastFailure.current = Date.now();
        if (!document.hasFocus()) return;
        toast({
          tone: n.tone,
          title: n.title,
          body: n.body,
          action: n.target && n.target !== viewRef.current ? { label: "View", run: () => openNotice(n) } : undefined
        });
      }),
      window.xaver.notices.onOpen((p) => openNotice({ id: p.id, target: p.target, kind: "system", read: true }))
    ];

    const trackUpdate = (s: { status: string }) => setUpdateReady(s.status === "available" || s.status === "ready");
    off.push(window.xaver.updates.onChanged(trackUpdate));
    void window.xaver.updates.state().then(trackUpdate).catch(() => {});
    void window.xaver.notices.list().then(setFeed).catch(() => {});
    void window.xaver.notices
      .takeOpen()
      .then((p) => p && openNotice({ id: p.id, target: p.target, kind: "system", read: true }))
      .catch(() => {});

    return () => {
      off.forEach((fn) => fn());
      dropPending();
    };
  }, [refreshMeta, applyJobs, openNotice]);

  useEffect(() => {
    if (config?.autoCheckAuthOnLaunch && auth?.authenticated && !auth.screenName) {
      void window.xaver.auth.refresh().then(setAuth).catch(() => {});
    }
  }, [config?.autoCheckAuthOnLaunch, auth?.authenticated, auth?.screenName]);

  const activeJob = useMemo(() => {
    if (activeJobId) return queue.find((j) => j.id === activeJobId) || history.find((j) => j.id === activeJobId) || null;
    return queue.find((j) => ACTIVE.includes(j.status)) || null;
  }, [queue, history, activeJobId]);

  const lastScan = useMemo(() => history.find((j) => Array.isArray(j.sources)) || null, [history]);

  const patchConfig = async (patch: Partial<AppConfig>) => {
    const next = await window.xaver.config.set(patch);
    setConfig(next);
    onConfig(next);
    return next;
  };

  const fail = (title: string, e: unknown) => {
    if (Date.now() - lastFailure.current < 3000) return;
    toast({ tone: "error", title, body: errorText(e) });
  };

  const meta = VIEW_TITLES[view];
  const density = config?.themeDensity === "compact" ? "compact" : "";
  const lockable = Boolean(security?.pinSet);

  return (
    <div className={`app ${density}`}>
      <Sidebar
        view={view}
        onNavigate={(v) => go(v)}
        auth={auth}
        activeJob={activeJob}
        onLock={lockable ? () => void window.xaver.security.lock() : undefined}
        shielded={Boolean(security?.hideFromCapture)}
        unread={feed.unread}
        updateReady={updateReady}
        bellOpen={bellOpen}
        onBell={() => setBellOpen((o) => !o)}
      />
      {bellOpen ? (
        <NotificationCenter
          feed={feed}
          onClose={() => setBellOpen(false)}
          onOpen={openNotice}
          onSettings={() => {
            setBellOpen(false);
            go("settings", "notifications");
          }}
        />
      ) : null}
      <div className="main">
        <div className="content view-enter" key={view}>
          {view !== "run" ? (
            <div className="page-head">
              <h1>{meta.title}</h1>
              {meta.sub ? <p>{meta.sub}</p> : null}
            </div>
          ) : null}
          {view === "run" && config && (
            <RunView
              config={config}
              auth={auth}
              progress={progress}
              activeJob={activeJob}
              items={liveItems}
              hiddenCount={lastScan?.status === "ready" ? lastScan.hidden || 0 : 0}
              downloading={downloading}
              scanning={scanning}
              onStart={async (target, sources) => {
                dropPending();
                setLiveItems([]);
                setProgress(null);
                try {
                  await window.xaver.jobs.start(target, { sources });
                } catch (e) {
                  fail("Couldn't start the scan", e);
                }
              }}
              onCancel={() => window.xaver.jobs.cancel()}
              onGotoAccount={() => go("account")}
              onDownload={async (urls) => {
                try {
                  if (urls?.length) await window.xaver.jobs.download(urls);
                  else await window.xaver.jobs.downloadAll();
                } catch (e) {
                  fail("Download failed", e);
                  throw e;
                } finally {
                  void refreshMeta().catch(() => {});
                }
              }}
            />
          )}
          {view === "library" && <LibraryView liveItems={liveItems} />}
          {view === "database" && <DatabaseView refreshKey={dbRefresh} />}
          {view === "jobs" && (
            <JobsView
              queue={queue}
              history={history}
              activeJobId={activeJobId}
              onCancel={(id) => window.xaver.jobs.cancel(id)}
              onOpen={(p) => window.xaver.library.openPath(p).catch((e) => fail("Couldn't open that", e))}
            />
          )}
          {view === "settings" && config && (
            <SettingsView
              key={settingsCat || "default"}
              config={config}
              onChange={patchConfig}
              security={security}
              onSecurity={onSecurity}
              onRerunSetup={() => onAppearanceChange({ setupComplete: false })}
              appearance={appearance}
              onAppearance={onAppearanceChange}
              initialCat={settingsCat}
            />
          )}
          {view === "about" && config && <AboutView config={config} onChange={patchConfig} />}
          {view === "account" && <AccountView auth={auth} busy={busyAuth} setBusy={setBusyAuth} onAuth={setAuth} />}
        </div>
        {view === "run" || view === "jobs" ? (
          <JobInspector job={activeJob} progress={progress} found={liveItems.length} />
        ) : null}
      </div>
    </div>
  );
}
