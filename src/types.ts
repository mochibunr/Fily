export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  size: number;
  modified: number | null;
  created: number | null;
  extension: string;
  mime: string;
}

export interface OpFailure {
  path: string;
  message: string;
}

export interface OpResult {
  ok: boolean;
  failures: OpFailure[];
  conflicts: string[];
}

export interface CopyOptions {
  overwrite?: boolean;
  keepBoth?: boolean;
}

export interface SearchOptions {
  query: string;
  recursive: boolean;
  extensions: string[];
  minSize?: number | null;
  maxSize?: number | null;
  modifiedAfter?: number | null;
  modifiedBefore?: number | null;
  maxResults?: number;
  maxDepth?: number;
}

export interface Place {
  id: string;
  label: string;
  path: string;
}

export interface Volume {
  label: string;
  path: string;
  total?: number | null;
  available?: number | null;
}

export type ViewMode = "list" | "grid";
export type SortKey = "name" | "size" | "modified" | "type";
export type Theme =
  | "light"
  | "dark"
  | "dracula"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "nord"
  | "gruvbox"
  | "tokyo-night"
  | "one-dark";

export interface DirViewPrefs {
  mode: ViewMode;
  sortKey: SortKey;
  sortDesc: boolean;
}

export interface TabState {
  id: number;
  path: string;
  history: string[];
  histIndex: number;
}

/**
 * Progress for a long-running operation, emitted by the backend as
 * `op-progress`. Mirrors `OpProgress` in `src-tauri/src/fs_commands.rs`.
 */
export interface OpProgress {
  id: string;
  label: string;
  current: string;
  done: number;
  total: number;
  finished: boolean;
}

/** Mirrors `FilySettings` in `src-tauri/src/settings.rs`. */
export interface FilySettings {
  theme: Theme;
  uiZoom: number;
  listScale: number;
  showHidden: boolean;
  sideWidth: number;
  sidebarCollapsed: boolean;
  showDevices: boolean;
  showPlaces: boolean;
  previewVisible: boolean;
  dual: boolean;
  toolbar: Record<string, boolean>;
}
