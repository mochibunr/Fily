import Glyph, { type GlyphKind } from "./Glyph";
import type { FileEntry } from "../types";

// Code files carry their own abbreviation and their own hue.
//
// Every code file used to be one grey `</>` glyph, so .js, .json and .py were
// literally indistinguishable in a list. The abbreviation does most of the
// work -- two or three characters are read faster than a shape is recognised --
// and the colour is a second, faster cue for the common ones.
//
// Hues deliberately skip the blue sector. Folders own blue: it was the reason
// code files looked like directories in the first place. Python is the one
// concession, as a much lighter sky than the folder's cornflower and carrying
// a "PY" label, so it cannot be read as a directory.
const LANG: Record<string, { label: string; color: string }> = {
  // Markup and prose
  md: { label: "MD", color: "#8a8a84" },
  markdown: { label: "MD", color: "#8a8a84" },
  mdx: { label: "MD", color: "#8a8a84" },
  rst: { label: "RST", color: "#9c9686" },
  tex: { label: "TeX", color: "#7f8f9c" },
  // JavaScript family
  js: { label: "JS", color: "#e6c84a" },
  jsx: { label: "JS", color: "#e6c84a" },
  mjs: { label: "JS", color: "#e6c84a" },
  cjs: { label: "JS", color: "#e6c84a" },
  ts: { label: "TS", color: "#35b0cc" },
  tsx: { label: "TS", color: "#35b0cc" },
  json: { label: "JSON", color: "#d18b2e" },
  // Web
  html: { label: "HTML", color: "#e07b39" },
  htm: { label: "HTML", color: "#e07b39" },
  css: { label: "CSS", color: "#d9569e" },
  scss: { label: "SCSS", color: "#c74f8a" },
  sass: { label: "SASS", color: "#c74f8a" },
  less: { label: "LESS", color: "#a97ea8" },
  vue: { label: "VUE", color: "#4fb87a" },
  svelte: { label: "SVEL", color: "#e0574c" },
  // Data and config
  xml: { label: "XML", color: "#9b7ce8" },
  yaml: { label: "YAML", color: "#a9a23f" },
  yml: { label: "YAML", color: "#a9a23f" },
  toml: { label: "TOML", color: "#b5895a" },
  ini: { label: "INI", color: "#8fae7a" },
  cfg: { label: "CFG", color: "#8fae7a" },
  conf: { label: "CONF", color: "#8fae7a" },
  env: { label: "ENV", color: "#8fae7a" },
  envrc: { label: "ENV", color: "#8fae7a" },
  lock: { label: "LOCK", color: "#8fae7a" },
  // Systems
  rs: { label: "RS", color: "#c25b34" },
  c: { label: "C", color: "#9aa5ad" },
  h: { label: "H", color: "#9aa5ad" },
  cpp: { label: "C++", color: "#b07a45" },
  cc: { label: "C++", color: "#b07a45" },
  cxx: { label: "C++", color: "#b07a45" },
  hpp: { label: "H++", color: "#b07a45" },
  go: { label: "GO", color: "#2fa8a0" },
  zig: { label: "ZIG", color: "#c9a23f" },
  // Managed runtimes
  py: { label: "PY", color: "#a3c93f" },
  pyi: { label: "PY", color: "#a3c93f" },
  java: { label: "JAVA", color: "#d2456b" },
  kt: { label: "KT", color: "#b06fe0" },
  kts: { label: "KT", color: "#b06fe0" },
  scala: { label: "SCALA", color: "#c1487f" },
  swift: { label: "SW", color: "#ef7a3e" },
  cs: { label: "CS", color: "#63b05c" },
  php: { label: "PHP", color: "#7f6fd8" },
  rb: { label: "RB", color: "#e04f7a" },
  lua: { label: "LUA", color: "#d07fb8" },
  pl: { label: "PL", color: "#6fbf72" },
  r: { label: "R", color: "#b07ac9" },
  dart: { label: "DART", color: "#5fbf9e" },
  ex: { label: "EX", color: "#8a8f9c" },
  exs: { label: "EX", color: "#8a8f9c" },
  erl: { label: "ERL", color: "#b5563f" },
  hs: { label: "HS", color: "#a06fb8" },
  // Query
  sql: { label: "SQL", color: "#c74f9e" },
  sqlite: { label: "LITE", color: "#c74f9e" },
  // Shells
  sh: { label: "SH", color: "#6f9e3f" },
  bash: { label: "SH", color: "#6f9e3f" },
  zsh: { label: "ZSH", color: "#6f9e3f" },
  fish: { label: "FISH", color: "#5fa87a" },
};

interface ExtStyle {
  kind: GlyphKind;
  color: string;
  label?: string;
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
  rtx: { kind: "doc-text", color: "var(--ext-text)" },
  config: { kind: "doc-config", color: "var(--ext-config)" },
  conf: { kind: "doc-config", color: "var(--ext-config)" },
  cfg: { kind: "doc-config", color: "var(--ext-config)" },
  ini: { kind: "doc-config", color: "var(--ext-config)" },
  env: { kind: "doc-config", color: "var(--ext-config)" },
  properties: { kind: "doc-config", color: "var(--ext-config)" },
  desktop: { kind: "doc-config", color: "var(--ext-config)" },
  md: { kind: "doc-markdown", color: "var(--ext-mark)" },
  markdown: { kind: "doc-markdown", color: "var(--ext-mark)" },
  mdx: { kind: "doc-markdown", color: "var(--ext-mark)" },
  rst: { kind: "doc-markdown", color: "var(--ext-mark)" },
  tex: { kind: "doc-markdown", color: "var(--ext-mark)" },
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
  // Code and data files are labelled and coloured by the LANG table above, which
  // extStyle consults first. Entries duplicated there (md, markdown, mdx, rst,
  // tex, log) are left below only so this map stays a complete picture.
  db: { kind: "doc-database", color: "var(--ext-data)" },
  mdb: { kind: "doc-database", color: "var(--ext-data)" },
  parquet: { kind: "doc-database", color: "var(--ext-data)" },
  avro: { kind: "doc-database", color: "var(--ext-data)" },
  sqlite: { kind: "doc-database", color: "var(--ext-data)" },
  sh: { kind: "doc-terminal", color: "var(--ext-term)" },
  bat: { kind: "doc-terminal", color: "var(--ext-term)" },
  cmd: { kind: "doc-terminal", color: "var(--ext-term)" },
  ps1: { kind: "doc-terminal", color: "var(--ext-term)" },
  // Archives / packages
  zip: { kind: "doc-archive", color: "var(--ext-archive)" },
  tar: { kind: "doc-archive", color: "var(--ext-archive)" },
  gz: { kind: "doc-archive", color: "var(--ext-archive)" },
  tgz: { kind: "doc-archive", color: "var(--ext-archive)" },
  bz2: { kind: "doc-archive", color: "var(--ext-archive)" },
  xz: { kind: "doc-archive", color: "var(--ext-archive)" },
  zst: { kind: "doc-archive", color: "var(--ext-archive)" },
  rar: { kind: "doc-archive", color: "var(--ext-archive)" },
  iso: { kind: "doc-disc", color: "var(--ext-disc)" },
  img: { kind: "doc-disc", color: "var(--ext-disc)" },
  dmg: { kind: "doc-disc", color: "var(--ext-disc)" },
  vhd: { kind: "doc-disc", color: "var(--ext-disc)" },
  vmdk: { kind: "doc-disc", color: "var(--ext-disc)" },
  deb: { kind: "doc-package", color: "var(--ext-archive)" },
  rpm: { kind: "doc-package", color: "var(--ext-archive)" },
  apk: { kind: "doc-package", color: "var(--ext-archive)" },
  // Fonts
  blend: { kind: "doc-cube", color: "var(--ext-cube)" },
  obj: { kind: "doc-cube", color: "var(--ext-cube)" },
  stl: { kind: "doc-cube", color: "var(--ext-cube)" },
  fbx: { kind: "doc-cube", color: "var(--ext-cube)" },
  gltf: { kind: "doc-cube", color: "var(--ext-cube)" },
  glb: { kind: "doc-cube", color: "var(--ext-cube)" },
  dae: { kind: "doc-cube", color: "var(--ext-cube)" },
  ttf: { kind: "doc-font", color: "var(--ext-font)" },
  otf: { kind: "doc-font", color: "var(--ext-font)" },
  woff: { kind: "doc-font", color: "var(--ext-font)" },
  woff2: { kind: "doc-font", color: "var(--ext-font)" },
  // Data / misc
  epub: { kind: "doc-book", color: "var(--ext-book)" },
  mobi: { kind: "doc-book", color: "var(--ext-book)" },
  azw: { kind: "doc-book", color: "var(--ext-book)" },
  azw3: { kind: "doc-book", color: "var(--ext-book)" },
  fb2: { kind: "doc-book", color: "var(--ext-book)" },
  djvu: { kind: "doc-book", color: "var(--ext-book)" },
  pages: { kind: "doc-text", color: "var(--ext-doc)" },
  numbers: { kind: "doc-sheet", color: "var(--ext-sheet)" },
  key: { kind: "doc-lock", color: "var(--ext-shield)" },
  gpg: { kind: "doc-lock", color: "var(--ext-shield)" },
  asc: { kind: "doc-lock", color: "var(--ext-shield)" },
  p12: { kind: "doc-lock", color: "var(--ext-shield)" },
  keystore: { kind: "doc-lock", color: "var(--ext-shield)" },
  pem: { kind: "doc-shield", color: "var(--ext-cert)" },
  crt: { kind: "doc-shield", color: "var(--ext-cert)" },
  cer: { kind: "doc-shield", color: "var(--ext-cert)" },
  der: { kind: "doc-shield", color: "var(--ext-cert)" },
  exe: { kind: "doc-binary", color: "var(--ext-exec)" },
  msi: { kind: "doc-binary", color: "var(--ext-exec)" },
  dll: { kind: "doc-binary", color: "var(--ext-exec)" },
  so: { kind: "doc-binary", color: "var(--ext-exec)" },
  dylib: { kind: "doc-binary", color: "var(--ext-exec)" },
  bin: { kind: "doc-binary", color: "var(--ext-exec)" },
  o: { kind: "doc-binary", color: "var(--ext-exec)" },
  a: { kind: "doc-binary", color: "var(--ext-exec)" },
  appimage: { kind: "doc-package", color: "var(--ext-exec)" },
  flatpak: { kind: "doc-package", color: "var(--ext-exec)" },
  snap: { kind: "doc-package", color: "var(--ext-exec)" },
  torrent: { kind: "doc-cloud", color: "var(--ext-cloud)" },
  magnet: { kind: "doc-cloud", color: "var(--ext-cloud)" },
  nzb: { kind: "doc-cloud", color: "var(--ext-cloud)" },
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
  const key = ext.toLowerCase();
  // LANG first: a labelled, per-language icon beats the generic kind entry.
  const lang = LANG[key];
  if (lang) return { kind: "doc-lang", color: lang.color, label: lang.label };
  const hit = BY_EXT[key];
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
    // Name-based folder accents. Statting children to classify a folder would
    // cost a read per row; the name is free and matches what people expect.
    const n = entry.name.toLowerCase();
    let folder: GlyphKind = "folder";
    let color = "var(--ext-folder)";
    // Plurals included: people name folders "photos", "images", "pics".
    if (/(^|[-_. ])(photos?|images?|imgs?|pictures?|pics?|camera|screenshots?)([-_. ]|$)/.test(n)) {
      folder = "folder-image";
      color = "var(--ext-image)";
    } else if (/(^|[-_. ])(src|code|codes|scripts|dev|lib|bin)([-_. ]|$)/.test(n)) {
      folder = "folder-code";
      color = "var(--ext-code)";
    }
    return (
      <span className="ext-icon" style={{ color }} title="Folder">
        <Glyph kind={folder} size={size} />
      </span>
    );
  }
  const s = extStyle(entry.extension, entry.mime);
  return (
    <span className="ext-icon" style={{ color: s.color }} title={entry.name}>
      <Glyph kind={s.kind} size={size} label={s.label} />
    </span>
  );
}