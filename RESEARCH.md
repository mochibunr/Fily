# Fily — research summary and product decisions

Researched: Files (Windows), Finder, Dolphin, Spacedrive, Directory Opus, Raycast patterns.
Method: HN Algolia API + Wikipedia fetches (only key-free sources reachable from here),
plus local inspection of Nautilus/Dolphin behavior on this machine.

## What users actually complain about

- **Nautilus**: removed split view and type-ahead; "always uses icon view", weak bulk
  rename, no dual pane. (This machine runs Nautilus 50 as the default FM.)
- **Finder**: cutting files is awkward (Cmd-drag), no real path bar, image preview
  pays full-decode cost on large folders.
- **Dolphin**: powerful but visually dated; split view and KIO are the beloved parts.
- **Spacedrive/Opus**:raves about organization + power, complaints about stability
  and overwhelming chrome.
- Common thread: **everyday ops (copy/move/conflict handling) are where trust is
  won or lost**, not exotic features.

## Decisions for Fily (why it looks the way it does)

1. **Conflict-first copy/move.** Never silently overwrite. Backend pre-flights
   conflicts and returns them; UI offers Replace / Keep both / Skip exactly once.
   (`copy_paths`/`move_paths` in `src-tauri/src/fs_commands.rs`.)
2. **Trash by default, permanent delete behind explicit confirm**, with system
   locations (`/`, `/home`, home dir, drive roots) refused in the backend —
   not just hidden in the UI.
3. **Virtualized list + capped previews.** List renders ~a screenful of rows
   regardless of directory size; image previews are fetched only for visible
   grid items and cached; text capped at 256 KB, images at 12 MB, archives
   listed to 500 entries. No full-directory image decoding.
4. **Search is filename search with honest filters** (`type:`, `ext:`, `size:`),
   bounded (500 results, depth 8), debounced, with obsolete runs discarded by
   token. No fake "full-text" claims.
5. **Command palette + full shortcut map** (Raycast lesson): Ctrl+K, Ctrl+F,
   Ctrl+1/2, F2, Del/Shift+Del, Alt+Left/Right, Ctrl+Shift+N, Ctrl+T.
6. **Neutral canvas + one accent**, light/dark tokens, no glass, no card soup.
   Breadcrumbs, compact 34 px rows, sidebar limited to Navigate/Places/
   Bookmarks/Devices.
7. **Dual pane + tabs shipped early** because Dolphin/Opus users call them
   non-negotiable — but as thin panes over one engine, not a second app.
8. **What was cut on purpose:** indexed search (consistency burden), archive
   browsing-as-filesystem (extract + listing only), duplicate finder UI
   (backend has checksum + size primitives; UI review step deferred to keep
   v1 honest), custom shortcut remapping (deferred, documented).

## Platform notes

- Linux: Trash via `trash` crate (freedesktop compliant), terminal probing
  (xdg-terminal-exec → kitty → gnome-terminal → konsole → xterm), volumes from
  `/proc/mounts`, open via `xdg-open`. All verified paths in code.
- Windows: Trash via same crate (Recycle Bin), `cmd /C start` for open,
  drive-root protection. Implemented but **not executed here** — documented
  in PROGRESS.md as untested.
