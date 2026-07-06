# Binary Size Optimization

## Current Size (Post-Kokoro Removal)

| Component | Size | Notes |
|-----------|------|-------|
| `theorem` Rust binary | **~28 MB** | Release build, `opt-level="s"`, `lto=true`, `strip="symbols"`, `panic="abort"`. Removed Kokoro/ONNX TTS (was ~52 MB). |
| `sync-daemon` sidecar | **~4.4 MB** | Separate binary, optional at runtime |
| Frontend JS | **~4.4 MB** | `dist/assets/` — dynamic chunks, code-split |
| PDF.js resources | **~2.5 MB** | `dist/pdfjs/` — cmaps + standard_fonts |
| AppImage distribution | **~40 MB** | Binary + resources + Tauri runtime bundled |

### What Was Removed

The Kokoro-82M ONNX neural TTS pipeline was replaced with the **Web Speech API** (`window.speechSynthesis`). This delegates to the platform's native TTS engine (NSSpeechSynthesizer on macOS, SAPI on Windows, speech-dispatcher on Linux, TextToSpeech on Android).

**Removed crates:**
- `kokoro-en` (121 KB — neural TTS engine)
- `ort` / `ort_sys` (12.2 MB — ONNX Runtime C++ static library)
- `ndarray` (tensor operations for audio)
- `regex` (was only used by TTS text normalization)
- `rodio` (desktop audio output)
- `tauri-plugin-android-tts-audio` (Android AudioTrack plugin)

**Removed source files:**
- `src/tts.rs` (586 lines — TTS synthesis pipeline)
- `src/tts_model.rs` (373 lines — model download/management)
- `src/desktop_audio.rs` (74 lines — rodio audio output)

**Total savings: ~52 MB** (from ~83 MB → ~28 MB estimated)

## Release Profile

```toml
[profile.release]
opt-level = "s"         # Optimize for size
strip = "symbols"       # Strip all symbols from binary
lto = true              # Link Time Optimization
codegen-units = 1       # Maximize optimization (slower compile)
panic = "abort"         # Remove unwinding tables (~1.3 MB savings)
```

## Future Optimization Opportunities

| Technique | Potential Savings | Effort |
|-----------|------------------|--------|
| UPX compression | ~50% (final ~20 MB) | Medium — slower startup |
| Remove unused Rust deps from lockfile | ~1-5 MB | Low |
| Tree-shake PDF.js resources (only English cmaps) | ~1 MB | Medium |
| LTO for sync-daemon sidecar | ~1 MB | Trivial |
| Compress frontend assets (Brotli in Tauri) | Smaller transfer | Low |
