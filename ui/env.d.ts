import type { XaverApi } from "../electron/preload";

declare global {
  const __APP_VERSION__: string;
  interface Window {
    xaver: XaverApi;
  }
}

export {};
