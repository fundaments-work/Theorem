#!/usr/bin/env bash
set -euo pipefail

bundle="auto"
purge=false
did_uninstall=false

usage() {
    cat <<'EOF'
Usage: ./scripts/uninstall-linux.sh [--bundle deb|rpm|appimage|auto] [--purge]

Uninstalls Theorem on Linux:
  - Tries to remove system package manager installs (deb/rpm) when available.
  - Removes local AppImage/fallback install files under ~/.local/.
  - --purge removes deb package config files when using apt/dpkg.
EOF
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

detect_bundle() {
    if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1 || command -v rpm >/dev/null 2>&1; then
        printf "rpm\n"
    else
        printf "deb\n"
    fi
}

has_dpkg_pkg() {
    local pkg="$1"
    dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"
}

has_rpm_pkg() {
    local pkg="$1"
    command -v rpm >/dev/null 2>&1 && rpm -q "$pkg" >/dev/null 2>&1
}

uninstall_deb_package() {
    local pkg="theorem"
    if ! command -v dpkg-query >/dev/null 2>&1; then
        return
    fi
    if ! has_dpkg_pkg "$pkg"; then
        return
    fi

    if command -v apt >/dev/null 2>&1; then
        if [[ "$purge" == true ]]; then
            run_as_root apt purge -y "$pkg"
        else
            run_as_root apt remove -y "$pkg"
        fi
        run_as_root apt autoremove -y >/dev/null 2>&1 || true
    elif command -v dpkg >/dev/null 2>&1; then
        if [[ "$purge" == true ]]; then
            run_as_root dpkg --purge "$pkg"
        else
            run_as_root dpkg -r "$pkg"
        fi
    fi

    did_uninstall=true
    printf "Removed Debian package: %s\n" "$pkg"
}

uninstall_rpm_package() {
    local pkg="theorem"
    if ! has_rpm_pkg "$pkg"; then
        return
    fi

    if command -v dnf >/dev/null 2>&1; then
        run_as_root dnf remove -y "$pkg"
    elif command -v yum >/dev/null 2>&1; then
        run_as_root yum remove -y "$pkg"
    elif command -v zypper >/dev/null 2>&1; then
        run_as_root zypper --non-interactive remove "$pkg"
    elif command -v rpm >/dev/null 2>&1; then
        run_as_root rpm -e "$pkg"
    fi

    did_uninstall=true
    printf "Removed RPM package: %s\n" "$pkg"
}

remove_local_install() {
    local app_dir="$HOME/.local/lib/theorem"
    local bin_link="$HOME/.local/bin/theorem"
    local desktop_entry="$HOME/.local/share/applications/theorem.desktop"
    local icons_root="$HOME/.local/share/icons/hicolor"
    local removed_local=false

    if [[ -e "$app_dir" ]]; then
        rm -rf "$app_dir"
        removed_local=true
    fi
    if [[ -L "$bin_link" || -f "$bin_link" ]]; then
        rm -f "$bin_link"
        removed_local=true
    fi
    if [[ -f "$desktop_entry" ]]; then
        rm -f "$desktop_entry"
        removed_local=true
    fi
    if [[ -d "$icons_root" ]]; then
        if find "$icons_root" -type f -path "*/apps/theorem.png" -print -delete | grep -q .; then
            removed_local=true
        fi
    fi

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1 && [[ -d "$icons_root" ]]; then
        gtk-update-icon-cache -q "$icons_root" >/dev/null 2>&1 || true
    fi

    if [[ "$removed_local" == true ]]; then
        did_uninstall=true
        printf "Removed local install files from ~/.local/\n"
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bundle|-b)
            [[ $# -ge 2 ]] || { printf "Missing value for %s\n" "$1" >&2; exit 1; }
            bundle="$2"
            shift 2
            ;;
        --purge)
            purge=true
            shift
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
    auto)
        uninstall_deb_package
        uninstall_rpm_package
        ;;
    deb)
        uninstall_deb_package
        ;;
    rpm)
        uninstall_rpm_package
        ;;
    appimage)
        ;;
    *)
        printf "Unsupported bundle selection: %s\n" "$bundle" >&2
        exit 1
        ;;
esac

remove_local_install

if [[ "$did_uninstall" == true ]]; then
    printf "Theorem uninstall completed.\n"
else
    printf "No Theorem installation was found to uninstall.\n"
fi
