import { describe, expect, it } from "vitest";
import type { FileEntry, FilySettings } from "../src/types";
import { baseName, breadcrumb, formatDate, formatSize, joinPath, parentDir, splitPath } from "../src/utils/format";
import { parseSearchQuery, parseSizeToken, toSearchOptions } from "../src/utils/search";
import { naturalCompare, plainCompare } from "../src/utils/sort";
import { settingsSnapshot, sortEntries } from "../src/store/app";
import { extStyle } from "../src/components/ExtIcon";

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatSize(-1)).toBe("—");
  });
});

describe("paths", () => {
  it("parentDir handles root and nesting", () => {
    expect(parentDir("/")).toBeNull();
    expect(parentDir("/a/b")).toBe("/a");
    expect(parentDir("/a")).toBe("/");
  });
  it("splitPath and baseName", () => {
    expect(splitPath("/")).toEqual([]);
    expect(splitPath("/a/b")).toEqual(["a", "b"]);
    expect(baseName("/a/b.txt")).toBe("b.txt");
    expect(joinPath("/a", "b")).toBe("/a/b");
  });
  it("formatDate handles null", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(0)).toBe("—");
    expect(formatDate(-5)).toBe("—");
    expect(formatDate(Date.now()).length).toBeGreaterThan(0);
  });
});

describe("search parser", () => {
  it("parses type/ext/size tokens", () => {
    const p = parseSearchQuery("report type:pdf size:>10mb invoice");
    expect(p.text).toBe("report invoice");
    expect(p.extensions).toContain("pdf");
    expect(p.minSize).toBe(10 * 1024 * 1024);
  });
  it("parses ext lists", () => {
    const p = parseSearchQuery("ext:png,jpg photo");
    expect(p.extensions).toEqual(expect.arrayContaining(["png", "jpg"]));
    expect(p.text).toBe("photo");
  });
  it("parses sizes", () => {
    expect(parseSizeToken("100MB")).toBe(100 * 1024 * 1024);
    expect(parseSizeToken("1.5kb")).toBe(1536);
    expect(parseSizeToken("abc")).toBeNull();
  });
  it("clamps absurd queries", () => {
    const big = "x".repeat(10000);
    expect(toSearchOptions(big).query.length).toBeLessThanOrEqual(200);
  });
});

describe("naturalCompare", () => {
  it("orders embedded numbers numerically", () => {
    const in_ = ["f10.txt", "f2.txt", "f1.txt", "f20.txt"].sort(naturalCompare);
    expect(in_).toEqual(["f1.txt", "f2.txt", "f10.txt", "f20.txt"]);
  });
  it("is case insensitive but deterministic", () => {
    expect(naturalCompare("Apple", "apple")).toBeLessThan(0);
    expect(naturalCompare("apple", "Banana")).toBeLessThan(0);
  });
  it("handles mixed runs", () => {
    const in_ = ["chapter-2-part-10", "chapter-2-part-2", "chapter-10-part-1"].sort(naturalCompare);
    expect(in_).toEqual(["chapter-2-part-2", "chapter-2-part-10", "chapter-10-part-1"]);
  });
  it("is a total order (never returns 0 for different strings)", () => {
    const pairs: [string, string][] = [["a", "A"], ["01", "1"], ["x2", "x02"]];
    for (const [a, b] of pairs) expect(naturalCompare(a, b)).not.toBe(0);
  });
  it("matches ICU natural ordering", () => {
    // The point of the rewrite: identical results, far faster.
    const names = ["img12.png", "img2.png", "Img3.png", "a.txt", "b-10.tar.gz", "b-9.tar.gz"];
    const fast = [...names].sort(naturalCompare);
    const icu = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    expect(fast).toEqual(icu);
  });
});

describe("sortEntries", () => {
  const mk = (name: string, isDir: boolean, extension = ""): FileEntry => ({
    name,
    path: `/t/${name}`,
    isDir,
    isSymlink: false,
    isHidden: false,
    size: 100,
    modified: 1717200000,
    created: 1,
    extension,
    mime: "",
  });

  it("puts folders before files regardless of name", () => {
    const sorted = sortEntries(
      [mk("aaa.txt", false), mk("zzz.txt", false), mk("mmm", true), mk("bbb", true)],
      "name",
      false,
    );
    expect(sorted.map((e) => e.name)).toEqual(["bbb", "mmm", "aaa.txt", "zzz.txt"]);
  });

  it("keeps folders first when sorting by size", () => {
    const sorted = sortEntries([mk("big.txt", false), mk("tiny", true)], "size", true);
    expect(sorted[0].isDir).toBe(true);
  });
});

describe("settingsSnapshot", () => {
  const base: FilySettings = {
    theme: "dark",
    uiZoom: 1,
    listScale: 1,
    showHidden: false,
    sideWidth: 218,
    sidebarCollapsed: false,
    showDevices: true,
    showPlaces: true,
    previewVisible: false,
    dual: false,
    toolbar: { terminal: true, preview: true },
  };

  it("is stable across toolbar key ordering", () => {
    // Toolbar state is a plain object; reordering keys must not read as a
    // change, or the app would rewrite the settings file on every render.
    expect(settingsSnapshot(base)).toBe(
      settingsSnapshot({ ...base, toolbar: { preview: true, terminal: true } }),
    );
  });

  it("treats a missing toolbar key as different from false", () => {
    // Deliberate. A missing key means "no opinion", false means "off", and
    // collapsing them would let a genuine change hide behind the guard and go
    // unpersisted. The cost is one extra normalizing write, which is cheap.
    expect(settingsSnapshot({ ...base, toolbar: { terminal: true } })).not.toBe(
      settingsSnapshot({ ...base, toolbar: { terminal: true, preview: false } }),
    );
  });

  it("distinguishes a real change to the preview panel", () => {
    // This is the regression: the panel state must not be able to look
    // unchanged when it has changed, or it is silently never persisted.
    expect(settingsSnapshot(base)).not.toBe(
      settingsSnapshot({ ...base, previewVisible: true }),
    );
  });

  it("distinguishes every other field too", () => {
    const variants: FilySettings[] = [
      { ...base, theme: "nord" },
      { ...base, uiZoom: 1.2 },
      { ...base, listScale: 1.5 },
      { ...base, showHidden: true },
      { ...base, sideWidth: 300 },
      { ...base, sidebarCollapsed: true },
      { ...base, showDevices: false },
      { ...base, showPlaces: false },
      { ...base, dual: true },
      { ...base, toolbar: { terminal: false } },
    ];
    const seen = new Set(variants.map(settingsSnapshot));
    expect(seen.size).toBe(variants.length);
    expect(seen.has(settingsSnapshot(base))).toBe(false);
  });
});

describe("Windows path handling", () => {
  it("parentDir walks up a Windows path", () => {
    expect(parentDir("C:\\Users\\foo\\Documents")).toBe("C:\\Users\\foo");
    expect(parentDir("C:\\Users")).toBe("C:\\");
  });

  it("parentDir refuses to go above a drive root", () => {
    // Going up from a drive root on Windows must not become "/".
    expect(parentDir("C:\\")).toBeNull();
    expect(parentDir("C:")).toBeNull();
    expect(parentDir("/")).toBeNull();
  });

  it("baseName takes the last segment of a Windows path", () => {
    expect(baseName("C:\\Users\\foo\\report.pdf")).toBe("report.pdf");
    expect(baseName("C:\\Users\\foo\\")).toBe("foo");
  });

  it("splitPath separates a drive letter as its own segment", () => {
    expect(splitPath("C:\\Users\\foo")).toEqual(["C:", "Users", "foo"]);
  });

  it("breadcrumb builds real, navigable Windows paths", () => {
    // The old inline version produced "/C:/Users" for every segment.
    expect(breadcrumb("C:\\Users\\foo\\Documents")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "foo", path: "C:\\Users\\foo" },
      { label: "Documents", path: "C:\\Users\\foo\\Documents" },
    ]);
  });

  it("breadcrumb builds real POSIX paths too", () => {
    expect(breadcrumb("/home/tester/Documents")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "tester", path: "/home/tester" },
      { label: "Documents", path: "/home/tester/Documents" },
    ]);
  });

  it("breadcrumb handles a bare drive root", () => {
    expect(breadcrumb("C:\\")).toEqual([{ label: "C:", path: "C:\\" }]);
    expect(breadcrumb("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("every crumb path is absolute for its platform", () => {
    for (const c of breadcrumb("C:\\Users\\foo")) {
      expect(c.path.startsWith("C:\\")).toBe(true);
    }
    for (const c of breadcrumb("/home/tester")) {
      expect(c.path.startsWith("/")).toBe(true);
    }
  });
});

describe("extStyle language icons", () => {
  const CODES = [
    "js", "ts", "json", "html", "css", "scss", "vue", "svelte", "xml", "yaml",
    "toml", "rs", "py", "go", "java", "kt", "swift", "cs", "rb", "php", "c",
    "cpp", "sh", "sql", "md",
  ];

  it("gives every code extension a short label", () => {
    for (const ext of CODES) {
      const s = extStyle(ext, "");
      expect(s.label, `${ext} has no label`).toBeTruthy();
      expect(s.label!.length, `${ext} label too long`).toBeLessThanOrEqual(4);
      expect(s.kind).toBe("doc-lang");
    }
  });

  it("matches the label case-insensitively", () => {
    expect(extStyle("JS", "").label).toBe("JS");
    expect(extStyle("Rs", "").label).toBe("RS");
  });

  it("keeps markdown grey and off the folder hue", () => {
    // The original complaint: code files shared the folder's blue.
    const md = extStyle("md", "");
    expect(md.color).toBe("#8a8a84");
    expect(md.color).not.toBe(extStyle("bin", "").color);
  });

  it("uses a distinct colour for every code extension", () => {
    const colors = CODES.map((e) => extStyle(e, "").color);
    expect(new Set(colors).size).toBe(CODES.length);
  });

  it("never uses a folder-like blue for code", () => {
    // Folders sit at hue 216 (--ext-folder #5b8dd9). A code file anywhere in
    // the blue band reads as a directory again, which is the whole problem
    // this palette exists to avoid. Desaturated greys are exempt: they read as
    // "plain text", which is exactly the intent for .md, .c and friends.
    for (const ext of CODES) {
      const [h, s] = hueSat(extStyle(ext, "").color as string);
      const inBand = h >= 195 && h <= 245;
      expect(inBand && s > 0.2, `${ext} looks like a folder: h=${h} s=${s}`).toBe(false);
    }
  });

  it("still falls back gracefully for unknown extensions", () => {
    const s = extStyle("qqq", "text/plain");
    expect(s.kind).toBeTruthy();
    expect(s.label).toBeUndefined();
  });
});

/** Hue in degrees (0-360) and saturation (0-1) of a #rrggbb colour. */
function hueSat(hex: string): [number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [Math.round(h), s];
}

describe("plainCompare", () => {
  it("compares case-insensitively", () => {
    expect(plainCompare("B", "a")).toBeGreaterThan(0);
    expect(plainCompare("a", "b")).toBeLessThan(0);
  });
  it("is 0 only for identical strings", () => {
    expect(plainCompare("same", "same")).toBe(0);
  });
});
