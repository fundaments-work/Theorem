# Binary Size Optimization

## Current Size (Measured)

| Component | Size | Notes |
|-----------|------|-------|
| `theorem` Rust binary | **83 MB** | Release build, `opt-level="s"`, `lto=true`, `strip=true` |
| `sync-daemon` sidecar | **4.4 MB** | Separate binary, optional at runtime |
| Frontend JS | **4.4 MB** | `dist/assets/` — dynamic chunks, code-split |
| PDF.js resources | **2.5 MB** | `dist/pdfjs/` — cmaps + standard_fonts |
| AppImage distribution | **111 MB** | Binary + resources + Tauri runtime bundled |

### Binary Section Breakdown

| Section | Size | What's inside |
|---------|------|---------------|
| `.rodata` | **40.2 MB** | Read-only data: TTS model weights (ONNX blob), Unicode tables, string constants, crate metadata |
| `.text` | **25.6 MB** | Executable code: compiled functions. `ort_sys` (ONNX Runtime C++ static lib) = 12.2 MB. Our Rust code (`theorem_lib`) = 2.3 MB |
| `.eh_frame` | **2.6 MB** | Exception unwinding tables (C++ exception handling from ort + Rust panic unwind) |
| `.data.rel.ro` | 635 KB | Relocated read-only data |
| Debug sections | 3.1 MB | `.debug_*` — some remain despite `strip=true` |
| Rest | ~9 MB | Headers, PLT, GOT, `.data`, `.bss` |

### Per-Crate Code Size (cargo bloat — .text only)

| Crate | Code Size | Feature | Notes |
|-------|-----------|---------|-------|
| `ort_sys` | **12.2 MB** | **TTS** | ONNX Runtime C++ static library (prebuilt) |
| `theorem_lib` | **2.3 MB** | Core | Our entire Rust application code |
| `tauri` | 983 KB | Core | Tauri framework |
| `std` | 1.0 MB | Core | Rust standard library |
| `reqwest` | 571 KB | Core (HTTP) | Also used by RSS, StarDict, sync |
| `rustls` | 484 KB | Core | TLS — shared by reqwest |
| `theorem_sync_core` | 332 KB | Sync | Sync protocol + crypto |
| `regex_automata` | 326 KB | Core | Regex engine |
| `kokoro_en` | 121 KB | **TTS** | Kokoro synthesizer (includes misaki G2P) |
| `unrar_ng_sys` | 160 KB | CBR | RAR decompression (C++ static lib) |
| `axum` | 147 KB | Sync | HTTP server for LAN sync |
| `zbus` | 582 KB | Core (Linux) | D-Bus bindings (Linux desktop integration) |
| `ring` | 193 KB | Core | Crypto primitives (used by rustls) |

---

## Strategy: Replace Kokoro/ONNX with Platform TTS

The TTS stack (`ort_sys` 12.2 MB + `kokoro_en` 121 KB + model weights ~10-15 MB in `.rodata`) adds **~25 MB** to the binary. Removing it and using the device's built-in TTS API eliminates that entirely.

### Per-Platform TTS APIs

| Platform | API | Implementation | Size added |
|----------|-----|---------------|------------|
| **Linux** | **speech-dispatcher** (`libspeechd`) | C FFI bindings — send text, get audio. Thin wrapper (~50 KB) | **~0** (system lib) |
| **macOS** | **NSSpeechSynthesizer** | Objective-C bridge via `objc2` crate. Already part of system. | **~0** (system framework) |
| **Windows** | **Windows.Speech.Synthesis** (SAPI) | `windows-rs` crate bindings | **~0** (system API) |
| **Android** | **android.speech.tts.TextToSpeech** | Already partially wired via `tauri-plugin-android-tts-audio` | **~0** (already exists) |
| **iOS** | **AVSpeechSynthesizer** | Objective-C bridge | **~0** (system framework) |
| **Web** | **SpeechSynthesis** API | Browser built-in (`window.speechSynthesis`), zero deps | **0 KB** JS |

### What Gets Removed

| Crate | Size | Replaced by |
|-------|------|-------------|
| `ort_sys` | 12.2 MB code | Nothing — platform does the inference |
| `kokoro-en` + `misaki-rs` | 121 KB + 88 KB | Nothing — platform does G2P |
| TTS model weights (in `.rodata`) | ~10-15 MB | Nothing — no model embedded |
| `ndarray` | ~2 KB | Nothing — no tensor ops needed |
| `rodio` | ~minimal | Platform audio playback |
| `soundtouchjs` (JS) | 20 KB JS | Native platform audio control |

### Binary After: ~58 MB

Section-by-section estimate:

| Section | Before | After | Change |
|---------|--------|-------|--------|
| `.rodata` | 40.2 MB | ~25 MB | -15 MB (model weights gone) |
| `.text` | 25.6 MB | ~13 MB | -12.6 MB (ort_sys + kokoro + ndarray + rodio) |
| `.eh_frame` | 2.6 MB | ~1.3 MB | -1.3 MB (C++ exception tables from ort gone) |
| Rest | 14.6 MB | ~14 MB | ~same |
| **Total** | **83 MB** | **~58 MB** | **-25 MB** |

---

## Future: AI TTS as a System-Level Voice Provider

Instead of coupling Theorem to AI TTS, a **separate standalone app** replaces the system's TTS voices entirely. It registers itself as a native OS voice provider — Theorem never knows it exists.

```
┌──────────────┐    calls platform API    ┌──────────────────────┐
│   Theorem    │ ──────────────────────→   │ Platform TTS Service │
│ (native TTS) │   (speech-dispatcher /    │  (speech-dispatcher  │
│              │    SAPI / AVSpeechSynth)  │   / SAPI / AvAud)    │
└──────────────┘                           └───────┬──────────────┘
                                                   │
                                        ┌──────────▼──────────┐
                                        │  AI TTS Voice       │
                                        │  Provider App        │
                                        │  (registers as OS    │
                                        │   voice provider —   │
                                        │   speech-dispatcher  │
                                        │   module, SAPI voice,│
                                        │   NSSpeech voice     │
                                        │   bundle, etc.)      │
                                        └─────────────────────┘
```

**How it works per platform:**

| Platform | Mechanism | AI TTS app does |
|----------|-----------|-----------------|
| **Linux** | speech-dispatcher output module | Implements a speechd output module, pipes audio generated from Gemini/OpenAI API |
| **macOS** | NSSpeechSynthesizer voice bundle | Installs a `.voice` bundle that generates audio from AI APIs |
| **Windows** | SAPI voice (TTS engine COM object) | Registers a COM object implementing `ISpObjectToken`, generates audio from AI APIs |
| **Android** | TextToSpeech engine | Installs as a system TTS engine, selectable in Settings → Language & Input → TTS |
| **iOS** | AVSpeechSynthesizer voice | Installs as an enhanced voice via `AVSpeechSynthesisProviderVoice` |

**Benefits of this approach:**
- **Zero coupling** — Theorem has no AI TTS code, no IPC, no plugin system
- **System-wide** — every app gets the AI voices (browser, document reader, accessibility tools)
- **Theorem doesn't need to change** beyond switching to platform TTS
- **Users install nothing extra** if they don't want AI TTS
- **The AI TTS provider is a standalone app** with its own install, updates, lifecycle

---

## Other Size Wins

| Optimization | Savings | Complexity |
|-------------|---------|------------|
| Strip remaining debug info (`Cargo.toml`: add `strip = "debuginfo"` on top of `strip = true`) | ~3 MB | Trivial — one-line config change |
| Remove old dist/packages/ (`rm -rf dist/packages/`) | 222 MB | Trivial — stale AppImages |
| `panic = "abort"` to eliminate `.eh_frame` (remove unwinding) | ~1.3 MB | Medium — breaks catch_unwind, worth testing |
| UPX-compress AppImage in CI | ~50 MB | Low — adds decompression time on first launch |
| Tree-shake unused i18n locales | ~55 KB JS | Low — bundle English only |
| Verify `opt-level = "z"` vs `"s"` | ~1-2 MB | Trivial — change one letter |

None of these are needed right now. The TTS swap gets the biggest single gain.

## Cleanup

```bash
rm -rf dist/packages/   # removes 222 MB of stale AppImages
```
