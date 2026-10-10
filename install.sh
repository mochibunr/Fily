#!/usr/bin/env bash
#
# Fily installer — builds from source and sets up a launcher.
#
#   curl -fsSL https://raw.githubusercontent.com/mochibunr/Fily/main/install.sh | bash
#
# or, from a clone:
#   ./install.sh
#
# Safe to re-run: it overwrites its own files and leaves everything else alone.
#
set -euo pipefail

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GRN=$'\033[32m'
YLW=$'\033[33m'
OFF=$'\033[0m'
say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$BOLD" "$OFF" "$*"; }
ok() { printf '%s  ✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s  !%s %s\n' "$YLW" "$OFF" "$*"; }
die() {
	printf '%s  ✗%s %s\n' "$RED" "$OFF" "$*" >&2
	exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# Where the repo lives. Works when piped from curl (no argv) or run in place.
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
if [ ! -f "$SRC_DIR/src-tauri/Cargo.toml" ]; then
	# Piped from curl: fetch a copy so we build from a known-good tree.
	SRC_DIR="$(mktemp -d)/Fily"
	say "${DIM}Fetching source…${OFF}"
	have git || die "git is required to download the source."
	git clone --depth 1 https://github.com/mochibunr/Fily.git "$SRC_DIR" ||
		die "Could not download Fily."
fi

# Install locations. Overridable so this can be tested without touching the
# real home directory.
INSTALL_DIR="${FILY_INSTALL_DIR:-$HOME/.local/bin}"
DESKTOP_DIR="${FILY_DESKTOP_DIR:-$HOME/.local/share/applications}"
ICON_DIR="${FILY_ICON_DIR:-$HOME/.local/share/icons/hicolor}"

say ""
say "${BOLD}Fily installer${OFF}"
say "${DIM}$SRC_DIR${OFF}"
say ""

# --------------------------------------------------------------------------
step "Checking prerequisites"
# --------------------------------------------------------------------------

have node || die "node is missing. Install Node.js 18+ (https://nodejs.org)."
have npm || die "npm is missing. It ships with Node.js."
have cargo || die "Rust is missing. Install it with: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
# `cargo` can be on PATH and still be unusable (rustup with no default
# toolchain), which used to print a blank version next to a green tick.
if ! cargo --version >/dev/null 2>&1; then
  if have rustup; then
    die "rustup is installed but has no default toolchain. Run: rustup default stable"
  fi
  die "cargo is on PATH but does not run. Reinstall Rust, then retry."
fi
ok "node    $(node --version)"
ok "npm     v$(npm --version)"
ok "cargo   $(cargo --version | cut -d' ' -f2)"

# Tauri's Linux build needs the WebKitGTK 4.1 development package. The exact
# name differs per distro and picking the wrong one is the usual first-build
# failure, so name it explicitly instead of letting pkg-config fail obscurely.
webkit_pkg=""
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
	ok "webkit2gtk-4.1 found"
else
	case "$(. /etc/os-release 2>/dev/null && echo "${ID:-}${ID_LIKE:-}")" in
	*arch* | *manjaro* | *endeavouros*) webkit_pkg="sudo pacman -S webkit2gtk-4.1 base-devel" ;;
	*debian* | *ubuntu* | *mint*) webkit_pkg="sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev" ;;
	*fedora* | *rhel*) webkit_pkg="sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel" ;;
	*suse*) webkit_pkg="sudo zypper install webkit2gtk-4.1-devel libappindicator3-devel librsvg2-devel" ;;
	*alpine*) webkit_pkg="sudo apk add webkit2gtk-4.1-dev build-base" ;;
	*) webkit_pkg="(install your distro's webkit2gtk-4.1 development package)" ;;
	esac
	warn "webkit2gtk-4.1 development files are missing."
	say ""
	say "     Install them, then re-run this script:"
	say ""
	say "       $webkit_pkg"
	say ""
	exit 1
fi

# --------------------------------------------------------------------------
step "Installing dependencies"
# --------------------------------------------------------------------------
cd "$SRC_DIR"
if [ -f package-lock.json ]; then
	npm ci --no-audit --no-fund || warn "npm ci failed, falling back to npm install"
	[ -d node_modules ] || npm install --no-audit --no-fund
else
	npm install --no-audit --no-fund
fi
ok "node modules ready"

# --------------------------------------------------------------------------
step "Building Fily (this takes a few minutes)"
# --------------------------------------------------------------------------
npm run tauri build
ok "release build finished"

BIN_SRC="$SRC_DIR/src-tauri/target/release/fily"
[ -x "$BIN_SRC" ] || die "build did not produce $BIN_SRC"

# --------------------------------------------------------------------------
step "Installing"
# --------------------------------------------------------------------------
mkdir -p "$INSTALL_DIR" "$DESKTOP_DIR" "$ICON_DIR/32x32/apps" "$ICON_DIR/128x128/apps"

# Copy to a temp name first, then rename. A plain `cp` onto a running binary
# fails with "Text file busy".
TMP_BIN="$(mktemp)"
cp "$BIN_SRC" "$TMP_BIN"
chmod 755 "$TMP_BIN"
mv -f "$TMP_BIN" "$INSTALL_DIR/fily"
ok "binary  -> $INSTALL_DIR/fily"

# The launcher must point at the real path. A hardcoded one only works on the
# machine where the file was generated.
cat >"$DESKTOP_DIR/fily.desktop" <<EOF
[Desktop Entry]
Name=Fily
Comment=Modern file manager
Exec=$INSTALL_DIR/fily %f
Icon=fily
Terminal=false
Type=Application
Categories=Utility;FileManager;FileTools;
MimeType=inode/directory;
StartupWMClass=Fily
EOF
ok "launcher -> $DESKTOP_DIR/fily.desktop"

if [ -f "$SRC_DIR/src-tauri/icons/128x128.png" ]; then
	cp "$SRC_DIR/src-tauri/icons/128x128.png" "$ICON_DIR/128x128/apps/fily.png"
	cp "$SRC_DIR/src-tauri/icons/32x32.png"   "$ICON_DIR/32x32/apps/fily.png"
	if [ -f "$SRC_DIR/src-tauri/icons/128x128@2x.png" ]; then
	  mkdir -p "$ICON_DIR/256x256/apps"
	  cp "$SRC_DIR/src-tauri/icons/128x128@2x.png" "$ICON_DIR/256x256/apps/fily.png"
	fi
	have update-desktop-database && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
	have gtk-update-icon-cache && gtk-update-icon-cache -f -t "$ICON_DIR" >/dev/null 2>&1 || true
	ok "icons   -> $ICON_DIR"
fi

# --------------------------------------------------------------------------
say ""
say "${GRN}${BOLD}Fily is installed.${OFF}"
say ""
say "  Run it:        ${BOLD}fily${OFF}"
say "  Open a folder: ${BOLD}fily ~/Documents${OFF}"
say "  Configure it:  ${BOLD}fily config set theme=nord${OFF}"
say ""
say "  If your desktop has no launcher entry yet, log out and back in, or run:"
say "    ${DIM}update-desktop-database ~/.local/share/applications 2>/dev/null || true${OFF}"
say ""
say "  Re-running this script is safe — it just rebuilds and overwrites."
say ""
