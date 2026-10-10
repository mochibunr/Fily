import { Check } from "lucide-react";
import { THEME_LIST, themeName } from "../themes";
import { useApp, type ToolbarKey } from "../store/app";
import Glyph from "./Glyph";

const TOOLBAR_ROWS: { key: ToolbarKey; label: string; hint: string }[] = [
  { key: "terminal", label: "Terminal", hint: "Open a terminal in this folder" },
  { key: "newFolder", label: "New folder", hint: "Create folder button" },
  { key: "newFile", label: "New file", hint: "Create file button" },
  { key: "dual", label: "Dual pane", hint: "Two folders side by side" },
  { key: "hidden", label: "Hidden files", hint: "Show/hide dotfiles toggle" },
  { key: "preview", label: "Preview panel", hint: "Show/hide the right panel" },
  { key: "theme", label: "Theme switcher", hint: "Quick light/dark button" },
];

function Row({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="set-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-row-text"><span>{label}</span><small>{hint}</small></span>
    </label>
  );
}

export default function SettingsModal({ onClose }: { onClose(): void }) {
  const app = useApp();
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog settings" role="dialog" aria-label="Settings" style={{ width: 600 }}>
        <header>Settings</header>
        <div className="body">
          <section>
            <h5>Appearance</h5>
            <div className="theme-grid">
              {THEME_LIST.map((t) => {
                const active = app.theme === t.id;
                return (
                  <button
                    key={t.id}
                    className={`theme-card${active ? " active" : ""}`}
                    onClick={() => app.setTheme(t.id)}
                    aria-pressed={active}
                    title={t.name}
                  >
                    <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 0 55%, ${t.swatch[1]} 55% 100%)` }}>
                      <span className="theme-dot" style={{ background: t.swatch[2] }} />
                      {active && <Check size={16} className="theme-check" />}
                    </span>
                    <span>{t.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="hint">Current theme: {themeName(app.theme)}. Everything here applies instantly and is remembered.</div>
          </section>

          <section>
            <h5>App size</h5>
            <div className="hint">Scale the entire window — text, sidebar, spacing. <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd>. File icons have their own size below.</div>
            <div className="slider-row">
              <input
                type="range"
                min={70}
                max={160}
                step={5}
                value={Math.round(app.uiZoom * 100)}
                aria-label="App size"
                onChange={(e) => app.setUiZoom(Number(e.target.value) / 100)}
              />
              <span className="slider-val">{Math.round(app.uiZoom * 100)}%</span>
              <button className="mini-btn" onClick={() => app.setUiZoom(1)} disabled={app.uiZoom === 1}>Reset</button>
            </div>
          </section>

          <section>
            <h5>File list size</h5>
            <div className="hint">Scales the file list text and icons only — the rest of the window stays put. <kbd>Ctrl</kbd>+<kbd>Wheel</kbd> over the list does the same.</div>
            <div className="slider-row">
              <input
                type="range"
                min={80}
                max={160}
                step={5}
                value={Math.round(app.listScale * 100)}
                aria-label="File list size"
                onChange={(e) => app.setListScale(Number(e.target.value) / 100)}
              />
              <span className="slider-val">{Math.round(app.listScale * 100)}%</span>
              <span className="slider-preview" aria-hidden="true" style={{ transform: `scale(${app.listScale})`, transformOrigin: "left center" }}>
                <Glyph kind="folder" size={18} />
                <Glyph kind="doc-pdf" size={18} />
                <Glyph kind="doc-code" size={18} />
                <span style={{ fontSize: 13, color: "var(--text-2)" }}>Documents</span>
              </span>
            </div>
          </section>

          <section>
            <h5>Toolbar buttons</h5>
            <div className="hint">Choose which icons sit in the top bar. Everything hidden here stays available in the command palette (Ctrl+K).</div>
            {TOOLBAR_ROWS.map((r) => (
              <Row key={r.key} label={r.label} hint={r.hint} checked={app.toolbarBtns[r.key]} onChange={(v) => app.setToolbarBtn(r.key, v)} />
            ))}
          </section>

          <section>
            <h5>Behavior</h5>
            <Row label="Show hidden files" hint="Applies to every folder, remembered" checked={app.showHidden} onChange={app.setShowHidden} />
            <Row label="Preview panel" hint="Details on the right of every window" checked={app.previewVisible} onChange={app.setPreviewVisible} />
            <Row label="Dual pane" hint="Browse two folders side by side" checked={app.dual} onChange={app.setDual} />
          </section>

          <section>
            <h5>Sidebar</h5>
            <Row label="Places" hint="Home, Documents, Downloads…" checked={app.showPlaces} onChange={app.setShowPlaces} />
            <Row label="Devices" hint="Mounted drives and volumes" checked={app.showDevices} onChange={app.setShowDevices} />
            <div className="hint">Tip: drag the sidebar's right edge to resize it — drag it all the way shut to collapse into an icon rail.</div>
          </section>

          <section>
            <h5>Data</h5>
            <div className="hint">Themes, toolbar, sidebar and view preferences live only in this app on your machine.</div>
            <button
              className="mini-btn danger"
              onClick={() => app.askConfirm({
                title: "Reset all settings?",
                body: "Theme, toolbar, sidebar and per-folder view choices return to defaults. Bookmarks are kept.",
                confirmLabel: "Reset",
                onConfirm: () => { app.resetSettings(); app.toast("info", "Settings reset"); },
              })}
            >
              Reset all settings…
            </button>
          </section>
        </div>
        <footer>
          <button className="mini-btn primary" onClick={onClose} autoFocus>Done</button>
        </footer>
      </div>
    </div>
  );
}
