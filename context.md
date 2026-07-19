# Theorem — Context

## What This Is

Theorem is a **local-first desktop ebook reader** with P2P device sync. It reads EPUB, MOBI, PDF, CBR, FB2, and RSS feeds. It also exports highlights and vocabulary to Markdown for Obsidian/Logseq.

It runs as a Tauri 2 desktop app (Linux, macOS, Windows, Android). The web build works for basic browsing but Tauri is the primary target.

## Why Local-First

Your library, highlights, and reading position are stored **on your machine** in SQLite. There is no cloud account, no subscription, no vendor lock-in. Sync between devices uses direct P2P connections over LAN/Internet via the iroh protocol stack — no server in the middle.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| UI framework | React 19 | Component model, lazy loading, Suspense |
| State | Zustand 5 | Minimal boilerplate, `persist` middleware, selector-based subscriptions (no full-store re-renders) |
| Bundling | Vite 8 (rolldown) | Fast builds, CSS-free in prod |
| CSS | Tailwind CSS v4 | Utility-first, `@theme` design tokens, `cn()` for composition |
| Desktop shell | Tauri 2 | Smaller binaries than Electron, Rust for perf-critical paths |
| Persistence | SQLite (rusqlite + r2d2) | Reliable, well-understood, FTS5 for search |
| P2P sync | iroh stack | CRDT-based doc sync (structured data) + blob transfer (files) |
| Ebook reflow | foliate-js (vendored) | Mature EPUB/MOBI/FB2/CBZ rendering, patched at build time |
| PDF | PDF.js | Industry standard, range-based streaming reads |
| Tests | Vitest + jsdom | Familiar, fast, React Testing Library compatible |
| Linting | TypeScript strict mode | No linter — typecheck catches issues |

## Key Architectural Decisions

**No React Router.** Navigation uses `useUIStore.currentRoute` and `window.history.pushState`. This avoids a heavy dependency for what amounts to a page switch with 10 routes. All route components are `React.lazy()` loaded.

**Two reader engines.** Foliate-js handles reflowable formats (EPUB, MOBI, FB2, comic archives). PDF.js handles PDF. They share annotation and bookmark state through a common store interface via `Reader.tsx`.

**Reader chunk prewarming.** The reader chunk is the largest feature by far. `LibraryPage` calls `prewarmReaderChunk()` on mount so the JS is already loaded by the time the user opens a book.

**EPUB pre-parser in Rust.** Opening an EPUB normally requires JS-side ZIP traversal (zip.js). The Rust `prefetch_zip_metadata` command pre-decodes all text entries in parallel before zip.js starts. If the cache is populated, zip.js skips `getEntries()` entirely.

**P2P sync always compiled.** The iroh stack (iroh + iroh-docs + iroh-blobs + iroh-gossip) is always built into the binary. There is no feature gate for sync — it's a core product feature, not optional infrastructure.

**Book locations in SQLite, not Zustand.** Foliate-js position snapshots (the `locations` field) can reach 50-100MB across 1000 opened books. Storing that in persisted Zustand state would serialize and deserialize megabytes on every persist cycle. Instead, it lives in a SQLite BLOB column, read on book open, written on book close.

**Markdown export without a library.** The vault sync module generates Markdown files directly with a YAML frontmatter template matching Obsidian's expected format. No external Markdown generation library — the output is tightly coupled to Obsidian's filename conventions.

## Scale Targets

The schema and query paths are designed for **10,000 books**. WAL mode, a 4-connection pool, FTS5 indexing, and per-book annotation tables support this without degradation. The Zustand store holds only metadata (~1MB at 10K), with binary payloads materialized to the filesystem.

## Filesystem Layout

```
~/.local/share/work.fundamentals.theorem/
├── theorem.db               # SQLite (books, covers, kv, blobs, FTS)
├── book-cache/              # Materialized book files (on-demand from DB)
│   ├── {bookId}.book
│   └── ...
```

The `book-cache/` directory is a write-through cache: books are written to both the DB BLOB column and a `.book` file on import. Subsequent reads go from the file; if missing, they're re-materialized from the DB.
