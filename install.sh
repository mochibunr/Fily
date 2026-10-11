#!/usr/bin/env bash
#
# Fily installer.
#
#   curl -fsSL https://raw.githubusercontent.com/mochibunr/Fily/main/install.sh | bash
#
# By default this downloads a PREBUILT binary from GitHub Releases. You do not
# need Node.js, Rust, or a compiler — only curl and tar.
#
#   ./install.sh            install the prebuilt binary (recommended)
#   ./install.sh --local    install into ~/.local, never calls sudo
#   ./install.sh --build    build from source instead (needs Node.js + Rust)
#   ./install.sh --version  print the version that would be installed
#
set -euo pipefail

REPO="mochibunr/Fily"
API="https://api.github.com/repos/$REPO/releases/latest"
RAW_ICON="https://raw.githubusercontent.com/$REPO/main/src-tauri/icons"

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GRN=$'\033[32m'
YLW=$'\033[33m'
OFF=$'\033[0m'
say() { printf '%s\n' "$*"; }
step() { printf '%s==> %s%s\n' "$BOLD" "$*" "$OFF"; }
ok() { printf '%s  ok%s  %s\n' "$GRN" "$OFF" "$*"; }
info() { printf '%s  ·%s  %s\n' "$DIM" "$OFF" "$*"; }
warn() { printf '%s  !%s  %s\n' "$YLW" "$OFF" "$*"; }
die() {
	printf '%s  ✗%s  %s\n' "$RED" "$OFF" "$*" >&2
	exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }
# A progress bar is noise when output is captured or piped.
if [ -t 1 ]; then CURL_PROGRESS="--progress-bar"; else CURL_PROGRESS="-sS"; fi

MODE="auto"
for arg in "$@"; do
	case "$arg" in
	--local) MODE="local" ;;
	--build) MODE="build" ;;
	--version) MODE="version" ;;
	-h | --help)
		sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*) die "Unknown option '$arg'. Try --help." ;;
	esac
done

say ""
say "${BOLD}Fily installer${OFF}"
say ""

# ===========================================================================
# Source build — the original path, kept for developers.
# ===========================================================================
build_from_source() {
	step "Checking build prerequisites"
	have node || die "Building needs Node.js 18+ (https://nodejs.org). Or run without --build to install a prebuilt binary."
	have cargo || die "Building needs Rust (https://rustup.rs). Or run without --build to install a prebuilt binary."
	# cargo can be on PATH and still unusable (rustup with no default toolchain).
	if ! cargo --version >/dev/null 2>&1; then
		have rustup && die "rustup has no default toolchain. Run: rustup default stable"
		die "cargo is on PATH but does not run. Reinstall Rust, then retry."
	fi
	ok "node   $(node --version)"
	ok "cargo  $(cargo --version | cut -d' ' -f2)"

	if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
		local pkg="(install your distro's webkit2gtk-4.1 development package)"
		case "$(. /etc/os-release 2>/dev/null && echo "${ID:-}${ID_LIKE:-}")" in
		*arch* | *manjaro* | *endeavouros*) pkg="sudo pacman -S webkit2gtk-4.1 base-devel" ;;
		*debian* | *ubuntu* | *mint*) pkg="sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev" ;;
		*fedora* | *rhel*) pkg="sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel" ;;
		*suse*) pkg="sudo zypper install webkit2gtk-4.1-devel libappindicator3-devel librsvg2-devel" ;;
		*alpine*) pkg="sudo apk add webkit2gtk-4.1-dev build-base" ;;
		esac
		warn "webkit2gtk-4.1 development files are missing."
		say ""
		say "     ${BOLD}Install them, then re-run:${OFF}"
		say "       $pkg"
		say ""
		exit 1
	fi
	ok "webkit2gtk-4.1"

	local SRC_DIR
	SRC_DIR="$(mktemp -d)/Fily"
	step "Fetching source"
	have git || die "git is required to build from source."
	git clone --depth 1 "https://github.com/$REPO.git" "$SRC_DIR" || die "clone failed."
	cd "$SRC_DIR"

	step "Building (a few minutes)"
	npm install --no-audit --no-fund >/dev/null 2>&1 || npm install
	npm run tauri build >/dev/null
	local built="$SRC_DIR/src-tauri/target/release/fily"
	[ -x "$built" ] || die "build did not produce $built"

	install_binary "$built"
	fetch_icons
}

# ===========================================================================
# Helpers
# ===========================================================================
INSTALL_DIR="${FILY_INSTALL_DIR:-$HOME/.local/bin}"
DESKTOP_DIR="${FILY_DESKTOP_DIR:-$HOME/.local/share/applications}"
ICON_DIR="${FILY_ICON_DIR:-$HOME/.local/share/icons/hicolor}"

install_binary() {
	local src="$1"
	mkdir -p "$INSTALL_DIR"
	# Copy then rename: writing straight onto a running binary fails with
	# "Text file busy". mktemp creates 600, and `chmod +x` would yield 711.
	local tmp
	tmp="$(mktemp)"
	cp "$src" "$tmp"
	chmod 755 "$tmp"
	mv -f "$tmp" "$INSTALL_DIR/fily"
	ok "binary   $INSTALL_DIR/fily"
}

write_launcher() {
	mkdir -p "$DESKTOP_DIR"
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
	ok "launcher $DESKTOP_DIR/fily.desktop"
	have update-desktop-database && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
}

fetch_icons() {
	mkdir -p "$ICON_DIR/32x32/apps" "$ICON_DIR/128x128/apps" "$ICON_DIR/256x256/apps"
	local got=0
	for spec in "32x32.png:32x32" "128x128.png:128x128" "128x128@2x.png:256x256"; do
		local src="${spec%%:*}" dst="${spec##*:}"
		curl -fsSL "$RAW_ICON/$src" -o "$ICON_DIR/$dst/apps/fily.png" 2>/dev/null && got=1
	done
	[ "$got" = 1 ] && ok "icons    $ICON_DIR"
	have gtk-update-icon-cache && gtk-update-icon-cache -f -t "$ICON_DIR" >/dev/null 2>&1 || true
	return 0
}

# Pull the asset URL for a suffix out of the latest-release JSON. Uses only
# grep/sed so it works on a machine with nothing but coreutils.
latest_json=""
asset_url() {
	[ -n "$latest_json" ] || return 1
	printf '%s' "$latest_json" |
		grep -o "\"browser_download_url\": *\"[^\"]*$1\"" |
		head -1 | sed 's/.*"browser_download_url": *"//; s/"$//'
}

arch_ok() {
	case "$(uname -m)" in
	x86_64 | amd64) return 0 ;;
	*) return 1 ;;
	esac
}

# ===========================================================================
# Prebuilt install
# ===========================================================================
install_prebuilt() {
	have curl || die "curl is required to download Fily."

	if ! arch_ok; then
		warn "No prebuilt binary for $(uname -m) yet — releases are x86_64 only."
		say "     ${BOLD}Building from source instead (needs Node.js + Rust):${OFF}"
		say "       ./install.sh --build"
		exit 1
	fi

	step "Finding the latest release"
	latest_json="$(curl -fsSL "$API")" || die "Could not reach the GitHub API."
	local version tag
	version="$(printf '%s' "$latest_json" | grep -m1 '"tag_name"' | sed 's/.*: *"//; s/".*//')"
	[ -n "$version" ] || die "Could not read the latest release."
	ok "latest release $version"

	local deb rpm appimage
	deb="$(asset_url '_amd64\.deb' || true)"
	rpm="$(asset_url '\.x86_64\.rpm' || true)"
	appimage="$(asset_url '_amd64\.AppImage' || true)"
	[ -n "$appimage" ] || die "Release $version has no AppImage asset."

	if [ "$MODE" = "version" ]; then
		say ""
		say "Fily $version would be installed."
		say "  deb:      ${deb:-none}"
		say "  rpm:      ${rpm:-none}"
		say "  AppImage: $appimage"
		say ""
		exit 0
	fi

	# A package manager gives dependency handling and a registered launcher for
	# free. Everywhere else, drop the AppImage in ~/.local.
	local pm=""
	[ "$MODE" = "auto" ] || pm="none"
	if [ -z "$pm" ]; then
		if have apt-get; then pm="apt"; elif have dnf; then
			pm="dnf"
		elif have yum; then pm="yum"; elif have zypper; then pm="zypper"; fi
	fi

	local tmp
	tmp="$(mktemp -d)"
	case "$pm" in
	apt | dnf | yum | zypper)
		local kind="deb" url="$deb"
		[ "$pm" = "apt" ] || {
			kind="rpm"
			url="$rpm"
		}
		if [ -z "$url" ]; then
			warn "No .$kind for this release; using the AppImage instead."
			install_appimage_locally "$appimage" "$tmp"
		else
			step "Downloading Fily $version"
			local file="$tmp/Fily.$kind"
			curl -fL $CURL_PROGRESS -o "$file" "$url"
			ok "downloaded $(du -h "$file" | cut -f1)"
			step "Installing"
			case "$pm" in
			apt) sudo apt-get install -y "$file" ;;
			dnf) sudo dnf install -y "$file" ;;
			yum) sudo yum install -y "$file" ;;
			zypper) sudo zypper install -y "$file" ;;
			esac
			ok "installed via $pm"
			info "package installed — 'fily' should be on your PATH"
		fi
		;;
	*)
		install_appimage_locally "$appimage" "$tmp"
		;;
	esac
	rm -rf "$tmp"
}

install_appimage_locally() {
	local url="$1" tmp="$2"
	step "Downloading Fily"
	local file="$tmp/fily.AppImage"
	curl -fL $CURL_PROGRESS -o "$file" "$url"
	ok "downloaded $(du -h "$file" | cut -f1)"
	step "Installing into $INSTALL_DIR"
	install_binary "$file"
	write_launcher
	fetch_icons
}

# ===========================================================================
case "$MODE" in
build) build_from_source ;;
version) install_prebuilt ;;
local) install_prebuilt ;;
auto) install_prebuilt ;;
esac

say ""
say "${GRN}${BOLD}Fily is installed.${OFF}"
say ""
say "  Run it:         ${BOLD}fily${OFF}"
say "  Open a folder:  ${BOLD}fily ~/Documents${OFF}"
say "  Configure it:   ${BOLD}fily config set theme=nord${OFF}"
say ""
say "  Uninstall:      ${BOLD}sudo apt remove fily${OFF}  ${DIM}(or remove $INSTALL_DIR/fily)${OFF}"
say ""
