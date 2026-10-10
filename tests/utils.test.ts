import { describe, expect, it } from "vitest";
import { baseName, formatDate, formatSize, joinPath, parentDir, splitPath } from "../src/utils/format";
import { parseSearchQuery, parseSizeToken, toSearchOptions } from "../src/utils/search";

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
