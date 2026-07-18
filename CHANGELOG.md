# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.7] - 2026-07-18

### Added

- **On-demand download progress** — Reader shows a real progress bar with file size (e.g., `12.5 MB / 45.3 MB (28%)`) instead of an indeterminate spinner when downloading synced books. Progress events emitted from Rust in 1MB chunks, throttled to percentage changes.
- **Memorized reader state** — Reader now persists `downloadingBookId` and `downloadProgress` across renders. "Try Again" button on all error screens.

### Changed

- **File transfer: streaming writes with no IPC** — `download_book_file` writes received data directly to `book-cache/{id}.book` from Rust in 1MB chunks. Zero bytes pass through the Tauri IPC bridge. Previously, the entire file was returned via IPC as JSON `number[]`, causing 360MB+ allocations that crashed Android with OOM (heap limit 256MB).
- **File transfer: 120s timeouts** — All I/O operations (connect, open_bi, read_line, read_exact) now have 120s timeouts. Previously, `request_book_file` could hang indefinitely on unreachable peers.
- **File transfer: SQLite fallback** — `FileTransferHandler` falls back to reading from SQLite `books` table when the file is not in `book-cache`. Previously only served from `book-cache`, meaning locally-imported books (stored in SQLite) were unavailable to peers.
- **Sync: gossip-based bidirectional auto-sync** — `NeighborUp` events now properly trigger `runDeviceSync` on the peer via `docs-peer-online`. The `iroh_node_id` field was missing from `PairedDeviceInfo`, making the peer-matching `d.irohNodeId === nodeId` always fail. Auto-sync when a peer comes online was completely dead.
- **Sync: settle threshold fixed** — `signalSettle()` checks `>= 2` instead of `>= 3`. Only 2 events (`docs-pending-content-ready` + `docs-sync-finished`) ever call signalSettle, so the threshold of 3 was never reached — every sync round waited the full 30s timeout.
- **Sync: event subscription on doc recovery** — `subscribe_doc_events` is now called after re-importing a sync doc from ticket in `docs_sync_now`. Previously, doc subscriptions were lost during recovery, causing no live events to flow.
- **Sync: `_bridgePaused` guard for all stores** — Vocabulary, RSS, and settings store subscriptions now check `_bridgePaused` during provisioning, preventing writes during initial data sync.
- **Reader: shortcuts useEffect moved before early returns** — The keyboard shortcuts registration useEffect is now called before all early-return guards (downloading, error, syncedWithoutFile). Previously, the shortcuts useEffect was duplicated — one copy before and one after the early returns — causing "Rendered more hooks than during the previous render" errors when transitioning from the download screen to the reader.
- **Reader: polling loop timeout** — The `while (syncedWithoutFile)` polling loop now has a 120-second timeout. Previously it hung forever if the download failed.
- **Annotations page: fully responsive card view** — Touch swipe navigation, icon-based mobile toolbars, clipped dot indicators, `touch-manipulation` on all interactive elements.

### Performance

- **Memory: eliminate unnecessary Blob copy** — When the MIME type already matches, use the blob directly instead of `new Blob([blob], type)`, which duplicated the entire book in JS memory. Saves one full copy (50-100MB for large EPUBs).
- **Memory: call EPUB.destroy() on engine teardown** — `FoliateEngine.destroy()` now calls `EPUB.destroy()`, which revokes all blob URLs created for sections, CSS, images, and fonts. Previously, blob URLs accumulated until page refresh.
- **Memory: unload previous fixed-layout spreads** — `goToSpread()` now calls `unload()` on the previous spread's sections. Fixed-layout books (children's books, comics) were leaking all visited spreads' blob URLs.
- **Memory: cover extraction early-return before file re-read** — The `hasRealCover && coverExtractionDone` check now runs BEFORE `getBookData()`, avoiding a full re-read of the book from storage when cover is already extracted.
- **Memory: metadata-only EPUB prefetch** — Rust `prefetch_zip_metadata` no longer pre-decodes all EPUB section HTML files (up to 100 sections, ~3-6MB of JS strings). Only metadata files (container.xml, OPF, NAV, NCX, encryption) are prefetched. Sections load lazily via zip.js.
- **Binary size: removed unused Rust dependencies** — `read_zip_entry` wrapper removed after section prefetch elimination.

### Fixed (Sync)

- **Duplicate pairing by iroh_node_id** — The dedup check only matched by `fingerprint`, which is empty on Android (and often empty on desktop). Added `iroh_node_id`-based dedup in both `handle_pair_req` and `submit_pairing_code`.
- **Frontend duplicate device list** — `DeviceSync.tsx` filtered by `deviceId` before appending, preventing duplicate entries in the local React state.

### Fixed (General)

- **Stuck "Downloading Book" screen** — Added 120s timeout, clears `downloadingBookId` on timeout, shows "Book download timed out" error with retry.
- **Broken reader state after download failure** — New guard renders "Book File Not Available" screen when `syncedWithoutFile` is true but not currently downloading, instead of showing a broken reader view.
- **"Rendered more hooks than during the previous render"** — Removed duplicate shortcuts useEffect that was left after the move. When transitioning from "Downloading" screen (early return fired, 1 shortcuts hook) to reader (no early return, 2 shortcuts hooks), React detected the mismatch and threw.

## [1.0.6] - 2026-07-06

### Added

- **Keyboard shortcuts** (global + reader-scoped) — `Ctrl+1`–`7` navigate between pages, `Ctrl+,` for Settings, `Ctrl+F` for search, `Ctrl+B` for sidebar toggle, `?` for shortcuts help. Reader shortcuts: `Ctrl+D` bookmark, `Ctrl+T` TOC, `Ctrl+S` settings, `Ctrl+A` annotations, `F11` fullscreen. Shortcuts reference available in Settings → Shortcuts tab.
- **Auto-advance immersion reading** — When TTS finishes reading a page in immersion mode, it automatically turns to the next page and starts speaking. Chains continuously until the book ends or the user stops playback.
- **Bookmarks page redesign** — Bookmarks now match the AnnotationCard design language with proper borders, MoreVertical dropdown menu, and serif blockquote styling.
- **PDF paged navigation mode** — Scroll-snap based paged mode for PDFs (engine support maintained, UI toggle deferred).

### Changed

- **TTS: removed Kokoro/ONNX neural engine** (~52 MB binary saved) — Replaced with native OS speech: `android.speech.tts.TextToSpeech` on Android, `say`/NSSpeechSynthesizer on macOS, `spd-say`/`espeak-ng` on Linux, PowerShell/SAPI on Windows. Zero Rust dependencies, zero model download. Audio now starts instantly — no model warmup delay.
- **TTS: real pause/resume** — Pause now stops at the estimated word position (158 wpm audiobook rate, self-calibrating). Resume continues from where speech was paused, not the beginning of the section.
- **TTS: disabled on web** — Web Speech API support was janky. TTS is now Tauri-only (Android + desktop). Settings show "Not available in web browser" on web.
- **Sync: event-driven, not timer-based** — Sync now uses dirty-tracking across all three layers (JS orchestrator, Rust background loop, sync daemon). Mutation-triggered sync fires within seconds; periodic syncs become no-ops when nothing changed. The Rust 5-minute loop checks a data version counter and only initiates sync when data actually changed.
- **Sync: autoSyncEnabled toggle respected** — The Rust background sync loop now stops when auto-sync is turned off. Previously it ran regardless of the toggle setting.
- **Sync: Android WorkManager data loss fixed** — The JNI standalone sync round (WorkManager) now persists incoming peer data to `sync-incoming-cache.json` before its ephemeral runtime exits. On next app boot, `get_incoming_sync_data` loads and merges this cache.
- **Bookmarks page** redesigned to match AnnotationCard design language.

### Fixed

- **RSS duplicate subscriptions** — `useRssStore.addFeed` and `refreshFeed` now normalize feed and article URLs (lowercase + trailing-slash strip) before comparison.
- **RSS remove feed UX** — Replaced dropdown action menu with direct hover-triggered trash button.
- **RSS duplicate images** — Article card summaries now hide inline `<img>` and `<figure>` elements to prevent duplicate image display.
- **Shelf search and context menus** — ShelfDetail uses shared `MemoizedBookCard`, `BookInfoModal`, and context menu. Bulk "Add to Shelf" fixed.
- **Android TTS crash** — `TextToSpeech` constructor must run on UI thread. All TTS operations now go through `Handler(Looper.getMainLooper()).post()`.
- **TTS reads wrong page** — `getVisibleTextForTts()` was returning entire section text instead of visible portion. Fixed to use `visibleRange.cloneContents()`.
- **Settings page re-render** — Extracted `StorageTab` as memo component, removed heavy subscriptions from parent.
- **Reader remount on navigation** — Removed `key={currentRoute}` from `RouteErrorBoundary` that forced full remount on every route change.

### Performance

- **Binary size: ~83 MB → ~28 MB** — Removed Kokoro/ONNX TTS stack (52 MB). Added `panic = "abort"`, `strip = "symbols"`. Removed 12 TTS crates, 3 Rust source files.
- **Event-driven sync** — All three sync layers use dirty-tracking. No more wasted manifest builds + SHA-256 hashing + HTTP round-trips when data unchanged. Mutation-triggered sync debounces to 5 seconds.
- **Virtual scrolling** (all list pages) — Library, Shelves, Annotations, Bookmarks, Vocabulary now use `@tanstack/react-virtual` with padding-based approach. DOM node count reduced by 85-98% for large collections. Overscan: 3 rows.
- **Background cover hydration** — `coversHydrated=true` set immediately on rehydrate. Covers hydrate incrementally in batches of 48, unblocking the UI.
- **WebP cover downsampling** — Covers resized to 200px, saved as WebP (quality 0.75), decoded asynchronously.
- **LRU-capped caches** — coverCache=100, thumbnailCache=200, materializedPathCache=500, blobCache=3. Persist storage skips values >500KB.
- **PDF zoom rescaling** — ImageBitmap cache for GPU-scaled instant zoom feedback. DOM window = canvas window + 4 pages. Search capped at 500 pages.
- **Barrel import elimination** — All imports now use direct module paths instead of `src/core/index.ts`, enabling tree-shaking.
- **Zustand selector anti-patterns** — Individual selectors instead of destructuring in ContextMenu, ReaderBookmarks, and other hot-path components.
- **Shared context menu portal** — Single global `ContextMenuRoot` replaces per-card portals.
- **Fuse index caching** — `WeakMap<Book[], Fuse>` caches search index. Debounced search (250ms).
- **Navigation fix** — Removed `key={currentRoute}` from RouteErrorBoundary (prevented full remount on route change).
- **DailyActivity pruning** — Capped to 365 days on rehydrate (was unbounded).
- **DeletionTombstone GC** — Garbage-collected on store rehydrate (was only during sync).

## [1.0.5] - 2026-07-03

### Added

- **RSS feed Markdown rendering** — Articles that include Markdown-formatted content (headings, bold, italic, links, lists, code blocks, etc.) are now converted to styled HTML at render time using `markdown-it` (v14). Both the article reader view and the feed card abstract render Markdown properly. Conversion also runs during initial feed import and article extraction for forward storage.
- **RSS article deletion** — Articles can now be deleted individually from the feed list. Deletions propagate as sync tombstones so the removal syncs to paired devices.
- **RSS article right-click context menu** — Feed article cards now have a context menu with: Read Article, Open Original, Copy Link, Mark Read/Unread, and Delete Article. The inline delete button has been removed in favor of the context menu.
- **Library multi-select** — A new "Select" button in the library toolbar toggles batch selection mode with checkboxes on every book card. Once selected, a bottom action bar appears with bulk operations: Mark Read, Mark Unread, Add to Shelf, and Delete. BookCard click behavior switches to toggle selection when in select mode.

### Changed

- **Feed card summary rendering** — Article abstracts on the feed page now render as rich HTML (links, bold, italic) instead of stripped plain text, giving a proper content preview.

### Fixed

- **Sync manifest rejected by peer (403 Forbidden) after pairing** — The sync-daemon grabbed the fixed port (43935) before the Tauri app, forcing it to a random fallback port. The daemon only loaded `paired_devices` at startup and never refreshed them, so devices paired by the Tauri app were unknown to the daemon's server. Two fixes:
  - `decrypt_request` now reloads `sync-paired-devices.json` from disk when a device lookup misses in the in-memory HashMap, so both the daemon and Tauri app servers pick up newly paired devices immediately.
  - The sync-daemon's auto-sync loop reloads paired devices from disk before each round (every 120s), ensuring periodic refresh even without an incoming request trigger.
- **Paired scanner IP not recorded** — `handle_pair` previously saved `last_ip: ""` and `last_port: 0` for the scanner, preventing the host from initiating sync back to the scanner. Now captures the client's real IP via `axum::ConnectInfo` so the host can reach the scanner without waiting for the scanner to initiate first.
- **Install script** — `curl | bash` install now handles `BASH_SOURCE` being unbound when piped via stdin.

## [1.0.4] - 2026-07-03

### Added

- **Sync-daemon bundled as Tauri sidecar** — The `sync-daemon` binary is now built and bundled inside deb/rpm/AppImage packages. On startup, the app launches it as a child process for 24/7 background sync.
- **One-command Linux install** — `curl -fsSL https://raw.githubusercontent.com/fundaments-work/Theorem/main/scripts/install-linux.sh | bash` auto-detects the distro, downloads the latest release, installs the app, **extracts the sync-daemon**, and creates a **systemd user service** (`theorem-daemon.service`) for persistent background sync.
- **Systemd user service** — `theorem-daemon.service` runs the sync-daemon as a user service, auto-starts on login, and survives app restart/quit/reboot. Enable manually: `systemctl --user enable --now theorem-daemon`.
- **Android notification permission request** — On Android 13+, `POST_NOTIFICATIONS` is now properly requested before the foreground service starts. The system dialog appears when enabling sync, making the persistent notification visible.
- **Android ProGuard/R8 keep rules** — `proguard-rules.pro` now keeps all `work.fundamentals.theorem.syncworker.*` classes so R8 doesn't strip reflectively-called plugin methods in release builds.

### Changed

- **Build scripts** — `makepackage-linux.sh` builds the sync-daemon before `pnpm tauri build` so it's included in the bundle. `release.yml` CI does the same.
- **Install script overhaul** — `install-linux.sh` now downloads from GitHub, detects the distro (deb/rpm/AppImage), installs the app + daemon + systemd service in one command.

### Fixed

- **Android foreground notification not showing** — `SyncWorkerPlugin.startWorker()` now calls `requestPermissionForAliases("notifications")` on Android 13+ before starting the service. Previously it only checked and logged.
- **Android R8 stripping** — `consumerProguardFiles` now points to the existing `proguard-rules.pro` instead of the missing `consumer-rules.pro`. Includes `-keep class work.fundamentals.theorem.syncworker.** { *; }`.

## [1.0.3] - 2026-07-02

### Added

- **Android background sync daemon** — `sync-daemon` sidecar binary with embedded HTTP server for LAN sync. Runs as a foreground service (`connectedDevice` type) with persistent notification. WorkManager periodic sync every 15 minutes + battery optimization exemption. Survives task removal.
- **Android sync foreground service** — `SyncForegroundService.kt` manages the persistent notification and lifecycle. Auto-starts on app launch. Updates notification with sync status messages.
- **Android device identity** — Stable per-device ID generated on first launch, stored in app preferences. Used for sync pairing and authentication.
- **Sync daemon status in settings** — UI shows daemon running/stopped status, last sync time. Control API via HTTP on loopback.
- **Back arrow in article reader** — Dedicated floating back arrow below the mobile status bar with `safe-area-inset-top` support. Prevents stale article state from hijacking book opens.
- **RSS feed deletion sync** — Tombstone propagation ensures deleted feeds are removed on paired devices.
- **Colored sync status indicator** — Replaced rotating `animate-spin` icon with status dot: idle (grey), syncing (amber+pulse), synced (green), error (red). Last synced label moved to left of icon.
- **Page-turn animation on all navigations** — `#setViewPosition` now always animates in paginated mode (not just same-chapter turns). Touch drag stays instant via `animate=false`.

### Changed

- **TTS: native audio on desktop** — Completely removed Web Audio API for TTS playback. Desktop now uses `rodio` (Rust audio library) for gapless native audio output. Android uses raw `AudioTrack` via a custom Tauri plugin. Bypasses WebView audio entirely.
- **TTS: native audio on Android** — New `tauri-plugin-android-tts-audio` plugin writes PCM audio directly to Android `AudioTrack`. No more Web Audio API latency or autoplay restrictions.
- **TTS: increased chunk size** — First chunk 150 chars, subsequent chunks 500 chars (was 80/150). Reduces chunk boundaries by ~3-4×, eliminating audible fade-out dips between sentences.
- **TTS: removed Anti-Bite Detachment regex** — The phonemizer workaround is no longer needed; the `misaki-lean` bug fix appends a trailing `_` instead.
- **Sync/statistics buttons** — Now use `ui-icon-btn` class on desktop too, giving consistent visible `background: var(--color-surface)` with mobile.
- **Page-turn easing** — Changed from `cubic-bezier(0.22, 1, 0.36, 1)` (dual y=1.0 caused mid-turn plateau) to `cubic-bezier(0, 0, 0.58, 1)` (CSS ease-out, natural deceleration).
- **Reader toolbar** — Double-click on titlebar now toggles maximize/restore (standard desktop behavior).
- **Git ignore** — Explicit policy for generated Android project files, SDK files, build outputs.

### Fixed

- **TTS autoplay on word tap** — Removed the `.tts-word` click-to-play feature. Tapping any word no longer triggers `generate_speech` regardless of `ttsEnabled`.
- **TTS word doubling** — Removed `isContinuousMode` auto-play effect in ImmersionBar that raced with `handleTtsComplete`. Both called `generate_speech` for same text.
- **TTS continues after closing immersion bar** — `handleTtsComplete` now guards on `immersionMode`. Ref-based check prevents stale in-flight async calls.
- **TTS memory: audio buffers not freed on stop** — `desktop_audio::stop_audio()` changed from `player.stop()` (atomic flag, 1 chunk/5ms drain) to `player.clear()` (immediate queue drain + pause).
- **TTS memory: 3× IPC overhead per chunk** — Removed `audio_data` from `TtsChunk` IPC (48KB+ `Vec<f32>` serialized as JSON, never read by frontend). Added `duration_ms` on Rust side. Saves ~400KB per chunk.
- **TTS memory: stale closures in singleton** — `ImmersionPlayer.destroy()` now clears `this.callbacks`, preventing old React closures from being held indefinitely.
- **Immersion toggle causes page turn** — Removed `pb-16` padding transition on viewport container that resized the foliate paginator and triggered column recalculation.
- **3D page-flip animation broken CSS** — Restored missing closing brace on `#container` CSS rule (deleted when reverting the 3D flip). The unclosed rule merged `#container` with all subsequent selectors, causing broken layout that appeared as animation stutter.
- **Page-turn animation stutters mid-turn** — Settings sync (`applySettingsSync`) in `next()`/`prev()` called immediately after navigation, triggering renderer attribute changes (column count, flow) during the 0.3s CSS transition. Deferred via `setTimeout(350)` so it fires after the animation completes.
- **Broken column layout on multi-column desktop** — `next()`/`prev()` now call `applySettingsSync`/`Async` after navigation (deferred past transition) to ensure correct column count, inline-size, and flow mode.
- **Book stuck at "Loading..."** — Force new Blob reference in `loadBook` to trigger React re-render. Reset `loadedBookIdRef` on effect cleanup to prevent infinite loading.
- **TTS column layout misalignment** — Repeated layout sync and zoom application after navigation. Added chapter-boundary detection so re-renders only happen when needed.
- **Android: crash on Android 14** — `SystemForegroundService` missing `foregroundServiceType` in AndroidManifest. Crash when binding WorkManager notification.
- **Android: WorkManager JNI crash** — Fixed `Java_work_fundamentals_theorem_syncworker_SyncWorker_runBackgroundSync` native method naming.
- **Android: redundant companion object** — Merged duplicate `companion object` blocks in `SyncWorker.kt`.
- **Android: smart cast errors** — Fixed Kotlin smart cast on `networkCallback` in `NetworkCallback` registration/unregistration.
- **Android: WakeLock + notification permissions** — Added `WAKE_LOCK` and `POST_NOTIFICATIONS` permissions. Wrapped `acquireWakeLock` in try/catch.
- **Android: task removal kills sync** — Set `stopWithTask=false` and restart in `onTaskRemoved` to keep sync alive.
- **Android: notification importance** — Increased to `IMPORTANCE_LOW` for reliable display.
- **Sync: 503 race condition** — Prevents concurrent sync requests from causing HTTP 503 errors. Propagates RSS feed deletions as tombstones.
- **Sync: crashes on Android and desktop** — Eliminated multiple crash sources in sync orchestrator, crypto, and server.
- **RSS article reader back button** — Restored back navigation. Fixed stale article state hijacking book opens when switching between reader and feeds.
- **Rust compiler warnings** — All warnings eliminated for production builds.
- **3D page-flip shadow overlay** — Reverted `#flip-shadow` element, `perspective: 2000px` CSS, and Web Animations API 3-keyframe effect.

### Performance

- **Instant book opening** — Rust-native EPUB prefetch reads zip metadata in parallel with JS. Container.xml, OPF, nav, NCX, and ALL HTML section text are pre-decoded and cached. `loadText`/`getSize` calls skip `@zip.js/zip.js` entirely on the critical path. Book opening drops from ~1.5s to <50ms on desktop, <150ms on Android.
- **Eliminated barrel imports** — Every import now uses direct module paths instead of `src/core/index.ts`. Barrel re-exports prevented tree-shaking and bundled all stores/services together.
- **React.memo on heavy components** — Wrapped `BookCard`, `ReaderViewport`, `PDFJsEngine`, `Sidebar`, `BottomNav`, `AppTitlebar`.
- **Lazy-loaded heavy dependencies** — `soundtouchjs` (TTS), `pdfjs-dist`, `@mozilla/readability`, `fast-xml-parser`, `html-to-image` all use dynamic `import()`.
- **Zustand individual selectors** — All store consumers now use `useStore(s => s.x)` instead of destructuring `const { x } = useStore()`.
- **Layout reflow on same-section page turns** — Only triggers render when layout is genuinely broken (size === 0). Keybard navigation and page turns skip unnecessary columnization.

### Removed

- **Dead component** — Removed unused `ShareCard.tsx`.
- **Unused barrel files** — `article-reader/index.ts`, `components/index.ts`, `highlights/index.ts`, `progress/index.ts`.
- **Dead CSS classes** — `.epub-container`, `.epub-container iframe`, `.reader-screen`, `.theme-transition`, `.reader-container` from `index.css`.
- **Commented-out console.log** — 3 lines in `foliate-js-runtime/epub.js`.
- **Unused PDF.js vendor** — `foliate-js/vendor/pdfjs/` directory (~10.5MB, app uses `pdfjs-dist` npm package).
- **Vendored foliate-js** — Converted to git submodule pointing to `fundaments-work/foliate-js` fork.
  Fork stripped of `vendor/pdfjs/` (~10.5MB unused PDF.js build artifacts, app uses `pdfjs-dist` npm package).
  Nightly GitHub Action syncs upstream `johnfactotum/foliate-js` changes into the fork automatically.
  Clone with `git clone --recurse-submodules`.
- **TTS Anti-Bite Detachment regex** — Replaced by trailing `_` phonemizer workaround.

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
- **Share notification feedback** — Added error toasts for preview generation failures in both highlights and stats share modals. Added "Popup was blocked" toast in ShareMenu when X share popup is blocked.
- **Rust clippy warning** — `map_or(false, ...)` → `is_some_and()` in `epub_parser.rs` (new Rust 1.96 lint).

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
