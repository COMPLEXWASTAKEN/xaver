import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type {
  Appearance,
  DbOverview,
  DbSearchRow,
  MigrateResult,
  Notice,
  NoticeFeed,
  NoticeTarget,
  SecurityPrefs,
  SecurityStatus,
  UnlockResult
} from "../shared/types";

type Unsub = () => void;

function on(channel: string, handler: (...args: unknown[]) => void): Unsub {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  app: {
    version: () => ipcRenderer.invoke("app:version") as Promise<string>
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("config:set", patch),
    reset: (keys: string[]) => ipcRenderer.invoke("config:reset", keys),
    defaults: () => ipcRenderer.invoke("config:defaults")
  },
  auth: {
    getStatus: () => ipcRenderer.invoke("auth:getStatus"),
    importText: (text: string) => ipcRenderer.invoke("auth:importText", text),
    importFile: () => ipcRenderer.invoke("auth:importFile"),
    loginBrowser: () => ipcRenderer.invoke("auth:loginBrowser"),
    refresh: () => ipcRenderer.invoke("auth:refresh"),
    clear: () => ipcRenderer.invoke("auth:clear"),
    clearProfile: () => ipcRenderer.invoke("auth:clearProfile"),
    ensureEngine: () => ipcRenderer.invoke("auth:ensureEngine"),
    profileDir: () => ipcRenderer.invoke("auth:profileDir"),
    onLoginWaiting: (cb: (payload: { message: string }) => void): Unsub =>
      on("auth:login-waiting", (p) => cb(p as { message: string }))
  },
  jobs: {
    list: () => ipcRenderer.invoke("jobs:list"),
    start: (target: string, opts?: { sources?: string[] }) =>
      ipcRenderer.invoke("jobs:start", target, opts),
    enqueue: (target: string, opts?: { sources?: string[] }) =>
      ipcRenderer.invoke("jobs:enqueue", target, opts),
    cancel: (jobId?: string) => ipcRenderer.invoke("jobs:cancel", jobId),
    liveItems: () => ipcRenderer.invoke("jobs:liveItems"),
    download: (urls?: string[]) => ipcRenderer.invoke("jobs:download", urls),
    downloadAll: () => ipcRenderer.invoke("jobs:downloadAll"),
    onProgress: (cb: (p: unknown) => void): Unsub => on("jobs:progress", cb),
    onItem: (cb: (p: unknown) => void): Unsub => on("jobs:item", cb),
    onItems: (cb: (p: unknown) => void): Unsub => on("jobs:items", cb),
    onItemsReset: (cb: (p: unknown) => void): Unsub => on("jobs:items-reset", cb),
    onDone: (cb: (p: unknown) => void): Unsub => on("jobs:done", cb),
    onUpdated: (cb: (p: unknown) => void): Unsub => on("jobs:updated", cb),
    onLog: (cb: (p: unknown) => void): Unsub => on("jobs:log", cb)
  },
  library: {
    listRuns: () => ipcRenderer.invoke("library:listRuns"),
    listItems: (runId: string) => ipcRenderer.invoke("library:listItems", runId),
    openPath: (p: string) => ipcRenderer.invoke("library:openPath", p),
    reveal: (p: string) => ipcRenderer.invoke("library:reveal", p)
  },
  appearance: {
    get: () => ipcRenderer.invoke("appearance:get") as Promise<Appearance>
  },
  security: {
    status: () => ipcRenderer.invoke("security:status") as Promise<SecurityStatus>,
    unlockPin: (pin: string) => ipcRenderer.invoke("security:unlockPin", pin) as Promise<UnlockResult>,
    unlockHello: () => ipcRenderer.invoke("security:unlockHello") as Promise<UnlockResult>,
    activity: () => ipcRenderer.invoke("security:activity") as Promise<boolean>,
    lock: () => ipcRenderer.invoke("security:lock") as Promise<boolean>,
    setPin: (current: string, next: string) =>
      ipcRenderer.invoke("security:setPin", current, next) as Promise<UnlockResult>,
    removePin: (current: string) => ipcRenderer.invoke("security:removePin", current) as Promise<UnlockResult>,
    setPrefs: (patch: Partial<SecurityPrefs>) =>
      ipcRenderer.invoke("security:setPrefs", patch) as Promise<SecurityStatus>,
    probeHello: () => ipcRenderer.invoke("security:probeHello") as Promise<boolean>,
    setEncryptDatabase: (on: boolean) =>
      ipcRenderer.invoke("security:setEncryptDatabase", on) as Promise<SecurityStatus>,
    onChanged: (cb: (s: SecurityStatus) => void): Unsub => on("security:changed", (p) => cb(p as SecurityStatus))
  },
  db: {
    overview: () => ipcRenderer.invoke("db:overview") as Promise<DbOverview>,
    search: (q: string) => ipcRenderer.invoke("db:search", q) as Promise<DbSearchRow[]>,
    migrate: () => ipcRenderer.invoke("db:migrate") as Promise<MigrateResult>,
    migrateFile: () => ipcRenderer.invoke("db:migrateFile") as Promise<MigrateResult | null>,
    verify: () => ipcRenderer.invoke("db:verify") as Promise<{ checked: number; missing: number }>,
    prune: () => ipcRenderer.invoke("db:prune") as Promise<{ removedFiles: number; removedKeys: number }>,
    rescan: () => ipcRenderer.invoke("db:rescan") as Promise<{ scanned: number; added: number }>,
    compact: () => ipcRenderer.invoke("db:compact") as Promise<{ ok: boolean }>,
    backup: () => ipcRenderer.invoke("db:backup") as Promise<string | null>,
    reveal: () => ipcRenderer.invoke("db:reveal") as Promise<void>
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
    pickCookieFile: () => ipcRenderer.invoke("dialog:pickCookieFile")
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url)
  },
  notices: {
    list: () => ipcRenderer.invoke("notices:list") as Promise<NoticeFeed>,
    markRead: (ids?: string[]) => ipcRenderer.invoke("notices:markRead", ids) as Promise<NoticeFeed>,
    remove: (id: string) => ipcRenderer.invoke("notices:remove", id) as Promise<NoticeFeed>,
    clear: () => ipcRenderer.invoke("notices:clear") as Promise<NoticeFeed>,
    test: () => ipcRenderer.invoke("notices:test") as Promise<Notice>,
    takeOpen: () => ipcRenderer.invoke("notices:takeOpen") as Promise<{ id: string; target?: NoticeTarget } | null>,
    onAdded: (cb: (n: Notice) => void): Unsub => on("notices:added", (p) => cb(p as Notice)),
    onChanged: (cb: (f: NoticeFeed) => void): Unsub => on("notices:changed", (p) => cb(p as NoticeFeed)),
    onOpen: (cb: (p: { id: string; target?: NoticeTarget }) => void): Unsub =>
      on("notices:open", (p) => cb(p as { id: string; target?: NoticeTarget }))
  },
  media: {
    stagePreview: (url: string) =>
      ipcRenderer.invoke("media:stagePreview", url) as Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >
  }
};

contextBridge.exposeInMainWorld("xaver", api);

export type XaverApi = typeof api;
