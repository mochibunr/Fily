import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
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

  // Clamp the menu into the viewport AFTER every commit, by toggling a class.
  //
  // Applying `el.style.top` imperatively did not work: React writes style.top
  // from props on every re-render, so the correction was undone and a tall
  // menu ran off the bottom, hiding "Move to Trash" and "Delete forever…".
  // A stylesheet rule with `!important` beats React's inline style, so the
  // clamp cannot be lost. See `.ctx-menu.ctx-up` / `.ctx-left`.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.classList.toggle("ctx-up", y + r.height > window.innerHeight - 8);
    el.classList.toggle("ctx-left", x + r.width > window.innerWidth - 8);
  });

  useEffect(() => {
    const el = ref.current;
    if (el) {
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
