#!/bin/bash
# download-onnx-android.sh
# Downloads official ONNX Runtime Android .so files from Maven Central
# and places them in the Tauri Android jniLibs directory so the app
# can load libonnxruntime.so at runtime via dlopen.
#
# The ort crate uses load-dynamic on Android (no compile-time linking),
# so the .so is only needed at runtime — but without it the TTS engine
# will fail to initialize on the device.
#
# Run before `pnpm tauri android dev` or `pnpm tauri android build`.

set -euo pipefail

# ort-sys 2.0.0-rc.12 is pinned to ONNX Runtime 1.24.2
ONNX_VERSION="1.24.2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
JNILIBS_BASE="$PROJECT_DIR/src-tauri/gen/android/app/src/main/jniLibs"

# ABIs that Tauri Android targets (omit x86/x86_64 — phones are ARM)
ABIS=("arm64-v8a" "armeabi-v7a")

# Check if all expected .so files exist already
all_present=true
for ABI in "${ABIS[@]}"; do
    if [ ! -f "$JNILIBS_BASE/$ABI/libonnxruntime.so" ]; then
        all_present=false
        break
    fi
done

if $all_present; then
    echo "[onnx-android] ONNX Runtime libraries already present"
    exit 0
fi

AAR_URL="https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/${ONNX_VERSION}/onnxruntime-android-${ONNX_VERSION}.aar"
AAR_TMP="/tmp/onnxruntime-android-${ONNX_VERSION}.aar"
EXTRACT_TMP="/tmp/onnxrt-extract"

echo "[onnx-android] Downloading ONNX Runtime Android v${ONNX_VERSION}..."
curl -sL --fail "$AAR_URL" -o "$AAR_TMP"
echo "[onnx-android] Downloaded $(wc -c < "$AAR_TMP") bytes"

for ABI in "${ABIS[@]}"; do
    mkdir -p "$JNILIBS_BASE/$ABI"
    rm -rf "$EXTRACT_TMP"
    mkdir -p "$EXTRACT_TMP"

    if unzip -o "$AAR_TMP" "jni/$ABI/libonnxruntime.so" -d "$EXTRACT_TMP" 2>/dev/null; then
        cp "$EXTRACT_TMP/jni/$ABI/libonnxruntime.so" "$JNILIBS_BASE/$ABI/"
        echo "[onnx-android]  Extracted $ABI/libonnxruntime.so ($(wc -c < "$JNILIBS_BASE/$ABI/libonnxruntime.so") bytes)"
    else
        echo "[onnx-android]  WARNING: $ABI not found in AAR — skipping"
    fi
done

rm -f "$AAR_TMP"
rm -rf "$EXTRACT_TMP"
echo "[onnx-android] Done"
