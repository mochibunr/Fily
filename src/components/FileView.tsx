import { Folder } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fsApi } from "../api/fs";
import { sortEntries, useApp } from "../store/app";
import type { FileEntry } from "../types";
import { formatDate, formatSize, isImageExt } from "../utils/format";
import { shrinkDataUrl } from "../utils/thumb";
import ExtIcon from "./ExtIcon";

const ROW_H = 34;
const GRID_BATCH = 120;
const THUMB_CACHE_MAX = 150;
const THUMB_CONCURRENCY = 4;

function highlight(name: string, q: string): React.ReactNode {
  if (!q) return name;
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </>
  );
}

interface RowProps {
  entry: FileEntry;
  selected: boolean;
  renaming: boolean;
  q: string;
  index: number;
  /** Downscaled preview of an image file, or undefined to use the type icon. */
  thumb?: string;
  onClick(ev: React.MouseEvent<HTMLDivElement>): void;
  onDoubleClick(): void;
  onContext(ev: React.MouseEvent<HTMLDivElement>): void;
  onDragStart(ev: React.DragEvent<HTMLDivElement>): void;
  onDragOver(ev: React.DragEvent<HTMLDivElement>): void;
  onDrop(ev: React.DragEvent<HTMLDivElement>): void;
  onRenameCommit(path: string, name: string): void;
  onRenameCancel(): void;
}

/** Memoized: scrolling swaps which rows are mounted, but unchanged rows
 *  bail out of rendering entirely instead of re-rendering every frame. */
const FileRow = React.memo(function FileRow({
  entry: e, selected, renaming, q, index, thumb, onClick, onDoubleClick, onContext,
  onDragStart, onDragOver, onDrop, onRenameCommit, onRenameCancel,
}: RowProps) {
  return (
    <div
      key={e.path}
      data-path={e.path}
      role="row"
      aria-selected={selected}
      className={`file-row${selected ? " selected" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContext}
      title={e.path}
    >
      <span className="cell">
        <span className="file-icon">
          {thumb ? <img className="row-thumb" src={thumb} alt="" draggable={false} /> : <ExtIcon entry={e} />}
        </span>
        {renaming ? (
          <input
            className="rename-input"
            autoFocus
            defaultValue={e.name}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") onRenameCommit(e.path, (ev.target as HTMLInputElement).value);
              if (ev.key === "Escape") onRenameCancel();
              ev.stopPropagation();
            }}
            onBlur={(ev) => onRenameCommit(e.path, ev.target.value)}
          />
        ) : (
          <span className="fname">{highlight(e.name, q)}{e.isSymlink ? " ⤴" : ""}</span>
        )}
      </span>
      <span className="cell dim">{e.isDir ? "—" : formatSize(e.size)}</span>
      <span className="cell dim hide-narrow">{e.isSymlink ? "Link" : e.isDir ? "Folder" : (e.extension ? e.extension.toUpperCase() : "File")}</span>
      <span className="cell dim">{formatDate(e.modified)}</span>
    </div>
  );
});

interface Props {
  pane: number;
  searchQuery: string;
  searchResults: FileEntry[] | null;
  searching: boolean;
  onContext(paths: string[], x: number, y: number): void;
  renaming: string | null;
  setRenaming(v: string | null): void;
}

export default function FileView({ pane, searchQuery, searchResults, searching, onContext, renaming, setRenaming }: Props) {
  const app = useApp();
  const p = app.panes[pane];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(680);
  const scrollRaf = useRef(0);
  // Per-directory scroll memory (capped): going back restores where you were.
  const scrollMem = useRef(new Map<string, number>());
  const pathRef = useRef(p?.path ?? "/");
  pathRef.current = p?.path ?? "/";
  const lastPath = useRef(p?.path ?? "/");
  // Remember a scroll offset for a SPECIFIC directory.
  const rememberPath = useCallback((key: string, top: number) => {
    if (!key) return;
    scrollMem.current.delete(key);
    scrollMem.current.set(key, top);
    if (scrollMem.current.size > 100) {
      const oldest = scrollMem.current.keys().next().value;
      if (oldest !== undefined) scrollMem.current.delete(oldest);
    }
  }, []);
  const remember = (top: number) => rememberPath(pathRef.current, top);
  // Scroll position drives windowing — throttle to one update per frame so
  // fast wheel flings don't re-render the list several times per frame.
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      remember(el.scrollTop);
      setScrollTop(el.scrollTop);
    });
  };
  // Measure the real viewport so the render window is right on any screen
  // (a hardcoded guess under-buffers short windows and over-draws tall ones).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const onAnyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    remember(e.currentTarget.scrollTop);
  };
  useEffect(() => () => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    // Never lose the offset of the directory we were looking at last.
    const el = scrollRef.current;
    if (el) {
      scrollMem.current.delete(lastPath.current);
      scrollMem.current.set(lastPath.current, el.scrollTop);
    }
  }, []);
  const [anchor, setAnchor] = useState<string | null>(null);
  const dragRef = useRef<{ paths: string[]; fromPane: number } | null>(null);
  // Bounded thumbnail cache (oldest evicted past the cap) so image-heavy
  // folders don't grow memory without limit.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  // Mirrors thumbUrls so the loader effect can read the cache without taking
  // the whole map as a dependency (which would re-fire on every thumbnail).
  const thumbRef = useRef<Record<string, string>>({});
  const [gridLimit, setGridLimit] = useState(GRID_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Entrance motion runs once per directory load — never for rows that mount
  // later while scrolling (those would shimmer on every scroll).
  const [fresh, setFresh] = useState(true);
  const [navDir, setNavDir] = useState(0);
  useEffect(() => {
    setFresh(true);
    setNavDir(p?.navDir ?? 0);
    const t = window.setTimeout(() => {
      setFresh(false);
      setNavDir(0);
    }, 420);
    return () => window.clearTimeout(t);
  }, [p?.path, p?.navDir]);

  // Search results are sorted too, not returned in raw walk order. Skipping
  // this put files and folders in one alphabetical stream, which read as
  // random — and ignored the user's sort preference while searching.
  const base = useMemo(
    () => sortEntries(searchResults ?? p?.entries ?? [], app.prefs.sortKey, app.prefs.sortDesc),
    [p?.entries, searchResults, app.prefs.sortKey, app.prefs.sortDesc],
  );

  // List window math, hoisted above the thumbnail loader so that loader can
  // see which rows are actually mounted. One screenful + generous buffer on
  // both sides so fast flings never reach an unrendered gap.
  //
  // Two coordinate spaces are in play. `scrollTop`/`viewportH` are measured on
  // the scroll container, which is OUTSIDE the zoomed canvas, so they are
  // already in visual pixels — hence `rowPx` (scaled) for picking the window.
  // The pad elements live INSIDE the zoomed canvas, so their CSS heights are
  // multiplied by the scale again and must stay in unscaled pixels.
  const rowPx = ROW_H * app.listScale;
  const listWindow = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowPx) - 14);
    const count = Math.ceil(viewportH / rowPx) + 40;
    const slice = base.slice(start, start + count);
    return {
      start,
      slice,
      topPad: start * ROW_H,
      bottomPad: Math.max(0, (base.length - start - slice.length) * ROW_H),
    };
  }, [base, scrollTop, viewportH, rowPx]);

  const visible = base;
  // Grid renders incrementally: first batch immediately, more as the user
  // scrolls (sentinel observer). Keeps huge folders fast and lean.
  const gridShown = app.prefs.mode === "grid" ? visible.slice(0, gridLimit) : visible;

  // Thumbnails load only for rows the user can actually see. The virtualizer
  // deliberately over-mounts (14 rows of lead, ~40 of trail) so fast scrolling
  // never hits an empty gap, but decoding images for those off-screen rows is
  // pure waste — in a folder of photos that was ~26 needless decodes per scroll
  // position. Grid keeps its batch (cells are large and already capped).
  const firstVis = Math.max(0, Math.floor(scrollTop / rowPx));
  const lastVis = Math.min(base.length, Math.ceil((scrollTop + viewportH) / rowPx) + 1);
  const mounted =
    app.prefs.mode === "grid"
      ? gridShown
      : base.slice(firstVis, lastVis);
  const mountedKey = `${app.prefs.mode}:${mounted.length}:${mounted[0]?.path ?? ""}:${mounted[mounted.length - 1]?.path ?? ""}`;

  useEffect(() => {
    const imgs = mounted
      .filter((e) => !e.isDir && isImageExt(e.extension) && !thumbRef.current[e.path])
      .slice(0, 48);
    if (imgs.length === 0) return;
    let cancelled = false;
    const put = (path: string, url: string) => {
      if (thumbRef.current[path]) return;
      thumbRef.current[path] = url;
      setThumbUrls((m) => {
        const next: Record<string, string> = { ...m, [path]: url };
        const keys = Object.keys(next);
        if (keys.length > THUMB_CACHE_MAX) {
          for (const k of keys.slice(0, keys.length - THUMB_CACHE_MAX)) {
            delete next[k];
            delete thumbRef.current[k];
          }
        }
        return next;
      });
    };
    void (async () => {
      for (let i = 0; i < imgs.length; i += THUMB_CONCURRENCY) {
        if (cancelled) return;
        const batch = imgs.slice(i, i + THUMB_CONCURRENCY);
        await Promise.all(batch.map(async (e) => {
          try {
            const raw = await fsApi.readImageDataUrl(e.path);
            // Downscale before caching: the raw bytes are megabytes, the
            // thumbnail itself is a couple of KB.
            const small = await shrinkDataUrl(raw, app.prefs.mode === "grid" ? 160 : 72);
            if (!cancelled && small) put(e.path, small);
          } catch {
            /* leave icon fallback */
          }
        }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, p?.path, mountedKey, app.prefs.mode]);

  useEffect(() => {
    setGridLimit(GRID_BATCH);
  }, [p?.path, searchQuery, app.prefs.mode]);
  useEffect(() => {
    if (app.prefs.mode !== "grid") return;
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const obs = new IntersectionObserver(
      (items) => {
        if (items.some((it) => it.isIntersecting)) {
          setGridLimit((l) => (l >= visible.length ? l : l + GRID_BATCH));
        }
      },
      { root, rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [app.prefs.mode, visible.length, pane, p?.path]);

  useEffect(() => {
    setScrollTop(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [searchQuery]);

  // Directory change: snapshot the on-screen entries, then restore the
  // remembered offset once a FRESH listing for the new path lands.
  // (Identity of the entries array — not the loading flag, which React may
  // batch away entirely for fast directories, starving the restore.)
  // Applying to the stale listing still on screen would compute against the
  // wrong content and strand the view past the end.
  const stagedPath = useRef<string | null>(null);
  const stagedEntries = useRef<FileEntry[] | null>(null);
  // Remember the scroll offset of the directory we are LEAVING, keyed to
  // THAT directory — otherwise the parent's only recorded offset is
  // whatever it had before we entered the child.
  const rememberOnLeave = useCallback((key: string) => {
    const el = scrollRef.current;
    if (el) rememberPath(key, el.scrollTop);
  }, [rememberPath]);
  useEffect(() => {
    if (p?.path && p.path !== lastPath.current) {
      rememberOnLeave(lastPath.current);
      lastPath.current = p.path;
    }
  }, [p?.path, rememberOnLeave]);
  useEffect(() => {
    stagedPath.current = p?.path ?? "";
    stagedEntries.current = p?.entries ?? null;
  }, [p?.path]);
  useEffect(() => {
    if (!p || stagedPath.current == null || stagedPath.current !== p.path) return;
    if (stagedEntries.current != null && p.entries === stagedEntries.current) return;
    stagedPath.current = null;
    stagedEntries.current = null;
    const top = scrollMem.current.get(p.path) ?? 0;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = top;
      // The browser clamps to the real maximum (big offset into a short
      // directory). State MUST take the clamped value back — otherwise the
      // virtualized window is computed past the end and renders zero rows.
      const applied = el.scrollTop;
      setScrollTop(applied);
      remember(applied);
    }
  }, [p, p?.loading, p?.entries]);

  if (!p) return null;

  const sel = new Set(p.selection);

  const openEntry = (e: FileEntry) => {
    if (e.isDir) app.navigate(pane, e.path);
    else fsApi.openPath(e.path).catch((err) => app.toast("error", err.message));
  };

  const clickSelect = (ev: React.MouseEvent, e: FileEntry, index: number) => {
    app.setFocusPane(pane);
    let next: string[];
    if (ev.shiftKey && anchor) {
      const a = base.findIndex((x) => x.path === anchor);
      const [lo, hi] = a < 0 ? [index, index] : [Math.min(a, index), Math.max(a, index)];
      next = base.slice(lo, hi + 1).map((x) => x.path);
    } else if (ev.ctrlKey || ev.metaKey) {
      next = sel.has(e.path) ? [...p.selection.filter((s) => s !== e.path)] : [...p.selection, e.path];
      setAnchor(e.path);
    } else {
      next = [e.path];
      setAnchor(e.path);
    }
    app.setSelection(pane, next);
    setPanesFocus(index);
  };

  const setPanesFocus = (_i: number) => {
    // focus index tracked via selection anchor; kept minimal on purpose.
  };

  const onKey = (ev: React.KeyboardEvent) => {
    const idx = base.findIndex((x) => x.path === (p.selection[p.selection.length - 1] ?? anchor));
    const cur = idx < 0 ? 0 : idx;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const next = ev.key === "ArrowDown" ? Math.min(base.length - 1, cur + 1) : Math.max(0, cur - 1);
      const target = base[next];
      if (!target) return;
      if (ev.shiftKey) {
        const a = anchor ?? base[cur]?.path ?? target.path;
        const ai = base.findIndex((x) => x.path === a);
        const [lo, hi] = [Math.min(ai, next), Math.max(ai, next)];
        app.setSelection(pane, base.slice(lo, hi + 1).map((x) => x.path));
      } else {
        app.setSelection(pane, [target.path]);
        setAnchor(target.path);
      }
      scrollRef.current?.querySelector(`[data-path="${CSS.escape(target.path)}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter" && !ev.altKey) {
      const t = base[cur];
      if (t) openEntry(t);
    }
  };

  const commitRename = async (oldPath: string, newName: string) => {
    setRenaming(null);
    const entry = base.find((x) => x.path === oldPath);
    if (!entry || newName === entry.name || !newName.trim()) return;
    try {
      await fsApi.renamePath(oldPath, newName.trim());
      app.refreshAll();
    } catch (e) {
      app.toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const onDropOn = async (ev: React.DragEvent, destDir: string) => {
    ev.preventDefault();
    const d = dragRef.current;
    if (!d || d.paths.length === 0) return;
    if (d.paths.some((s) => s === destDir || destDir.startsWith(s + "/"))) {
      app.toast("error", "Cannot move a folder into itself");
      return;
    }
    try {
      const mover = ev.ctrlKey ? fsApi.copyPaths : fsApi.movePaths;
      const res = await mover(d.paths, destDir);
      if (!res.ok && res.conflicts.length > 0) {
        app.askConflict("Move conflicts", res.conflicts, async (how) => {
          if (how === "skip") return;
          await mover(d.paths, destDir, how === "overwrite" ? { overwrite: true } : { keepBoth: true });
          app.refreshAll();
        });
        return;
      }
      if (!res.ok) app.toast("error", res.failures.map((f) => f.message).join("; "));
      app.refreshAll();
    } catch (e) {
      app.toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      dragRef.current = null;
    }
  };

  if (p.loading) {
    return (
      <div className="file-scroll" aria-busy="true" aria-label="Loading folder">
        {Array.from({ length: 10 }, (_, i) => (
          <div className="skel-row" key={i} style={{ opacity: 1 - i * 0.08 }}><span /></div>
        ))}
      </div>
    );
  }
  if (p.error) {
    return (
      <div className="file-scroll">
        <div className="notice error" role="alert">
          Cannot open this folder: {p.error}
          <button className="mini-btn" onClick={() => app.refresh(pane)}>Retry</button>
        </div>
      </div>
    );
  }
  if (searching) {
    return (
      <div className="file-scroll" aria-busy="true">
        <div className="empty-state"><h3>Searching…</h3><p>Press Esc to clear.</p></div>
      </div>
    );
  }
  if (base.length === 0) {
    return (
      <div className="file-scroll">
        <div className="empty-state">
          <Folder size={36} strokeWidth={1.25} />
          <h3>{searchQuery ? `No matches for “${searchQuery}”` : "This folder is empty"}</h3>
          <p style={{ margin: 0, fontSize: 12 }}>Try <code>type:pdf</code>, <code>ext:png</code> or <code>size:&gt;10mb</code></p>
        </div>
      </div>
    );
  }

  const sortBtn = (key: "name" | "size" | "modified" | "type", label: string, narrow = false) => (
    <button
      className={narrow ? "hide-narrow" : ""}
      onClick={() => {
        if (app.prefs.sortKey === key) app.setPrefs({ sortDesc: !app.prefs.sortDesc });
        else app.setPrefs({ sortKey: key, sortDesc: false });
      }}
    >
      {label}{app.prefs.sortKey === key ? (app.prefs.sortDesc ? " ↓" : " ↑") : ""}
    </button>
  );

  if (app.prefs.mode === "grid") {
    return (
      <div
        className={`file-scroll${fresh ? " fresh" : ""}${navDir === 1 ? " nav-in" : navDir === -1 ? " nav-out" : ""}`}
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={onAnyScroll}
        onClick={() => { app.setFocusPane(pane); }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".grid-item")) return;
          onContext(p.selection, e.clientX, e.clientY);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void onDropOn(e, p.path)}
        onWheel={(e) => {
          // Ctrl+Wheel resizes the icons in the grid only.
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          app.setListScale(app.listScale + (e.deltaY < 0 ? 0.05 : -0.05));
        }}
      >
        <div className="file-canvas" style={{ zoom: app.listScale === 1 ? undefined : app.listScale }}>
        <div className="grid-wrap">
          {gridShown.map((e, i) => (
            <div
              key={e.path}
              data-path={e.path}
              className={`grid-item${sel.has(e.path) ? " selected" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
              draggable={renaming !== e.path}
              onDragStart={(ev) => {
                const paths = sel.has(e.path) ? p.selection : [e.path];
                dragRef.current = { paths, fromPane: pane };
                ev.dataTransfer.setData("text/plain", JSON.stringify(paths));
                ev.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(ev) => { if (e.isDir) ev.preventDefault(); }}
              onDrop={(ev) => { if (e.isDir) { ev.stopPropagation(); void onDropOn(ev, e.path); } }}
              onClick={(ev) => clickSelect(ev, e, base.indexOf(e))}
              onDoubleClick={() => openEntry(e)}
              onContextMenu={(ev) => {
                ev.stopPropagation();
                const paths = sel.has(e.path) ? p.selection : [e.path];
                if (!sel.has(e.path)) app.setSelection(pane, paths);
                app.setFocusPane(pane);
                onContext(paths, ev.clientX, ev.clientY);
              }}
              title={`${e.name}\n${formatSize(e.size)} · ${formatDate(e.modified)}`}
            >
              <span className="thumb">
                {thumbUrls[e.path] ? <img src={thumbUrls[e.path]} alt="" draggable={false} /> : <ExtIcon entry={e} size={40} />}
              </span>
              {renaming === e.path ? (
                <input
                  className="rename-input"
                  autoFocus
                  defaultValue={e.name}
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") void commitRename(e.path, (ev.target as HTMLInputElement).value);
                    if (ev.key === "Escape") setRenaming(null);
                    ev.stopPropagation();
                  }}
                  onBlur={(ev) => void commitRename(e.path, ev.target.value)}
                />
              ) : (
                <span className="gname">{highlight(e.name, searchQuery)}</span>
              )}
            </div>
          ))}
          {gridShown.length < visible.length && (
            <div ref={sentinelRef} style={{ gridColumn: "1 / -1", padding: 12, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              Showing {gridShown.length} of {visible.length} — scroll for more
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  // List mode with lightweight virtualization for large directories.
  // The window itself is computed in `listWindow` above the render.

  return (
    <div
      className={`file-scroll${fresh ? " fresh" : ""}${navDir === 1 ? " nav-in" : navDir === -1 ? " nav-out" : ""}`}
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKey}
      onScroll={onListScroll}
      onClick={() => { app.setFocusPane(pane); }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".file-row")) return;
        onContext(p.selection, e.clientX, e.clientY);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDropOn(e, p.path)}
      onWheel={(e) => {
        // Ctrl+Wheel resizes the icons in the list only.
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        app.setListScale(app.listScale + (e.deltaY < 0 ? 0.05 : -0.05));
      }}
      role="grid"
      aria-label={`Files in ${p.path}`}
      aria-rowcount={base.length}
    >
      {/* Zoom-scaled content canvas: text + icons scale together, while
          the scroll container (and thus the windowing math) stays stable. */}
      <div className="file-canvas" style={{ zoom: app.listScale === 1 ? undefined : app.listScale }}>
      <div className="file-list-header" role="row">
        <span>{sortBtn("name", "Name")}</span>
        <span>{sortBtn("size", "Size")}</span>
        <span className="hide-narrow">{sortBtn("type", "Type", true)}</span>
        <span>{sortBtn("modified", "Modified")}</span>
      </div>
      <div style={{ height: listWindow.topPad }} />
      {listWindow.slice.map((e, i) => (
        <FileRow
          key={e.path}
          entry={e}
          selected={sel.has(e.path)}
          renaming={renaming === e.path}
          q={searchQuery}
          index={listWindow.start + i}
          thumb={thumbUrls[e.path]}
          onClick={(ev) => clickSelect(ev, e, base.indexOf(e))}
          onDoubleClick={() => openEntry(e)}
          onContext={(ev) => {
            ev.stopPropagation();
            const paths = sel.has(e.path) ? p.selection : [e.path];
            if (!sel.has(e.path)) app.setSelection(pane, paths);
            app.setFocusPane(pane);
            onContext(paths, ev.clientX, ev.clientY);
          }}
          onDragStart={(ev) => {
            const paths = sel.has(e.path) ? p.selection : [e.path];
            dragRef.current = { paths, fromPane: pane };
            ev.dataTransfer.setData("text/plain", JSON.stringify(paths));
            ev.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(ev) => { if (e.isDir) ev.preventDefault(); }}
          onDrop={(ev) => { if (e.isDir) { ev.stopPropagation(); void onDropOn(ev, e.path); } }}
          onRenameCommit={(path, name) => void commitRename(path, name)}
          onRenameCancel={() => setRenaming(null)}
        />
      ))}
      <div style={{ height: listWindow.bottomPad }} />
      </div>
    </div>
  );
}
