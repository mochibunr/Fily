import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store/app";

export interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  run(): void;
}

export default function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose(): void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useApp();
  void toast;

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return commands.filter((c) => !needle || c.label.toLowerCase().includes(needle) || c.hint.toLowerCase().includes(needle)).slice(0, 12);
  }, [commands, q]);

  useEffect(() => {
    inputRef.current?.focus();
    setIdx(0);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          value={q}
          placeholder="Type a command…"
          aria-label="Command search"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") { filtered[idx]?.run(); onClose(); }
          }}
        />
        <ul>
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button className={i === idx ? "on" : ""} onMouseEnter={() => setIdx(i)} onClick={() => { c.run(); onClose(); }}>
                <span>{c.label}</span>
                <span className="kbd">{c.hint}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-3)" }}>No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
