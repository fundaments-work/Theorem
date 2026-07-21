#!/usr/bin/env bash
# Setup local build environment with signing keys.
# Source this file before running `pnpm tauri build`:
#   source scripts/setup-local-build.sh
#
# First time setup:
#   bash scripts/setup-local-build.sh --init

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

UPGRADER_KEY="$HOME/.tauri/theorem.key"
ANDROID_KEYSTORE="$HOME/theorem-android.jks"

init_updater() {
    echo "==> Checking Tauri updater signing key..."
    if [[ -f "$UPGRADER_KEY" ]]; then
        echo "  ✅ Updater key found at $UPGRADER_KEY"
    else
        echo "  ⚠️  Updater key not found at $UPGRADER_KEY"
        echo "  Run this command interactively (needs TTY):"
        echo "      mkdir -p ~/.tauri"
        echo "      pnpm tauri signer generate -w ~/.tauri/theorem.key"
        echo "  Then paste the public key into src-tauri/tauri.conf.json"
        return 1
    fi
}

init_android() {
    echo "==> Checking Android keystore..."
    if [[ -f "$ANDROID_KEYSTORE" ]]; then
        echo "  ✅ Android keystore found at $ANDROID_KEYSTORE"
    else
        echo "  ❌ Android keystore not found at $ANDROID_KEYSTORE"
        echo "  Run: keytool -genkey -v -keystore ~/theorem-android.jks \\"
        echo "         -keyalg RSA -keysize 2048 -validity 10000 \\"
        echo "         -alias theorem-release-key"
        return 1
    fi
}

setup_android_properties() {
    local props_file="$PROJECT_DIR/src-tauri/gen/android/keystore.properties"
    if [[ ! -f "$ANDROID_KEYSTORE" ]]; then
        echo "  ❌ Cannot create keystore.properties — keystore missing"
        return 1
    fi
    mkdir -p "$(dirname "$props_file")"
    cat > "$props_file" <<EOF
keyAlias=theorem-release-key
password=$ANDROID_KEY_PASSWORD
storeFile=$ANDROID_KEYSTORE
EOF
    echo "  ✅ Created $props_file"
}

export_env() {
    if [[ -f "$UPGRADER_KEY" ]]; then
        export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPGRADER_KEY")"
        # Export password if set as env var, otherwise empty
        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
        echo "  ✅ Exported TAURI_SIGNING_PRIVATE_KEY"
    else
        echo "  ⚠️  TAURI_SIGNING_PRIVATE_KEY not exported — updater signing disabled"
    fi
}

case "${1:-}" in
    --init)
        echo "🔧 Theorem Local Build — First Time Setup"
        echo "========================================="
        init_updater
        init_android
        echo ""
        echo "After setup, run: source scripts/setup-local-build.sh"
        ;;
    "")
        echo "🔧 Theorem Local Build — Setting up environment"
        echo "==============================================="
        export_env
        setup_android_properties || true
        echo ""
        echo "✅ Ready. Now run: pnpm tauri build"
        echo "   (Android: pnpm tauri android build --split-per-abi)"
        ;;
    *)
        echo "Usage: source scripts/setup-local-build.sh"
        echo "       bash scripts/setup-local-build.sh --init"
        exit 1
        ;;
esac
