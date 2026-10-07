import { useEffect, useState } from "react";
import type { AppConfig, FolderLayout } from "../../../electron/shared/types";
import { Row, Toggle } from "../common/controls";

const LAYOUTS: { id: FolderLayout; title: string; hint: string }[] = [
  { id: "run", title: "New folder each time", hint: "One dated folder per download" },
  { id: "profile", title: "One folder per profile", hint: "Same folder every time for each account" },
  { id: "single", title: "Everything in one folder", hint: "All profiles, all downloads together" }
];

type Line = { depth: number; name: string; dir?: boolean; dim?: boolean };

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

function tree(layout: FolderLayout, split: boolean, single: string): Line[] {
  const files = (depth: number, who: string) =>
    split
      ? [
          { depth, name: "photos", dir: true },
          { depth: depth + 1, name: `${who}photo_8f2c41.jpg` },
          { depth, name: "videos", dir: true },
          { depth: depth + 1, name: `${who}video_19ab07.mp4` },
          { depth, name: "gifs", dir: true },
          { depth: depth + 1, name: `${who}gif_c0d3e5.gif` }
        ]
      : [
          { depth, name: `${who}photo_8f2c41.jpg` },
          { depth, name: `${who}video_19ab07.mp4` },
          { depth, name: `${who}gif_c0d3e5.gif` }
        ];
  if (layout === "single") {
    return [{ depth: 0, name: single || "All media", dir: true }, ...files(1, "nasa_"), { depth: 1, name: "…files from every profile", dim: true }];
  }
  if (layout === "profile") {
    return [{ depth: 0, name: "nasa", dir: true }, ...files(1, ""), { depth: 0, name: "spacex", dir: true, dim: true }];
  }
  return [
    { depth: 0, name: `nasa_${stamp()}`, dir: true },
    ...files(1, ""),
    { depth: 0, name: "nasa_2026-09-30-18-02", dir: true, dim: true }
  ];
}

export function FolderLayoutPicker({
  config,
  set,
  visible
}: {
  config: AppConfig;
  set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<void>;
  visible: (title: string, hint?: string) => boolean;
}) {
  const [name, setName] = useState(config.singleFolderName);
  useEffect(() => setName(config.singleFolderName), [config.singleFolderName]);
  const lines = tree(config.folderLayout, config.splitByType, name.trim());

  return (
    <>
      {visible("Where files go", "folder layout one folder same folder each time per profile") && (
        <div className="layout-block">
          <div className="layout-head">
            <div className="title">Where files go</div>
            <div className="hint">Pick how downloads are grouped inside your output folder.</div>
          </div>
          <div className="layout-body">
            <div className="layout-options" role="radiogroup" aria-label="Where files go">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={config.folderLayout === l.id}
                  className={`choice layout-choice ${config.folderLayout === l.id ? "on" : ""}`}
                  onClick={() => void set("folderLayout", l.id)}
                >
                  <span className="layout-radio" />
                  <span>
                    <strong>{l.title}</strong>
                    <small>{l.hint}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="layout-tree mono" aria-label="Folder preview">
              <div className="layout-tree-root">{config.outputRoot.split(/[\\/]/).filter(Boolean).pop() || "Xaver"}</div>
              {lines.map((l, i) => (
                <div
                  key={`${config.folderLayout}-${config.splitByType}-${i}`}
                  className={`layout-line ${l.dir ? "dir" : "file"} ${l.dim ? "dim" : ""}`}
                  style={{ paddingLeft: 14 + l.depth * 16, animationDelay: `${i * 22}ms` }}
                >
                  <span className="layout-icon">{l.dir ? "▸" : "·"}</span>
                  {l.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {config.folderLayout === "single" && visible("Folder name", "one folder name") && (
        <Row title="Folder name" hint="Created inside your output folder. Files get the profile name in front so you can tell them apart.">
          <input
            className="field"
            value={name}
            maxLength={60}
            placeholder="All media"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void set("singleFolderName", name)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </Row>
      )}
      {visible("Sort by type", "photos videos gifs subfolders") && (
        <Row title="Sort by type" hint="Keep photos, videos and GIFs in their own subfolders. Turn off to put them all side by side.">
          <Toggle on={config.splitByType} onChange={(v) => void set("splitByType", v)} />
        </Row>
      )}
    </>
  );
}
