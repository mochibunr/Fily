import { useEffect, useRef, useState } from "react";
import { useApp } from "../store/app";
import { formatSize } from "../utils/format";

export function Dialogs() {
  const app = useApp();
  const [promptVal, setPromptVal] = useState("");
  const [conflictChoice, setConflictChoice] = useState<"overwrite" | "keepBoth" | "skip">("keepBoth");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (app.promptState) {
      setPromptVal(app.promptState.initial);
      window.setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [app.promptState]);

  useEffect(() => {
    if (app.conflictState) setConflictChoice("keepBoth");
  }, [app.conflictState]);

  return (
    <>
      {app.toasts.length > 0 && (
        <div className="toasts" aria-live="polite">
          {app.toasts.map((t) => (
            <div key={t.id} className={`toast${t.kind === "error" ? " error" : ""}`} role={t.kind === "error" ? "alert" : "status"}>
              <span>{t.text}</span>
              <button aria-label="Dismiss" onClick={() => app.dismissToast(t.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {app.confirmState && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) app.closeConfirm(); }}>
          <div className="dialog" role="alertdialog" aria-label={app.confirmState.title}>
            <header>{app.confirmState.title}</header>
            <div className="body"><div className="hint">{app.confirmState.body}</div></div>
            <footer>
              <button className="mini-btn" onClick={app.closeConfirm}>Cancel</button>
              <button
                className="mini-btn primary"
                autoFocus
                onClick={() => { const f = app.confirmState!.onConfirm; app.closeConfirm(); f(); }}
              >
                {app.confirmState.confirmLabel}
              </button>
            </footer>
          </div>
        </div>
      )}

      {app.conflictState && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) app.closeConflict(); }}>
          <div className="dialog" role="dialog" aria-label={app.conflictState.title}>
            <header>{app.conflictState.title}</header>
            <div className="body">
              <div className="hint">These files already exist at the destination:</div>
              <div className="conflict-list">
                {app.conflictState.conflicts.map((c) => <code key={c}>{c}</code>)}
              </div>
              <label className="radio-row"><input type="radio" name="cf" checked={conflictChoice === "keepBoth"} onChange={() => setConflictChoice("keepBoth")} /> Keep both (rename copies)</label>
              <label className="radio-row"><input type="radio" name="cf" checked={conflictChoice === "overwrite"} onChange={() => setConflictChoice("overwrite")} /> Replace existing files</label>
              <label className="radio-row"><input type="radio" name="cf" checked={conflictChoice === "skip"} onChange={() => setConflictChoice("skip")} /> Skip</label>
            </div>
            <footer>
              <button className="mini-btn" onClick={app.closeConflict}>Cancel</button>
              <button
                className="mini-btn primary"
                onClick={() => { const r = app.conflictState!.resolve; const c = conflictChoice; app.closeConflict(); r(c); }}
              >
                Apply
              </button>
            </footer>
          </div>
        </div>
      )}

      {app.promptState && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) app.closePrompt(); }}>
          <div className="dialog" role="dialog" aria-label={app.promptState.title}>
            <header>{app.promptState.title}</header>
            <div className="body">
              <label style={{ fontSize: 12 }}>{app.promptState.label}</label>
              <input
                ref={inputRef}
                type="text"
                value={promptVal}
                onChange={(e) => setPromptVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && promptVal.trim()) {
                    const v = promptVal.trim();
                    const fn = app.promptState!.onSubmit;
                    app.closePrompt();
                    void fn(v);
                  }
                  if (e.key === "Escape") app.closePrompt();
                }}
              />
            </div>
            <footer>
              <button className="mini-btn" onClick={app.closePrompt}>Cancel</button>
              <button
                className="mini-btn primary"
                disabled={!promptVal.trim()}
                onClick={() => { const v = promptVal.trim(); const fn = app.promptState!.onSubmit; app.closePrompt(); void fn(v); }}
              >
                Create
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

export function StatusBar({ total, shown }: { total: number; shown: number }) {
  const app = useApp();
  const sel = app.panes[app.focusPane]?.selection ?? [];  const selEntries = app.panes[app.focusPane]?.entries.filter((e) => sel.includes(e.path)) ?? [];
  const selBytes = selEntries.filter((e) => !e.isDir).reduce((a, e) => a + e.size, 0);
  return (
    <div className="statusbar" role="status">
      <span>{shown === total ? `${total} items` : `${shown} of ${total} shown`}</span>
      {app.showHidden && <span>· hidden shown</span>}
      {sel.length > 0 && <span>{sel.length} selected{selBytes > 0 ? ` · ${formatSize(selBytes)}` : ""}</span>}
      <span className="right">
        <span>{app.panes[app.focusPane]?.path}</span>
      </span>
    </div>
  );
}
