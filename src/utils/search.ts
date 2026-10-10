import type { SearchOptions } from "../types";

export interface ParsedSearch {
  text: string;
  extensions: string[];
  minSize: number | null;
  maxSize: number | null;
  recursive: boolean;
}

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i;

export function parseSizeToken(token: string): number | null {
  const m = SIZE_RE.exec(token.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "b").toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
  };
  return Math.floor(n * (mult[unit] ?? 1));
}

/**
 * Parse queries like:
 *   `report type:pdf size:>10mb ext:png,svg invoice`
 * Supported tokens: type:<kind|ext>, ext:<a,b>, size:>N / size:<N / size:N,
 * larger_than / smaller_than aliases. Remaining words form the name query.
 */
export function parseSearchQuery(raw: string): ParsedSearch {
  const extensions: string[] = [];
  let minSize: number | null = null;
  let maxSize: number | null = null;
  const words: string[] = [];

  const typeMap: Record<string, string[]> = {
    image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"],
    images: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"],
    audio: ["mp3", "wav", "ogg", "flac", "m4a", "opus", "aac"],
    video: ["mp4", "webm", "ogv", "mov", "mkv"],
    pdf: ["pdf"],
    text: ["txt", "md", "log", "csv"],
    code: ["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "css", "html"],
    archive: ["zip", "tar", "gz", "7z", "rar"],
  };

  for (const tok of raw.split(/\s+/).filter(Boolean)) {
    const lower = tok.toLowerCase();
    if (lower.startsWith("type:")) {
      const v = tok.slice(5).toLowerCase();
      if (typeMap[v]) extensions.push(...typeMap[v]);
      else if (v) extensions.push(v.replace(/^\./, ""));
      continue;
    }
    if (lower.startsWith("ext:")) {
      const v = tok.slice(4);
      for (const e of v.split(",")) {
        const clean = e.trim().replace(/^\./, "").toLowerCase();
        if (clean) extensions.push(clean);
      }
      continue;
    }
    if (lower.startsWith("size:")) {
      const v = tok.slice(5);
      if (v.startsWith(">")) {
        const n = parseSizeToken(v.slice(1));
        if (n != null) minSize = n;
        continue;
      }
      if (v.startsWith("<")) {
        const n = parseSizeToken(v.slice(1));
        if (n != null) maxSize = n;
        continue;
      }
      const n = parseSizeToken(v);
      if (n != null) {
        minSize = Math.floor(n * 0.9);
        maxSize = Math.ceil(n * 1.1);
      }
      continue;
    }
    words.push(tok);
  }

  return {
    text: words.join(" "),
    extensions: [...new Set(extensions)],
    minSize,
    maxSize,
    recursive: true,
  };
}

export function toSearchOptions(raw: string, overrides?: Partial<SearchOptions>): SearchOptions {
  // Pasted essays don't belong in a filename query — clamp before IPC.
  const p = parseSearchQuery(raw.slice(0, 200));
  return {
    query: p.text,
    recursive: p.recursive,
    extensions: p.extensions,
    minSize: p.minSize,
    maxSize: p.maxSize,
    modifiedAfter: null,
    modifiedBefore: null,
    maxResults: 500,
    maxDepth: 8,
    ...overrides,
  };
}
