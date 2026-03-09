#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$repo_root/dist/packages/linux"
bundle="auto"
skip_build=false
tauri_args=()

usage() {
    cat <<'EOF'
Usage: ./scripts/install-linux.sh [--bundle deb|rpm|appimage] [--skip-build] [-- <extra tauri build args>]

Builds and installs Theorem on Linux:
  - Debian/Ubuntu: installs the generated .deb
  - Fedora/RHEL/openSUSE: installs the generated .rpm
  - Everything else: extracts the generated .deb into ~/.local/
EOF
}

detect_bundle() {
    if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1 || command -v rpm >/dev/null 2>&1; then
        printf "rpm\n"
    else
        printf "deb\n"
    fi
}

latest_artifact() {
    local pattern="$1"
    find "$output_dir" -maxdepth 1 -type f -name "$pattern" | sort | tail -n 1
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
    local install_root="$HOME/.local/lib/theorem"
    local bin_dir="$HOME/.local/bin"
    local applications_dir="$HOME/.local/share/applications"
    local icons_root="$HOME/.local/share/icons/hicolor"
    local icon
    local relative_path

    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN

    mkdir -p "$install_root" "$bin_dir" "$applications_dir" "$icons_root"
    rm -rf "$install_root/usr"

    bsdtar -xf "$artifact" -C "$temp_dir"
    bsdtar -xzf "$temp_dir/data.tar.gz" -C "$install_root"

    ln -sf "$install_root/usr/bin/theorem" "$bin_dir/theorem"
    cp -f "$install_root/usr/share/applications/Theorem.desktop" "$applications_dir/theorem.desktop"
    while IFS= read -r icon; do
        relative_path="${icon#"$install_root/usr/share/icons/hicolor/"}"
        install -Dm644 "$icon" "$icons_root/$relative_path"
    done < <(find "$install_root/usr/share/icons/hicolor" -type f -name "theorem.png")

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
    fi

    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q "$icons_root" >/dev/null 2>&1 || true
    fi

    printf "Installed Theorem into %s\n" "$install_root"
    printf "Launcher available at %s\n" "$applications_dir/theorem.desktop"
}

install_appimage() {
    local artifact="$1"
    local app_dir="$HOME/.local/lib/theorem"
    local bin_dir="$HOME/.local/bin"
    local applications_dir="$HOME/.local/share/applications"
    local icons_dir="$HOME/.local/share/icons/hicolor/128x128/apps"

    mkdir -p "$app_dir" "$bin_dir" "$applications_dir" "$icons_dir"

    install -Dm755 "$artifact" "$app_dir/Theorem.AppImage"
    ln -sf "$app_dir/Theorem.AppImage" "$bin_dir/theorem"
    install -Dm644 "$repo_root/src-tauri/icons/128x128.png" "$icons_dir/theorem.png"

    cat > "$applications_dir/theorem.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Theorem
Comment=Local-first reader for PDFs, EPUBs, and RSS with markdown export.
Exec=$bin_dir/theorem %F
Icon=theorem
Terminal=false
Categories=Education;
MimeType=application/epub+zip;application/x-mobipocket-ebook;application/vnd.amazon.ebook;application/vnd.amazon.mobi8-ebook;application/x-fictionbook+xml;application/vnd.comicbook+zip;application/pdf;
StartupWMClass=theorem
EOF

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
    fi

    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
    fi

    printf "Installed AppImage to %s\n" "$app_dir/Theorem.AppImage"
    printf "Launcher available at %s\n" "$applications_dir/theorem.desktop"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bundle|-b)
            [[ $# -ge 2 ]] || { printf "Missing value for %s\n" "$1" >&2; exit 1; }
            bundle="$2"
            shift 2
            ;;
        --skip-build)
            skip_build=true
            shift
            ;;
        --)
            if [[ $# -gt 1 ]]; then
                case "$2" in
                    --bundle|-b|--skip-build|--help|-h)
                        shift
                        continue
                        ;;
                esac
            fi
            shift
            tauri_args+=("$@")
            break
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            printf "Unknown argument: %s\n" "$1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ "$bundle" == "auto" ]]; then
    bundle="$(detect_bundle)"
fi

case "$bundle" in
    deb|rpm|appimage) ;;
    *)
        printf "Unsupported bundle selection: %s\n" "$bundle" >&2
        exit 1
        ;;
esac

if [[ "$skip_build" != true ]]; then
    "$repo_root/scripts/makepackage-linux.sh" --bundle "$bundle" -- "${tauri_args[@]}"
fi

mkdir -p "$output_dir"

case "$bundle" in
    deb)
        artifact="$(latest_artifact "*.deb")"
        [[ -n "$artifact" ]] || { printf "No .deb artifact found in %s\n" "$output_dir" >&2; exit 1; }
        if command -v apt >/dev/null 2>&1; then
            run_as_root apt install -y "$artifact"
        elif command -v dpkg >/dev/null 2>&1; then
            run_as_root dpkg -i "$artifact"
        else
            install_deb_locally "$artifact"
        fi
        ;;
    rpm)
        artifact="$(latest_artifact "*.rpm")"
        [[ -n "$artifact" ]] || { printf "No .rpm artifact found in %s\n" "$output_dir" >&2; exit 1; }
        if command -v dnf >/dev/null 2>&1; then
            run_as_root dnf install -y "$artifact"
        elif command -v yum >/dev/null 2>&1; then
            run_as_root yum localinstall -y "$artifact"
        elif command -v zypper >/dev/null 2>&1; then
            run_as_root zypper --non-interactive install "$artifact"
        elif command -v rpm >/dev/null 2>&1; then
            run_as_root rpm -Uvh --replacepkgs "$artifact"
        else
            printf "No RPM package installer found for %s\n" "$artifact" >&2
            exit 1
        fi
        ;;
    appimage)
        artifact="$(latest_artifact "*.AppImage")"
        [[ -n "$artifact" ]] || { printf "No AppImage artifact found in %s\n" "$output_dir" >&2; exit 1; }
        install_appimage "$artifact"
        ;;
esac
