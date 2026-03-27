# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.5] - 2026-03-27

### Changed

- Completely overhauled LAN Sync performance logic, changing blocking synchronous file payloads into asynchronous encrypted stream chunks for ultra-fast transfers without extreme RAM overheads.
- Reduced strict file transferring limits to avoid OOM memory crashes on Android and lower-memory systems.
- Re-architected data serialization structures eliminating CPU-heavy "Double JSON" stringification lags occurring during peer connections.

### Fixed

- Resolved asynchronous race conditions overlapping library updates simultaneously when rapid data pushes arrived.
- Fixed severe sync timeouts where SQLite-to-disk metadata file conversions were sequentially blocking `reqwest` transfers on the `tokio` thread.

## [1.0.0-beta.4] - 2026-03-24

### Fixed

- Fixed reader screen title truncation on mobile devices by adjusting titlebar flex layouts to properly wrap or truncate long titles.
- Fixed site title overlap with the sync button on the feeds page for mobile devices.
- Added spinning animation to the sync button on the feeds page to better indicate active refresh and load states.

## [1.0.0-beta.3] - 2026-03-23

### Added

- Support for importing and opening files directly from OS file associations ("Open With") via Tauri events.
- Added alerts in the library when book imports fail.

### Changed

- Enhanced book format detection to properly handle Android content URIs and various ZIP archives.

### Fixed

- Increased storage read timeout to reliably handle large books.
- Relaxed the import timeout and improved failure reporting.
- Fixed mobile reader back button to correctly exit to the library.
- Prevented redundant navigation actions during routing.

## [1.0.0-beta.2] - 2026-03-09

### Added

- Encrypted LAN device sync backend for syncing books, reading progress, and annotations across Theorem installs.
- QR-based pairing and device sync controls in settings, including mobile scanner support.
- Linux packaging and install scripts for distro-native bundles and local user-space installs.

### Changed

- Improved sync merge behavior, conflict handling, cover extraction, and paired-device UX across the full sync flow.
- Updated the desktop bundle version to `1.0.0-2` for the sync beta release while keeping tag-based beta versioning.

### Fixed

- Addressed sync security and tombstone propagation issues uncovered during the initial device sync rollout.
- Hardened Linux local install fallback by extracting generated `.deb` bundles into `~/.local/` when system package tools are unavailable.

## [1.0.0-beta.1] - 2026-02-27

### Added

- **Reader Engine**
  - EPUB, MOBI, AZW, AZW3, FB2, CBZ, and PDF format support
  - Foliate-based reflowable book rendering
  - PDF.js-based PDF rendering with annotation support
  - RSS feed reader with article extraction

- **Library Management**
  - Book import from local files
  - Folder scanning for batch import
  - Custom shelf organization
  - Book metadata display

- **Annotations**
  - Highlight passages with multiple colors
  - Add notes to highlights
  - Annotation panel for navigation
  - Export annotations to Markdown

- **Vocabulary**
  - Built-in dictionary lookup during reading
  - StarDict dictionary support
  - Vocabulary capture and review

- **Markdown Export**
  - Sync highlights and notes to local Markdown files
  - Obsidian/Logseq vault integration
  - Customizable export templates

- **Settings**
  - Theme customization (light/dark modes)
  - Reading preferences
  - Export path configuration

- **Cross-Platform**
  - Desktop support (Windows, macOS, Linux)
  - Android support
  - Web fallback for browser testing

### Changed

- Expanded `getFilteredAndSortedBooks` test coverage with a full behavior matrix:
  - RSS visibility across main library and shelf contexts.
  - Favorites + shelf interaction and filtered-scope search behavior.
  - Search invariants for fuzzy relevance, whitespace queries, tags, and format labels.
  - Sorting assertions for all supported sort keys and both directions.

### Fixed

- Resolved an EPUB reader regression where some books stayed indefinitely at `Loading book...`.
- Added timeout and fallback safeguards in the EPUB storage/read pipeline to prevent cross-platform open hangs.
- Added edge-case regression tests for author normalization and nullable/string-backed date fields.
- Added a non-mutation assertion to guarantee filtering/sorting does not reorder the input array.
- Updated desktop bundle versioning to an MSI-compatible format (`1.0.0-1`) for Windows release packaging.

### CI

- Added a dedicated `Build` job in CI to enforce production build success (`pnpm build`) on every push and pull request.
- Hardened tag-based release workflow to publish desktop and Android artifacts from CI/CD.
- Updated macOS release runners and signing flow with a safe ad-hoc fallback when signing secrets are unavailable or disabled.

### Technical

- React 19 + TypeScript frontend
- Tauri 2.0 desktop runtime
- Zustand state management
- Tailwind CSS v4 styling
- Custom mobile folder scanning plugin

### Known Limitations

- No cross-device sync (planned for future release)
- CBR format recognized but not supported for import
- User is responsible for data backups

---

## Release Notes Template

### [Unreleased]

#### Added

#### Changed

#### Deprecated

#### Removed

#### Fixed

#### Security
