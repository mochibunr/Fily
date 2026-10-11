import { describe, expect, it } from "vitest";
import type { FileEntry } from "../src/types";
import { baseName, formatDate, formatSize, joinPath, parentDir, splitPath } from "../src/utils/format";
import { parseSearchQuery, parseSizeToken, toSearchOptions } from "../src/utils/search";
import { naturalCompare, plainCompare } from "../src/utils/sort";
import { sortEntries } from "../src/store/app";

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

describe("plainCompare", () => {
  it("compares case-insensitively", () => {
    expect(plainCompare("B", "a")).toBeGreaterThan(0);
    expect(plainCompare("a", "b")).toBeLessThan(0);
  });
  it("is 0 only for identical strings", () => {
    expect(plainCompare("same", "same")).toBe(0);
  });
});
