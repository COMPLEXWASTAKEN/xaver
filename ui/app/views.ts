export type ViewId = "run" | "library" | "database" | "jobs" | "settings" | "account";

export const VIEW_TITLES: Record<ViewId, { title: string; sub: string }> = {
  run: { title: "Scan", sub: "" },
  library: { title: "Library", sub: "Saved runs and live finds" },
  database: { title: "Database", sub: "Everything you've saved, indexed" },
  jobs: { title: "Jobs", sub: "Queue and history" },
  settings: { title: "Settings", sub: "Look, security, notifications and more" },
  account: { title: "Account", sub: "Session and cookies" }
};
