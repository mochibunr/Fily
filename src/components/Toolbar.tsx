import {
  ArrowDownWideNarrow, ArrowLeft, ArrowRight, ArrowUp, Columns2, Eye, EyeOff,
  FolderPlus, FilePlus, LayoutGrid, List, Moon, PanelRight, RefreshCw, Search,
  Sun, Terminal, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SortKey } from "../types";
import { fsApi } from "../api/fs";
import { useApp } from "../store/app";
import { baseName, breadcrumb, parentDir } from "../utils/format";
import ContextMenu from "./ContextMenu";

const FILTER_HINTS = [
  { chip: "type:pdf", hint: "PDFs, or image/audio/video/code" },
  { chip: "ext:png", hint: "Any extension, comma separated" },
  { chip: "size:>10mb", hint: "Bigger than — < works too" },
];

const SORTS: { k: SortKey; label: string }[] = [
  { k: "name", label: "Name" },
  { k: "size", label: "Size" },
  { k: "modified", label: "Modified" },
  { k: "type", label: "Type" },
];

export default function Toolbar({ pane, onSearch, resetKey = 0 }: { pane: number; onSearch(q: string): void; resetKey?: number }) {
  const app = useApp();
  const p = app.panes[pane];
  const [q, setQ] = useState("");
  // Navigating away retires the search: the keyword was scoped to the folder
  // you were standing in, and its results describe a listing you just left.
  // Keeping it meant the next listing showed stale matches, or the box sat
  // full of text silently filtering a folder the query never covered.
  useEffect(() => {
    setQ("");
  }, [resetKey]);
  const [focused, setFocused] = useState(false);
  const [locEditing, setLocEditing] = useState(false);
  const [locVal, setLocVal] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortPos, setSortPos] = useState({ x: 0, y: 0 });
  const sortRef = useRef<HTMLButtonElement>(null);
  // Ctrl+L (or the palette) swaps breadcrumbs for a path field.
  useEffect(() => {
    const onEdit = (e: Event) => {
      if ((e as CustomEvent<number>).detail !== pane) return;
      setLocVal(p?.path ?? "/");
      setLocEditing(true);
    };
    window.addEventListener("fily:edit-location", onEdit);
    return () => window.removeEventListener("fily:edit-location", onEdit);
  }, [pane, p?.path]);
  // Type-to-search: App dispatches the accumulated term; put it in the box.
  useEffect(() => {
    const onType = (e: Event) => {
      const term = (e as CustomEvent<string>).detail;
      if (!term) return;
      setQ(term);
      onSearch(term);
    };
    window.addEventListener("fily:type-search", onType);
    return () => window.removeEventListener("fily:type-search", onType);
  }, [onSearch]);

  if (!p) return null;
  // Built by a tested helper rather than inline: the previous inline version
  // produced "/C:/Users" on Windows. The drive letter is the root crumb there.
  const crumbs = breadcrumb(p.path);
  const searchId = `fily-search-pane-${pane}`;
  const tb = app.toolbarBtns;

  const doPaste = async () => {
    if (!app.clipboard || app.clipboard.paths.length === 0) return;
    const { mode, paths } = app.clipboard;
    try {
      const res = mode === "copy"
        ? await fsApi.copyPaths(paths, p.path)
        : await fsApi.movePaths(paths, p.path);
      if (!res.ok && res.conflicts.length > 0) {
        app.askConflict(mode === "copy" ? "Copy conflicts" : "Move conflicts", res.conflicts, async (how) => {
          if (how === "skip") return;
          const r2 = mode === "copy"
            ? await fsApi.copyPaths(paths, p.path, how === "overwrite" ? { overwrite: true } : { keepBoth: true })
            : await fsApi.movePaths(paths, p.path, how === "overwrite" ? { overwrite: true } : { keepBoth: true });
          if (!r2.ok) app.toast("error", r2.failures.map((f) => f.message).join("; "));
          else { app.setClipboard(null); app.refreshAll(); }
        });
        return;
      }
      if (!res.ok) app.toast("error", res.failures.map((f) => f.message).join("; "));
      else { if (mode === "cut") app.setClipboard(null); app.refreshAll(); }
    } catch (e) {
      app.toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const insertHint = (chip: string) => {
    const next = q ? (q.endsWith(" ") ? q + chip : `${q} ${chip}`) : chip;
    setQ(next);
    onSearch(next);
  };

  const commitLoc = async () => {
    const v = locVal.trim();
    setLocEditing(false);
    if (!v || v === p.path) return;
    try {
      const st = await fsApi.statPath(v);
      if (st.isDir) {
        app.navigate(pane, st.path);
      } else {
        // A file path jumps to its parent and selects the file. parentDir
        // handles both separators and stops at a Windows drive root.
        const parent = parentDir(v) ?? v;
        app.navigate(pane, parent);
        window.setTimeout(() => app.setSelection(pane, [st.path]), 400);
      }
    } catch {
      app.toast("error", `No such folder: ${v}`);
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Navigation">
      <button className="icon-btn" disabled={p.histIndex <= 0} onClick={() => app.goBack(pane)} aria-label="Back" title="Back (Alt+Left, mouse button 4)">
        <ArrowLeft size={16} />
      </button>
      <button className="icon-btn" disabled={p.histIndex >= p.history.length - 1} onClick={() => app.goForward(pane)} aria-label="Forward" title="Forward (Alt+Right, mouse button 5)">
        <ArrowRight size={16} />
      </button>
      <button className="icon-btn" onClick={() => app.goUp(pane)} aria-label="Up one folder" title="Up one folder">
        <ArrowUp size={16} />
      </button>
      <button className="icon-btn" onClick={() => app.refresh(pane)} aria-label="Refresh" title="Refresh">
        <RefreshCw size={15} />
      </button>

      {locEditing ? (
        <input
          className="loc-input"
          aria-label="Location — type or paste a path, Enter to go"
          value={locVal}
          autoFocus
          ref={(el) => el?.select()}
          onChange={(e) => setLocVal(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void commitLoc();
            if (e.key === "Escape") setLocEditing(false);
          }}
          onBlur={() => setLocEditing(false)}
          placeholder="/home/user/Documents"
        />
      ) : (
      <nav
        className="breadcrumbs"
        aria-label="Breadcrumb"
        title="Click a segment to go there — click empty space or press Ctrl+L to type a path"
        style={{ cursor: "text" }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          setLocVal(p.path);
          setLocEditing(true);
        }}
      >        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.path} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && <span className="crumb-sep">›</span>}
              <button
                className={`crumb${last ? " current" : ""}`}
                onClick={() => app.navigate(pane, c.path)}
                title={c.path}
              >
                {c.label}
              </button>
            </span>
          );
        })}
      </nav>
      )}

      {/* Collapsed to just the magnifier until focused or holding a query, so
          the toolbar stays quiet until search is actually wanted. */}
      <div className={`search-box${focused ? " open" : ""}${q ? " has-query" : ""}`}>
        {/* A <label> wrapping the magnifier, so clicking it focuses the input
            natively. Collapsed, the box is 32px wide with overflow:hidden and
            the input is pushed out of view, so the icon was dead space: the
            click landed on the container and nothing took focus. The id is
            per-pane because two panes render two of these at once. */}
        <label className="search-icon" htmlFor={searchId}>
          <Search size={14} />
        </label>
        <input
          id={searchId}
          value={q}
          placeholder={`Search in ${baseName(p.path) || "/"}…`}
          aria-label="Search files"
          onChange={(e) => { setQ(e.target.value); onSearch(e.target.value); }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); onSearch(""); } }}
        />
        {q && (
          <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label="Clear search" title="Clear search (Esc)" onClick={() => { setQ(""); onSearch(""); }}>
            <X size={12} />
          </button>
        )}
        {!q && <kbd>⌃F</kbd>}
        {focused && !q && (
          <div className="search-hints" role="menu" aria-label="Search filters">
            <div className="ctx-label">Filters — click to insert</div>
            {FILTER_HINTS.map((h) => (
              <button key={h.chip} className="ctx-item" onMouseDown={(e) => e.preventDefault()} onClick={() => insertHint(h.chip)}>
                <code>{h.chip}</code>
                <span style={{ color: "var(--text-3)", fontSize: 11 }}>{h.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="view-switch" role="group" aria-label="View mode">
        <button className={`icon-btn${app.prefs.mode === "list" ? " on" : ""}`} onClick={() => app.setPrefs({ mode: "list" })} aria-label="List view" title="List view (Ctrl+1)">
          <List size={15} />
        </button>
        <button className={`icon-btn${app.prefs.mode === "grid" ? " on" : ""}`} onClick={() => app.setPrefs({ mode: "grid" })} aria-label="Grid view" title="Grid view (Ctrl+2)">
          <LayoutGrid size={15} />
        </button>
      </div>

      {/* Sorting and the item count used to occupy a whole row of their own,
          duplicating what the status bar already shows. One control here. */}
      <button
        ref={sortRef}
        className="icon-btn"
        aria-label="Sort and order"
        aria-haspopup="menu"
        title={`Sorted by ${SORTS.find((s) => s.k === app.prefs.sortKey)?.label ?? "Name"}, ${app.prefs.sortDesc ? "descending" : "ascending"}`}
        onClick={() => {
          const r = sortRef.current?.getBoundingClientRect();
          if (r) setSortPos({ x: r.left, y: r.bottom + 4 });
          setSortOpen((v) => !v);
        }}
      >
        <ArrowDownWideNarrow size={15} className={app.prefs.sortDesc ? "flip" : ""} />
      </button>
      {sortOpen && (
        <ContextMenu
          x={sortPos.x}
          y={sortPos.y}
          onClose={() => setSortOpen(false)}
          sections={[
            {
              title: "Sort by",
              items: SORTS.map((s) => ({
                label: `${s.label}${app.prefs.sortKey === s.k ? " ✓" : ""}`,
                action: () => app.setPrefs({ sortKey: s.k }),
              })),
            },
            {
              title: "Order",
              items: [
                { label: `Ascending${!app.prefs.sortDesc ? " ✓" : ""}`, action: () => app.setPrefs({ sortDesc: false }) },
                { label: `Descending${app.prefs.sortDesc ? " ✓" : ""}`, action: () => app.setPrefs({ sortDesc: true }) },
              ],
            },
          ]}
        />
      )}

      {tb.dual && (
        <button className={`icon-btn dual-toggle${app.dual ? " on" : ""}`} onClick={() => app.setDual(!app.dual)} aria-label="Dual pane" title="Dual pane">
          <Columns2 size={15} />
        </button>
      )}
      {tb.hidden && (
        <button className="icon-btn" onClick={() => app.setShowHidden(!app.showHidden)} aria-label="Toggle hidden files" title={app.showHidden ? "Hide hidden files" : "Show hidden files"}>
          {app.showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      )}
      {tb.preview && (
        <button className="icon-btn" onClick={() => app.setPreviewVisible(!app.previewVisible)} aria-label="Toggle preview panel" title="Preview panel">
          <PanelRight size={15} />
        </button>
      )}
      {tb.theme && (
        <button className="icon-btn" onClick={() => app.toggleTheme()} aria-label="Toggle theme" title="Toggle light/dark (more in Settings)">
          {app.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      )}
      {pane === 0 && (
        <>
          {tb.newFolder && (
            <button className="icon-btn" aria-label="New folder" title="New folder (Ctrl+Shift+N)" onClick={() => app.askPrompt({ title: "New folder", label: "Folder name", initial: "Untitled folder", onSubmit: async (v) => {
              try { await fsApi.createDir(p.path, v); app.refreshAll(); }
              catch (e) { app.toast("error", e instanceof Error ? e.message : String(e)); }
            } })}>
              <FolderPlus size={15} />
            </button>
          )}
          {tb.newFile && (
            <button className="icon-btn" aria-label="New file" title="New file" onClick={() => app.askPrompt({ title: "New file", label: "File name", initial: "Untitled.txt", onSubmit: async (v) => {
              try { await fsApi.createFile(p.path, v); app.refreshAll(); }
              catch (e) { app.toast("error", e instanceof Error ? e.message : String(e)); }
            } })}>
              <FilePlus size={15} />
            </button>
          )}
          {tb.terminal && (
            <button className="icon-btn" aria-label="Open terminal here" title="Open terminal here" onClick={() => fsApi.openTerminal(p.path).catch((e) => app.toast("error", e.message))}>
              <Terminal size={15} />
            </button>
          )}
          {app.clipboard && (
            <button className="mini-btn primary" onClick={doPaste}>
              Paste {app.clipboard.paths.length} item{app.clipboard.paths.length > 1 ? "s" : ""} ({app.clipboard.mode})
            </button>
          )}
        </>
      )}
    </div>
  );
}
