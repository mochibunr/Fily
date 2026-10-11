import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DirViewPrefs, FileEntry, FilySettings, OpProgress, SortKey, TabState, Theme } from "../types";
import { fsApi, onSettingsChanged } from "../api/fs";
import { naturalCompare, plainCompare } from "../utils/sort";

export interface Toast {
  id: number;
  kind: "info" | "error";
  text: string;
}

interface Clipboard {
  mode: "copy" | "cut";
  paths: string[];
}

export interface Pane {
  path: string;
  history: string[];
  histIndex: number;
  /** +1 navigated deeper/forward, -1 went back, 0 initial load. */
  navDir: number;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  selection: string[];
  focusIndex: number;
}

const DEFAULT_PREFS: DirViewPrefs = { mode: "list", sortKey: "name", sortDesc: false };

export type ToolbarKey = "newFolder" | "newFile" | "terminal" | "dual" | "hidden" | "preview" | "theme";
export type ToolbarBtns = Record<ToolbarKey, boolean>;

const DEFAULT_TOOLBAR: ToolbarBtns = {
  newFolder: false,
  newFile: false,
  terminal: true,
  dual: false,
  hidden: false,
  preview: false,
  theme: false,
};

function loadToolbar(): ToolbarBtns {
  try {
    const raw = localStorage.getItem("fily.toolbar");
    if (!raw) return { ...DEFAULT_TOOLBAR };
    return { ...DEFAULT_TOOLBAR, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TOOLBAR };
  }
}

function loadList(key: string): { label: string; path: string }[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function prefsFor(path: string, all: Record<string, DirViewPrefs>): DirViewPrefs {
  return { ...DEFAULT_PREFS, ...(all[path] ?? {}) };
}

function loadPrefs(): Record<string, DirViewPrefs> {
  try {
    const raw = localStorage.getItem("fily.prefs");
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

let toastId = 1;
let tabId = 1;

interface AppCtx {
  theme: Theme;
  setTheme(t: Theme): void;
  toggleTheme(): void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed(v: boolean): void;
  previewVisible: boolean;
  setPreviewVisible(v: boolean): void;
  dual: boolean;
  setDual(v: boolean): void;
  focusPane: number;
  setFocusPane(i: number): void;
  panes: Pane[];
  navigate(pane: number, path: string): void;
  goBack(pane: number): void;
  goForward(pane: number): void;
  goUp(pane: number): void;
  refresh(pane: number): void;
  refreshAll(): void;
  tabs: TabState[];
  activeTab: number;
  openTab(path: string): void;
  closeTab(id: number): void;
  switchTab(id: number): void;
  prefs: DirViewPrefs;
  setPrefs(patch: Partial<DirViewPrefs>): void;
  showHidden: boolean;
  setShowHidden(v: boolean): void;
  /** Scale of the file list/grid content (text + icons), 0.8–1.6. */
  listScale: number;
  setListScale(v: number): void;
  /** Whole-app UI scale (CSS zoom), 0.7–1.6. */
  uiZoom: number;
  setUiZoom(v: number): void;
  sideWidth: number;
  setSideWidth(v: number): void;
  toolbarBtns: ToolbarBtns;
  setToolbarBtn(key: ToolbarKey, v: boolean): void;
  showDevices: boolean;
  setShowDevices(v: boolean): void;
  showPlaces: boolean;
  setShowPlaces(v: boolean): void;
  settingsOpen: boolean;
  setSettingsOpen(v: boolean): void;
  resetSettings(): void;
  clipboard: Clipboard | null;
  setClipboard(c: Clipboard | null): void;
  bookmarks: { label: string; path: string }[];
  addBookmark(path: string): void;
  removeBookmark(path: string): void;
  toasts: Toast[];
  toast(kind: Toast["kind"], text: string): void;
  /** In-flight long operations, keyed by id. Empty when nothing is running. */
  ops: Record<string, OpProgress>;
  dismissToast(id: number): void;
  setSelection(pane: number, sel: string[]): void;
  confirmState: { title: string; body: string; confirmLabel: string; onConfirm(): void } | null;
  askConfirm(c: { title: string; body: string; confirmLabel: string; onConfirm(): void }): void;
  closeConfirm(): void;
  conflictState: { title: string; conflicts: string[]; resolve(mode: "overwrite" | "keepBoth" | "skip"): void } | null;
  askConflict(title: string, conflicts: string[], resolve: (mode: "overwrite" | "keepBoth" | "skip") => void): void;
  closeConflict(): void;
  promptState: { title: string; label: string; initial: string; onSubmit(v: string): void } | null;
  askPrompt(p: { title: string; label: string; initial: string; onSubmit(v: string): void }): void;
  closePrompt(): void;
  startDir: string;
}

const Ctx = createContext<AppCtx | null>(null);

function emptyPane(path: string): Pane {
  return { path, history: [path], histIndex: 0, navDir: 0, entries: [], loading: false, error: null, selection: [], focusIndex: 0 };
}

/**
 * Stable serialization of a settings payload, used to tell "what the backend
 * already has" from "what the user just changed". Toolbar keys are sorted so
 * key order can never make two equal settings look different.
 */
export function settingsSnapshot(s: FilySettings): string {
  const toolbar: Record<string, boolean> = {};
  for (const k of Object.keys(s.toolbar ?? {}).sort()) toolbar[k] = !!s.toolbar[k];
  return JSON.stringify([
    s.theme, s.uiZoom, s.listScale, s.showHidden, s.sideWidth, s.sidebarCollapsed,
    s.showDevices, s.showPlaces, s.previewVisible, s.dual, toolbar,
  ]);
}

export function AppProvider({ children, initialPath }: { children: React.ReactNode; initialPath: string }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("fily.theme");
    const known = ["light", "dark", "dracula", "catppuccin-mocha", "catppuccin-latte", "nord", "gruvbox", "tokyo-night", "one-dark"];
    return (saved && known.includes(saved) ? saved : "dark") as Theme;
  });
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [previewVisible, setPreviewVisibleState] = useState(true);
  const [dual, setDualState] = useState(false);
  const [focusPane, setFocusPane] = useState(0);
  const [panes, setPanes] = useState<Pane[]>([emptyPane(initialPath)]);
  const [tabs, setTabs] = useState<TabState[]>([{ id: 0, path: initialPath, history: [initialPath], histIndex: 0 }]);
  const [activeTab, setActiveTab] = useState(0);
  const [prefsMap, setPrefsMap] = useState<Record<string, DirViewPrefs>>(loadPrefs);
  const [showHidden, setShowHiddenState] = useState<boolean>(() => localStorage.getItem("fily.hidden") === "1");
  const [listScale, setListScaleState] = useState<number>(() => {
    const n = Number.parseFloat(localStorage.getItem("fily.listScale") ?? "");
    return Number.isFinite(n) ? Math.min(1.6, Math.max(0.8, n)) : 1;
  });
  const [uiZoom, setUiZoomState] = useState<number>(() => {
    const n = Number.parseInt(localStorage.getItem("fily.uiZoom") ?? "", 10);
    return Number.isFinite(n) ? Math.min(1.6, Math.max(0.7, n)) : 1;
  });
  const [sideWidth, setSideWidthState] = useState<number>(() => {
    const n = Number.parseInt(localStorage.getItem("fily.sideWidth") ?? "", 10);
    return Number.isFinite(n) ? Math.min(400, Math.max(160, n)) : 218;
  });
  const [toolbarBtns, setToolbarBtns] = useState<ToolbarBtns>(loadToolbar);
  const [showDevices, setShowDevicesState] = useState<boolean>(() => localStorage.getItem("fily.side.devices") !== "0");
  const [showPlaces, setShowPlacesState] = useState<boolean>(() => localStorage.getItem("fily.side.places") !== "0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [bookmarks, setBookmarks] = useState<{ label: string; path: string }[]>(() => loadList("fily.bookmarks"));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ops, setOps] = useState<Record<string, OpProgress>>({});
  const [confirmState, setConfirmState] = useState<AppCtx["confirmState"]>(null);
  const [conflictState, setConflictState] = useState<AppCtx["conflictState"]>(null);
  const [promptState, setPromptState] = useState<AppCtx["promptState"]>(null);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const loadTokens = useRef<Record<number, number>>({});
  // False until the settings file has been read. Until then the state holds
  // only useState defaults, and writing those back would overwrite the saved
  // file — which is why toggling the preview panel off and restarting would
  // silently turn it back on.
  const hydrated = useRef(false);
  // Snapshot of what the backend is believed to hold right now. The
  // write-through effect skips while the outgoing payload still matches it.
  //
  // This replaces a one-shot boolean, which had two failure modes: an applied
  // update that changed nothing left the flag armed, so the user's very next
  // real change was swallowed and lost; and the value it guarded was the
  // wrong one. Comparing payloads cannot get stuck in either state.
  const appliedRemote = useRef("");

  // --- Long-running operation progress -------------------------------------
  // The backend emits `op-progress` while it works (extracting an archive, for
  // instance). Entries are keyed by op id so two overlapping extractions get
  // their own rows, and a finished op removes itself.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<OpProgress>("op-progress", (e) => {
          const p = e.payload;
          if (!p?.id) return;
          setOps((prev) => {
            if (p.finished) {
              if (!(p.id in prev)) return prev;
              const next = { ...prev };
              delete next[p.id];
              return next;
            }
            return { ...prev, [p.id]: p };
          });
        }),
      )
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {
        /* Not running under Tauri (browser preview): no events, no rows. */
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // --- Settings file: the authoritative, externally-writable store ---------
  // On boot the JSON file wins over localStorage, so a value set by
  // `fily config …` or an AI agent is what the user sees. When no file exists
  // yet (first run / upgrade), the existing localStorage values are migrated up
  // so nobody loses their preferences.
  const applySettings = useCallback((s: FilySettings) => {
    // Record what the backend now holds, before the state updates land.
    appliedRemote.current = settingsSnapshot(s);
    setThemeState(s.theme);
    setSidebarCollapsedState(s.sidebarCollapsed);
    setShowHiddenState(s.showHidden);
    setListScaleState(s.listScale);
    setUiZoomState(s.uiZoom);
    setSideWidthState(s.sideWidth);
    setShowDevicesState(s.showDevices);
    setShowPlacesState(s.showPlaces);
    setPreviewVisibleState(s.previewVisible);
    setDualState(s.dual);
    setToolbarBtns((t) => ({ ...t, ...s.toolbar }));
  }, []);

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const { settings, exists } = await fsApi.getSettings();
        if (dead) return;
        if (exists) {
          applySettings(settings);
        } else {
          // Migrate whatever the webview already had.
          await fsApi.setSettings({
            theme,
            uiZoom,
            listScale,
            showHidden,
            sideWidth,
            sidebarCollapsed,
            showDevices,
            showPlaces,
            previewVisible,
            dual,
            toolbar: toolbarBtns,
          });
        }
      } catch {
        /* file backend unavailable (browser preview) — localStorage still works */
      } finally {
        // Only now may the write-through effect persist anything.
        hydrated.current = true;
      }
    })();
    // Boot only. Depends on the empty-mount state by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-apply settings changed outside the app (CLI, AI agent, second window).
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    void onSettingsChanged((s) => {
      if (!dead) applySettings(s);
    }).then((f) => {
      if (dead) f();
      else un = f;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, [applySettings]);

  // Write through to the settings file so external tools always see the
  // current state, whichever side changed it.
  useEffect(() => {
    // Before the file has been read these values are only defaults, and
    // writing them would destroy the saved settings.
    if (!hydrated.current) return;
    const payload: FilySettings = {
      theme,
      uiZoom,
      listScale,
      showHidden,
      sideWidth,
      sidebarCollapsed,
      showDevices,
      showPlaces,
      previewVisible,
      dual,
      toolbar: toolbarBtns,
    };
    const snap = settingsSnapshot(payload);
    // Identical to what the backend already holds: the write would be a no-op,
    // and skipping keeps a remote apply from echoing straight back.
    if (snap === appliedRemote.current) return;
    appliedRemote.current = snap;
    void fsApi.setSettings(payload).catch(() => {});
  }, [
    theme,
    uiZoom,
    listScale,
    showHidden,
    sideWidth,
    sidebarCollapsed,
    showDevices,
    showPlaces,
    previewVisible,
    dual,
    toolbarBtns,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("fily.theme", theme);
  }, [theme]);

  // Whole-app UI scale. CSS `zoom` (not transform: scale) so layout,
  // hit-testing and scrollbars all scale correctly. The app height is
  // divided by the zoom because 100vh is the *unzoomed* viewport — without
  // this the layout overflows and pushes the sidebar footer out of view.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--zoom", String(uiZoom));
    root.style.zoom = uiZoom === 1 ? "" : String(uiZoom);
  }, [uiZoom]);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastId++;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const loadDir = useCallback(async (paneIdx: number, path: string, showHidden: boolean) => {
    // Stale-load guard: if the user navigates twice quickly, the older
    // request's results are discarded instead of flashing wrong content.
    const tok = (loadTokens.current[paneIdx] = (loadTokens.current[paneIdx] ?? 0) + 1);
    setPanes((ps) => ps.map((p, i) => (i === paneIdx ? { ...p, loading: true, error: null } : p)));
    try {
      const entries = await fsApi.listDir(path, showHidden);
      if (loadTokens.current[paneIdx] !== tok) return;
      setPanes((ps) => ps.map((p, i) => (i === paneIdx ? { ...p, entries, loading: false, error: null, selection: [], focusIndex: 0 } : p)));
    } catch (e) {
      if (loadTokens.current[paneIdx] !== tok) return;
      const msg = e instanceof Error ? e.message : String(e);
      setPanes((ps) => ps.map((p, i) => (i === paneIdx ? { ...p, entries: [], loading: false, error: msg } : p)));
    }
  }, []);

  // Ensure pane count matches dual flag.
  useEffect(() => {
    setPanes((ps) => {
      if (dual && ps.length === 1) return [...ps, emptyPane(ps[0].path)];
      if (!dual && ps.length === 2) return [ps[0]];
      return ps;
    });
  }, [dual]);

  const setShowHidden = useCallback((v: boolean) => {
    setShowHiddenState(v);
    localStorage.setItem("fily.hidden", v ? "1" : "0");
  }, []);

  // Public setters. Persistence is handled by the write-through effect above,
  // so these only need to update state.
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);
  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
  }, []);
  const setPreviewVisible = useCallback((v: boolean) => {
    setPreviewVisibleState(v);
  }, []);
  const setDual = useCallback((v: boolean) => {
    setDualState(v);
  }, []);

  const setListScale = useCallback((v: number) => {
    const clamped = Math.min(1.6, Math.max(0.8, Math.round(v * 100) / 100));
    setListScaleState(clamped);
    localStorage.setItem("fily.listScale", String(clamped));
  }, []);

  const setUiZoom = useCallback((v: number) => {
    const clamped = Math.min(1.6, Math.max(0.7, Math.round(v * 100) / 100));
    setUiZoomState(clamped);
    localStorage.setItem("fily.uiZoom", String(clamped));
  }, []);

  const setSideWidth = useCallback((v: number) => {
    const clamped = Math.min(400, Math.max(160, Math.round(v)));
    setSideWidthState(clamped);
    localStorage.setItem("fily.sideWidth", String(clamped));
  }, []);

  const setToolbarBtn = useCallback((key: ToolbarKey, v: boolean) => {
    setToolbarBtns((t) => {
      const next = { ...t, [key]: v };
      localStorage.setItem("fily.toolbar", JSON.stringify(next));
      return next;
    });
  }, []);

  const setShowDevices = useCallback((v: boolean) => {
    setShowDevicesState(v);
    localStorage.setItem("fily.side.devices", v ? "1" : "0");
  }, []);

  const setShowPlaces = useCallback((v: boolean) => {
    setShowPlacesState(v);
    localStorage.setItem("fily.side.places", v ? "1" : "0");
  }, []);

  const resetSettings = useCallback(() => {
    for (const k of ["fily.theme", "fily.prefs", "fily.hidden", "fily.sideWidth", "fily.toolbar", "fily.side.devices", "fily.side.places", "fily.bookmarks", "fily.listScale", "fily.uiZoom"]) {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    }
    setTheme("dark");
    setPrefsMap({});
    setShowHiddenState(false);
    setListScaleState(1);
    try { localStorage.removeItem("fily.listScale"); } catch { /* noop */ }
    setUiZoomState(1);
    try { localStorage.removeItem("fily.uiZoom"); } catch { /* noop */ }
    setSideWidthState(218);
    setToolbarBtns({ ...DEFAULT_TOOLBAR });
    setShowDevicesState(true);
    setShowPlacesState(true);
    setPreviewVisibleState(true);
    setDualState(false);
    setSidebarCollapsed(false);
    // Reset the shared file too, so `fily config list` agrees with the UI.
    void fsApi.resetSettings().catch(() => {});
  }, []);

  // Load whenever path or the global hidden toggle changes.
  const prevKey = useRef("");
  useEffect(() => {
    const key = panes.map((p) => p.path).join("|") + (showHidden ? "#h" : "");
    if (key === prevKey.current) return;
    prevKey.current = key;
    panes.forEach((p, i) => {
      void loadDir(i, p.path, showHidden);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.map((p) => p.path).join("|"), showHidden]);

  const navigate = useCallback((pane: number, path: string) => {
    setPanes((ps) =>
      ps.map((p, i) => {
        if (i !== pane) return p;
        const hist = p.history.slice(0, p.histIndex + 1);
        hist.push(path);
        const deeper = path.startsWith(p.path);
        return { ...p, path, history: hist.slice(-100), histIndex: Math.min(hist.length - 1, 99), navDir: deeper ? 1 : 0 };
      }),
    );
    setFocusPane(pane);
  }, []);

  const goBack = useCallback((pane: number) => {
    setPanes((ps) =>
      ps.map((p, i) => {
        if (i !== pane || p.histIndex <= 0) return p;
        const idx = p.histIndex - 1;
        return { ...p, histIndex: idx, path: p.history[idx], navDir: -1 };
      }),
    );
  }, []);

  const goForward = useCallback((pane: number) => {
    setPanes((ps) =>
      ps.map((p, i) => {
        if (i !== pane || p.histIndex >= p.history.length - 1) return p;
        const idx = p.histIndex + 1;
        return { ...p, histIndex: idx, path: p.history[idx], navDir: 1 };
      }),
    );
  }, []);

  const goUp = useCallback((pane: number) => {
    const p = panesRef.current[pane];
    if (!p || p.path === "/") return;
    const clean = p.path.replace(/\/+$/, "");
    const idx = clean.lastIndexOf("/");
    const up = idx <= 0 ? "/" : clean.slice(0, idx);
    navigate(pane, up);
  }, [navigate]);

  const refresh = useCallback((pane: number) => {
    const p = panesRef.current[pane];
    if (p) void loadDir(pane, p.path, showHidden);
  }, [loadDir, showHidden]);

  const refreshAll = useCallback(() => {
    panesRef.current.forEach((p, i) => {
      void loadDir(i, p.path, showHidden);
    });
  }, [loadDir, showHidden]);

  const openTab = useCallback((path: string) => {
    const id = tabId++;
    setTabs((ts) => [...ts, { id, path, history: [path], histIndex: 0 }]);
    setActiveTab(id);
    setPanes((ps) => ps.map((p, i) => (i === 0 ? { ...p, path, history: [path], histIndex: 0 } : p)));
    setFocusPane(0);
  }, []);

  const switchTab = useCallback((id: number) => {
    setActiveTab(id);
    const t = tabs.find((x) => x.id === id);
    // Persist current pane path into old tab record lazily on next switch.
    if (t) {
      setPanes((ps) => ps.map((p, i) => (i === 0 ? { ...p, path: t.path, history: t.history, histIndex: t.histIndex } : p)));
    }
    setFocusPane(0);
  }, [tabs]);

  const closeTab = useCallback((id: number) => {
    setTabs((ts) => {
      if (ts.length === 1) return ts;
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (id === activeTab) {
        const pick = next[Math.max(0, idx - 1)];
        setActiveTab(pick.id);
        setPanes((ps) => ps.map((p, i) => (i === 0 ? { ...p, path: pick.path, history: pick.history, histIndex: pick.histIndex } : p)));
      }
      return next;
    });
  }, [activeTab]);

  // Keep active tab record in sync with pane 0 navigation.
  useEffect(() => {
    const p0 = panes[0];
    if (!p0) return;
    setTabs((ts) => ts.map((t) => (t.id === activeTab ? { ...t, path: p0.path, history: p0.history, histIndex: p0.histIndex } : t)));
  }, [panes[0]?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const prefs = useMemo(() => prefsFor(panes[focusPane]?.path ?? "/", prefsMap), [panes, focusPane, prefsMap]);
  const setPrefs = useCallback((patch: Partial<DirViewPrefs>) => {
    const path = panesRef.current[focusPane]?.path ?? "/";
    setPrefsMap((m) => {
      const next = { ...m, [path]: { ...prefsFor(path, m), ...patch } };
      localStorage.setItem("fily.prefs", JSON.stringify(next));
      return next;
    });
  }, [focusPane]);

  const setSelection = useCallback((pane: number, sel: string[]) => {
    setPanes((ps) => ps.map((p, i) => (i === pane ? { ...p, selection: sel } : p)));
  }, []);

  const addBookmark = useCallback((path: string) => {
    setBookmarks((bs) => {
      if (bs.some((b) => b.path === path)) return bs;
      const label = path.split("/").filter(Boolean).pop() ?? path;
      const next = [...bs, { label, path }];
      localStorage.setItem("fily.bookmarks", JSON.stringify(next));
      return next;
    });
  }, []);

  const removeBookmark = useCallback((path: string) => {
    setBookmarks((bs) => {
      const next = bs.filter((b) => b.path !== path);
      localStorage.setItem("fily.bookmarks", JSON.stringify(next));
      return next;
    });
  }, []);

  const value: AppCtx = {
    theme,
    setTheme,
    toggleTheme: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    sidebarCollapsed,
    setSidebarCollapsed,
    previewVisible,
    setPreviewVisible,
    dual,
    setDual,
    focusPane,
    setFocusPane,
    panes,
    navigate,
    goBack,
    goForward,
    goUp,
    refresh,
    refreshAll,
    tabs,
    activeTab,
    openTab,
    closeTab,
    switchTab,
    prefs,
    setPrefs,
    showHidden,
    setShowHidden,
    listScale,
    setListScale,
    uiZoom,
    setUiZoom,
    sideWidth,
    setSideWidth,
    toolbarBtns,
    setToolbarBtn,
    showDevices,
    setShowDevices,
    showPlaces,
    setShowPlaces,
    settingsOpen,
    setSettingsOpen,
    resetSettings,
    clipboard,
    setClipboard,
    bookmarks,
    addBookmark,
    removeBookmark,
    toasts,
    toast,
    dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    ops,
    setSelection,
    confirmState,
    askConfirm: setConfirmState,
    closeConfirm: () => setConfirmState(null),
    conflictState,
    askConflict: (title, conflicts, resolve) => setConflictState({ title, conflicts, resolve }),
    closeConflict: () => setConflictState(null),
    promptState,
    askPrompt: setPromptState,
    closePrompt: () => setPromptState(null),
    startDir: initialPath,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function sortEntries(entries: FileEntry[], sortKey: SortKey, desc: boolean): FileEntry[] {
  const arr = [...entries];
  const dirFirst = (a: FileEntry, b: FileEntry) => Number(b.isDir) - Number(a.isDir);
  const sign = desc ? -1 : 1;
  switch (sortKey) {
    case "name":
      arr.sort((a, b) => dirFirst(a, b) || sign * naturalCompare(a.name, b.name));
      break;
    case "size":
      arr.sort((a, b) => dirFirst(a, b) || sign * (a.size - b.size) || naturalCompare(a.name, b.name));
      break;
    case "modified":
      arr.sort((a, b) => dirFirst(a, b) || sign * ((a.modified ?? 0) - (b.modified ?? 0)));
      break;
    case "type":
      arr.sort((a, b) => dirFirst(a, b) || sign * plainCompare(a.extension, b.extension) || naturalCompare(a.name, b.name));
      break;
  }
  return arr;
}
