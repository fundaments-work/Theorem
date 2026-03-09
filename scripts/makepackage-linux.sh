#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$repo_root/dist/packages/linux"
bundle="auto"
tauri_args=()

usage() {
    cat <<'EOF'
Usage: ./scripts/makepackage-linux.sh [--bundle deb|rpm|appimage|all] [-- <extra tauri build args>]

Builds Linux release artifacts with Tauri and copies the generated bundles to dist/packages/linux/.

Examples:
  ./scripts/makepackage-linux.sh
  ./scripts/makepackage-linux.sh --bundle appimage
  ./scripts/makepackage-linux.sh --bundle all -- --target x86_64-unknown-linux-gnu
EOF
}

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf "Missing required command: %s\n" "$1" >&2
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

bundle_dir_for() {
    case "$1" in
        deb) printf "deb\n" ;;
        rpm) printf "rpm\n" ;;
        appimage) printf "appimage\n" ;;
        *)
            printf "Unsupported bundle: %s\n" "$1" >&2
            exit 1
            ;;
    esac
}

copy_bundle_outputs() {
    local bundle_name="$1"
    local source_dir="$repo_root/src-tauri/target/release/bundle/$(bundle_dir_for "$bundle_name")"
    local pattern
    local artifact

    case "$bundle_name" in
        deb) pattern="*.deb" ;;
        rpm) pattern="*.rpm" ;;
        appimage) pattern="*.AppImage" ;;
    esac

    artifact="$(find "$source_dir" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)"
    if [[ -z "$artifact" ]]; then
        printf "No %s artifacts were found under %s\n" "$bundle_name" "$source_dir" >&2
        exit 1
    fi

    find "$output_dir" -maxdepth 1 -type f -name "$pattern" -delete
    cp -f "$artifact" "$output_dir/"
    printf "Created %s\n" "$output_dir/$(basename "$artifact")"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bundle|-b)
            [[ $# -ge 2 ]] || { printf "Missing value for %s\n" "$1" >&2; exit 1; }
            bundle="$2"
            shift 2
            ;;
        --)
            if [[ $# -gt 1 ]]; then
                case "$2" in
                    --bundle|-b|--help|-h)
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

need_cmd pnpm
need_cmd cargo

if [[ "$bundle" == "auto" ]]; then
    bundle="$(detect_bundle)"
fi

case "$bundle" in
    deb|rpm|appimage)
        bundles=("$bundle")
        ;;
    all)
        bundles=("deb" "rpm" "appimage")
        ;;
    *)
        printf "Unsupported bundle selection: %s\n" "$bundle" >&2
        exit 1
        ;;
esac

cd "$repo_root"
printf "Building Linux bundle(s): %s\n" "${bundles[*]}"
if [[ ${#tauri_args[@]} -gt 0 ]]; then
    printf "Extra tauri args: %s\n" "${tauri_args[*]}"
fi

if [[ ! -d "$repo_root/node_modules" ]]; then
    pnpm install --frozen-lockfile
fi

if ! pnpm tauri build --bundles "${bundles[@]}" "${tauri_args[@]}"; then
    cat >&2 <<'EOF'
Linux packaging failed.

Use `--bundle deb` as the safest cross-distro fallback.
AppImage builds require `linuxdeploy` on the host.
EOF
    exit 1
fi

mkdir -p "$output_dir"

for bundle_name in "${bundles[@]}"; do
    copy_bundle_outputs "$bundle_name"
done
