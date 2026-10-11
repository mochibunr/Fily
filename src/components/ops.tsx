import {
  AppWindow, Archive, Copy, CopyPlus, ClipboardPaste, ExternalLink, FilePlus,
  Files, FolderInput, FolderOpen, FolderOutput, FolderPlus, Info, Link, ListPlus,
  Move, PenLine, Scissors, Star, Terminal, TriangleAlert, Trash2, Type,
} from "lucide-react";
import { fsApi } from "../api/fs";
import type { FileEntry } from "../types";
import { isArchiveExt } from "../utils/format";
import type { CtxItem } from "./ContextMenu";
import { baseName } from "../utils/format";

interface OpsCtx {
  toast(kind: "info" | "error", text: string): void;
  refreshAll(): void;
  setClipboard(c: { mode: "copy" | "cut"; paths: string[] } | null): void;
  askConfirm(c: { title: string; body: string; confirmLabel: string; onConfirm(): void }): void;
  askConflict(title: string, conflicts: string[], resolve: (m: "overwrite" | "keepBoth" | "skip") => void): void;
  askPrompt(p: { title: string; label: string; initial: string; onSubmit(v: string): void }): void;
  addBookmark(path: string): void;
  navigate(pane: number, path: string): void;
}

export interface OpsCallbacks {
  beginRename(path: string): void;
  openBulkRename(paths: string[]): void;
  openProperties(path: string): void;
  openPalette(): void;
  openWithDialog(path: string, mime: string): void;
  moveCopyTo(mode: "move" | "copy", paths: string[]): void;
  compressSel(paths: string[], suggestedName: string): void;
  extractTo(path: string): void;
}

async function withConflict(
  ctx: OpsCtx,
  title: string,
  fn: (opts?: { overwrite: boolean } | { keepBoth: boolean }) => Promise<{ ok: boolean; failures: { message: string }[]; conflicts: string[] }>,
  onDone: () => void,
) {
  const res = await fn();
  if (!res.ok && res.conflicts.length > 0) {
    ctx.askConflict(title, res.conflicts, async (how) => {
      if (how === "skip") return;
      const r2 = await fn(how === "overwrite" ? { overwrite: true } : { keepBoth: true });
      if (!r2.ok) ctx.toast("error", r2.failures.map((f) => f.message).join("; "));
      else onDone();
    });
    return;
  }
  if (!res.ok) ctx.toast("error", res.failures.map((f) => f.message).join("; "));
  else onDone();
}

export async function doPaste(ctx: OpsCtx, mode: "copy" | "cut", paths: string[], destDir: string) {
  try {
    if (mode === "copy") {
      await withConflict(ctx, "Copy conflicts", (o) => fsApi.copyPaths(paths, destDir, o as { overwrite: boolean }), () => ctx.refreshAll());
    } else {
      await withConflict(ctx, "Move conflicts", (o) => fsApi.movePaths(paths, destDir, o as { overwrite: boolean }), () => {
        ctx.setClipboard(null);
        ctx.refreshAll();
      });
    }
  } catch (e) {
    ctx.toast("error", e instanceof Error ? e.message : String(e));
  }
}

function trashSel(ctx: OpsCtx, paths: string[]) {
  void (async () => {
    try {
      const r = await fsApi.trashPaths(paths);
      if (!r.ok) ctx.toast("error", r.failures.map((f) => f.message).join("; "));
      else ctx.toast("info", `Moved ${paths.length} item${paths.length > 1 ? "s" : ""} to Trash`);
      ctx.refreshAll();
    } catch (e) {
      ctx.toast("error", e instanceof Error ? e.message : String(e));
    }
  })();
}

function permDelete(ctx: OpsCtx, paths: string[], names: string[]) {
  ctx.askConfirm({
    title: "Permanently delete?",
    body: `${paths.length} item${paths.length > 1 ? "s" : ""} will be deleted forever. This cannot be undone.\n${names.slice(0, 5).join(", ")}${names.length > 5 ? ` (+${names.length - 5} more)` : ""}`,
    confirmLabel: "Delete forever",
    onConfirm: () => {
      void (async () => {
        try {
          const r = await fsApi.deletePermanent(paths);
          if (!r.ok) ctx.toast("error", r.failures.map((f) => f.message).join("; "));
          ctx.refreshAll();
        } catch (e) {
          ctx.toast("error", e instanceof Error ? e.message : String(e));
        }
      })();
    },
  });
}

function baseNameOf(p: string): string {
  return baseName(p) || p;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function buildMenu(
  ctx: OpsCtx,
  cb: OpsCallbacks,
  pane: number,
  dirPath: string,
  paths: string[],
  clipboard: { mode: "copy" | "cut"; paths: string[] } | null,
  entries: FileEntry[],
): { title?: string; items: CtxItem[] }[] {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const names = paths.map(baseNameOf);
  const single = paths.length === 1 ? paths[0] : null;
  const singleEntry = single ? byPath.get(single) : undefined;
  const hasSel = paths.length > 0;
  const singleIsDir = !!singleEntry?.isDir;
  const singleIsArchive = !!single && !singleIsDir && isArchiveExt(singleEntry?.extension ?? single.split(".").pop() ?? "");
  const singleMime = singleEntry?.mime ?? "";
  // Actions that create things target the selected folder when exactly one
  // folder is selected, otherwise the current directory.
  const targetDir = singleIsDir && single ? single : dirPath;
  // Folder-targeted actions only make sense when no file is singled out:
  // a lone folder selection or empty space. Never for a single file.
  const showCreate = !single || singleIsDir;
  const targetLabel = singleIsDir && single ? `“${baseNameOf(single)}”` : "here";

  const openSingle = () => {
    if (!single) return;
    if (singleIsDir) ctx.navigate(pane, single);
    else fsApi.openPath(single).catch((e) => ctx.toast("error", e.message));
  };

  const extractHere = () => {
    if (!single) return;
    void (async () => {
      try {
        const r = await fsApi.extractHere(single);
        if (!r.ok) ctx.toast("error", r.failures.map((f) => f.message).join("; "));
        else ctx.toast("info", "Archive extracted");
        ctx.refreshAll();
      } catch (e) {
        ctx.toast("error", e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const newFolderHere = () => ctx.askPrompt({
    title: `New folder ${targetLabel}`,
    label: "Folder name",
    initial: "Untitled folder",
    onSubmit: async (v) => {
      try { await fsApi.createDir(targetDir, v); ctx.refreshAll(); }
      catch (e) { ctx.toast("error", e instanceof Error ? e.message : String(e)); }
    },
  });

  const newFileHere = () => ctx.askPrompt({
    title: `New file ${targetLabel}`,
    label: "File name",
    initial: "Untitled.txt",
    onSubmit: async (v) => {
      try { await fsApi.createFile(targetDir, v); ctx.refreshAll(); }
      catch (e) { ctx.toast("error", e instanceof Error ? e.message : String(e)); }
    },
  });

  return [
    {
      title: hasSel ? `${paths.length} selected` : baseNameOf(dirPath) || "/",
      items: [
        { label: singleIsDir ? "Open folder" : "Open", icon: singleIsDir ? <FolderOpen size={14} /> : <ExternalLink size={14} />, disabled: !single, action: openSingle },
        ...(single && !singleIsDir ? [{ label: "Open With…", icon: <AppWindow size={14} />, action: () => cb.openWithDialog(single, singleMime) }] : []),
        ...(singleIsArchive && single ? [{ label: "Extract here", icon: <FolderOutput size={14} />, action: extractHere }] : []),
        ...(singleIsArchive && single ? [{ label: "Extract To…", icon: <FolderInput size={14} />, action: () => cb.extractTo(single) }] : []),
        { label: "Open in Terminal", icon: <Terminal size={14} />, action: () => fsApi.openTerminal(single ?? dirPath).catch((e) => ctx.toast("error", e.message)) },
      ],
    },
    {
      items: [
        { label: "Cut", shortcut: "Ctrl+X", icon: <Scissors size={14} />, disabled: !hasSel, action: () => ctx.setClipboard({ mode: "cut", paths }) },
        { label: "Copy", shortcut: "Ctrl+C", icon: <Copy size={14} />, disabled: !hasSel, action: () => ctx.setClipboard({ mode: "copy", paths }) },
        {
          label: `Paste${clipboard ? ` (${clipboard.paths.length})` : ""}`,
          shortcut: "Ctrl+V",
          icon: <ClipboardPaste size={14} />,
          disabled: !clipboard || clipboard.paths.length === 0,
          action: () => { if (clipboard) void doPaste(ctx, clipboard.mode, clipboard.paths, targetDir); },
        },
        { label: "Move to…", icon: <Move size={14} />, disabled: !hasSel, action: () => cb.moveCopyTo("move", paths) },
        { label: "Copy to…", icon: <Files size={14} />, disabled: !hasSel, action: () => cb.moveCopyTo("copy", paths) },
        {
          label: "Duplicate", icon: <CopyPlus size={14} />, disabled: !hasSel,
          action: () => {
            void (async () => {
              for (const s of paths) {
                try { await fsApi.duplicatePath(s); } catch (e) { ctx.toast("error", e instanceof Error ? e.message : String(e)); }
              }
              ctx.refreshAll();
            })();
          },
        },
        { label: "Rename", shortcut: "F2", icon: <PenLine size={14} />, disabled: !single, action: () => { if (single) cb.beginRename(single); } },
        { label: "Bulk rename…", icon: <ListPlus size={14} />, disabled: paths.length < 2, action: () => cb.openBulkRename(paths) },
        {
          label: "Compress…",
          icon: <Archive size={14} />,
          disabled: !hasSel,
          action: () => {
            const suggested = single ? `${stemOf(baseNameOf(single))}.zip` : "Archive.zip";
            cb.compressSel(paths, suggested);
          },
        },
      ],
    },
    {
      items: [
        ...(showCreate ? [
          { label: `New folder ${targetLabel}`, shortcut: "Ctrl+Shift+N", icon: <FolderPlus size={14} />, action: newFolderHere },
          { label: `New file ${targetLabel}`, icon: <FilePlus size={14} />, action: newFileHere },
          {
            label: singleIsDir && single ? `Bookmark “${baseNameOf(single)}”` : "Bookmark this folder",
            icon: <Star size={14} />,
            action: () => {
              const target = singleIsDir && single ? single : dirPath;
              ctx.addBookmark(target);
              ctx.toast("info", "Bookmark added");
            },
          },
        ] as CtxItem[] : []),
        { label: "Copy path", icon: <Link size={14} />, disabled: !single, action: () => { if (single) void navigator.clipboard?.writeText(single).then(() => ctx.toast("info", "Path copied")).catch(() => ctx.toast("error", "Copy failed")); } },
        { label: "Copy name", icon: <Type size={14} />, disabled: !single, action: () => { if (single) void navigator.clipboard?.writeText(names[0]).then(() => ctx.toast("info", "Name copied")).catch(() => ctx.toast("error", "Copy failed")); } },
        { label: "Properties", shortcut: "Alt+Enter", icon: <Info size={14} />, disabled: !single, action: () => { if (single) cb.openProperties(single); } },
      ],
    },
    {
      items: [
        { label: "Move to Trash", shortcut: "Del", icon: <Trash2 size={14} />, disabled: !hasSel, action: () => trashSel(ctx, paths) },
        { label: "Delete forever…", shortcut: "Shift+Del", icon: <TriangleAlert size={14} />, danger: true, disabled: !hasSel, action: () => permDelete(ctx, paths, names) },
      ],
    },
  ];
}
