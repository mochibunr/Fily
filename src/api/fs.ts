import type {
  CopyOptions,
  FileEntry,
  FilySettings,
  OpResult,
  Place,
  SearchOptions,
  Volume,
} from "../types";

let cachedInvoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;
let invokePromise: Promise<(<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null> | null = null;

async function getInvoke() {
  if (!invokePromise) {
    invokePromise = (async () => {
      try {
        const mod = await import("@tauri-apps/api/core");
        const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
        cachedInvoke = internals
          ? (mod.invoke as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)
          : null;
      } catch {
        cachedInvoke = null;
      }
      return cachedInvoke;
    })();
  }
  return invokePromise;
}

export async function isTauri(): Promise<boolean> {
  return (await getInvoke()) !== null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("File backend unavailable — launch the Tauri desktop app for real file access");
  return invoke<T>(cmd, args);
}

function friendly(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e.replace(/^CONFLICT:/, ""));
  return new Error(String(e));
}

export interface Opener {
  id: string;
  name: string;
}

export const fsApi = {
  async listDir(path: string, showHidden: boolean): Promise<FileEntry[]> {
    try {
      return await call<FileEntry[]>("list_dir", { path, showHidden });
    } catch (e) {
      throw friendly(e);
    }
  },
  async statPath(path: string): Promise<FileEntry> {
    try {
      return await call<FileEntry>("stat_path", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async createDir(parent: string, name: string): Promise<string> {
    try {
      return await call<string>("create_dir", { parent, name });
    } catch (e) {
      throw friendly(e);
    }
  },
  async createFile(parent: string, name: string): Promise<string> {
    try {
      return await call<string>("create_file", { parent, name });
    } catch (e) {
      throw friendly(e);
    }
  },
  async renamePath(path: string, newName: string): Promise<string> {
    try {
      return await call<string>("rename_path", { path, newName });
    } catch (e) {
      throw friendly(e);
    }
  },
  async copyPaths(sources: string[], destDir: string, options?: CopyOptions): Promise<OpResult> {
    try {
      return await call<OpResult>("copy_paths", { sources, destDir, options: options ?? null });
    } catch (e) {
      throw friendly(e);
    }
  },
  async movePaths(sources: string[], destDir: string, options?: CopyOptions): Promise<OpResult> {
    try {
      return await call<OpResult>("move_paths", { sources, destDir, options: options ?? null });
    } catch (e) {
      throw friendly(e);
    }
  },
  async duplicatePath(path: string): Promise<string> {
    try {
      return await call<string>("duplicate_path", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async trashPaths(paths: string[]): Promise<OpResult> {
    try {
      return await call<OpResult>("trash_paths", { paths });
    } catch (e) {
      throw friendly(e);
    }
  },
  async deletePermanent(paths: string[]): Promise<OpResult> {
    try {
      return await call<OpResult>("delete_permanent", { paths });
    } catch (e) {
      throw friendly(e);
    }
  },
  async searchDir(dir: string, options: SearchOptions): Promise<FileEntry[]> {
    try {
      const clean: Record<string, unknown> = { ...options };
      for (const k of ["minSize", "maxSize", "modifiedAfter", "modifiedBefore"]) {
        if (clean[k] == null) clean[k] = null;
      }
      return await call<FileEntry[]>("search_dir", { dir, options: clean });
    } catch (e) {
      throw friendly(e);
    }
  },
  async readTextPreview(path: string): Promise<{ text: string; truncated: boolean; size: number }> {
    try {
      return await call("read_text_preview", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async readImageDataUrl(path: string): Promise<string> {
    try {
      return await call<string>("read_image_data_url", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async listArchive(path: string): Promise<string[]> {
    try {
      return await call<string[]>("list_archive", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async extractArchive(path: string, destDir: string): Promise<OpResult> {
    try {
      return await call<OpResult>("extract_archive", { path, destDir });
    } catch (e) {
      throw friendly(e);
    }
  },
  async extractHere(path: string): Promise<OpResult> {
    try {
      return await call<OpResult>("extract_here", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async compressZip(sources: string[], destFile: string, overwrite?: boolean): Promise<OpResult> {
    try {
      return await call<OpResult>("compress_zip", { sources, destFile, overwrite: overwrite ?? false });
    } catch (e) {
      throw friendly(e);
    }
  },
  async getOpeners(mime: string): Promise<Opener[]> {
    try {
      return await call<Opener[]>("get_openers", { mime });
    } catch (e) {
      throw friendly(e);
    }
  },
  async openWith(path: string, appId: string): Promise<void> {
    try {
      await call("open_with", { path, appId });
    } catch (e) {
      throw friendly(e);
    }
  },
  async fileChecksum(path: string, algo = "sha256"): Promise<string> {
    try {
      return await call<string>("file_checksum", { path, algo });
    } catch (e) {
      throw friendly(e);
    }
  },
  async dirSize(path: string): Promise<number> {
    try {
      return await call<number>("dir_size", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async openPath(path: string): Promise<void> {
    try {
      await call("open_path", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async openTerminal(path: string): Promise<void> {
    try {
      await call("open_terminal", { path });
    } catch (e) {
      throw friendly(e);
    }
  },
  async getPlaces(): Promise<Place[]> {
    try {
      return await call<Place[]>("get_places");
    } catch (e) {
      throw friendly(e);
    }
  },
  async getVolumes(): Promise<Volume[]> {
    try {
      return await call<Volume[]>("get_volumes");
    } catch (e) {
      throw friendly(e);
    }
  },
  /** Folder the app opens on launch: `$HOME`, not `/`. */
  async getStartDir(): Promise<string> {
    try {
      return await call<string>("get_start_dir");
    } catch (e) {
      throw friendly(e);
    }
  },

  // --- Settings ---------------------------------------------------------
  // Backed by a JSON file so the app can also be configured from outside via
  // `fily config …` (see src-tauri/src/settings.rs).

  /** Current settings plus whether a settings file already existed on disk. */
  async getSettings(): Promise<{ settings: FilySettings; exists: boolean }> {
    try {
      const [settings, exists] = await call<[FilySettings, boolean]>("get_settings");
      return { settings, exists };
    } catch (e) {
      throw friendly(e);
    }
  },
  /** Merge a partial patch; unknown keys are rejected by the backend. */
  async setSettings(patch: Partial<FilySettings>): Promise<FilySettings> {
    try {
      return await call<FilySettings>("set_settings", { patch });
    } catch (e) {
      throw friendly(e);
    }
  },
  /** Point the backend's folder watcher at the folders the panes are showing. */
  async watchPanes(paths: string[]): Promise<void> {
    try {
      await call<void>("watch_panes", { paths });
    } catch (e) {
      throw friendly(e);
    }
  },

  /** Which folders the backend currently watches. Diagnostic. */
  async watchedPaths(): Promise<string[]> {
    return await call<string[]>("watched_paths");
  },

  async resetSettings(): Promise<FilySettings> {
    try {
      return await call<FilySettings>("reset_settings");
    } catch (e) {
      throw friendly(e);
    }
  },
};

/**
 * Subscribe to settings changed externally (CLI, AI agent, or a second
 * instance). Returns an unsubscribe function; a no-op in the browser where
 * there is no Tauri event bus.
 */
export async function onSettingsChanged(
  handler: (s: FilySettings) => void,
): Promise<() => void> {
  try {
    const mod = await import("@tauri-apps/api/event");
    const un = await mod.listen<FilySettings>("settings-changed", (e) => handler(e.payload));
    return un;
  } catch {
    return () => {};
  }
}

/**
 * Subscribe to "a watched directory changed". The payload is that directory.
 * Returns an unsubscribe function; a no-op in the browser where there is no
 * Tauri event bus.
 */
export async function onFsChanged(
  handler: (dir: string) => void,
): Promise<() => void> {
  try {
    const mod = await import("@tauri-apps/api/event");
    const un = await mod.listen<string>("fs-changed", (e) => handler(e.payload));
    return un;
  } catch {
    return () => {};
  }
}
