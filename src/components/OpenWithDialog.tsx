import { AppWindow } from "lucide-react";
import { useEffect, useState } from "react";
import { fsApi, type Opener } from "../api/fs";
import { useApp } from "../store/app";

export default function OpenWithDialog({ path, mime, name, onClose }: {
  path: string;
  mime: string;
  name: string;
  onClose(): void;
}) {
  const app = useApp();
  const [openers, setOpeners] = useState<Opener[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fsApi.getOpeners(mime || "application/octet-stream")
      .then(setOpeners)
      .catch((e: Error) => setError(e.message));
  }, [mime]);

  const launch = async (id: string) => {
    setBusy(id);
    try {
      await fsApi.openWith(path, id);
      onClose();
    } catch (e) {
      app.toast("error", e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label={`Open ${name} with`}>
        <header>Open “{name}” with</header>
        <div className="body">
          {error && <div className="err">{error}</div>}
          {openers == null && !error && <div className="hint">Looking for applications…</div>}
          {openers != null && openers.length === 0 && (
            <div className="hint">No installed application declares this file type. It can still be opened with the default app from the file menu.</div>
          )}
          {openers?.map((o) => (
            <button key={o.id} className="ctx-item" style={{ border: "1px solid var(--border)" }} onClick={() => void launch(o.id)} disabled={busy != null}>
              <AppWindow size={15} style={{ color: "var(--ext-code)" }} />
              <span style={{ flex: 1 }}>{o.name}</span>
              {busy === o.id && <span className="hint">Launching…</span>}
            </button>
          ))}
        </div>
        <footer>
          <button className="mini-btn" onClick={onClose}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}
