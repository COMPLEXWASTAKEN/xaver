import { useState } from "react";
import type { Appearance, SecurityStatus } from "../../../electron/shared/types";
import logoUrl from "../../assets/logo.png";
import { AppearancePicker } from "./AppearancePicker";
import { SecurityPanel } from "../security/SecurityPanel";

const STEPS = ["Welcome", "Look & feel", "Security", "Ready"] as const;

export function SetupWizard({
  appearance,
  onAppearance,
  security,
  onSecurity,
  onFinish
}: {
  appearance: Appearance;
  onAppearance: (patch: Partial<Appearance>) => void;
  security: SecurityStatus | null;
  onSecurity: (s: SecurityStatus) => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [finishing, setFinishing] = useState(false);

  const go = (n: number) => {
    setDir(n > step ? "fwd" : "back");
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  };

  const finish = () => {
    if (finishing) return;
    setFinishing(true);
    onFinish();
  };

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-label="Set up Xaver">
      <div className="setup-card">
        <div className="setup-progress">
          <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="setup-body">
          <div key={step} className={`setup-step ${dir}`}>
            {step === 0 ? (
              <div className="setup-hero">
                <img src={logoUrl} alt="" />
                <div className="setup-kicker">Welcome</div>
                <h2 className="setup-title">Let's make it yours</h2>
                <p className="setup-lead">
                  Pick a look, then decide how locked-down you want things. You can change any of this later in Settings.
                </p>
                <div className="setup-feats stagger">
                  <div className="setup-feat">
                    <strong>Your style</strong>
                    <span className="muted">Five themes, any accent colour, and animation as lively or calm as you like.</span>
                  </div>
                  <div className="setup-feat">
                    <strong>Private by default</strong>
                    <span className="muted">Your login, settings and history are encrypted with your Windows account.</span>
                  </div>
                  <div className="setup-feat">
                    <strong>Lock it</strong>
                    <span className="muted">Protect the app with a PIN or Windows Hello, with auto-lock when you step away.</span>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <>
                <div className="setup-kicker">Step 1 of 2</div>
                <h2 className="setup-title">Look & feel</h2>
                <p className="setup-lead">Changes apply instantly so you can see them as you go.</p>
                <AppearancePicker value={appearance} onChange={onAppearance} />
              </>
            ) : null}

            {step === 2 ? (
              <>
                <div className="setup-kicker">Step 2 of 2</div>
                <h2 className="setup-title">Security</h2>
                <p className="setup-lead">
                  A PIN keeps anyone using this PC out of your library. Skip it if you're the only one here.
                </p>
                {security ? (
                  <SecurityPanel status={security} onStatus={onSecurity} variant="setup" />
                ) : (
                  <div className="skeleton" style={{ height: 180 }} />
                )}
              </>
            ) : null}

            {step === 3 ? (
              <div className="setup-hero">
                <img src={logoUrl} alt="" />
                <div className="setup-kicker">All set</div>
                <h2 className="setup-title">You're ready to go</h2>
                <p className="setup-lead">
                  {security?.pinSet
                    ? `Locked with a PIN${security.hello ? " and Windows Hello" : ""}. Press Ctrl + L any time to lock.`
                    : "No PIN for now. You can add one later in Settings → Security."}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="setup-foot">
          <div className="setup-dots" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className={i === step ? "on" : ""} />
            ))}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {STEPS[step]}
          </span>
          <span className="gb-spacer" />
          {step > 0 && step < STEPS.length - 1 ? (
            <button type="button" className="btn ghost sm" onClick={() => go(step - 1)}>
              Back
            </button>
          ) : null}
          {step === 0 ? (
            <button type="button" className="btn ghost sm" onClick={finish}>
              Skip setup
            </button>
          ) : null}
          {step === 2 && !security?.pinSet ? (
            <button type="button" className="btn sm" onClick={() => go(3)}>
              Skip for now
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn primary sm"
              disabled={step === 2 && !security?.pinSet}
              onClick={() => go(step + 1)}
            >
              {step === 0 ? "Get started" : "Continue"}
            </button>
          ) : (
            <button type="button" className="btn primary sm" disabled={finishing} onClick={finish}>
              Open the app
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
