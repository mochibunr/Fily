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
  | "link";

const DOC_BODY =
  "M7 2.6h6.2L19 8.4v13A1.6 1.6 0 0 1 17.4 23H7A1.6 1.6 0 0 1 5.4 21.4V4.2A1.6 1.6 0 0 1 7 2.6z";
const DOC_FOLD = "M13.2 2.6v5.2a.6.6 0 0 0 .6.6h5.2z";

const W = "#ffffff";

function GlyphSvg({ kind }: { kind: GlyphKind }) {
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

export default function Glyph({ kind, size = 17, className }: { kind: GlyphKind; size?: number; className?: string }) {
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
      <GlyphSvg kind={kind} />
    </svg>
  );
}