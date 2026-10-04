

export type ThemeDensity = "compact" | "comfortable";
export type ThemeName = "charcoal" | "midnight" | "slate" | "light" | "system";
export type MotionLevel = "system" | "full" | "reduced" | "off";
export type CornerStyle = "sharp" | "rounded" | "round";

export type AppConfig = {
  outputRoot: string;
  defaultZip: boolean;
  openFolderOnComplete: boolean;
  notifyDesktop: boolean;
  notifyWhenAway: boolean;
  notifySound: boolean;
  notifyPrivate: boolean;
  notifyScans: boolean;
  notifyDownloads: boolean;
  notifyFailures: boolean;
  notifyQuiet: boolean;
  notifyQuietFrom: number;
  notifyQuietTo: number;
  autoUpdateCheck: boolean;
  themeDensity: ThemeDensity;
  theme: ThemeName;
  accent: string;
  motion: MotionLevel;
  cornerStyle: CornerStyle;
  uiScale: number;
  setupComplete: boolean;
  maxScrolls: number;
  scrollDelayMs: number;
  maxIdleRounds: number;
  headless: boolean;
  viewportWidth: number;
  viewportHeight: number;
  userAgent: string;
  
  overrideUserAgent: boolean;
  downloadConcurrency: number;
  includePhotos: boolean;
  includeVideos: boolean;
  includeGifs: boolean;
  skipHls: boolean;
  sha256Dedupe: boolean;
  hideDownloaded: boolean;
  filenamePattern: string;
  cookiePathOverride: string;
  autoCheckAuthOnLaunch: boolean;
  playwrightArgs: string;
  proxyUrl: string;
  requestTimeoutMs: number;
  retryCount: number;
  logLevel: "silent" | "info" | "debug";
  chromiumChannel: string;
  
  shardxCacheDir: string;
  shardxTemplate: string;
  shardxProfileId: string;
  shardxHumanize: boolean;
  shardxWebrtc: "auto" | "block" | "tcp_only";
  shardxTimezone: string;
};

export const DEFAULT_CONFIG: AppConfig = {
  outputRoot: "",
  defaultZip: true,
  openFolderOnComplete: true,
  notifyDesktop: true,
  notifyWhenAway: true,
  notifySound: true,
  notifyPrivate: false,
  notifyScans: true,
  notifyDownloads: true,
  notifyFailures: true,
  notifyQuiet: false,
  notifyQuietFrom: 22,
  notifyQuietTo: 7,
  autoUpdateCheck: true,
  themeDensity: "comfortable",
  theme: "charcoal",
  accent: "#ff5a3c",
  motion: "system",
  cornerStyle: "rounded",
  uiScale: 100,
  setupComplete: false,
  maxScrolls: 800,
  scrollDelayMs: 1200,
  maxIdleRounds: 45,
  headless: false,
  viewportWidth: 1280,
  viewportHeight: 900,
  userAgent: "",
  overrideUserAgent: false,
  downloadConcurrency: 4,
  includePhotos: true,
  includeVideos: true,
  includeGifs: true,
  skipHls: true,
  sha256Dedupe: true,
  hideDownloaded: true,
  filenamePattern: "{kind}_{hash16}",
  cookiePathOverride: "",
  autoCheckAuthOnLaunch: true,
  playwrightArgs: "",
  proxyUrl: "",
  requestTimeoutMs: 120000,
  retryCount: 2,
  logLevel: "info",
  chromiumChannel: "",
  shardxCacheDir: "",
  shardxTemplate: "win-rtx4060",
  shardxProfileId: "",
  shardxHumanize: true,
  shardxWebrtc: "auto",
  shardxTimezone: ""
};

export type AuthStatus = {
  authenticated: boolean;
  screenName: string | null;
  cookieCount: number;
  hasAuthToken: boolean;
  hasCt0: boolean;
  updatedAt: string | null;
  source: "none" | "file" | "paste" | "browser";
};

export type JobStatus =
  | "queued"
  | "running"
  | "scraping"
  | "ready"
  | "downloading"
  | "zipping"
  | "done"
  | "failed"
  | "cancelled";

export type MediaItem = {
  url: string;
  kind: "image" | "video";
  gif?: boolean;
  thumb?: string;
  localPath?: string;
  rel?: string;
  sha256?: string;
  id?: string;
};

export type ScanSource = "media" | "posts" | "reposts" | "replies" | "likes" | "highlights";

export type JobRecord = {
  id: string;
  target: string;
  profilePath?: string;
  sources?: ScanSource[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  mediaCount: number;
  saved: number;
  skipped: number;
  errors: number;
  hidden?: number;
  runDir?: string;
  zipPath?: string | null;
  errorMessage?: string;
  logs: string[];
};

export type JobProgress = {
  jobId: string;
  phase: string;
  message: string;
  scroll?: number;
  maxScrolls?: number;
  mediaCount?: number;
  downloadDone?: number;
  downloadTotal?: number;
  saved?: number;
  skipped?: number;
  failed?: number;
};

export type DbFileRow = {
  sha256: string;
  path: string;
  bytes: number;
  kind: "image" | "video" | "gif";
  profile: string | null;
  origin: "download" | "disk" | "legacy";
  created_at: number;
  missing: number;
};

export type DbSearchRow = DbFileRow;

export type DbRunRow = {
  id: number;
  profile: string | null;
  run_dir: string | null;
  started_at: number;
  finished_at: number | null;
  status: string;
  requested: number;
  saved: number;
  skipped: number;
  failed: number;
  bytes: number;
};

export type LegacyIndexStatus = {
  path: string;
  files: number;
  keys: number;
  readable: boolean;
  importedAt: number | null;
};

export type MigrateResult = {
  files: number;
  keys: number;
  skipped: number;
  archivedTo: string | null;
};

export type DbOverview = {
  path: string;
  sizeOnDisk: number;
  schemaVersion: number;
  createdAt: number | null;
  lastSavedAt: number | null;
  lastVerifyAt: number | null;
  lastRescanAt: number | null;
  recoveredFrom: string | null;
  totals: {
    files: number;
    bytes: number;
    missing: number;
    images: number;
    videos: number;
    gifs: number;
    keys: number;
    runs: number;
  };
  origins: { origin: string; n: number }[];
  topProfiles: { profile: string; files: number; bytes: number; last_at: number }[];
  recentFiles: DbFileRow[];
  recentRuns: DbRunRow[];
  imports: { source: string; imported_at: number; files: number; keys: number; skipped: number }[];
  encrypted: boolean;
  legacy: LegacyIndexStatus | null;
};

export type Appearance = Pick<
  AppConfig,
  "theme" | "accent" | "motion" | "cornerStyle" | "uiScale" | "themeDensity" | "setupComplete"
>;

export type SecurityPrefs = {
  lockOnLaunch: boolean;
  idleMinutes: number;
  lockOnSystemLock: boolean;
  lockOnMinimize: boolean;
  hello: boolean;
  hideFromCapture: boolean;
  blurWhenInactive: boolean;
  panicKey: string;
};

export const PANIC_KEYS = ["Control+Shift+F12", "Control+Alt+Space", "Alt+Shift+Z"];

export type CaptureSupport = "full" | "black" | "none";

export type LockReason = "launch" | "manual" | "idle" | "system" | "minimize" | "panic";

export type SecurityStatus = SecurityPrefs & {
  locked: boolean;
  lockReason: LockReason | null;
  panicActive: boolean;
  captureSupport: CaptureSupport;
  pinSet: boolean;
  pinLength: number;
  helloAvailable: boolean;
  encryptDatabase: boolean;
  encryptionAvailable: boolean;
  lockoutMs: number;
  failedAttempts: number;
};

export type UnlockResult = {
  ok: boolean;
  reason?: "wrong" | "invalid" | "lockout" | "unavailable" | "cancelled" | "hello-failed";
  attemptsLeft?: number;
  lockoutMs?: number;
  detail?: string;
};

export type NoticeKind = "scan" | "download" | "failure" | "session" | "database" | "system";

export type NoticeTone = "ok" | "info" | "warn" | "error";

export type NoticeTarget = "run" | "library" | "database" | "jobs" | "settings" | "account" | "about";

export type Notice = {
  id: string;
  kind: NoticeKind;
  tone: NoticeTone;
  title: string;
  body: string;
  at: number;
  read: boolean;
  target?: NoticeTarget;
  path?: string;
};

export type NoticeInput = Omit<Notice, "id" | "at" | "read">;

export type NoticeFeed = {
  items: Notice[];
  unread: number;
};

export type AppInfo = {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  os: string;
  arch: string;
  packaged: boolean;
  installDir: string;
  dataDir: string;
  releasesUrl: string;
  issuesUrl: string;
};

export type UpdateRelease = {
  version: string;
  name: string;
  publishedAt: string;
  notes: string;
  url: string;
  asset: { name: string; size: number } | null;
};

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "unavailable"
  | "error"
  | "downloading"
  | "ready"
  | "installing";

export type UpdateState = {
  status: UpdateStatus;
  checkedAt: number;
  release: UpdateRelease | null;
  received: number;
  total: number;
  error: string | null;
};
