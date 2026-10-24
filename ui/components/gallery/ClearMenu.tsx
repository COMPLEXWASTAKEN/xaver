import { useEffect, useRef, useState } from "react";

export type ClearChoice = "all" | "saved" | "selected";

export function ClearMenu({
  total,
  saved,
  selected,
  disabled,
  onClear
}: {
  total: number;
  saved: number;
  selected: number;
  disabled?: boolean;
  onClear: (mode: ClearChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unsaved = total - saved;

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  useEffect(() => {
    if (disabled || !total) setOpen(false);
  }, [disabled, total]);

  const pick = (mode: ClearChoice) => {
    if (mode === "all" && unsaved > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setOpen(false);
    onClear(mode);
  };

  return (
    <div className="clear-menu" ref={box}>
      <button
        type="button"
        className={`btn sm ${open ? "active" : ""}`}
        disabled={disabled || !total}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Remove media from this gallery"
      >
        Clear <span className="clear-caret">▾</span>
      </button>
      {open ? (
        <div className="clear-pop" role="menu">
          <div className="clear-head">
            <strong>Clear the gallery</strong>
            <span className="muted">Only removes it from this list. Saved files stay on disk.</span>
          </div>
          <button type="button" role="menuitem" className="clear-item" disabled={!saved} onClick={() => pick("saved")}>
            <span>
              <strong>Remove saved</strong>
              <span className="muted">Already downloaded</span>
            </span>
            <span className="clear-count">{saved}</span>
          </button>
          <button type="button" role="menuitem" className="clear-item" disabled={!selected} onClick={() => pick("selected")}>
            <span>
              <strong>Remove selected</strong>
              <span className="muted">The ones you picked</span>
            </span>
            <span className="clear-count">{selected}</span>
          </button>
          <button type="button" role="menuitem" className={`clear-item danger ${confirming ? "confirm" : ""}`} onClick={() => pick("all")}>
            <span>
              <strong>{confirming ? "Click again to clear" : "Clear everything"}</strong>
              <span className="muted">
                {confirming ? `${unsaved} haven't been downloaded yet` : "Start fresh with an empty gallery"}
              </span>
            </span>
            <span className="clear-count">{total}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
