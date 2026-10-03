import { useEffect, useState } from "react";

export function PrivacyVeil() {
  const [away, setAway] = useState(() => !document.hasFocus());

  useEffect(() => {
    const blur = () => setAway(true);
    const focus = () => setAway(false);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    setAway(!document.hasFocus());
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, []);

  return (
    <div className={`privacy-veil ${away ? "on" : ""}`} aria-hidden={!away}>
      <div className="privacy-veil-card">
        <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3l18 18" />
          <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </svg>
        <strong>Hidden while you're away</strong>
        <span>Click anywhere to continue</span>
      </div>
    </div>
  );
}
