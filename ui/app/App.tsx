import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, Appearance, SecurityStatus } from "../../electron/shared/types";
import { ToastHost } from "../components/notifications/ToastHost";
import { LockScreen } from "../components/security/LockScreen";
import { PrivacyVeil } from "../components/security/PrivacyVeil";
import { SetupWizard } from "../components/setup/SetupWizard";
import { applyAppearance, currentAppearance } from "../lib/appearance";
import type { ViewId } from "./views";
import { Workspace } from "./Workspace";

const APPEARANCE_KEYS: (keyof Appearance)[] = ["theme", "accent", "motion", "cornerStyle", "uiScale", "themeDensity", "setupComplete"];

function pickAppearance(c: Partial<AppConfig>): Partial<Appearance> {
  const out: Partial<Appearance> = {};
  for (const k of APPEARANCE_KEYS) {
    if (k in c) (out as Record<string, unknown>)[k] = c[k];
  }
  return out;
}

export function App() {
  const [view, setView] = useState<ViewId>("run");
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [lockShown, setLockShown] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(currentAppearance());
  const [ready, setReady] = useState(false);
  const lastPing = useRef(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.xaver.security.status(), window.xaver.appearance.get()])
      .then(([sec, look]) => {
        if (!alive) return;
        setAppearance(applyAppearance(look));
        setSecurity(sec);
        if (sec.locked) setLockShown(true);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    const off = window.xaver.security.onChanged((s) => {
      setSecurity(s);
      if (s.locked) setLockShown(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const locked = Boolean(security?.locked);
  const pinSet = Boolean(security?.pinSet);

  useEffect(() => {
    if (locked) return;
    const ping = () => {
      const now = Date.now();
      if (now - lastPing.current < 15_000) return;
      lastPing.current = now;
      void window.xaver.security.activity().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      ping();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "l" && pinSet) {
        e.preventDefault();
        void window.xaver.security.lock();
      }
    };
    window.addEventListener("pointermove", ping, { passive: true });
    window.addEventListener("pointerdown", ping, { passive: true });
    window.addEventListener("wheel", ping, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", ping);
      window.removeEventListener("pointerdown", ping);
      window.removeEventListener("wheel", ping);
      window.removeEventListener("keydown", onKey);
    };
  }, [locked, pinSet]);

  const changeAppearance = useCallback((patch: Partial<Appearance>) => {
    setAppearance(applyAppearance(patch));
    void window.xaver.config.set(patch).catch(() => {});
  }, []);

  const onConfig = useCallback((c: Partial<AppConfig>) => setAppearance(applyAppearance(pickAppearance(c))), []);
  const onLockGone = useCallback(() => setLockShown(false), []);

  if (!ready) return null;

  return (
    <>
      {!locked ? (
        <Workspace
          view={view}
          setView={setView}
          security={security}
          onSecurity={setSecurity}
          onConfig={onConfig}
          appearance={appearance}
          onAppearanceChange={changeAppearance}
        />
      ) : null}
      {!locked && !appearance.setupComplete && !lockShown ? (
        <SetupWizard
          appearance={appearance}
          onAppearance={changeAppearance}
          security={security}
          onSecurity={setSecurity}
          onFinish={() => changeAppearance({ setupComplete: true })}
        />
      ) : null}
      {!locked && security?.blurWhenInactive ? <PrivacyVeil /> : null}
      {!locked ? <ToastHost /> : null}
      {lockShown && security ? <LockScreen status={security} unlocked={!locked} onGone={onLockGone} /> : null}
    </>
  );
}
