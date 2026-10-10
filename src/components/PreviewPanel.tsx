import { ExternalLink, FolderOutput } from "lucide-react";
import { useEffect, useState } from "react";
import { fsApi } from "../api/fs";
import { useApp } from "../store/app";
import type { FileEntry } from "../types";
import { formatDate, formatSize, isArchiveExt, isAudioExt, isImageExt, isPdfExt, isTextExt, isVideoExt, kindLabel } from "../utils/format";
import ExtIcon from "./ExtIcon";

function usePreviewEntry(path: string | null): FileEntry | null {
  const [entry, setEntry] = useState<FileEntry | null>(null);
  useEffect(() => {
    if (!path) { setEntry(null); return; }
    let dead = false;
    fsApi.statPath(path).then((e) => { if (!dead) setEntry(e); }).catch(() => { if (!dead) setEntry(null); });
    return () => { dead = true; };
  }, [path]);
  return entry;
}

export default function PreviewPanel({ path }: { path: string | null }) {
  const app = useApp();
  const entry = usePreviewEntry(path);
  const [text, setText] = useState<string | null>(null);
  const [textNote, setTextNote] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [archive, setArchive] = useState<string[] | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [hashBusy, setHashBusy] = useState(false);
  const [folderSize, setFolderSize] = useState<number | null>(null);
  const [sizeBusy, setSizeBusy] = useState(false);

  useEffect(() => {
    setText(null); setTextNote(""); setImg(null); setArchive(null); setHash(null); setFolderSize(null);
    if (!entry) return;
    let dead = false;
    const ext = entry.extension.toLowerCase();
    if (!entry.isDir && isTextExt(ext) && entry.size < 4 * 1024 * 1024) {
      fsApi.readTextPreview(entry.path)
        .then((r) => { if (!dead) { setText(r.text as string); setTextNote((r.truncated as boolean) ? "Truncated to first 256 KB" : ""); } })
        .catch((e) => { if (!dead) setTextNote(e.message); });
    }
    if (!entry.isDir && isImageExt(ext)) {
      fsApi.readImageDataUrl(entry.path).then((u) => { if (!dead) setImg(u); }).catch(() => {});
    }
    if (!entry.isDir && ext === "zip") {
      fsApi.listArchive(entry.path).then((n) => { if (!dead) setArchive(n); }).catch(() => { if (!dead) setArchive([]); });
    }
    return () => { dead = true; };
  }, [entry?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app.previewVisible) return null;
  if (!entry) {
    return (
      <aside className="preview preview-empty" aria-label="Preview">
        <ExtIcon entry={{ name: "", path: "", isDir: true, isSymlink: false, isHidden: false, size: 0, modified: null, created: null, extension: "", mime: "" }} size={40} />
        <p>Select a file to see its preview, details and quick actions here.</p>
      </aside>
    );
  }

  const ext = entry.extension.toLowerCase();
  const showAudio = !entry.isDir && isAudioExt(ext);
  const showVideo = !entry.isDir && isVideoExt(ext);
  const showPdf = !entry.isDir && isPdfExt(ext);
  const showArchive = !entry.isDir && isArchiveExt(ext);
  const kind = kindLabel(entry.isDir, entry.extension, entry.mime);

  return (
    <aside className="preview" aria-label="Preview">
      <div className="pv-swap" key={entry.path}>
      <div className="pv-head">
        <span className="pv-icon">
          {img ? <img src={img} alt="" /> : <ExtIcon entry={entry} size={40} />}
        </span>
        <div className="pv-title">
          <span className="pv-name">{entry.name}</span>
          <span className="pv-kind">{kind}</span>
        </div>
      </div>

      <div className="pv-thumb pv-thumb-lg">
        {img ? <img src={img} alt={entry.name} /> :
          text != null ? <pre>{text || "(empty file)"}</pre> :
          <span className="pv-fallback">{entry.isDir ? "Folder" : textNote || kind}</span>}
      </div>
      {textNote && !img && <div className="pv-note">{textNote}</div>}

      {showAudio && (
        <div className="pv-note">Audio file — use Open below to play in your default player.</div>
      )}
      {showVideo && <div className="pv-note">Video — opens in your system player for full playback.</div>}
      {showPdf && (
        <div className="pv-note">PDF preview opens in your default reader for full fidelity.</div>
      )}
      {showArchive && (
        <section className="pv-section" aria-label="Archive contents">
          <h5>Inside this archive {archive ? `(${archive.length}${archive.length >= 500 ? "+" : ""})` : ""}</h5>
          <div className="pv-archlist">
            {archive == null ? "Reading…" : archive.length === 0 ? "Could not list (unsupported format)." : archive.slice(0, 100).map((n) => <div key={n}>{n}</div>)}
          </div>
          {ext === "zip" && (
            <div className="pv-actions" style={{ marginTop: 8 }}>
              <button className="mini-btn" onClick={() => void fsApi.extractHere(entry.path).then(() => { app.toast("info", "Archive extracted"); app.refreshAll(); }).catch((e: Error) => app.toast("error", e.message))}>
                <FolderOutput size={13} /> Extract here
              </button>
            </div>
          )}
        </section>
      )}

      <dl className="pv-meta">
        <div><dt>Size</dt><dd>{entry.isDir ? (folderSize != null ? formatSize(folderSize) : sizeBusy ? "Measuring…" : "—") : formatSize(entry.size)}</dd></div>
        <div><dt>Modified</dt><dd>{formatDate(entry.modified)}</dd></div>
        <div><dt>Created</dt><dd>{formatDate(entry.created)}</dd></div>
        <div><dt>Location</dt><dd className="pv-path">{entry.path}</dd></div>
        {entry.isSymlink && <div><dt>Link</dt><dd>Symbolic link</dd></div>}
      </dl>

      {entry.isDir && folderSize == null && (
        <button className="mini-btn" disabled={sizeBusy} onClick={async () => {
          setSizeBusy(true);
          try { setFolderSize(await fsApi.dirSize(entry.path)); }
          catch (e) { app.toast("error", e instanceof Error ? e.message : String(e)); }
          finally { setSizeBusy(false); }
        }}>
          {sizeBusy ? "Measuring…" : "Calculate folder size"}
        </button>
      )}

      {!entry.isDir && (
        hash ? <div className="pv-hash" title="SHA-256">sha256 · {hash.slice(0, 24)}…</div> : (
          <button className="mini-btn" disabled={hashBusy} onClick={async () => {
            setHashBusy(true);
            try { setHash(await fsApi.fileChecksum(entry.path)); }
            catch (e) { app.toast("error", e instanceof Error ? e.message : String(e)); }
            finally { setHashBusy(false); }
          }}>
            {hashBusy ? "Hashing…" : "Compute SHA-256"}
          </button>
        )
      )}

      <div className="pv-actions">
        {!entry.isDir && (
          <button className="mini-btn primary" onClick={() => fsApi.openPath(entry.path).catch((e) => app.toast("error", e.message))}>
            <ExternalLink size={13} /> Open
          </button>
        )}
        <button className="mini-btn" onClick={() => { void navigator.clipboard?.writeText(entry.path).then(() => app.toast("info", "Path copied")).catch(() => app.toast("error", "Copy failed")); }}>
          Copy path
        </button>
        <button className="mini-btn" onClick={() => fsApi.openTerminal(entry.path).catch((e) => app.toast("error", e.message))}>
          Terminal
        </button>
      </div>
      </div>
    </aside>
  );
}
