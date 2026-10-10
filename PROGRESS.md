# Fily — progress

## Done (verified)

- [x] Research summary + product decisions (`RESEARCH.md`).
- [x] Tauri 2 scaffold: `src-tauri/` (main, 21-command `fs_commands.rs`,
      dependency-free `logic.rs`, icons, `tauri.conf.json`).
- [x] Filesystem backend: list/stat/create/rename/copy/move/duplicate/trash/
      permanent-delete/search/text+image preview/archive list+extract/sha256/
      dir-size/open/terminal/places/volumes — with conflict pre-flight,
      protected-target refusal, zip-slip guard, no shell strings.
- [x] Frontend: sidebar, toolbar, breadcrumbs, tabs, dual pane, list (virtualized)
      + grid, sorting (natural), hidden toggle, per-dir prefs, selection
      (click/Ctrl/Shift/keyboard), inline rename, context menus, DnD,
      preview panel, command palette, bulk rename, properties, conflict/
      confirm/prompt dialogs, toasts, status bar, light/dark themes.
- [x] Search parser (`type:` `ext:` `size:`) with unit tests.
- [x] Quality gates: `tsc` clean, `vite build` passes, `vitest` 7/7,
      `rustfmt` clean, `logic.rs` 6/6 via `rustc --test`.
- [x] Headless-Chromium functional suite 9/9 (stubbed IPC): virtualization
      (48 rows for 1538 entries), selection, 16-item context menu,
      `type:pdf` → 1 result, grid, palette, theme persistence.
- [x] Release build + install (2026-10-10): `tauri build` produced deb/rpm/
      AppImage with zero warnings; installed to `~/.local/bin/fily` with a
      launcher entry + icons. Installed binary smoke-tested under Xvfb:
      real `/` listing, Places, Devices, symlink markers — all live.
- [x] Round 2 (menus, icons, search, perf): single custom context menu,
      full file menu (Open, Open With…, Extract/Extract To…, Cut/Copy,
      Move/Copy to…, Rename, Compress…, Trash, Properties), folder-aware
      New Folder/File + Bookmark targets, real Open-With backend, zip
      compress + extract-here, ~100 per-extension colored icons, global
      show-hidden, redesigned preview panel, incremental grid + bounded
      thumbnails + content-visibility, custom sort picker.
- [x] Round 3 (motion + mouse): file right-click hides folder items;
      spring-physics motion throughout (all transform/opacity only,
      `prefers-reduced-motion` respected); mouse side buttons navigate.
- [x] Round 4 (settings, themes, sidebar, search): settings modal with 9
      themes (Fily Dark/Light, Dracula, Catppuccin Mocha/Latte, Nord,
      Gruvbox, Tokyo Night, One Dark), toolbar button toggles, behavior and
      sidebar section switches, settings reset; resizable sidebar (160–400px,
      drag-shut to icon rail, double-click resets); decluttered toolbar
      (terminal only by default); expanding search with filter chips.
- [x] Round 5 (frame + menus): capability file fixes dead window controls
      (close proven live); unused plugins dropped (bundles 5.97→3.74 MiB);
      sidebar drag fixed and proven live (218→353px persisted, rail,
      restore); context menu icons; borderless rows; chevron frame buttons.
- [x] Round 6 (search + location): single focus ring on the search box;
      searches clamped to 200 chars, superseded backend scans abort within
      ~1024 entries, 300k-entry walk budget; Ctrl+L editable location bar
      (paste-a-path navigation, file paths select in parent, bad paths toast)
      with palette command.
- [x] Round 7 (roundness + scroll): transparent frameless window with 16px
      rounded frame, radii bumped app-wide (8/12/18), borderless file rows
      with rounded selection, click-empty-breadcrumb enters location mode,
      rAF-throttled list scroll, themed slim scrollbars, overscroll
      containment. Verified under picom: without a compositor transparent
      windows can't blend (bare-Xvfb artifact, not an app bug).
- [x] Round 11 (filled icons + icon size): authored a filled glyph set
      (`Glyph.tsx`) — colored file bodies with white emblems (play, note,
      image, `</>`, grid, bars, `A`), solid folder, ribbon package, chain
      for symlinks. Lucide is stroke-only so filling it was not viable;
      replacing the per-type icons also cut 7 KB from the bundle.
      Icon size was first exposed as a Settings → File icons slider
      (14–30px) and Ctrl+Wheel; **Round 12 replaced both** with a single
      "File list size" scale (80–160%) covering text and icons together, so
      the icon-only control no longer exists.
- [x] Round 12 (scale + thumbnails): whole-app UI scale (Settings → App
      size, Ctrl +`+`/`-`/`0`) via CSS `zoom`. `100vh` is the *unzoomed*
      viewport, so root/body/#root height is `calc(100vh / var(--zoom))` —
      without it the layout overflowed and pushed the sidebar footer
      (Settings) and the Settings dialog's Done button out of the window at
      130%+. Sidebar footer anchored with `margin-top:auto` instead of a
      flex spacer, which collapsed to zero height under zoom.
      Ctrl+Wheel now scales the file list/grid content only (text, dates,
      icons) — 80–160% — applied as `zoom` on an inner `.file-canvas` so the
      scroll container and the virtualization window stay stable; row
      offsets scale with it. Image files now show a real downscaled preview
      in the list icon slot: thumbnails load only for mounted rows, are
      downscaled in the webview (`utils/thumb.ts`) and cached small, so no
      `image` crate and no megabyte base64 strings in memory.
- [x] Round 13 (scaled-list gap fix): the virtual list's pad elements are
      declared in *scaled* pixels but live inside the zoomed `.file-canvas`,
      which multiplies them by the scale a second time — so a scaled list grew
      a blank gap above the first row and a scrollbar quadratically too long.
      Two coordinate spaces are now explicit: `scrollTop`/`viewportH` come
      from the scroll container (outside the canvas) so they are visual px and
      drive `rowPx = ROW_H * scale`; the pads stay in unscaled px
      (`start * ROW_H`). Verified by a probe asserting the row under the
      header matches the scroll position exactly.
- [x] Round 14 (CLI/AI configuration): settings moved out of the webview into
      an authoritative JSON file at `~/.config/fily/settings.json`
      (`FILY_CONFIG_DIR` overrides), because `localStorage` is unreachable by
      any external process — an AI could not configure the app at all.
      `fily config list|get|set|reset|path` runs before the Tauri builder so it
      never opens a window; unknown keys and bad values are rejected with a
      specific error instead of silently ignored, and numeric values are clamped
      on write and again on read. A Rust watcher polls the file and emits
      `settings-changed`, so `fily config set theme=nord` re-themes a RUNNING
      window with no restart; the store writes through on every in-app change,
      so the file is always current whichever side changed it. On first run the
      existing `localStorage` values are migrated up so no one loses prefs.
      Verified: Rust 15/15 (6 new settings + 3 CLI tests), config suite 4/4
      (file beats stale localStorage, write-through, event subscription),
      existing suites unchanged at 27/27 + 7/7 + 4/4, zero warnings,
      rustfmt clean. Bundle 3.74 → 3.81 MiB (serde_json).
- [x] Round 15 (minimal UI + measured perf): audited the UI for anything not
      earning its place. The `action-row` band (sort icon, "Name ▾", "A → Z",
      item count) was **fully redundant** — the status bar already shows items
      and selection, and the Paste button was duplicated in the toolbar. The
      whole band is gone; sorting collapsed into one toolbar icon opening a
      menu with both key and direction, and the search box collapses to a bare
      magnifier (32px, expanding on focus or when it holds a query). One fewer
      horizontal band, ~34px of list reclaimed, ~160px of toolbar width.
      Measured before/after on a 6000-entry directory: 60 rows mounted, 815 DOM
      nodes, 5.6 MB JS heap, **0 DOM mutations while idle**, worst scroll frame
      46ms.
      Perf: thumbnails were being decoded for the virtualizer's off-screen
      buffer (14 rows above, ~26 below), which in a photo folder meant ~40
      needless decodes per scroll position. They now load only for rows that
      intersect the viewport — measured 21 decodes for 19 visible rows, and 331
      total after scrolling past 353 rows (previously 1200+). The settings
      watcher also backs off from a 400ms poll to 2s after five quiet checks
      instead of stat-ing the file 2.5x/second forever.
      Verified: tsc clean, vitest 8/8, cargo test 15/15, rustfmt clean,
      existing UI suite 27/27 (three checks repointed from the removed
      `.action-row`/`.selection-note` to the status bar and the new sort
      button), plus a new 6-check minimal-UI suite and a 2-check thumbnail-lazy
      suite.
- [x] Round 8 (menu key + scroll memory): F10 / Menu key pops the context
      menu anchored at the selected row; per-directory scroll offsets
      remembered (capped at 100) and restored after Back/Forward/mouse
      navigation once the listing loads.
- [x] Round 10 (blank list on back, from user screenshot): the scroll
      restore was starved whenever React batched the `loading` flag away —
      the restore never fired, and when it did fire late it applied a big
      offset to a short listing, clamping the DOM but leaving stale
      windowing state that rendered ZERO rows with the thumb pinned top.
      Fix: key off fresh entries (array identity) instead of the loading
      flag, and read back the browser-clamped `scrollTop` into state.
      siblings (33px pitch vs the 34px the virtualizer assumes) — switched
      to padding for an exact pitch; stale overlapping directory loads are
      now discarded by token. Icons-after-back unreproducible (29/29 in
      Chromium, full icons in every live shot) — needs a user screenshot if
      it persists on the new build.
- [x] Suites: vitest 8/8, Chromium functional suite 25/25 (F10 menu,
      scroll restore 607→607 exact), release rebuilt warning-free,
      reinstalled via rename-over (live session untouched), Xvfb
      screenshot- and interaction-verified.
- [x] Fixed real bugs found by testing: IPC probe race, unstyled buttons,
      lexicographic ordering, bookmarks loader shape, effect-gated drag
      listeners, missing Tauri capabilities.

## Known issues / not tested

- Window drag + minimize need a window manager/compositor to complete the
  move; proven working at the IPC layer (close verified live), but please
  confirm dragging on your KDE session.
- Windows paths implemented, never executed. No access to a Windows host.
- Trash restore: OS viewer only (no in-app restore UI).
- `showHidden` for pane 2 follows pane-0 dir prefs keyed by its own path —
  correct, but prefs for secondary pane paths accumulate in localStorage.

## Next steps

1. Exercise copy/move conflicts, trash, and zip extract in the installed app.
2. In-app Trash restore UI (parse `trash::os_limited::list`).
3. Duplicate-finder review UI on top of existing checksum/size commands.
4. Windows smoke test (Recycle Bin, drive roots, `start` verb).
