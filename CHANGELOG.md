# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-07-01

### Added

- **Rust-native EPUB prefetch** — `prefetch_zip_metadata` Tauri command reads the epub zip in Rust (zip crate), returning pre-decoded text for container.xml, OPF, nav, NCX, encryption.xml, and ALL HTML/XHTML section files. Combined with the uncompressed-size map of every zip entry, JS loadText/getSize calls skip @zip.js/zip.js entirely on the critical path. Book opening drops from ~1.5s to <50ms on desktop and <150ms on Android.
- **CBZ/FBZ support** — Rust prefetch works for all zip-based formats (sizes map always returned; EPUB-specific paths gracefully degrade).
- **Smooth page-turn animation** — CSS `transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)` applied on single-page transforms. Jump navigation (goTo, scrollToAnchor) stays instant.
- **Loading grace period** — Spinner only appears if the book takes >200ms to open (rare with Rust prefetch).
- **Search bar clear button** — × button clears the query and returns to unsearched state.
- **Shelf membership in context menu** — Right-clicking a book in Library shows which shelves it belongs to, with one-click removal.
- **TTS pause/resume** — Play/Pause now suspends/resumes the Web Audio timeline without restarting synthesis (was restarting the entire pipeline).

### Changed

- **Immersion bar redesigned** — Full-width on mobile with `justify-center`, larger touch targets (play 40×40px, aux 32×32px), generous spacing (`gap-2`, `py-3`, `px-4`), safe-area coverage. All via `sm:` responsive prefixes; desktop stays compact.
- **Theme switching** — `getCSS` statically imported (no `await import()` on every switch), making the first theme toggle instant.
- **Brightness filter** — `CSS filter: brightness(%)` applied to the full-bleed reader container (`inset-0`) instead of a separate rectangle.
- **TTS speed** — Speed is now correctly applied at play start. Changing speed during playback triggers a restart with the new speed.
- **Toolbar buttons** — Click propagation stopped so headphone/other toolbar clicks don't trigger page navigation.
- **Loading state** — Spinner has a 200ms grace period to avoid flashing on fast opens.

### Fixed

- **Android: selection highlight on multi-column pages** — #container uses `overflow: clip` (makes scrollLeft/scrollTop inert) combined with `transform: translateX/Y()` for page positioning. The previous JS guards (checkPointerSelection, focusin, touchmove) blocked JS-level causes, but the OS-level auto-scroll of scrollLeft during native text selection was only beaten by this structural change.
- **Zoom persists across books** — Global `readerSettings.zoom` reset to 100% on each new book open. Zoom re-applied after every chapter change (`goTo`/`goToFraction`).
- **Immersion bar overlaying content** — Reader container gets `pb-16` when immersion bar is active, with `transition-[padding] 300ms` for smooth resize.
- **Android TTS crash** — `ImmersionPlayer.init()` now merges callbacks instead of wholesale replacing, preventing callback loss when multiple consumers call init.
- **TTS speed dependency** — `handlePlay` no longer had stale closure over speed; now correctly reads from store.
- **ReaderViewport empty init removed** — Removed `immersionPlayer.init()` call that was overwriting ImmersionBar's callbacks with empty ones, causing onStateChange to never fire and the UI to permanently stick at 'loading'.

### Performance

- **Rust EPUB parser** (`src-tauri/src/epub_parser.rs`): Opens zip once, reads container/OPF/nav/NCX/section text, and returns a full sizes map. Runs in parallel with JS zip.js getEntries. No new Rust dependencies (uses existing `zip` and `regex` crates).
- **In-flight loadText dedup**: Map-based deduplicator wraps loadText so concurrent calls for the same href share one zip.js inflate.
- **Static getCSS import**: `foliate/reader.ts` module preloaded at app startup, eliminating the dynamic import delay on every theme switch.

### Note

- **TTS on Android/mobile**: Audio synthesis runs via ONNX Runtime CPU inference, which is significantly slower on mobile hardware than desktop. On Android, each sentence takes ~5-10 seconds to produce first audio. This is a backend limitation — the Rust Kokoro TTS engine runs full neural model inference on CPU. Android native TextToSpeech API integration or Web Speech API fallback would be needed for instant TTS on mobile. Desktop TTS (macOS/Linux/Windows) has near-real-time performance after model warmup. Speed control on mobile uses `playbackRate` (pitch-preserved via Web Audio) instead of SoundTouch offline stretching (blocking on mobile).

### Added

- **CBR comic support** — RAR archives are now supported. Transparently converted to CBZ at import time via Rust `unrar-ng` decompression. OS file association registered for `.cbr`.
- RAR magic byte detection in buffer-based format detection.

### Fixed

- **TTS on Android** — Fixed silent playback in production builds by properly awaiting AudioContext.resume() before scheduling audio.
- **Auto-navigation during text selection** — `checkPointerSelection` disabled (upstream Foliate navigates to adjacent page when selection crosses column boundary, problematic on mobile).

### Changed

- **TTS speed control removed** — Non-functional. Speed button removed from ImmersionBar and Settings dropdown removed.
- **Focusin handler guarded** — Prevents scroll to page 1 during mobile text selection. Added body/documentElement exclusion.
- **README overhaul** — Complete rewrite with all features documented (highlight sharing, PDF annotations, backup/restore, achievements, FBZ/CBR, more). 7 screenshots added. Web demo badge. MIT vs AGPL FAQ.
- **CHANGELOG corrected** — TTS status reflects current restored state, not the historical removal.

## [1.0.0] - 2026-06-28

First stable release. Subsequent fixes and additions in 1.0.1.

### Added

- **Reading achievements** — Unlock badges (First Book, Bookworm, On Fire, Highlighter) as you read.
- **Reading goals** — Configurable daily reading goal (minutes) and yearly book goal.
- **Activity heatmap** — 12-week reading activity grid in Statistics.
- **Reading speed tracking** — Words-per-minute average reading speed.
- **Highlight share as image** — ShareStudio generates polished share-card images (highlight cards, reading stats). Export as PNG, copy to clipboard, or share via Web Share API / X (Twitter). Square (1080×1080) and Story (1080×1920) formats with multiple visual themes.
- **Backup & restore** — Full backup bundle (books, annotations, dictionaries, vocabulary, RSS, settings, sync state) exportable as a single JSON file. Clear all application data option.
- **Onboarding flow** — First-run step-by-step walkthrough covering library, reader, annotations, and sync.
- **Open With file association** — Desktop users can open ebook files directly from their file manager ("Open With Theorem").
- **Android content URI support** — Full pipeline for materializing and reading files from Android content:// URIs.
- **FBZ / fb2.zip import** — Compressed FictionBook format support.
- **Dictionary download from repository** — Browse and download remote StarDict dictionaries with progress tracking.

### Fixed

- **TTS on Android** — Fixed silent playback in production builds by properly awaiting AudioContext.resume() before scheduling audio. Previously the Web Audio context stayed suspended and audio was silently dropped.
- **TTS speed control removed** — Playback speed control was non-functional (SoundTouch blocked on mobile, playbackRate shifted pitch without preservation). The UI controls have been removed to avoid confusion.
- **EPUB reader timeout regression** — Some books were stuck at "Loading book..." indefinitely. Added timeout and fallback safeguards.
- **Mobile reader back button** — Correctly exits to library instead of navigating elsewhere.
- **Redundant navigation** — Prevented duplicate navigation actions during routing.
- **Sync race conditions** — Resolved overlapping library updates during rapid data syncs.
- **Sync security** — Addressed tombstone propagation and encryption edge cases.
- **Storage timeout** — Increased read timeout for large books.
- **Text truncation on mobile** — Fixed reader title wrapping on small screens.

### Changed

- **TTS system overhauled** — Complete rewrite of the Kokoro neural TTS pipeline: streaming parallel synthesis, Web Audio API gapless playback, per-word highlighting, voice switching, next-page preloading. Replaced Rust `tts-rs` ONNX bindings with `kokoro-en` (pure Rust phonemizer via misaki-lean, no espeak-ng subprocess needed).
- **LAN sync re-architected** — Switched from blocking synchronous file payloads to async encrypted stream chunks. Reduced OOM risk on Android. Eliminated "Double JSON" serialization overhead.
- **Import system rewritten** — Concurrency-controlled batch import with SHA-256 content hash deduplication. Magic byte format detection. Filename metadata extraction.
- **Settings schema migrated** — Versioned Zustand migrations for all persisted stores (TTS, vault, sync, reading progress).
- **Cross-platform build pipeline** — GitHub Actions CI/CD produces Linux (.deb, .AppImage), macOS (Intel + Apple Silicon .dmg), Windows (.msi, .exe), and Android (.apk) from a single codebase.

### Removed

- Playwright e2e tests and related devDependencies (replaced by expanded Vitest coverage).

### Known Limitations

- iOS is not currently supported (Tauri does not target iOS)
- User is responsible for data backups (export bundle recommended for migration)
- No Cross-device network sync beyond local LAN

---

## [1.0.0-beta.5] - 2026-03-27

### Changed

- Overhauled LAN Sync performance — blocking synchronous file payloads → async encrypted stream chunks, reducing OOM on Android
- Re-architected data serialization — eliminated "Double JSON" stringification lags

### Fixed

- Sync race conditions during rapid data pushes
- SQLite-to-disk blocking timeout on tokio thread

## [1.0.0-beta.4] - 2026-03-24

### Fixed

- Reader title truncation on mobile
- Feeds page overlap with sync button
- Added spinning animation to sync button for active state feedback

## [1.0.0-beta.3] - 2026-03-23

### Added

- OS file association support ("Open With") via Tauri events
- Import failure alerts in library

### Fixed

- Storage read timeout for large books
- Mobile reader back button routing
- Redundant navigation prevention

## [1.0.0-beta.2] - 2026-03-09

### Added

- Encrypted LAN device sync with QR pairing
- Linux packaging scripts

### Fixed

- Sync security and tombstone propagation
- Linux local install fallback

## [1.0.0-beta.1] - 2026-02-27

### Added

- **Reader Engine** — EPUB, MOBI, AZW/AZW3, FB2, CBZ, PDF support. Foliate-based reflowable rendering. PDF.js with annotation support. RSS feed reader.
- **Library Management** — Import from local files, folder scanning, shelves/collections, favorites, ratings, tags, sorting, search.
- **Annotations** — Color-coded highlights (6 colors), notes, bookmarks, annotation panel. PDF: highlights, freehand drawing, text notes. Overlayer: highlight, underline, strikethrough, squiggly.
- **Vocabulary** — Built-in dictionary, StarDict support, vocabulary review.
- **Markdown Export** — Obsidian/Logseq vault sync, per-book pages, vocabulary export, customizable naming.
- **Neural TTS** — Kokoro ONNX engine, 6 voices, streaming playback, per-word highlighting.
- **Reading Statistics** — Daily activity, reading time, streaks, reading speed, heatmap.
- **Search** — Full-text in-book search, library search, RSS article search.
- **Cross-Platform** — Desktop (Linux, macOS, Windows) + Android + Web fallback.
- **Theming** — Light/dark/sepia reader themes. Custom fonts, margins, spacing, alignment, hyphenation.
- **Multi-format support** — EPUB, MOBI, AZW, AZW3, FB2, CBZ, CBR, PDF, TXT, RSS articles.
