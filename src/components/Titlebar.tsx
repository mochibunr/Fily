import { ChevronDown, ChevronUp, Folder, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../api/fs";
import { useApp } from "../store/app";
import { baseName } from "../utils/format";

type ResizeDir = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

const EDGES: { dir: ResizeDir; style: React.CSSProperties; cursor: string }[] = [
  { dir: "North", style: { top: 0, left: 8, right: 8, height: 5 }, cursor: "ns-resize" },
  { dir: "South", style: { bottom: 0, left: 8, right: 8, height: 5 }, cursor: "ns-resize" },
  { dir: "West", style: { left: 0, top: 8, bottom: 8, width: 5 }, cursor: "ew-resize" },
  { dir: "East", style: { right: 0, top: 8, bottom: 8, width: 5 }, cursor: "ew-resize" },
  { dir: "NorthWest", style: { top: 0, left: 0, width: 9, height: 9 }, cursor: "nwse-resize" },
  { dir: "NorthEast", style: { top: 0, right: 0, width: 9, height: 9 }, cursor: "nesw-resize" },
  { dir: "SouthWest", style: { bottom: 0, left: 0, width: 9, height: 9 }, cursor: "nesw-resize" },
  { dir: "SouthEast", style: { bottom: 0, right: 0, width: 9, height: 9 }, cursor: "nwse-resize" },
];

export default function Titlebar() {
  const app = useApp();
  const [native, setNative] = useState(false);
  const [maxed, setMaxed] = useState(false);
  const folder = baseName(app.panes[app.focusPane]?.path ?? "") || "/";

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      if (!(await isTauri())) return;
      setNative(true);
      try {
        const win = getCurrentWindow();
        setMaxed(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          try { setMaxed(await getCurrentWindow().isMaximized()); } catch { /* noop */ }
        });
      } catch { /* browser preview */ }
    })();
    return () => unlisten?.();
  }, []);

  const act = (fn: () => Promise<unknown>) => () => {
    try { void fn().catch(() => {}); } catch { /* noop */ }
  };

  // Manual drag: press (left button) anywhere on the bar except the window
  // buttons starts a native move. Done in our own handler rather than
  // `data-tauri-drag-region` so button clicks keep working everywhere.
  const beginMove = (e: React.MouseEvent) => {
    if (!native || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tb-controls")) return;
    void getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <>
      <header
        className="titlebar"
        onMouseDown={beginMove}
        onDoubleClick={() => { if (native) act(() => getCurrentWindow().toggleMaximize())(); }}
      >
        <div className="tb-left">
          <span className="tb-mark"><Folder size={14} /></span>
        </div>
        <div className="tb-title" title={app.panes[app.focusPane]?.path ?? "Fily"}>
          <strong>Fily</strong>
          <span className="tb-sep">—</span>
          <span className="tb-folder">{folder}</span>
        </div>
        <div className="tb-controls">
          {native && (
            <>
              <button aria-label="Minimize" title="Minimize" onClick={act(() => getCurrentWindow().minimize())}>
                <ChevronDown size={17} />
              </button>
              <button aria-label={maxed ? "Restore" : "Maximize"} title={maxed ? "Restore" : "Maximize"} onClick={act(() => getCurrentWindow().toggleMaximize())}>
                {maxed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
              </button>
              <button className="close" aria-label="Close" title="Close" onClick={act(() => getCurrentWindow().close())}>
                <X size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      {native && !maxed && EDGES.map((e) => (
        <div
          key={e.dir}
          className="rz"
          style={{ ...e.style, cursor: e.cursor }}
          onMouseDown={(e2) => {
            if (e2.button !== 0) return;
            e2.preventDefault();
            void getCurrentWindow().startResizeDragging(e.dir).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
