#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$repo_root/dist/packages/linux"

# ── Detect distro and architecture ──
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64"  ;;
    *)       printf "Unsupported architecture: %s\n" "$ARCH" >&2; exit 1 ;;
esac

DISTRO="auto"
GH_REPO="fundaments-work/Theorem"

# ── Paths ──
APP_DIR="$HOME/.local/lib/theorem"
BIN_DIR="$HOME/.local/bin"
DAEMON_DIR="$APP_DIR"
DAEMON_BIN="$DAEMON_DIR/sync-daemon"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SYSTEMD_SERVICE="theorem-daemon.service"

install_systemd_service() {
    local daemon_path="$(command -v theorem-daemon 2>/dev/null || realpath "$DAEMON_BIN" 2>/dev/null)"
    if [[ -z "$daemon_path" || ! -x "$daemon_path" ]]; then
        daemon_path="$DAEMON_BIN"
    fi

    mkdir -p "$SYSTEMD_USER_DIR"
    cat > "$SYSTEMD_USER_DIR/$SYSTEMD_SERVICE" <<EOF
[Unit]
Description=Theorem Sync Daemon — 24/7 LAN device sync
Documentation=https://github.com/$GH_REPO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$daemon_path
Restart=on-failure
RestartSec=5
Environment=THEOREM_CONFIG_DIR=%h/.local/share/theorem

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable --now "$SYSTEMD_SERVICE" 2>/dev/null || true
    printf "Installed systemd user service: $SYSTEMD_SERVICE\n"
}

stop_systemd_service() {
    systemctl --user disable --now "$SYSTEMD_SERVICE" 2>/dev/null || true
}

install_daemon() {
    local daemon_url="https://github.com/$GH_REPO/releases/download/v${VERSION}/sync-daemon"
    local daemon_dest="$DAEMON_BIN"

    mkdir -p "$DAEMON_DIR"

    printf "Downloading sync-daemon from %s ...\n" "$daemon_url"
    if curl -fsSL "$daemon_url" -o "$daemon_dest"; then
        chmod +x "$daemon_dest"
        ln -sf "$daemon_dest" "$BIN_DIR/theorem-daemon" 2>/dev/null || true
        printf "Installed sync-daemon to %s\n" "$daemon_dest"
    else
        printf "Warning: sync-daemon not available in this release.\n" >&2
        printf "Only the app was installed. Background sync will use the in-app timer.\n" >&2
    fi
}

# ── Download latest release ──
download_release() {
    local bundle_type="$1"
    local pattern=""

    case "$bundle_type" in
        deb)      pattern="Theorem_${VERSION}_${ARCH}.deb" ;;
        rpm)      pattern="Theorem-${VERSION}-1.${ARCH}.rpm" ;;
        appimage) pattern="Theorem_${VERSION}_${ARCH}.AppImage" ;;
    esac

    local url="https://github.com/$GH_REPO/releases/download/v${VERSION}/$pattern"
    local dest="$output_dir/$pattern"

    mkdir -p "$output_dir"
    printf "Downloading %s ...\n" "$pattern"
    curl -fsSL "$url" -o "$dest"
    printf "Downloaded %s\n" "$dest"
    ARTIFACT="$dest"
}

# ── Sub-commands (remain similar to original) ──
detect_bundle() {
    if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1 || command -v rpm >/dev/null 2>&1; then
        printf "rpm\n"
    elif command -v apt >/dev/null 2>&1 || command -v dpkg >/dev/null 2>&1; then
        printf "deb\n"
    else
        printf "appimage\n"
    fi
}

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf "Missing required command: %s\n" "$1" >&2
        exit 1
    fi
}

run_as_root() {
    if [[ "${EUID}" -eq 0 ]]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        printf "Need root privileges to run: %s\n" "$*" >&2
        exit 1
    fi
}

install_deb_locally() {
    local artifact="$1"
    local temp_dir
    local install_root="$APP_DIR"
    local icons_root="$HOME/.local/share/icons/hicolor"
    local icon
    local relative_path

    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN

    mkdir -p "$APP_DIR" "$BIN_DIR" "$HOME/.local/share/applications" "$icons_root"
    rm -rf "$APP_DIR/usr"

    bsdtar -xf "$artifact" -C "$temp_dir"
    bsdtar -xzf "$temp_dir/data.tar.gz" -C "$APP_DIR"

    ln -sf "$APP_DIR/usr/bin/theorem" "$BIN_DIR/theorem"
    cp -f "$APP_DIR/usr/share/applications/Theorem.desktop" "$HOME/.local/share/applications/theorem.desktop"
    sed -i "s|^Exec=theorem|Exec=$BIN_DIR/theorem|" "$HOME/.local/share/applications/theorem.desktop"
    while IFS= read -r icon; do
        relative_path="${icon#"$APP_DIR/usr/share/icons/hicolor/"}"
        install -Dm644 "$icon" "$icons_root/$relative_path"
    done < <(find "$APP_DIR/usr/share/icons/hicolor" -type f -name "theorem.png" 2>/dev/null || true)

    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    gtk-update-icon-cache -q "$icons_root" 2>/dev/null || true

    printf "Installed Theorem into %s\n" "$APP_DIR"
    printf "Launcher available at %s\n" "$HOME/.local/share/applications/theorem.desktop"
}

install_appimage() {
    local artifact="$1"
    local icons_dir="$HOME/.local/share/icons/hicolor/128x128/apps"

    mkdir -p "$APP_DIR" "$BIN_DIR" "$HOME/.local/share/applications" "$icons_dir"

    install -Dm755 "$artifact" "$APP_DIR/Theorem.AppImage"
    ln -sf "$APP_DIR/Theorem.AppImage" "$BIN_DIR/theorem"
    install -Dm644 "$repo_root/src-tauri/icons/128x128.png" "$icons_dir/theorem.png"

    cat > "$HOME/.local/share/applications/theorem.desktop" <<EOF2
[Desktop Entry]
Type=Application
Name=Theorem
Comment=Local-first reader for PDFs, EPUBs, and RSS with markdown export.
Exec=$BIN_DIR/theorem %F
Icon=theorem
Terminal=false
Categories=Education;
MimeType=application/epub+zip;application/x-mobipocket-ebook;application/vnd.amazon.ebook;application/vnd.amazon.mobi8-ebook;application/x-fictionbook+xml;application/vnd.comicbook+zip;application/pdf;
StartupWMClass=theorem
EOF2

    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

    printf "Installed AppImage to %s\n" "$APP_DIR/Theorem.AppImage"
    printf "Launcher available at %s\n" "$HOME/.local/share/applications/theorem.desktop"
}

# ── Main ──
usage() {
    cat <<EOF
Usage: ./scripts/install-linux.sh [--version VERSION] [--bundle deb|rpm|appimage]

Downloads the latest Theorem release from GitHub and installs it with:
  - App binary + desktop launcher
  - sync-daemon binary (for 24/7 background sync)
  - systemd user service (auto-starts on login)

If --version is omitted, the latest release is auto-detected.
EOF
}

VERSION=""
bundle="auto"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)  VERSION="$2"; shift 2 ;;
        --bundle|-b) bundle="$2"; shift 2 ;;
        --help|-h)  usage; exit 0 ;;
        *)          printf "Unknown argument: %s\n" "$1" >&2; usage >&2; exit 1 ;;
    esac
done

# Auto-detect latest version from GitHub
if [[ -z "$VERSION" ]]; then
    need_cmd curl
    need_cmd jq
    VERSION="$(curl -fsSL "https://api.github.com/repos/$GH_REPO/releases/latest" | jq -r '.tag_name | ltrimstr("v")')"
    if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
        printf "Failed to detect latest version.\n" >&2
        exit 1
    fi
    printf "Latest release: v%s\n" "$VERSION"
fi

if [[ "$bundle" == "auto" ]]; then
    bundle="$(detect_bundle)"
fi

printf "Installing Theorem v%s (%s) for %s\n" "$VERSION" "$bundle" "$ARCH"

need_cmd curl
need_cmd bsdtar

# Stop existing daemon if running
stop_systemd_service

# Download
download_release "$bundle"

# Install app
case "$bundle" in
    deb)
        if command -v apt >/dev/null 2>&1; then
            run_as_root apt install -y "$ARTIFACT"
        elif command -v dpkg >/dev/null 2>&1; then
            run_as_root dpkg -i "$ARTIFACT"
        else
            install_deb_locally "$ARTIFACT"
        fi
        ;;
    rpm)
        if command -v dnf >/dev/null 2>&1; then
            run_as_root dnf install -y "$ARTIFACT"
        elif command -v yum >/dev/null 2>&1; then
            run_as_root yum localinstall -y "$ARTIFACT"
        elif command -v zypper >/dev/null 2>&1; then
            run_as_root zypper --non-interactive install "$ARTIFACT"
        elif command -v rpm >/dev/null 2>&1; then
            run_as_root rpm -Uvh --replacepkgs "$ARTIFACT"
        else
            install_deb_locally "$ARTIFACT"
        fi
        ;;
    appimage)
        install_appimage "$ARTIFACT"
        ;;
esac

# Install daemon + systemd service
printf "\n--- Setting up sync-daemon ---\n"
install_daemon
install_systemd_service

printf "\n✅ Theorem v%s installed successfully!\n" "$VERSION"
printf "   App:    %s\n" "$BIN_DIR/theorem"
printf "   Daemon: %s\n" "$DAEMON_BIN"
printf "   Status: systemctl --user status theorem-daemon\n"
printf "\nThe sync daemon is running in the background.\n"
