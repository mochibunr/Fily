import { useEffect, useMemo, useState } from "react";
import { fsApi } from "../api/fs";
import { useApp } from "../store/app";
import { formatDate, formatSize, kindLabel } from "../utils/format";

export function BulkRenameDialog({ paths, names, onClose }: { paths: string[]; names: string[]; onClose(): void }) {
  const app = useApp();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [pattern, setPattern] = useState("{name}");
  const [startNum, setStartNum] = useState(1);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    return paths.map((p, i) => {
      const orig = names[i] ?? p.split("/").pop() ?? p;
      const dot = orig.lastIndexOf(".");
      const stem = dot > 0 ? orig.slice(0, dot) : orig;
      const ext = dot > 0 ? orig.slice(dot) : "";
      let next = pattern
        .replaceAll("{name}", stem)
        .replaceAll("{ext}", ext.replace(/^\./, ""))
        .replaceAll("{n}", String(startNum + i));
      if (!next.includes(".") && ext) next += ext;
      if (find) next = next.split(find).join(replace);
      const dir = p.slice(0, p.length - orig.length);
      return { from: p, to: dir + next, display: next };
    });
  }, [paths, names, pattern, startNum, find, replace]);

  const apply = async () => {
    const dupes = new Set(preview.map((x) => x.to));
    if (dupes.size !== preview.length) {
      app.toast("error", "Rename preview contains duplicate names — adjust the pattern");
      return;
    }
    setBusy(true);
    let failed = 0;
    for (const r of preview) {
      if (r.from === r.to) continue;
      const newName = r.display;
      try {
        await fsApi.renamePath(r.from, newName);
      } catch {
        failed++;
      }
    }
    setBusy(false);
    onClose();
    app.refreshAll();
    if (failed > 0) app.toast("error", `${failed} rename(s) failed`);
    else app.toast("info", "Renamed successfully");
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="Bulk rename" style={{ width: 560 }}>
        <header>Bulk rename ({paths.length} items)</header>
        <div className="body">
          <div className="hint">Pattern tokens: <code>{"{name}"}</code> original name, <code>{"{ext}"}</code> extension, <code>{"{n}"}</code> number.</div>
          <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Name pattern" />
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={find} placeholder="Find" aria-label="Find" onChange={(e) => setFind(e.target.value)} />
            <input type="text" value={replace} placeholder="Replace with" aria-label="Replace with" onChange={(e) => setReplace(e.target.value)} />
            <input type="text" inputMode="numeric" value={startNum} aria-label="Start number" style={{ maxWidth: 90 }}
              onChange={(e) => setStartNum(Number.parseInt(e.target.value, 10) || 1)} />
          </div>
          <div className="conflict-list" style={{ maxHeight: 220 }}>
            {preview.map((r) => (
              <div key={r.from} style={{ display: "flex", gap: 8 }}>
                <code style={{ color: "var(--text-3)" }}>{r.from.split("/").pop()}</code>
                <span>→</span>
                <code>{r.display}</code>
              </div>
            ))}
          </div>
        </div>
        <footer>
          <button className="mini-btn" onClick={onClose}>Cancel</button>
          <button className="mini-btn primary" disabled={busy} onClick={() => void apply()}>
            {busy ? "Renaming…" : "Apply"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function PropertiesDialog({ path, onClose }: { path: string; onClose(): void }) {
  const app = useApp();
  const [entry, setEntry] = useState<{ name: string; size: number; modified: number | null; created: number | null; extension: string; mime: string; isDir: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [folderSize, setFolderSize] = useState<number | null>(null);

  useEffect(() => {
    fsApi.statPath(path)
      .then((e) => {
        setEntry(e);
        if (e.isDir) fsApi.dirSize(path).then(setFolderSize).catch(() => {});
        else fsApi.fileChecksum(path).then(setHash).catch(() => {});
      })
      .catch((e: Error) => setErr(e.message));
  }, [path]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="Properties">
        <header>Properties</header>
        <div className="body">
          {err && <div className="err">{err}</div>}
          {entry ? (
            <dl className="kv">
              <dt>Name</dt><dd>{entry.name}</dd>
              <dt>Type</dt><dd>{kindLabel(entry.isDir, entry.extension, entry.mime)}</dd>
              <dt>Size</dt><dd>{entry.isDir ? (folderSize != null ? formatSize(folderSize) : "Measuring…") : formatSize(entry.size)}</dd>
              <dt>Modified</dt><dd>{formatDate(entry.modified)}</dd>
              <dt>Created</dt><dd>{formatDate(entry.created)}</dd>
              <dt>Path</dt><dd style={{ fontSize: 11 }}>{path}</dd>
              {hash && <><dt>SHA-256</dt><dd className="hash">{hash}</dd></>}
            </dl>
          ) : !err && <div className="hint">Loading…</div>}
          <button className="mini-btn" onClick={() => { void navigator.clipboard?.writeText(path).then(() => app.toast("info", "Path copied")).catch(() => {}); }}>
            Copy path
          </button>
        </div>
        <footer>
          <button className="mini-btn primary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
