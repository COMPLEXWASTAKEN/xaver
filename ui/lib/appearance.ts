import type { Appearance, CornerStyle, MotionLevel, ThemeName } from "../../electron/shared/types";

const CACHE_KEY = "xaver.appearance";
const LEGACY_CACHE_KEY = "pms.appearance";

export const THEMES: { id: ThemeName; label: string; hint: string; swatch: [string, string, string] }[] = [
  { id: "charcoal", label: "Charcoal", hint: "Warm dark, the classic look", swatch: ["#080706", "#181512", "#f4efe6"] },
  { id: "midnight", label: "Midnight", hint: "True black, easy on OLED", swatch: ["#000000", "#0d0d0f", "#ededf0"] },
  { id: "slate", label: "Slate", hint: "Cool blue-grey dark", swatch: ["#0b0f14", "#161c24", "#e6edf5"] },
  { id: "light", label: "Daylight", hint: "Bright and paper-soft", swatch: ["#f4f1ec", "#ffffff", "#1b1714"] },
  { id: "system", label: "Match Windows", hint: "Follows your system setting", swatch: ["#080706", "#f4f1ec", "#ff5a3c"] }
];

export const ACCENTS: { id: string; label: string }[] = [
  { id: "#ff5a3c", label: "Ember" },
  { id: "#ff3d7f", label: "Rose" },
  { id: "#a855f7", label: "Violet" },
  { id: "#4f7cff", label: "Cobalt" },
  { id: "#14b8c4", label: "Lagoon" },
  { id: "#22c55e", label: "Fern" },
  { id: "#f5b301", label: "Gold" },
  { id: "#e2e8f0", label: "Silver" }
];

export const MOTIONS: { id: MotionLevel; label: string; hint: string }[] = [
  { id: "system", label: "Match Windows", hint: "Respects the Windows animation setting" },
  { id: "full", label: "Full", hint: "Every transition and flourish" },
  { id: "reduced", label: "Subtle", hint: "Gentle fades, no movement" },
  { id: "off", label: "Off", hint: "Instant, no animation" }
];

export const CORNERS: { id: CornerStyle; label: string }[] = [
  { id: "sharp", label: "Sharp" },
  { id: "rounded", label: "Rounded" },
  { id: "round", label: "Soft" }
];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "charcoal",
  accent: "#ff5a3c",
  motion: "system",
  cornerStyle: "rounded",
  uiScale: 100,
  themeDensity: "comfortable",
  setupComplete: false
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const darkQuery = () => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return null;
  }
};

const motionQuery = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    return null;
  }
};

export function resolveTheme(theme: ThemeName): Exclude<ThemeName, "system"> {
  if (theme !== "system") return theme;
  return darkQuery()?.matches === false ? "light" : "charcoal";
}

export function resolveMotion(motion: MotionLevel): Exclude<MotionLevel, "system"> {
  if (motion !== "system") return motion;
  return motionQuery()?.matches ? "reduced" : "full";
}

let current: Appearance = DEFAULT_APPEARANCE;
let watching = false;

export function applyAppearance(a: Partial<Appearance>): Appearance {
  current = { ...DEFAULT_APPEARANCE, ...current, ...a };
  const root = document.documentElement;
  const theme = resolveTheme(current.theme);
  root.dataset.theme = theme;
  root.dataset.motion = resolveMotion(current.motion);
  root.dataset.corners = current.cornerStyle;
  root.dataset.density = current.themeDensity;

  const rgb = hexToRgb(current.accent) || hexToRgb(DEFAULT_APPEARANCE.accent)!;
  const isLight = theme === "light";
  const soft = mix(rgb, isLight ? [0, 0, 0] : [255, 255, 255], isLight ? 0.35 : 0.62);
  const onAccent: [number, number, number] = luminance(rgb) > 0.45 ? [20, 16, 12] : [255, 255, 255];
  root.style.setProperty("--accent", `rgb(${rgb.join(",")})`);
  root.style.setProperty("--accent-rgb", rgb.join(", "));
  root.style.setProperty("--accent-2", `rgb(${soft.join(",")})`);
  root.style.setProperty("--on-accent", `rgb(${onAccent.join(",")})`);

  const scale = Math.max(85, Math.min(130, Number(current.uiScale) || 100));
  root.style.setProperty("zoom", String(scale / 100));

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {}

  if (!watching) {
    watching = true;
    darkQuery()?.addEventListener("change", () => applyAppearance({}));
    motionQuery()?.addEventListener("change", () => applyAppearance({}));
  }
  return current;
}

export function applyCachedAppearance(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY) ?? localStorage.getItem(LEGACY_CACHE_KEY);
    if (raw) {
      applyAppearance(JSON.parse(raw));
      return;
    }
  } catch {}
  applyAppearance(DEFAULT_APPEARANCE);
}

export function currentAppearance(): Appearance {
  return current;
}
