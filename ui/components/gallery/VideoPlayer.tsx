import { useEffect, useRef, useState } from "react";

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({
  src,
  poster,
  title
}: {
  src: string;
  poster?: string;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [rate, setRate] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [chrome, setChrome] = useState(true);
  const [fs, setFs] = useState(false);
  const [error, setError] = useState("");

  const bumpChrome = () => {
    setChrome(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setChrome(false);
    }, 2200);
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
    v.playbackRate = rate;
  }, [volume, muted, rate]);

  useEffect(() => {
    setWaiting(true);
    setError("");
    setCurrent(0);
    setDuration(0);
    setBuffered(0);
    setPlaying(false);
  }, [src]);

  useEffect(() => {
    const onFs = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
    bumpChrome();
  };

  const seekTo = (ratio: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    v.currentTime = Math.min(v.duration, Math.max(0, ratio * v.duration));
  };

  const toggleFs = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {}
    bumpChrome();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const v = videoRef.current;
      if (!v) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight" && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      } else if (e.key === "ArrowLeft" && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (e.key === "m") {
        setMuted((m) => !m);
      } else if (e.key === "f") {
        void toggleFs();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setVolume((x) => Math.min(1, x + 0.05));
        setMuted(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setVolume((x) => Math.max(0, x - 0.05));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={`vp ${chrome || !playing ? "vp-chrome" : "vp-dim"} ${fs ? "vp-fs" : ""}`}
      onMouseMove={bumpChrome}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".vp-bar")) return;
        togglePlay();
      }}
    >
      <video
        ref={videoRef}
        className="vp-video"
        src={src}
        poster={poster}
        playsInline
        autoPlay
        preload="auto"
        onPlay={() => {
          setPlaying(true);
          bumpChrome();
        }}
        onPause={() => {
          setPlaying(false);
          setChrome(true);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          setCurrent(v.currentTime);
          if (v.buffered.length) {
            try {
              setBuffered(v.buffered.end(v.buffered.length - 1));
            } catch {}
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (!v) return;
          setDuration(v.duration || 0);
          setWaiting(false);
          void v.play().catch(() => {});
        }}
        onError={() => setError("Playback failed")}
      />

      {waiting && !error ? <div className="vp-wait" aria-hidden /> : null}
      {error ? <div className="vp-error">{error}</div> : null}

      {!playing && !waiting && !error ? (
        <button
          type="button"
          className="vp-bigplay"
          aria-label="Play"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
        />
      ) : null}

      <div className="vp-bar" onClick={(e) => e.stopPropagation()}>
        <div className="vp-scrub">
          <div className="vp-buf" style={{ width: `${bufPct}%` }} />
          <div className="vp-fill" style={{ width: `${progress}%` }} />
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 10)}
            onChange={(e) => seekTo(Number(e.target.value) / 1000)}
            aria-label="Seek"
          />
        </div>
        <div className="vp-row">
          <button type="button" className="vp-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            <span className={playing ? "ico-pause" : "ico-play"} />
          </button>
          <button
            type="button"
            className="vp-btn"
            onClick={() => {
              setMuted((m) => !m);
              bumpChrome();
            }}
            aria-label="Mute"
          >
            <span className={muted || volume === 0 ? "ico-mute" : "ico-vol"} />
          </button>
          <input
            className="vp-vol"
            type="range"
            min={0}
            max={100}
            value={Math.round((muted ? 0 : volume) * 100)}
            onChange={(e) => {
              const n = Number(e.target.value) / 100;
              setVolume(n);
              setMuted(n === 0);
            }}
            aria-label="Volume"
          />
          <span className="vp-time mono">
            {fmt(current)}
            <span className="vp-sep">/</span>
            {fmt(duration)}
          </span>
          <span className="vp-spacer" />
          {title ? <span className="vp-title muted">{title}</span> : null}
          <select
            className="vp-rate"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-label="Speed"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
          <button type="button" className="vp-btn" onClick={() => void toggleFs()} aria-label="Fullscreen">
            <span className={fs ? "ico-fs-exit" : "ico-fs"} />
          </button>
        </div>
      </div>
    </div>
  );
}
