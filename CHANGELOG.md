# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.2] - 2026-02-27

### Changed

- Expanded `getFilteredAndSortedBooks` test coverage with a full behavior matrix:
  - RSS visibility across main library and shelf contexts.
  - Favorites + shelf interaction and filtered-scope search behavior.
  - Search invariants for fuzzy relevance, whitespace queries, tags, and format labels.
  - Sorting assertions for all supported sort keys and both directions.

### Fixed

- Added edge-case regression tests for author normalization and nullable/string-backed date fields.
- Added a non-mutation assertion to guarantee filtering/sorting does not reorder the input array.

### CI

- Added a dedicated `Build` job in CI to enforce production build success (`pnpm build`) on every push and pull request.

## [0.1.0-beta.1] - 2026-02-21

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
  - Android support (requires manual build)
  - Web fallback for browser testing

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
- Android requires manual build setup

---

## Release Notes Template

### [Unreleased]

#### Added

#### Changed

#### Deprecated

#### Removed

#### Fixed

#### Security
