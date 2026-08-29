# Theorem Discover Storefront Design Specification

**Date**: 2026-08-29  
**Status**: Approved / Ready for Implementation  
**Area**: Discovery / Library / Desktop  

---

## 1. Vision & Goals

Replace traditional, clunky folder-tree OPDS clients with a modern, editorial **Discover** experience tailored to Theorem's aesthetic.

- **Editorial Curated Storefront**: Modern layout featuring hero spotlight cards and horizontal carousels (*Timeless Essentials*, *Philosophy & Thought*, *New Releases*, *Sci-Fi & Classics*).
- **Zero-Friction Ingestion**: 1-click **Get** action with in-place micro-spinner, converting immediately into an **"In Library"** / **"Read Now"** state.
- **Unified Fast Search**: Cross-catalog search aggregated from open public domain catalogs and custom self-hosted servers (Calibre, Kavita).
- **Fast Local Caching**: Instant rendering via memory and SQLite KV store caching.
- **Desktop First**: Clean, responsive layout designed for desktop exploration.

---

## 2. Architecture & Components

```
                    ┌────────────────────────────┐
                    │       DiscoverPage         │
                    │ (Hero, Carousels, Search)  │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │      DiscoverService       │
                    │ (Feed Aggregator & Caching)│
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│Project Gutenberg │    │ Standard Ebooks  │    │  Custom OPDS/Feed  │
│  (Popular/Top)   │    │  (New Releases)  │    │ (Calibre / Kavita) │
└──────────────────┘    └──────────────────┘    └────────────────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │ EPUB stream
                                  ▼
                    ┌────────────────────────────┐
                    │  storage.ts & libraryStore │
                    │ (Direct Ingestion & SQLite)│
                    └────────────────────────────┘
```

### Components

1. **`DiscoverPage`** (`src/features/catalogs/DiscoverPage.tsx`):
   - Hero Spotlight showcasing a selected classic with synopsis and 1-tap "Get".
   - Curated Carousels (`DiscoverCarousel`) for thematic collections.
   - Global Search View when a search query is typed.
   - Source Selector tabs: *All Sources*, *Project Gutenberg*, *Standard Ebooks*, *+ Add Source*.

2. **`DiscoverBookCard`** (`src/features/catalogs/components/DiscoverBookCard.tsx`):
   - 2:3 aspect ratio cover card matching Theorem design tokens.
   - Hover elevation, title, author, and format badge.
   - 1-click "Get" action with stateful progress (`idle` -> `downloading` -> `in_library`).

3. **`DiscoverDetailModal`** (`src/features/catalogs/components/DiscoverDetailModal.tsx`):
   - Detailed modal showing high-res cover, description, author, year, and "Add to Library" / "Read Now" actions.

4. **`DiscoverService`** (`src/core/services/DiscoverService.ts`):
   - Parallel feed fetching, parsing, and caching.
   - Unified search across active catalogs.
   - 1-tap download & ingest pipeline.

5. **`discoverStore`** (`src/core/store/discoverStore.ts`):
   - Zustand store managing active sources, custom catalog URLs, and cached sections.

---

## 3. Quality & Performance Verification

- **Typecheck**: `pnpm typecheck` — 0 errors.
- **Unit Tests**: `pnpm test tests/discover.test.ts` — 100% passing.
- **Rust Quality Gates**: `cargo fmt --check`, `cargo clippy`, `cargo check` — 0 errors.
