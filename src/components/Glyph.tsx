/**
 * Filled icon set for Fily.
 *
 * Lucide is stroke-only, so "filled" icons aren't achievable by styling it.
 * These are authored solids: a saturated body with a white emblem knocked
 * into it, which stays legible at 17px in a dense list. All shapes are
 * single-path where possible and drawn on a 24x24 grid.
 */

export type GlyphKind =
  | "folder"
  | "doc-text"
  | "doc-code"
  | "doc-image"
  | "doc-audio"
  | "doc-video"
  | "doc-pdf"
  | "doc-sheet"
  | "doc-slides"
  | "doc-font"
  | "doc-archive"
  | "doc-package"
  | "doc-generic"
  | "doc-config"
  | "doc-markdown"
  | "doc-terminal"
  | "doc-database"
  | "doc-lock"
  | "doc-shield"
  | "doc-cube"
  | "doc-book"
  | "doc-disc"
  | "doc-binary"
  | "doc-cloud"
  | "folder-code"
  | "folder-image"
  | "folder-open"
  | "doc-lang"
  | "link";

const DOC_BODY =
  "M7 2.6h6.2L19 8.4v13A1.6 1.6 0 0 1 17.4 23H7A1.6 1.6 0 0 1 5.4 21.4V4.2A1.6 1.6 0 0 1 7 2.6z";
const DOC_FOLD = "M13.2 2.6v5.2a.6.6 0 0 0 .6.6h5.2z";

const W = "#ffffff";

function GlyphSvg({ kind, label }: { kind: GlyphKind; label?: string }) {
  // Fit the abbreviation to the width of the document body. The body spans
  // roughly x=5.4..19 below the fold, so ~13.6 units of usable width; four
  // bold characters at a readable size overflowed it, which is why longer
  // labels shrink and the whole thing is centred on the body's midpoint
  // (12.2) rather than the viewBox centre.
  const len = label?.length ?? 0;
  const labelSize = len <= 1 ? 9 : len === 2 ? 8.2 : len === 3 ? 6.9 : 5.2;
  const labelY = 17.5;
  switch (kind) {
    case "folder":
      return (
        <>
          <path
            d="M2.8 7.4A2.8 2.8 0 0 1 5.6 4.6h3.6c.85 0 1.66.4 2.17 1.08l1.1 1.5h6.97a2.8 2.8 0 0 1 2.8 2.8v8.62a2.8 2.8 0 0 1-2.8 2.8H5.6a2.8 2.8 0 0 1-2.8-2.8z"
            fill="currentColor"
          />
          <path d="M2.8 10.6h20.5v7.42a2.8 2.8 0 0 1-2.8 2.8H5.6a2.8 2.8 0 0 1-2.8-2.8z" fill={W} opacity={0.16} />
        </>
      );
    case "doc-image":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <circle cx="9.6" cy="14.4" r="1.7" fill={W} />
          <path d="M8 20.4l3.6-4.3 2.3 2.6 1.9-2.1 3.2 3.8z" fill={W} />
        </>
      );
    case "doc-video":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.9 12.6l7.2 3.9-7.2 3.9z" fill={W} />
        </>
      );
    case "doc-audio":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <circle cx="10" cy="17.4" r="2.3" fill={W} />
          <path d="M11.6 16.2V11l5-1.2v1.9l-5 1.2z" fill={W} />
        </>
      );
    case "doc-lang":
      // The extension spelled out, knocked out of a filled document body.
      // A generic `</>` glyph cannot tell .js from .json from .py at a glance;
      // two or three characters can, which is why this kind exists.
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <text
            x="12.2"
            y={labelY}
            textAnchor="middle"
            fill={W}
            fontSize={labelSize}
            style={{ fontFamily: "inherit", fontWeight: 700 }}
          >
            {label}
          </text>
        </>
      );
    case "doc-code":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M10.6 12.9L8 15.9l2.6 3M14.4 12.9L17 15.9l-2.6 3M13 11.8l-2.2 8"
            fill="none"
            stroke={W}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "doc-pdf":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.3 12.2h7.4v2.5H8.3zM8.3 15.9h7.4v2.5H8.3zM8.3 19.6h4.2v1.9H8.3z" fill={W} />
        </>
      );
    case "doc-text":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.3 12.4h7.4v1.7H8.3zM8.3 15.3h7.4v1.7H8.3zM8.3 18.2h4.4v1.7H8.3z" fill={W} />
        </>
      );
    case "doc-sheet":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.3 12.2h3.1v3.1H8.3zM12.6 12.2h3.1v3.1h-3.1zM8.3 16.5h3.1v3.1H8.3zM12.6 16.5h3.1v3.1h-3.1z" fill={W} />
        </>
      );
    case "doc-slides":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.5 16.8h2.1v3.9H8.5zM11.6 12.6h2.1v8.1h-2.1zM14.7 14.8h2.1v5.9h-2.1z" fill={W} />
        </>
      );
    case "doc-font":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M9.2 20.4L12 12.4l2.8 8M10.4 17.6h3.2"
            fill="none"
            stroke={W}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "doc-archive":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.2 11.6h7.6v2.3H8.2zM8.2 15.4h7.6v1.7H8.2zM8.2 18.2h7.6v1.7H8.2z" fill={W} />
        </>
      );
    case "doc-package":
      return (
        <>
          <path d="M2.8 9.2l9.2-5 9.2 5v11.4a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8z" fill="currentColor" />
          <path d="M2.8 9.2l9.2 5 9.2-5M12 14.2v13" fill="none" stroke={W} strokeWidth={1.7} strokeLinejoin="round" opacity={0.9} />
        </>
      );
    case "doc-generic":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M8.4 13.4h7.2v1.8H8.4zM8.4 16.6h7.2v1.8H8.4zM8.4 19.8h4.2v1.4H8.4z" fill={W} opacity={0.9} />
        </>
      );
    case "doc-config":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M12 12.6a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zm8.3 2.1a8.4 8.4 0 0 0-5.6-5.5v1.7a2.1 2.1 0 0 1 1.2 2.8 2.1 2.1 0 0 1-2.8 1.2 2.1 2.1 0 0 1-2.8-1.2 2.1 2.1 0 0 1 1.2-2.8v-1.7a8.4 8.4 0 0 0-5.6 5.5h1.7a2.1 2.1 0 0 1 1.5-2.7v-1.5a6.7 6.7 0 0 1 8.4 0v1.5a2.1 2.1 0 0 1 1.5 2.7z"
            fill={W}
          />
          <circle cx="12" cy="14.7" r="1.5" fill="currentColor" />
        </>
      );
    case "doc-markdown":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M7.8 12.4v7.4h1.7v-4.5l2.1 2.9 2.1-2.9v4.5h1.7v-7.4h-1.7L12 15l-2.5-2.6zM16.6 12.4h1.5v5.2h2.3v1.5h-3.8z"
            fill={W}
          />
        </>
      );
    case "doc-terminal":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M7.9 13.4l3 2.7-3 2.7M12.6 19.2h3.6"
            fill="none"
            stroke={W}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "doc-database":
      return (
        <>
          <ellipse cx="12" cy="7.6" rx="7.2" ry="3.1" fill="currentColor" />
          <path
            d="M4.8 7.6v8.8c0 1.71 3.22 3.1 7.2 3.1s7.2-1.39 7.2-3.1V7.6c0 1.71-3.22 3.1-7.2 3.1S4.8 9.31 4.8 7.6z"
            fill="currentColor"
          />
          <ellipse cx="12" cy="7.6" rx="7.2" ry="3.1" fill="currentColor" />
          <path
            d="M4.8 12.1c0 1.71 3.22 3.1 7.2 3.1s7.2-1.39 7.2-3.1M4.8 16.4c0 1.71 3.22 3.1 7.2 3.1s7.2-1.39 7.2-3.1"
            fill="none"
            stroke={W}
            strokeWidth={1.5}
            opacity={0.55}
          />
        </>
      );
    case "doc-lock":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M9.4 14.6V13a2.6 2.6 0 0 1 5.2 0v1.6h.5a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1H8.9a1 1 0 0 1-1-1v-4.2a1 1 0 0 1 1-1zm1.5 0h2.2V13a1.1 1.1 0 0 0-2.2 0z"
            fill={W}
          />
        </>
      );
    case "doc-shield":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path d="M12 11.6l6.4 2.2v4c0 3.3-2.5 6.2-6.4 7.6-3.9-1.4-6.4-4.3-6.4-7.6v-4z" fill={W} />
          <path d="M12 12.6l4.9 1.7v3.5c0 2.4-1.8 4.5-4.9 5.7z" fill="currentColor" opacity={0.25} />
        </>
      );
    case "doc-cube":
      return (
        <>
          <path d="M12 2.9l8.6 4.6v9L12 21.1 3.4 16.5v-9z" fill="currentColor" />
          <path
            d="M12 2.9l8.6 4.6L12 12.1 3.4 7.5zm0 9.2v9M3.4 7.5v9L12 21.1l8.6-4.6v-9"
            fill="none"
            stroke={W}
            strokeWidth={1.5}
            strokeLinejoin="round"
            opacity={0.9}
          />
        </>
      );
    case "doc-book":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M12 13.6c-1.2-1-2.6-1.4-4.4-1.2v7c1.8-.2 3.2.2 4.4 1.2 1.2-1 2.6-1.4 4.4-1.2v-7c-1.8-.2-3.2.2-4.4 1.2zm0 0V7.4c-1.2-1-2.6-1.4-4.4-1.2v7c1.8-.2 3.2.2 4.4 1.2z"
            fill={W}
          />
        </>
      );
    case "doc-disc":
      return (
        <>
          <circle cx="12" cy="12" r="9.1" fill="currentColor" />
          <circle cx="12" cy="12" r="6.4" fill="none" stroke={W} strokeWidth={1.4} opacity={0.45} />
          <circle cx="12" cy="12" r="3.4" fill="none" stroke={W} strokeWidth={1.4} opacity={0.45} />
          <circle cx="12" cy="12" r="1.5" fill={W} />
        </>
      );
    case "doc-binary":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <rect x="7.2" y="11.4" width="9.6" height="9.2" rx="1.4" fill="none" stroke={W} strokeWidth={1.6} />
          <path d="M9.8 13.6h1.3v1.3H9.8zm3.1 0h1.3v1.3h-1.3zM9.8 16.4h1.3v1.3H9.8zm3.1 0h1.3v1.3h-1.3z" fill={W} />
          <path d="M10 9.2V7.8M12 9.2V6.9M14 9.2V8.3" stroke={W} strokeWidth={1.5} strokeLinecap="round" />
        </>
      );
    case "doc-cloud":
      return (
        <>
          <path d={DOC_BODY} fill="currentColor" />
          <path d={DOC_FOLD} fill={W} opacity={0.42} />
          <path
            d="M8.1 19.6a3.1 3.1 0 0 1-.3-6.2 4.2 4.2 0 0 1 8-1.2 2.9 2.9 0 0 1-.5 5.8v1.6z"
            fill={W}
          />
          <path d="M11.4 16.2v-3.3m0 0l-1.5 1.5m1.5-1.5l1.5 1.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "folder-code":
      return (
        <>
          <path
            d="M2.8 7.4A2.8 2.8 0 0 1 5.6 4.6h3.6c.85 0 1.66.4 2.17 1.08l1.1 1.5h6.97a2.8 2.8 0 0 1 2.8 2.8v8.62a2.8 2.8 0 0 1-2.8 2.8H5.6a2.8 2.8 0 0 1-2.8-2.8z"
            fill="currentColor"
          />
          <path
            d="M10.4 12.2l-2.3 2.6 2.3 2.6M13.6 12.2l2.3 2.6-2.3 2.6"
            fill="none"
            stroke={W}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "folder-image":
      return (
        <>
          <path
            d="M2.8 7.4A2.8 2.8 0 0 1 5.6 4.6h3.6c.85 0 1.66.4 2.17 1.08l1.1 1.5h6.97a2.8 2.8 0 0 1 2.8 2.8v8.62a2.8 2.8 0 0 1-2.8 2.8H5.6a2.8 2.8 0 0 1-2.8-2.8z"
            fill="currentColor"
          />
          <circle cx="9" cy="12.7" r="1.5" fill={W} />
          <path d="M7.4 18.9l3.4-4 2.2 2.4 1.8-1.9 2.4 3.5z" fill={W} />
        </>
      );
    case "link":
      return (
        <>
          <path
            d="M10.3 13.7l-1.5 1.5a2.6 2.6 0 0 1-3.7-3.7l2.9-2.9a2.6 2.6 0 0 1 3.7 0M13.7 10.3l1.5-1.5a2.6 2.6 0 0 1 3.7 3.7l-2.9 2.9a2.6 2.6 0 0 1-3.7 0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <path d="M8.6 15.4l6.8-6.8" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
        </>
      );
  }
}

export default function Glyph({ kind, size = 17, className, label }: { kind: GlyphKind; size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <GlyphSvg kind={kind} label={label} />
    </svg>
  );
}