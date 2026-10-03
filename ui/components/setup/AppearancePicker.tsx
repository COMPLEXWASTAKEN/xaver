import type { Appearance } from "../../../electron/shared/types";
import { ACCENTS, CORNERS, MOTIONS, THEMES } from "../../lib/appearance";

export function AppearancePicker({
  value,
  onChange,
  compact
}: {
  value: Appearance;
  onChange: (patch: Partial<Appearance>) => void;
  compact?: boolean;
}) {
  const isPreset = ACCENTS.some((a) => a.id.toLowerCase() === value.accent.toLowerCase());

  return (
    <div className="stagger">
      <div className="setup-section">
        <div className="setup-label">Theme</div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-card ${value.theme === t.id ? "on" : ""}`}
              onClick={() => onChange({ theme: t.id })}
            >
              <span
                className="theme-preview"
                style={{
                  background:
                    t.id === "system"
                      ? `linear-gradient(115deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)`
                      : t.swatch[0]
                }}
              >
                <i style={{ background: t.id === "system" ? "rgba(128,128,128,.35)" : t.swatch[1] }} />
                <span className="tp-main">
                  <i style={{ background: value.accent }} />
                  <i style={{ background: t.id === "system" ? "rgba(128,128,128,.25)" : t.swatch[1], opacity: 0.9 }} />
                </span>
              </span>
              <strong>{t.label}</strong>
              {compact ? null : <small>{t.hint}</small>}
            </button>
          ))}
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-label">Accent colour</div>
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              className={`swatch ${value.accent.toLowerCase() === a.id.toLowerCase() ? "on" : ""}`}
              style={{ background: a.id }}
              onClick={() => onChange({ accent: a.id })}
            />
          ))}
          <label className={`swatch swatch-custom ${isPreset ? "" : "on"}`} title="Custom colour">
            <input type="color" value={value.accent} onChange={(e) => onChange({ accent: e.target.value })} />
          </label>
          <span className="muted mono">{value.accent.toUpperCase()}</span>
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-label">Animations</div>
        <div className="choice-row">
          {MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`choice ${value.motion === m.id ? "on" : ""}`}
              onClick={() => onChange({ motion: m.id })}
            >
              <strong>{m.label}</strong>
              <small>{m.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-label">Shape & spacing</div>
        <div className="choice-row">
          {CORNERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`choice ${value.cornerStyle === c.id ? "on" : ""}`}
              onClick={() => onChange({ cornerStyle: c.id })}
            >
              <strong>{c.label}</strong>
              <small>{c.id === "sharp" ? "Crisp edges" : c.id === "rounded" ? "Balanced" : "Pill buttons"}</small>
            </button>
          ))}
          <button
            type="button"
            className={`choice ${value.themeDensity === "comfortable" ? "on" : ""}`}
            onClick={() => onChange({ themeDensity: "comfortable" })}
          >
            <strong>Comfortable</strong>
            <small>Roomy layout</small>
          </button>
          <button
            type="button"
            className={`choice ${value.themeDensity === "compact" ? "on" : ""}`}
            onClick={() => onChange({ themeDensity: "compact" })}
          >
            <strong>Compact</strong>
            <small>Fit more on screen</small>
          </button>
        </div>
      </div>

      <div className="setup-section">
        <div className="setup-label">Interface size</div>
        <div className="scale-row">
          <span className="muted">A</span>
          <input
            type="range"
            min={85}
            max={130}
            step={5}
            value={value.uiScale}
            onChange={(e) => onChange({ uiScale: Number(e.target.value) })}
          />
          <span style={{ fontSize: 18 }}>A</span>
          <span className="mono muted" style={{ width: 44, textAlign: "right" }}>
            {value.uiScale}%
          </span>
          {value.uiScale !== 100 ? (
            <button type="button" className="btn ghost sm" onClick={() => onChange({ uiScale: 100 })}>
              Reset
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
