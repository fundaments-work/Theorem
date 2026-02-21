# Android Build Guide

This document explains how to build Theorem for Android.

## Prerequisites

- Node.js 22+
- pnpm 10+
- Rust stable
- Android SDK (with NDK)
- Java 17

## Initial Setup

### 1. Install Android SDK and NDK

You can install Android Studio or just the command-line tools:

```bash
# Using Android Studio
# Install via: https://developer.android.com/studio

# Or using SDK Manager (command-line)
sdkmanager "platform-tools" "platforms;android-36" "ndk;29.0.13846066"
```

### 2. Set Environment Variables

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/29.0.13846066
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

### 3. Add Rust Android Targets

```bash
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add i686-linux-android
rustup target add x86_64-linux-android
```

## Generate Android Project

The Android project is NOT committed to the repository. It must be regenerated on each machine:

```bash
pnpm install
pnpm tauri android init --ci
```

This creates `src-tauri/gen/android/` with the Android Studio project.

## Build APK

### Debug Build

```bash
pnpm tauri android build --debug
```

### Release Build (Unsigned)

```bash
pnpm tauri android build --release
```

The APK will be at:
```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

## Signing for Release

### Generate a Signing Key

```bash
keytool -genkey -v -keystore theorem-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias theorem
```

### Configure Signing

Create `src-tauri/gen/android/app/tauri.properties`:

```properties
tauri.android.signing.config=release
tauri.android.signing.storeFile=../../../theorem-release.jks
tauri.android.signing.storePassword=YOUR_STORE_PASSWORD
tauri.android.signing.keyAlias=theorem
tauri.android.signing.keyPassword=YOUR_KEY_PASSWORD
```

Or set environment variables:

```bash
export ANDROID_KEYSTORE_PATH=/path/to/theorem-release.jks
export ANDROID_KEYSTORE_PASSWORD=your_store_password
export ANDROID_KEY_ALIAS=theorem
export ANDROID_KEY_PASSWORD=your_key_password
```

### Build Signed APK

```bash
pnpm tauri android build --release
```

## CI/CD Setup

For GitHub Actions, store the keystore as a base64-encoded secret:

```bash
base64 -i theorem-release.jks | pbcopy  # macOS
base64 -w 0 theorem-release.jks         # Linux
```

Add these secrets to your repository:
- `ANDROID_KEYSTORE_BASE64`: Base64-encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD`: Keystore password
- `ANDROID_KEY_ALIAS`: Key alias
- `ANDROID_KEY_PASSWORD`: Key password

## Distribution

### APK Distribution

Upload the signed APK to:
- GitHub Releases
- Your website
- Direct distribution

### Google Play Store

For Play Store distribution, you need an AAB (Android App Bundle):

```bash
pnpm tauri android build --release --aab
```

The AAB will be at:
```
src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
```

## Troubleshooting

### NDK Not Found

```bash
# Set NDK_HOME explicitly
export NDK_HOME=$ANDROID_HOME/ndk/29.0.13846066
```

### Gradle Permission Denied

```bash
chmod +x src-tauri/gen/android/gradlew
```

### Build Fails with Java Error

Ensure Java 17 is installed and `JAVA_HOME` is set:

```bash
export JAVA_HOME=/usr/lib/jvm/temurin-17-jdk
```

## Architecture Support

The default build creates a universal APK with all architectures:
- `arm64-v8a` (most modern devices)
- `armeabi-v7a` (older 32-bit devices)
- `x86_64` (emulators)
- `x86` (older emulators)

For smaller APKs, build for specific architectures:

```bash
pnpm tauri android build --release --target aarch64
```
