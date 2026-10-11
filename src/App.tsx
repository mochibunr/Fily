import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as pickDialog } from "@tauri-apps/plugin-dialog";
import { fsApi, isTauri } from "./api/fs";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette";
import ContextMenu from "./components/ContextMenu";
import { Dialogs, StatusBar } from "./components/Dialogs";
import { BulkRenameDialog, PropertiesDialog } from "./components/ExtraDialogs";
import FileView from "./components/FileView";
import OpenWithDialog from "./components/OpenWithDialog";
import SettingsModal from "./components/SettingsModal";
import Titlebar from "./components/Titlebar";
import PreviewPanel from "./components/PreviewPanel";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import { buildMenu, doPaste } from "./components/ops";
import { AppProvider, useApp } from "./store/app";
import type { FileEntry } from "./types";
import { baseName } from "./utils/format";
import { toSearchOptions } from "./utils/search";

interface SearchState {
  query: string;
  results: FileEntry[] | null;
  searching: boolean;
}

function TabsBar() {
  const { tabs, activeTab, switchTab, closeTab, openTab, panes } = useApp();
  return (
    <div className="tabs-bar" role="tablist" aria-label="Tabs">
      {tabs.map((t) => (
        <div key={t.id} role="tab" aria-selected={t.id === activeTab} className={`tab${t.id === activeTab ? " active" : ""}`} title={t.path}
          onClick={() => switchTab(t.id)} onAuxClick={(e) => { if (e.button === 1) closeTab(t.id); }}>
          <span>{baseName(t.path) || "/"}</span>
          {tabs.length > 1 && (
            <button className="x" aria-label={`Close tab ${t.path}`} onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <button className="icon-btn" aria-label="New tab" title="New tab (Ctrl+T)" style={{ width: 26, height: 26 }}
        onClick={() => openTab(panes[0]?.path ?? "/")}>
        +
      </button>    </div>
  );
}

function Shell() {
  const app = useApp();
  const [searches, setSearches] = useState<Record<number, SearchState>>({});
  const [ctx, setCtx] = useState<{ pane: number; paths: string[]; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ paths: string[]; names: string[] } | null>(null);
  const [propsPath, setPropsPath] = useState<string | null>(null);
  const [openWith, setOpenWith] = useState<{ path: string; mime: string; name: string } | null>(null);
  const [palette, setPalette] = useState(false);
  const [noBackend, setNoBackend] = useState(false);
  const searchToken = useRef(0);
  // Pending debounce timers, per pane. This used to be returned as a cleanup
  // function, but the call site (`onSearch={(q) => runSearch(pane, q)}`)
  // discards a return value from an event handler, so nothing was ever
  // cancelled: typing "README" started six concurrent walks of the same tree
  // and only the last one to finish won the race.
  const searchTimers = useRef<Record<number, number>>({});

  useEffect(() => {
    void isTauri().then((ok) => { if (!ok) setNoBackend(true); });
  }, []);

  const runSearch = useCallback((pane: number, q: string) => {
    const token = ++searchToken.current;
    const dir = app.panes[pane]?.path;
    // Cancel this pane's pending walk before scheduling a new one.
    const pending = searchTimers.current[pane];
    if (pending !== undefined) window.clearTimeout(pending);
    if (!q.trim() || !dir) {
      setSearches((s) => ({ ...s, [pane]: { query: q, results: null, searching: false } }));
      return;
    }
    setSearches((s) => ({ ...s, [pane]: { query: q, results: s[pane]?.results ?? null, searching: true } }));
    const timer = window.setTimeout(() => {
      delete searchTimers.current[pane];
      void (async () => {
        try {
          const res = await fsApi.searchDir(dir, toSearchOptions(q));
          if (searchToken.current !== token) return; // obsolete
          setSearches((s) => ({ ...s, [pane]: { query: q, results: res, searching: false } }));
        } catch (e) {
          if (searchToken.current !== token) return;
          app.toast("error", e instanceof Error ? e.message : String(e));
          setSearches((s) => ({ ...s, [pane]: { query: q, results: [], searching: false } }));
        }
      })();
    }, 250);
    searchTimers.current[pane] = timer;
  }, [app]);

  const searchFor = (pane: number): SearchState =>
    searches[pane] ?? { query: "", results: null, searching: false };


  // ---- global shortcuts ----
  useEffect(() => {
    // Mouse side buttons: back / forward through folder history.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); app.goBack(app.focusPane); }
      else if (e.button === 4) { e.preventDefault(); app.goForward(app.focusPane); }
    };
    window.addEventListener("mousedown", onMouse);
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      const mod = e.ctrlKey || e.metaKey;
      const pane = app.focusPane;
      const p = app.panes[pane];
      const sel = p?.selection ?? [];

      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); return; }
      if (typing) {
        if (e.key === "Escape") (document.activeElement as HTMLElement)?.blur();
        return;
      }
      // Type-to-search: a printable key typed outside any field starts a
      // search. Only the FIRST character is handled — it focuses the box and
      // seeds the query, and every later keystroke then lands in the focused
      // input natively. An accumulator here would never grow past one
      // character, because focusing the box makes the next key look like
      // "already typing".
      if (
        !mod && !e.altKey && e.key.length === 1 &&
        e.key !== " " && /\S/.test(e.key)
      ) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
        window.dispatchEvent(new CustomEvent("fily:type-search", { detail: e.key }));
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("fily:edit-location", { detail: pane }));
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); app.goBack(pane); return; }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); app.goForward(pane); return; }
      if (mod && e.key === "1") { e.preventDefault(); app.setPrefs({ mode: "list" }); return; }
      if (mod && e.key === "2") { e.preventDefault(); app.setPrefs({ mode: "grid" }); return; }
      // Standard zoom keys: Ctrl+plus / Ctrl+minus / Ctrl+0.
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); app.setUiZoom(app.uiZoom + 0.1); return; }
      if (mod && (e.key === "-" || e.key === "_")) { e.preventDefault(); app.setUiZoom(app.uiZoom - 0.1); return; }
      if (mod && e.key === "0") { e.preventDefault(); app.setUiZoom(1); return; }
      if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); app.openTab(p?.path ?? "/"); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (p) app.askPrompt({ title: "New folder", label: "Folder name", initial: "Untitled folder", onSubmit: async (v) => {
          try { await fsApi.createDir(p.path, v); app.refreshAll(); }
          catch (err) { app.toast("error", err instanceof Error ? err.message : String(err)); }
        } });
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (p) app.setSelection(pane, (searchFor(pane).results ?? p.entries).map((x) => x.path));
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && sel.length > 0) { e.preventDefault(); app.setClipboard({ mode: "copy", paths: sel }); return; }
      if (mod && e.key.toLowerCase() === "x" && sel.length > 0) { e.preventDefault(); app.setClipboard({ mode: "cut", paths: sel }); return; }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (app.clipboard && p) void doPaste(app, app.clipboard.mode, app.clipboard.paths, p.path);
        return;
      }
      if (e.key === "F2" && sel.length === 1) { e.preventDefault(); setRenaming(sel[0]); return; }
      if (e.key === "Enter" && e.altKey && sel.length === 1) { e.preventDefault(); setPropsPath(sel[0]); return; }
      // F10 / Menu key: pop the context menu for the selection (or the
      // folder when nothing is selected), anchored at the focused row.
      if (e.key === "F10" || e.key === "ContextMenu") {
        e.preventDefault();
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 3;
        const anchorPath = sel.length > 0 ? sel[sel.length - 1] : null;
        if (anchorPath) {
          try {
            const el = document.querySelector(`[data-path="${CSS.escape(anchorPath)}"]`);
            if (el) {
              const r = el.getBoundingClientRect();
              x = Math.min(window.innerWidth - 260, r.left + 48);
              y = Math.min(window.innerHeight - 320, r.bottom + 4);
            }
          } catch { /* invalid selector — use fallback position */ }
        }
        openCtx(pane, sel, Math.max(8, x), Math.max(8, y));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length > 0) {
        e.preventDefault();
        if (e.shiftKey) {
          app.askConfirm({
            title: "Permanently delete?",
            body: `${sel.length} item${sel.length > 1 ? "s" : ""} will be deleted forever.`,
            confirmLabel: "Delete forever",
            onConfirm: () => {
              void fsApi.deletePermanent(sel).then((r) => {
                if (!r.ok) app.toast("error", r.failures.map((f) => f.message).join("; "));
                app.refreshAll();
              }).catch((err) => app.toast("error", err instanceof Error ? err.message : String(err)));
            },
          });
        } else {
          void fsApi.trashPaths(sel).then((r) => {
            if (!r.ok) app.toast("error", r.failures.map((f) => f.message).join("; "));
            app.refreshAll();
          }).catch((err) => app.toast("error", err instanceof Error ? err.message : String(err)));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
    };
  });

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const pane = app.focusPane;
    const p = app.panes[pane];
    const sel = p?.selection ?? [];
    const mk = (id: string, label: string, hint: string, run: () => void): PaletteCommand => ({ id, label, hint, run });
    return [
      mk("nav-up", "Go up one folder", "", () => app.goUp(pane)),
      mk("edit-location", "Type a path to go there", "Ctrl+L", () => {
        window.dispatchEvent(new CustomEvent("fily:edit-location", { detail: pane }));
      }),
      mk("nav-back", "Go back", "Alt+Left", () => app.goBack(pane)),
      mk("nav-forward", "Go forward", "Alt+Right", () => app.goForward(pane)),
      mk("view-list", "Switch to list view", "Ctrl+1", () => app.setPrefs({ mode: "list" })),
      mk("view-grid", "Switch to grid view", "Ctrl+2", () => app.setPrefs({ mode: "grid" })),
      mk("toggle-hidden", "Toggle hidden files", "", () => app.setShowHidden(!app.showHidden)),
      mk("toggle-dual", "Toggle dual pane", "", () => app.setDual(!app.dual)),
      mk("toggle-preview", "Toggle preview panel", "", () => app.setPreviewVisible(!app.previewVisible)),
      mk("zoom-in", "Zoom in (whole app)", "Ctrl++", () => app.setUiZoom(app.uiZoom + 0.1)),
      mk("zoom-out", "Zoom out (whole app)", "Ctrl+-", () => app.setUiZoom(app.uiZoom - 0.1)),
      mk("zoom-reset", "Reset zoom to 100%", "Ctrl+0", () => app.setUiZoom(1)),
      mk("list-bigger", "Bigger file list text and icons", "Ctrl+Wheel", () => app.setListScale(app.listScale + 0.05)),
      mk("list-smaller", "Smaller file list text and icons", "Ctrl+Wheel", () => app.setListScale(app.listScale - 0.05)),
      mk("toggle-theme", "Toggle light / dark theme", "", () => app.toggleTheme()),
      mk("settings", "Open settings", "", () => app.setSettingsOpen(true)),
      mk("show-sidebar", "Show sidebar", "", () => app.setSidebarCollapsed(false)),
      mk("hide-sidebar", "Hide sidebar", "", () => app.setSidebarCollapsed(true)),
      mk("new-folder", "New folder", "Ctrl+Shift+N", () => {
        if (p) app.askPrompt({ title: "New folder", label: "Folder name", initial: "Untitled folder", onSubmit: async (v) => {
          try { await fsApi.createDir(p.path, v); app.refreshAll(); }
          catch (e) { app.toast("error", e instanceof Error ? e.message : String(e)); }
        } });
      }),
      mk("new-file", "New file", "", () => {
        if (p) app.askPrompt({ title: "New file", label: "File name", initial: "Untitled.txt", onSubmit: async (v) => {
          try { await fsApi.createFile(p.path, v); app.refreshAll(); }
          catch (e) { app.toast("error", e instanceof Error ? e.message : String(e)); }
        } });
      }),
      mk("new-tab", "New tab here", "Ctrl+T", () => app.openTab(p?.path ?? "/")),
      mk("rename", "Rename selected", "F2", () => { if (sel.length === 1) setRenaming(sel[0]); }),
      mk("bulk", "Bulk rename selected…", "", () => { if (sel.length >= 2 && p) setBulk({ paths: sel, names: sel.map((s) => s.split("/").pop() ?? s) }); }),
      mk("trash", "Move selection to Trash", "Del", () => {
        if (sel.length) void fsApi.trashPaths(sel).then(() => app.refreshAll()).catch((e) => app.toast("error", e.message));
      }),
      mk("terminal", "Open terminal here", "", () => { if (p) void fsApi.openTerminal(p.path).catch((e) => app.toast("error", e.message)); }),
      mk("bookmark", "Bookmark this folder", "", () => { if (p) { app.addBookmark(p.path); app.toast("info", "Bookmark added"); } }),
      mk("refresh", "Refresh", "", () => app.refreshAll()),
    ];
  }, [app]);

  const openCtx = (pane: number, paths: string[], x: number, y: number) => setCtx({ pane, paths, x, y });

  const pickDestDir = useCallback(async (title: string, start: string): Promise<string | null> => {
    try {
      const sel = await pickDialog({ directory: true, multiple: false, title, defaultPath: start });
      return typeof sel === "string" ? sel : null;
    } catch (e) {
      app.toast("error", e instanceof Error ? e.message : "Folder picker needs the desktop app");
      return null;
    }
  }, [app]);

  const renderPane = (pane: number) => {
    const p = app.panes[pane];
    if (!p) return null;
    const s = searchFor(pane);
    return (
      <div key={pane} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: pane === 0 && app.dual ? "1px solid var(--separator)" : undefined }}
        onMouseDown={() => app.setFocusPane(pane)}>
        <Toolbar pane={pane} onSearch={(q) => runSearch(pane, q)} />
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <FileView
              pane={pane}
              searchQuery={s.query}
              searchResults={s.results}
              searching={s.searching}
              onContext={(paths, x, y) => openCtx(pane, paths, x, y)}
              renaming={renaming}
              setRenaming={setRenaming}
            />
          </div>
          {pane === app.focusPane && (
            <PreviewPanel path={p.selection.length === 1 ? p.selection[0] : null} />
          )}
        </div>
      </div>
    );
  };

  const focusPaneData = app.panes[app.focusPane];
  const s0 = searchFor(0);

  return (
    <div className="app">
      <Titlebar />
      {noBackend && (
        <div className="notice info" role="note">
          Running outside Tauri — file operations need the desktop app. Build with <code>npm run tauri build</code>.
          <button className="mini-btn" onClick={() => setNoBackend(false)}>Dismiss</button>
        </div>
      )}
      <div className="app-body">
        <Sidebar />
        <div className="main">
          <TabsBar />
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            {renderPane(0)}
            {app.dual && app.panes[1] && renderPane(1)}
          </div>
          <StatusBar total={focusPaneData?.entries.length ?? 0} shown={(app.focusPane === 0 ? s0.results : searchFor(1).results)?.length ?? focusPaneData?.entries.length ?? 0} />
        </div>
      </div>

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          sections={buildMenu(
            app,
            {
              beginRename: (path) => setRenaming(path),
              openBulkRename: (paths) => setBulk({ paths, names: paths.map((s) => s.split("/").pop() ?? s) }),
              openProperties: setPropsPath,
              openPalette: () => setPalette(true),
              openWithDialog: (path, mime) => setOpenWith({ path, mime, name: path.split("/").pop() ?? path }),
              moveCopyTo: (mode, paths) => {
                void (async () => {
                  const start = app.panes[app.focusPane]?.path ?? "/";
                  const dest = await pickDestDir(mode === "move" ? "Move to…" : "Copy to…", start);
                  if (!dest) return;
                  await doPaste(app, mode === "move" ? "cut" : "copy", paths, dest);
                })();
              },
              compressSel: (paths, suggestedName) => {
                const first = paths[0] ?? "";
                const dir = first.includes("/") ? first.slice(0, first.lastIndexOf("/")) || "/" : "/";
                app.askPrompt({
                  title: "Compress",
                  label: "Archive name",
                  initial: suggestedName,
                  onSubmit: async (v) => {
                    const dest = dir === "/" ? `/${v}` : `${dir}/${v}`;
                    try {
                      const r = await fsApi.compressZip(paths, dest);
                      if (!r.ok && r.conflicts.length > 0) {
                        app.askConflict("Archive exists", r.conflicts, async (how) => {
                          if (how === "skip") return;
                          if (how === "keepBoth") {
                            app.toast("error", "Rename the archive and try again");
                            return;
                          }
                          const r2 = await fsApi.compressZip(paths, dest, true);
                          if (!r2.ok) app.toast("error", r2.failures.map((f) => f.message).join("; "));
                          else { app.toast("info", "Compressed"); app.refreshAll(); }
                        });
                        return;
                      }
                      if (!r.ok) app.toast("error", r.failures.map((f) => f.message).join("; "));
                      else { app.toast("info", "Compressed"); app.refreshAll(); }
                    } catch (e) {
                      app.toast("error", e instanceof Error ? e.message : String(e));
                    }
                  },
                });
              },
              extractTo: (path) => {
                void (async () => {
                  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/";
                  const dest = await pickDestDir("Extract to…", dir);
                  if (!dest) return;
                  try {
                    const r = await fsApi.extractArchive(path, dest);
                    if (!r.ok) app.toast("error", r.failures.map((f) => f.message).join("; "));
                    else app.toast("info", "Archive extracted");
                    app.refreshAll();
                  } catch (e) {
                    app.toast("error", e instanceof Error ? e.message : String(e));
                  }
                })();
              },
            },
            ctx.pane,
            app.panes[ctx.pane]?.path ?? "/",
            ctx.paths,
            app.clipboard,
            app.panes[ctx.pane]?.entries ?? [],
          )}
        />
      )}
      {bulk && <BulkRenameDialog paths={bulk.paths} names={bulk.names} onClose={() => setBulk(null)} />}
      {propsPath && <PropertiesDialog path={propsPath} onClose={() => setPropsPath(null)} />}
      {openWith && <OpenWithDialog path={openWith.path} mime={openWith.mime} name={openWith.name} onClose={() => setOpenWith(null)} />}
      {app.settingsOpen && <SettingsModal onClose={() => app.setSettingsOpen(false)} />}
      {palette && <CommandPalette commands={paletteCommands} onClose={() => setPalette(false)} />}
      <Dialogs />
    </div>
  );
}

export default function App() {
  const override = (import.meta as unknown as { env?: Record<string, string> })?.env
    ?.VITE_START_DIR;
  // The backend owns the start folder so it can be `$HOME` rather than `/`.
  // Resolving it is one local IPC call, so gating the first paint on it costs
  // nothing perceptible and avoids mounting the whole app at `/` and then
  // yanking it to home a frame later.
  const [start, setStart] = useState<string | null>(override || null);
  useEffect(() => {
    if (override) return;
    let alive = true;
    void fsApi
      .getStartDir()
      .then((d) => {
        if (alive && d) setStart(d);
      })
      .catch(() => {
        if (alive) setStart("/");
      });
    return () => {
      alive = false;
    };
  }, [override]);

  if (!start) return <div className="boot">Fily</div>;
  return (
    <AppProvider initialPath={start}>
      <Shell />
    </AppProvider>
  );
}
