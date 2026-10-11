export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = v >= 100 || u === 0 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[u]}`;
}

export function formatDate(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function parentDir(path: string): string | null {
  if (!path || path === "/") return null;
  // Windows drive root like C:\
  if (/^[A-Za-z]:[\\/]?$/.test(path)) return null;
  const clean = path.replace(/[\\/]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx <= 0) return "/";
  const seg = clean.slice(0, idx);
  // `C:` is not the drive root -- on Windows it means "the current directory
  // on drive C". Going up from C:\Users must land on C:\, so put the separator
  // back or the pane jumps to some unrelated directory.
  if (/^[A-Za-z]:$/.test(seg)) return seg + "\\";
  return seg || "/";
}

export function baseName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return idx < 0 ? clean : clean.slice(idx + 1);
}

export function splitPath(path: string): string[] {
  if (path === "/") return [];
  const isWin = /^[A-Za-z]:/.test(path);
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (!isWin) return parts;
  return parts;
}

/**
 * Build the breadcrumb for a path: a root crumb plus one segment per level,
 * each carrying the real path to navigate to.
 *
 * This used to live inline as `"/" + parts.slice(0, i + 1).join("/")`, which
 * turns `C:\Users\foo` into `/C:/Users` and navigates nowhere. The drive letter
 * is the root crumb on Windows rather than a segment, and the joiner follows
 * the platform's separator.
 */
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  return dir + "/" + name;
}

export interface Crumb {
  label: string;
  path: string;
}

export function breadcrumb(path: string): Crumb[] {
  if (!path) return [];
  const isWin = /^[A-Za-z]:/.test(path);
  const parts = splitPath(path);
  const rootPath = isWin ? path.slice(0, 2) + "\\" : "/";
  const rootLabel = isWin ? path.slice(0, 2) : "/";
  const out: Crumb[] = [{ label: rootLabel, path: rootPath }];
  const segments = isWin ? parts.slice(1) : parts;
  segments.forEach((seg, i) => {
    out.push({
      label: seg,
      path: isWin ? parts.slice(0, i + 2).join("\\") : "/" + parts.slice(0, i + 1).join("/"),
    });
  });
  return out;
}

export function isImageExt(ext: string): boolean {
  return ["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "avif", "ico"].includes(ext.toLowerCase());
}

export function isTextExt(ext: string): boolean {
  return [
    "txt", "md", "markdown", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "log", "csv", "tsv", "js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "h",
    "cpp", "hpp", "css", "html", "htm", "sh", "bash", "zsh", "sql", "vue", "svelte",
    "env", "gitignore", "dockerfile",
  ].includes(ext.toLowerCase());
}

export function isAudioExt(ext: string): boolean {
  return ["mp3", "wav", "ogg", "oga", "flac", "m4a", "opus", "aac"].includes(ext.toLowerCase());
}

export function isVideoExt(ext: string): boolean {
  return ["mp4", "webm", "ogv", "mov", "mkv", "avi"].includes(ext.toLowerCase());
}

export function isPdfExt(ext: string): boolean {
  return ext.toLowerCase() === "pdf";
}

/**
 * Archive types Fily can actually extract. Deliberately narrower than
 * "anything compressed": the menu used to offer Extract for `.7z`, `.rar`,
 * `.tar.xz` and friends that the backend then refused, so the action existed
 * only to fail. Mirrors `is_extractable` in `src-tauri/src/archive_commands.rs`.
 *
 * Takes the full file name, not the extension: `photos.tar.gz` has the
 * extension `gz`.
 */
export function isArchiveName(name: string): boolean {
  return /\.(zip|tar|tar\.gz|tgz)$/i.test(name);
}

/** True for anything compressed enough to wear an archive icon. */
export function isArchiveExt(ext: string): boolean {
  return ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst"].includes(ext.toLowerCase());
}

export function kindLabel(isDir: boolean, ext: string, mime: string): string {
  if (isDir) return "Folder";
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    pdf: "PDF document",
    zip: "ZIP archive",
    png: "PNG image",
    jpg: "JPEG image",
    jpeg: "JPEG image",
    gif: "GIF image",
    webp: "WebP image",
    svg: "SVG image",
    mp3: "MP3 audio",
    mp4: "MP4 video",
    txt: "Text file",
    md: "Markdown document",
  };
  if (map[e]) return map[e];
  if (mime && mime !== "application/octet-stream") return mime;
  return e ? `${e.toUpperCase()} file` : "File";
}
