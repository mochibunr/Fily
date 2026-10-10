import { useEffect, useRef, type CSSProperties } from "react";
export interface CtxItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  action(): void;
}

export default function ContextMenu({ x, y, sections, onClose }: {
  x: number;
  y: number;
  sections: { title?: string; items: CtxItem[] }[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
      if (y + r.height > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
      (el.querySelector("button:not(:disabled)") as HTMLButtonElement | null)?.focus();
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [x, y, onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{
        left: x,
        top: y,
        "--menu-origin": `${x > window.innerWidth / 2 ? "right" : "left"} ${y > window.innerHeight / 2 ? "bottom" : "top"}`,
      } as CSSProperties}
      role="menu"
    >      {sections.map((s, i) => (
        <div key={i}>
          {i > 0 && <div className="ctx-sep" />}
          {s.title && <div className="ctx-label">{s.title}</div>}
          {s.items.map((it) => (
            <button
              key={it.label}
              className={`ctx-item${it.danger ? " danger" : ""}`}
              disabled={it.disabled}
              role="menuitem"
              onClick={() => { onClose(); it.action(); }}
            >
              {it.icon && <span className="ctx-icon">{it.icon}</span>}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.shortcut && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{it.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
