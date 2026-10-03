import type { ReactNode } from "react";

export function Toggle({
  on,
  onChange,
  disabled
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

export function Row({
  title,
  hint,
  children
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="title">{title}</div>
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
