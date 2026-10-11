# Fily

**A fast, keyboard-driven desktop file manager for Linux and Windows.**
Tauri 2 + React 18 + TypeScript, with every filesystem operation performed by
audited Rust commands. No mock data, no dead buttons, no placeholder features.

Fily is a focused alternative to Nautilus: dual panes, tabs, a command palette,
real bulk rename, conflict-aware copy/move, and a preview panel — with a virtualized
list that stays fast on directories of any size.

---

## Features

**Navigation**

- Sidebar with Home/Recent, user Places, Bookmarks, and mounted Devices (Linux,
  read from `/proc/mounts`).
- List and grid views, switchable per directory, with natural (human) sort order.
- Breadcrumbs, back/forward/up, per-pane history, refresh, tabs, and dual panes.
- Click an empty breadcrumb to type a path; `Ctrl+L` focuses it anywhere.
- Remembers scroll position per directory, so Back returns you where you were.
- Resizable sidebar (160–400 px) that snaps to an icon rail when dragged shut.

**File operations**

- Open, **Open With…** (real `.desktop` application picker), create file/folder,
  rename inline or with `F2`, copy/cut/paste, Move/Copy to…, duplicate,
  compress to zip, extract here / to…, Trash, and permanent delete.
- **Conflicts are never silently overwritten.** Copy and move pre-flight the
  destination and surface Replace / Keep both / Skip exactly once.
- Bulk rename with live preview using `{name}`, `{ext}`, `{n}` plus find/replace.
- Drag-and-drop move or copy between panes.
- Properties (`Alt+Enter`), copy path/name, folder size, SHA-256 on demand, and
  zip archive listings.

**Search**

- Recursive filename search with `type:`, `ext:`, and `size:` filters —
  e.g. `report type:pdf size:>10mb`.
- Debounced and bounded (depth 8, 5,000 results max). Superseded searches abort
  early instead of burning CPU. Matches are highlighted in the results.

**Preview panel**

- Images, text and code (capped at 256 KB), audio metadata with playback hook,
  PDF handoff to the system reader, zip contents, checksum, and folder size.
- Image files show a real thumbnail **directly in the list**, not just in grid
  view. Thumbnails are generated only for rows actually on screen and scaled
  down in the webview, so a folder of large photos stays cheap.

**Interface**

Deliberately minimal: the window is a toolbar, a list, and a status bar. Nothing
is on screen unless it earns its place — search collapses to a bare magnifier
until you use it, sorting lives in one toolbar menu, and the item/selection count
lives in the status bar rather than a row of its own.

- Command palette (`Ctrl+K`) and a complete keyboard map.
- 9 themes: light, dark, Dracula, Catppuccin Mocha, Catppuccin Latte, Nord,
  Gruvbox, Tokyo Night, One Dark.
- Whole-app UI scale (`Ctrl` `+` / `-` / `0`), and independent scaling of the
  file list text and icons (`Ctrl`+scroll) from 80–160%.
- Custom rounded window frame, spring-physics animations throughout, and
  full `prefers-reduced-motion` support.
- Context menus that adapt to what is selected (file, folder, or a mix).
- Settings for themes, toolbar buttons, behavior, sidebar sections, and sizes.

**Performance**

Built to stay cheap on very large directories. On a 6,000-entry folder it holds
60 rows in the DOM, ~815 nodes total, ~5.6 MB of JS heap, and does **zero** DOM
work while idle.

- The list is virtualized: only about a screenful of rows exists, regardless of
  directory size, and rows are memoized so scrolling re-renders only what changed.
- Image thumbnails decode **only for rows currently on screen**, not for the
  scroll buffer — measured at 21 decodes for 19 visible rows, and 331 total
  after scrolling past 353 rows (rather than one set per scroll position).
- Thumbnails are downscaled in the webview before being cached, so a folder of
  large photos costs kilobytes per item instead of megabytes of base64.
- Scroll handling is `requestAnimationFrame`-throttled, and the grid renders in
  batches with bounded caches for thumbnails and scroll positions.
- Search is bounded (depth, result count, query length) and superseded searches
  abort early instead of finishing work nobody reads.

**Safety**

Enforced in the backend, not merely hidden in the UI:

- Absolute-path validation and NUL-byte rejection on every path argument.
- Protected targets are refused for destructive operations: filesystem root,
  your home directory, and single-component system paths like `/usr`.
- Zip-slip refusal — archives containing absolute or `..` paths are rejected.
- Symlink-aware listing; symlinks are never followed implicitly.
- Cross-device moves fall back to copy + delete + report.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Focus search |
| `Ctrl+L` | Type a path / location bar |
| `Ctrl+1` / `Ctrl+2` | List view / grid view |
| `Ctrl+T` | New tab at current path |
| `Ctrl+Shift+N` | New folder |
| `Ctrl+A` | Select all |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom the whole app in / out / reset |
| `Ctrl` + scroll | Scale the file list text and icons |
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Delete` or `Backspace` | Move to Trash |
| `Shift+Delete` | Delete permanently (confirmed) |
| `F2` | Rename selection |
| `Alt+Enter` | Properties |
| `F10` or `Menu` | Context menu for selection |
| `Enter` | Open selection |
| `Escape` | Close dialog / cancel |

---

## Installing

### Download a prebuilt binary (no Node.js, no Rust)

Get the latest release and run it:

| Platform | File | Install |
|---|---|---|
| Any Linux | `Fily_*_amd64.AppImage` | `chmod +x Fily_*.AppImage && ./Fily_*.AppImage` |
| Debian / Ubuntu | `Fily_*_amd64.deb` | `sudo apt install ./Fily_*.deb` |
| Fedora / openSUSE | `Fily-*.x86_64.rpm` | `sudo dnf install ./Fily-*.rpm` |

Download from [**Releases**](https://github.com/mochibunr/Fily/releases/latest).

The AppImage needs no install at all. If it refuses to start because FUSE is
unavailable, extract it instead:

```sh
./Fily_*.AppImage --appimage-extract && ./squashfs-root/AppRun
```

> Linux still needs the WebKitGTK 4.1 **runtime** (`webkit2gtk-4.1` on Arch,
> `libwebkit2gtk-4.1-0` on Debian/Ubuntu). Desktop systems normally already
> ship it — you do not need a compiler or Rust.

### Build from source instead

If you'd rather build it yourself, or want the newest unreleased changes:

```sh
git clone https://github.com/mochibunr/Fily.git
cd Fily
npm install
npm run tauri build
```

Or use the installer, which picks the right method for your system — a package
install where one exists, otherwise a drop into `~/.local`:

```sh
curl -fsSL https://raw.githubusercontent.com/mochibunr/Fily/main/install.sh | bash
```

| Flag | Effect |
|---|---|
| *(none)* | Install the prebuilt binary — no Node.js or Rust needed |
| `--local` | Same, but always into `~/.local`; never calls `sudo` |
| `--build` | Build from source instead (requires Node.js + Rust) |
| `--version` | Print which version and assets would be installed |

It is safe to re-run and stops with clear instructions rather than installing
half-way.

### Prerequisites

- Node.js 18+ and npm
- Rust (stable toolchain)
- Platform WebKit libraries for Tauri 2

On **Arch Linux** the WebKit package is named **`webkit2gtk-4.1`** — it is *not*
called `webkit2gtk`, which is a common first-build stumbling block:

```sh
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file
```

On **Debian/Ubuntu**:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### What the build produces

Bundles land in `src-tauri/target/release/bundle/` (`.deb`, `.rpm`,
`.AppImage`), or you can skip straight to the binary:

```sh
./src-tauri/target/release/fily
```

### Development

```sh
npm run dev          # Vite dev server on :1420 (front end only)
npm run tauri dev    # full desktop app with hot reload
```

---

## Testing

```sh
npm run lint         # type check (tsc --noEmit)
npm test             # vitest — formatting, path and search-parser suites
npm run build        # type check + production build

# Rust: full suite (settings persistence, CLI typing, filesystem logic)
cargo test --manifest-path src-tauri/Cargo.toml

# Rust: pure logic only — runs with NO GTK/WebKit toolchain at all
rustc --edition 2021 --test src-tauri/src/logic.rs -o /tmp/logic_test && /tmp/logic_test

rustfmt --check --edition 2021 src-tauri/src/*.rs
```

Current status: type check clean, production build clean, **vitest 8/8**,
**Rust 15/15**, `rustfmt` clean, release build produces zero warnings.
Functional UI, scaling, thumbnail, and configuration suites are also run during
development; see [`PROGRESS.md`](PROGRESS.md) for the latest results.

---

## Configuring Fily from the command line

Fily's settings live in a plain JSON file, so the app can be configured by a
terminal, a script, or an AI agent — **no GUI required, and no restart**.

```sh
fily config list                          # show every setting and its value
fily config get theme                     # read one value
fily config set theme=nord                # change one value
fily config set uiZoom=1.2 listScale=1.15 # several at once
fily config set toolbar='{"terminal":false}'
fily config reset                         # back to defaults
fily config path                          # where the file lives
```

Settings file: `~/.config/fily/settings.json` (override with `FILY_CONFIG_DIR`).

| Setting | Type | Range / values |
|---|---|---|
| `theme` | string | `light`, `dark`, `dracula`, `catppuccin-mocha`, `catppuccin-latte`, `nord`, `gruvbox`, `tokyo-night`, `one-dark` |
| `uiZoom` | number | 0.7 – 1.6 (whole-window scale) |
| `listScale` | number | 0.8 – 1.6 (file list text and icons) |
| `showHidden` | bool | `true` / `false` |
| `sideWidth` | number | 160 – 400 (sidebar width in px) |
| `sidebarCollapsed` | bool | `true` / `false` |
| `showDevices` | bool | show the Devices section |
| `showPlaces` | bool | show the Places section |
| `toolbar` | object | e.g. `{"newFolder":true,"terminal":false}` |

**Changes apply live.** A background watcher notices edits to the file and the
running window updates immediately — so you can keep Fily open and theme it
from another terminal:

```sh
fily config set theme=dracula
```

Invalid keys and values are rejected with a specific error rather than being
ignored, and out-of-range numbers are clamped, so a mistyped command can never
leave the UI unusable.

---

## Architecture

The front end never touches the filesystem. All access goes through typed IPC
calls that land in Rust commands, which is what makes the safety guarantees
above enforceable rather than cosmetic.

```
React UI  ──invoke──▶  Rust commands  ──▶  filesystem
 (FileView,            (fs_commands,
  Sidebar, …)           archive_commands,
                        open_commands,
                        logic.rs  ← pure, unit-tested)

settings.json ◀──watched by Rust── emit "settings-changed" ──▶ React UI
     ▲                                    │
     └── fily config set ─────────────────┘ (live update, no restart)
```

- `src/` — React front end. `store/app.tsx` holds all app state and
  persistence; `api/fs.ts` is the only IPC boundary; `components/FileView.tsx`
  contains the virtualized list and grid.
- `src-tauri/src/` — Rust backend. `logic.rs` is deliberately dependency-free so
  it can be tested with `rustc --test` on any machine, without GUI libraries.

Design decisions and the reasoning behind them are recorded in
[`RESEARCH.md`](RESEARCH.md).

---

## Known limitations

- Windows support is implemented (Recycle Bin, `cmd /C start`, drive-root
  protection) but has not been exercised on a Windows host yet.
- Trash restore relies on the OS trash viewer; there is no in-app trash UI.
- Audio and video preview is metadata plus system-player handoff — there is no
  in-app media decoding.
- PDFs open in the system reader rather than rendering inline.
- Search is filename search only. There is no indexed or full-text search; this
  is a deliberate choice rather than a missing feature.

---

## Project status

Actively developed, pre-1.0 (`0.1.0`). See [`PROGRESS.md`](PROGRESS.md) for the
work log and [`HANDOFF.md`](HANDOFF.md) for the current architecture notes,
verification status, and open questions.