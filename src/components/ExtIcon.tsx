import Glyph, { type GlyphKind } from "./Glyph";
import type { FileEntry } from "../types";

interface ExtStyle {
  kind: GlyphKind;
  color: string;
}

/**
 * Distinct filled glyph + color per extension so file kinds are recognizable
 * at a glance. Extensions not listed fall back to their MIME category.
 */
const BY_EXT: Record<string, ExtStyle> = {
  // Documents
  pdf: { kind: "doc-pdf", color: "var(--ext-pdf)" },
  doc: { kind: "doc-text", color: "var(--ext-doc)" },
  docx: { kind: "doc-text", color: "var(--ext-doc)" },
  odt: { kind: "doc-text", color: "var(--ext-doc)" },
  rtf: { kind: "doc-text", color: "var(--ext-doc)" },
  txt: { kind: "doc-text", color: "var(--ext-text)" },
  md: { kind: "doc-text", color: "var(--ext-text)" },
  markdown: { kind: "doc-text", color: "var(--ext-text)" },
  log: { kind: "doc-text", color: "var(--ext-text)" },
  // Spreadsheets / slides / data
  xls: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  xlsx: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  ods: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  csv: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  tsv: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  ppt: { kind: "doc-slides", color: "var(--ext-slide)" },
  pptx: { kind: "doc-slides", color: "var(--ext-slide)" },
  odp: { kind: "doc-slides", color: "var(--ext-slide)" },
  // Images
  png: { kind: "doc-image", color: "var(--ext-image)" },
  jpg: { kind: "doc-image", color: "var(--ext-image)" },
  jpeg: { kind: "doc-image", color: "var(--ext-image)" },
  webp: { kind: "doc-image", color: "var(--ext-image)" },
  bmp: { kind: "doc-image", color: "var(--ext-image)" },
  avif: { kind: "doc-image", color: "var(--ext-image)" },
  ico: { kind: "doc-image", color: "var(--ext-image)" },
  svg: { kind: "doc-image", color: "var(--ext-image)" },
  gif: { kind: "doc-image", color: "var(--ext-image)" },
  raw: { kind: "doc-image", color: "var(--ext-image)" },
  nef: { kind: "doc-image", color: "var(--ext-image)" },
  cr2: { kind: "doc-image", color: "var(--ext-image)" },
  psd: { kind: "doc-image", color: "var(--ext-image)" },
  xcf: { kind: "doc-image", color: "var(--ext-image)" },
  // Audio
  mp3: { kind: "doc-audio", color: "var(--ext-audio)" },
  wav: { kind: "doc-audio", color: "var(--ext-audio)" },
  ogg: { kind: "doc-audio", color: "var(--ext-audio)" },
  oga: { kind: "doc-audio", color: "var(--ext-audio)" },
  flac: { kind: "doc-audio", color: "var(--ext-audio)" },
  m4a: { kind: "doc-audio", color: "var(--ext-audio)" },
  opus: { kind: "doc-audio", color: "var(--ext-audio)" },
  aac: { kind: "doc-audio", color: "var(--ext-audio)" },
  mid: { kind: "doc-audio", color: "var(--ext-audio)" },
  midi: { kind: "doc-audio", color: "var(--ext-audio)" },
  // Video
  mp4: { kind: "doc-video", color: "var(--ext-video)" },
  webm: { kind: "doc-video", color: "var(--ext-video)" },
  ogv: { kind: "doc-video", color: "var(--ext-video)" },
  mov: { kind: "doc-video", color: "var(--ext-video)" },
  mkv: { kind: "doc-video", color: "var(--ext-video)" },
  avi: { kind: "doc-video", color: "var(--ext-video)" },
  // Code
  ts: { kind: "doc-code", color: "var(--ext-code)" },
  tsx: { kind: "doc-code", color: "var(--ext-code)" },
  js: { kind: "doc-code", color: "var(--ext-code)" },
  jsx: { kind: "doc-code", color: "var(--ext-code)" },
  mjs: { kind: "doc-code", color: "var(--ext-code)" },
  rs: { kind: "doc-code", color: "var(--ext-code)" },
  py: { kind: "doc-code", color: "var(--ext-code)" },
  go: { kind: "doc-code", color: "var(--ext-code)" },
  java: { kind: "doc-code", color: "var(--ext-code)" },
  c: { kind: "doc-code", color: "var(--ext-code)" },
  h: { kind: "doc-code", color: "var(--ext-code)" },
  cpp: { kind: "doc-code", color: "var(--ext-code)" },
  hpp: { kind: "doc-code", color: "var(--ext-code)" },
  cs: { kind: "doc-code", color: "var(--ext-code)" },
  rb: { kind: "doc-code", color: "var(--ext-code)" },
  php: { kind: "doc-code", color: "var(--ext-code)" },
  swift: { kind: "doc-code", color: "var(--ext-code)" },
  kt: { kind: "doc-code", color: "var(--ext-code)" },
  vue: { kind: "doc-code", color: "var(--ext-code)" },
  svelte: { kind: "doc-code", color: "var(--ext-code)" },
  css: { kind: "doc-code", color: "var(--ext-code)" },
  scss: { kind: "doc-code", color: "var(--ext-code)" },
  html: { kind: "doc-code", color: "var(--ext-code)" },
  htm: { kind: "doc-code", color: "var(--ext-code)" },
  json: { kind: "doc-code", color: "var(--ext-code)" },
  yaml: { kind: "doc-code", color: "var(--ext-code)" },
  yml: { kind: "doc-code", color: "var(--ext-code)" },
  toml: { kind: "doc-code", color: "var(--ext-code)" },
  xml: { kind: "doc-code", color: "var(--ext-code)" },
  sql: { kind: "doc-code", color: "var(--ext-code)" },
  db: { kind: "doc-code", color: "var(--ext-code)" },
  sqlite: { kind: "doc-code", color: "var(--ext-code)" },
  sh: { kind: "doc-code", color: "var(--ext-code)" },
  bash: { kind: "doc-code", color: "var(--ext-code)" },
  zsh: { kind: "doc-code", color: "var(--ext-code)" },
  fish: { kind: "doc-code", color: "var(--ext-code)" },
  ps1: { kind: "doc-code", color: "var(--ext-code)" },
  // Archives / packages
  zip: { kind: "doc-archive", color: "var(--ext-archive)" },
  tar: { kind: "doc-archive", color: "var(--ext-archive)" },
  gz: { kind: "doc-archive", color: "var(--ext-archive)" },
  tgz: { kind: "doc-archive", color: "var(--ext-archive)" },
  bz2: { kind: "doc-archive", color: "var(--ext-archive)" },
  xz: { kind: "doc-archive", color: "var(--ext-archive)" },
  zst: { kind: "doc-archive", color: "var(--ext-archive)" },
  rar: { kind: "doc-archive", color: "var(--ext-archive)" },
  iso: { kind: "doc-archive", color: "var(--ext-archive)" },
  img: { kind: "doc-archive", color: "var(--ext-archive)" },
  deb: { kind: "doc-package", color: "var(--ext-archive)" },
  rpm: { kind: "doc-package", color: "var(--ext-archive)" },
  apk: { kind: "doc-package", color: "var(--ext-archive)" },
  // Fonts
  ttf: { kind: "doc-font", color: "var(--ext-font)" },
  otf: { kind: "doc-font", color: "var(--ext-font)" },
  woff: { kind: "doc-font", color: "var(--ext-font)" },
  woff2: { kind: "doc-font", color: "var(--ext-font)" },
  // Data / misc
  epub: { kind: "doc-text", color: "var(--ext-doc)" },
  mobi: { kind: "doc-text", color: "var(--ext-doc)" },
  pages: { kind: "doc-text", color: "var(--ext-doc)" },
  numbers: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  key: { kind: "doc-slides", color: "var(--ext-slide)" },
  pem: { kind: "doc-generic", color: "var(--ext-exec)" },
  crt: { kind: "doc-generic", color: "var(--ext-exec)" },
  exe: { kind: "doc-package", color: "var(--ext-exec)" },
  msi: { kind: "doc-package", color: "var(--ext-exec)" },
  appimage: { kind: "doc-package", color: "var(--ext-exec)" },
  torrent: { kind: "doc-generic", color: "var(--ext-exec)" },
  part: { kind: "doc-generic", color: "var(--ext-text)" },
};

const CATEGORY_FALLBACK: Record<string, ExtStyle> = {
  image: { kind: "doc-image", color: "var(--ext-image)" },
  audio: { kind: "doc-audio", color: "var(--ext-audio)" },
  video: { kind: "doc-video", color: "var(--ext-video)" },
  text: { kind: "doc-text", color: "var(--ext-text)" },
  font: { kind: "doc-font", color: "var(--ext-font)" },
};

export function extStyle(ext: string, mime: string): ExtStyle {
  const hit = BY_EXT[ext.toLowerCase()];
  if (hit) return hit;
  if (mime) {
    const cat = CATEGORY_FALLBACK[mime.split("/")[0]];
    if (cat) return cat;
  }
  return { kind: "doc-generic", color: "var(--ext-text)" };
}

export default function ExtIcon({ entry, size = 17 }: { entry: FileEntry; size?: number }) {
  if (entry.isSymlink) {
    return (
      <span className="ext-icon" style={{ color: "var(--ext-link)" }} title="Symbolic link">
        <Glyph kind="link" size={size} />
      </span>
    );
  }
  if (entry.isDir) {
    return (
      <span className="ext-icon" style={{ color: "var(--ext-folder)" }} title="Folder">
        <Glyph kind="folder" size={size} />
      </span>
    );
  }
  const s = extStyle(entry.extension, entry.mime);
  return (
    <span className="ext-icon" style={{ color: s.color }} title={entry.name}>
      <Glyph kind={s.kind} size={size} />
    </span>
  );
}