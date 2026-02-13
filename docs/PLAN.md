# Theorem Product Roadmap

Last updated: 2026-02-12

## Product Thesis
Theorem is an all-in-one reading and learning system: read, capture, remember, and apply.

## Delivery Strategy
1. Build the data platform first (local-first, sync-ready).
2. Layer learning workflows (dictionary + SRS) on top of the same data core.
3. Expand content ingestion (RSS, newsletters, web, academic) without changing the core model.
4. Keep one codebase for web, mobile, and desktop.

## Phase 1: Core Reading (Current state)
- [x] EPUB support
- [x] MOBI/AZW/AZW3 support
- [x] FB2 support
- [x] CBZ support
- [x] PDF support
- [x] Library management
- [x] Reading progress tracking
- [x] Highlights, notes, bookmarks
- [x] Table of contents navigation
- [x] Search in current document
- [x] Reading statistics

## Phase 2: Learning Loop
- [x] Dictionary lookup and save-to-vocabulary
- [x] Personal dictionary management
- [x] Flashcards from highlights/notes
- [x] Spaced repetition scheduler and review workflow
- [x] Daily review session UX


## Phase 3: Content Discovery and Capture
- [ ] RSS feed reader
- [ ] Newsletter ingestion
- [ ] Web clipper
- [ ] Saved web article reader mode
- [ ] Unified content model across books/articles/web

## Phase 4: Academic Workflow- [ ] Advanced continuation and session intelligence

- [ ] arXiv integration
- [ ] PubMed integration
- [ ] Reference manager
- [ ] Citation export formats
- [ ] Citation links on highlights and notes

## Phase 5: Reading Acceleration
- [ ] Velocity mode (speed reading)
- [ ] TTS with local/open-source model support

## Phase 6: Data Platform Foundation
- [ ] Local SQLite canonical data core
- [ ] Repository layer (`src/data/*`) replacing persisted domain Zustand state
- [ ] Shared schema across desktop/mobile/web
- [ ] Web SQLite WASM + OPFS driver
- [ ] Tauri native SQLite command layer
- [ ] Operation log + sync outbox
- [ ] Automatic one-time migration from existing local state
- [ ] Performance target validation for 10k docs / 500k annotations

## Phase 7: Paid Sync Infrastructure
- [ ] Cloudflare Workers sync API
- [ ] JWT auth integration for account/device identity
- [ ] Canonical cloud metadata store on Postgres (Supabase first)
- [ ] Blob sync via S3-compatible adapter
- [ ] R2 as primary blob provider
- [ ] AWS S3 as secondary/fallback provider
- [ ] End-to-end encryption (zero-knowledge)
- [ ] Deterministic conflict resolution for offline multi-device edits

## Phase 8: Integrations and Platform
- [ ] Obsidian export and sync-friendly markdown output
- [ ] Public API
- [ ] Launch readiness on web, mobile, and desktop

## Non-Negotiable Constraints
1. Local-first always: app remains useful without network.
2. Sync is optional and paid, not required for core reading.
3. New features must use central data core; no new direct localStorage/Zustand persistence silos.
4. Cloud architecture must remain portable across providers.

