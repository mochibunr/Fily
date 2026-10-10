import {
  ChevronLeft, ChevronRight, Clock, Download, FileText, Film, Folder,
  HardDrive, Home, Image as ImageIcon, Monitor, Music, Settings, Star, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fsApi } from "../api/fs";
import { useApp } from "../store/app";
import type { Place, Volume } from "../types";

const RAIL_W = 58;
const MIN_W = 160;
const MAX_W = 400;
const COLLAPSE_AT = 96;

function placeIcon(id: string, size = 15) {
  switch (id) {
    case "home": return <Home size={size} />;
    case "desktop": return <Monitor size={size} />;
    case "documents": return <FileText size={size} />;
    case "downloads": return <Download size={size} />;
    case "music": return <Music size={size} />;
    case "pictures": return <ImageIcon size={size} />;
    case "videos": return <Film size={size} />;
    default: return <Folder size={size} />;
  }
}

export default function Sidebar() {
  const app = useApp();
  const {
    panes, focusPane, navigate, sidebarCollapsed, setSidebarCollapsed,
    sideWidth, setSideWidth, bookmarks, removeBookmark, toast,
    showDevices, showPlaces, setSettingsOpen,
  } = app;
  const [places, setPlaces] = useState<Place[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const current = panes[focusPane]?.path;

  useEffect(() => {
    fsApi.getPlaces().then(setPlaces).catch(() => {});
    fsApi.getVolumes().then(setVolumes).catch(() => {});
  }, []);

  const beginDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = asideRef.current?.getBoundingClientRect();
    const d = { startX: e.clientX, startW: rect?.width ?? sideWidth };
    drag.current = d;
    // Attached here — not in an effect — so the very first pixel of
    // movement already resizes. (An effect gated on drag.current would
    // never fire, since refs don't trigger re-renders.)
    const onMove = (ev: MouseEvent) => {
      const w = d.startW + (ev.clientX - d.startX);
      if (w < COLLAPSE_AT) setSidebarCollapsed(true);
      else {
        setSidebarCollapsed(false);
        setSideWidth(Math.min(MAX_W, Math.max(MIN_W, w)));
      }
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Collapsed: a slim icon rail so the sidebar is never lost — one click
  // on any icon navigates, the chevron restores the full panel.
  if (sidebarCollapsed) {
    return (
      <aside
        className="sidebar rail"
        style={{ width: RAIL_W }}
        aria-label="Navigation (collapsed)"
      >
        <button className="icon-btn rail-btn" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar" data-tip="Expand sidebar">
          <ChevronRight size={16} />
        </button>
        {places.slice(0, 1).map((p) => (
          <button key={p.id} className="icon-btn rail-btn" onClick={() => navigate(focusPane, p.path)} data-tip={p.label} aria-label={p.label}>
            <Home size={16} />
          </button>
        ))}
        {showPlaces && places.slice(1).map((p) => (
          <button key={p.id} className={`icon-btn rail-btn${current === p.path ? " active" : ""}`} onClick={() => navigate(focusPane, p.path)} data-tip={p.label} aria-label={p.label}>
            {placeIcon(p.id, 16)}
          </button>
        ))}
        {bookmarks.slice(0, 6).map((b) => (
          <button key={b.path} className="icon-btn rail-btn" onClick={() => navigate(focusPane, b.path)} data-tip={b.label} aria-label={`Bookmark ${b.label}`}>
            <Star size={16} />
          </button>
        ))}
        {showDevices && volumes.slice(0, 4).map((v) => (
          <button key={v.path} className="icon-btn rail-btn" onClick={() => navigate(focusPane, v.path)} title={`${v.label} — ${v.path}`} data-tip={v.label} aria-label={v.label}>
            <HardDrive size={16} />
          </button>
        ))}
        <div className="side-footer" />
        <button className="icon-btn rail-btn" onClick={() => setSettingsOpen(true)} data-tip="Settings" aria-label="Settings">
          <Settings size={16} />
        </button>
        <div className="side-grip" onMouseDown={beginDrag} title="Drag to resize" />
      </aside>
    );
  }

  return (
    <aside
      ref={asideRef}
      className="sidebar"
      style={{ width: sideWidth }}
      aria-label="Navigation"
    >
      <div className="side-section">
        <h4>
          Navigate
          <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar" title="Collapse (or drag the edge shut)">
            <ChevronLeft size={14} />
          </button>
        </h4>
        {places.slice(0, 1).map((p) => (
          <button key={p.id} className={`side-item${current === p.path ? " active" : ""}`} onClick={() => navigate(focusPane, p.path)}>
            <Home size={15} /> <span>{p.label}</span>
          </button>
        ))}
        <button className="side-item" onClick={() => toast("info", "Recent is on the roadmap — Back/Forward history covers it for now.")}>
          <Clock size={15} /> <span>Recent</span>
        </button>
      </div>

      {showPlaces && (
        <div className="side-section">
          <h4>Places</h4>
          {places.slice(1).map((p) => (
            <button key={p.id} className={`side-item${current === p.path ? " active" : ""}`} onClick={() => navigate(focusPane, p.path)}>
              {placeIcon(p.id)} <span>{p.label}</span>
            </button>
          ))}
          {places.length === 0 && <div className="side-item" style={{ color: "var(--text-3)" }}><span>Loading…</span></div>}
        </div>
      )}

      {bookmarks.length > 0 && (
        <div className="side-section">
          <h4>Bookmarks</h4>
          {bookmarks.map((b) => (
            <div key={b.path} className={`side-item${current === b.path ? " active" : ""}`} role="button" tabIndex={0}
              onClick={() => navigate(focusPane, b.path)}
              onKeyDown={(e) => { if (e.key === "Enter") navigate(focusPane, b.path); }}>
              <Star size={15} /> <span>{b.label}</span>
              <button className="x" aria-label={`Remove bookmark ${b.label}`} onClick={(e) => { e.stopPropagation(); removeBookmark(b.path); }}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {bookmarks.length === 0 && (
        <div className="side-section">
          <div className="side-hint">Right-click any folder → “Bookmark” to pin it here.</div>
        </div>
      )}

      {showDevices && (
        <div className="side-section">
          <h4>Devices</h4>
          {volumes.map((v: Volume) => (
            <button key={v.path} className={`side-item${current === v.path ? " active" : ""}`} onClick={() => navigate(focusPane, v.path)} title={v.path}>
              <HardDrive size={15} /> <span>{v.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pushes the footer down. `margin-top:auto` (not a flex spacer
          div) because at larger UI scales the spacer collapses to zero
          height and pushes Settings out of the window. */}
      <div className="side-footer">
        <div className="side-section">
          <button className="side-item" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} /> <span>Settings</span>
          </button>
        </div>
      </div>
      <div className="side-grip" onMouseDown={beginDrag} onDoubleClick={() => { setSideWidth(218); }} title="Drag to resize · double-click to reset" />
    </aside>
  );
}
