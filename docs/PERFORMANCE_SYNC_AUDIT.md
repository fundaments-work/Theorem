# Theorem Performance & Sync Audit

## Table of Contents

1. [Startup Performance](#1-startup-performance)
2. [Mobile UI Performance](#2-mobile-ui-performance)
3. [Scale Analysis: 5000+ Books](#3-scale-analysis)
4. [Database Architecture](#4-database-architecture)
5. [Sync Correctness Bugs](#5-sync-correctness-bugs)
6. [Sync Architecture: Over-engineering](#6-sync-architecture)
7. [Sync Server Lifecycle](#7-sync-server-lifecycle)
8. [Remaining Gaps After Yjs](#8-remaining-gaps)
9. [Unnecessary Operations](#9-unnecessary-operations)
10. [Library Reinvention Audit](#10-library-reinvention-audit)
11. [Recommended Fixes](#11-recommended-fixes)
12. [Resilient Sync: Offline + P2P + Network](#12-resilient-sync-offline--p2p--network)

---

## 1. Startup Performance

### Problem: Long white screen before first paint

**Timeline:**

```
T=0ms     Binary launches
T=50ms    Webview window created — blank white maximized window
T=60ms    Rust setup(): init_sync (DeviceIdentity disk I/O)
T=100ms   index.html parsed → <div id="root"></div> — entirely empty
T=120ms   JS bundle download starts
T=160ms   5× sqlite_get_kv() IPC calls (one per store)
T=170ms   1st SQLite call: with_connection() runs schema migration
T=200ms   Persist middleware hydrates all stores
T=201ms   React renders <App/> — but defaults are false
T=203ms   Onboarding flash → re-render → LibraryPage lazy chunk loads
T=250ms   FIRST MEANINGFUL PAINT
```

**Root causes:**

| # | Cause | Location |
|---|-------|----------|
| 1 | `index.html` `<div id="root">` is empty — no spinner/skeleton | `index.html:58` |
| 2 | `tauri.conf.json` has `maximized: true` with no `visible: false` — window appears before content | `tauri.conf.json:21` |
| 3 | `hasCompletedOnboarding` defaults to `false` — returning users see onboarding flash, then re-render | `store/index.ts:107`, `App.tsx:448` |
| 4 | 5 separate `sqlite_get_kv` IPC calls (one per store) — should be batched | `persist-storage.ts:120` |
| 5 | Google Fonts `@import` is render-blocking in production builds | `index.css:1` |

**Fixes:**

1. Add inline CSS spinner + brand logo inside `index.html` `<div id="root">`
2. Set `"visible": false` in `tauri.conf.json`, call `window.show()` after React first render
3. Track explicit `useHasHydrated` state — show loader until all stores hydrated, then show onboarding or main UI
4. Batch 5 initial reads into single `sqlite_batch_get_kv` IPC roundtrip
5. Remove Google Fonts `@import`, use `<link rel="stylesheet">` in HTML `<head>` instead

---

## 2. Mobile UI Performance

### 2.1 Settings Page — Primary Mobile Jank

**Root cause chain** (ranked by impact):

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Horizontal tab bar with `snap-x snap-mandatory snap-start` nested inside vertical `overflow-y-auto` | `Settings.tsx:649-667`, `App.tsx:477` | Touch gesture disambiguation every frame |
| 2 | `animate-fade-in` promotes 1300-line DOM tree to GPU layer on every remount | `Settings.tsx:635`, `index.css:167-179` | GPU memory + layer allocation |
| 3 | `transition-all duration-500` on progress bar watches every animatable property | `Settings.tsx:844` | Unnecessary compositor work |
| 4 | `transition-colors` on 6 tab buttons during horizontal scroll | `Settings.tsx:657,675` | Scroll-triggered repaints |
| 5 | Scroll reset effect fires before Suspense resolves — `scrollTo` on stale DOM geometry | `App.tsx:415-420` | Forced synchronous layout |
| 6 | `SettingsPage` not wrapped in `React.memo` | `Settings.tsx:318` | Full re-render on any store change |
| 7 | 12+ Zustand selectors cause re-renders during background sync events | `Settings.tsx:319-335` | Mid-scroll re-renders |
| 8 | `SpeechSynthesis.getVoices()` on every settings mount (500-2000ms on Android) | `Settings.tsx:360-364` | Main-thread CPU contention |
| 9 | Conditional tab content DOM teardown/rebuild on tab switch | `Settings.tsx:688-1311` | Layout recalculation while scroll settles |
| 10 | `color-mix(in srgb, ...)` × 13+ in DeviceSync component | `DeviceSync.tsx:124-136 etc` | Cumulative paint cost |

**Fixes:**

1. Replace `snap-x snap-mandatory snap-start` with plain `overflow-x-auto` flex row
2. Guard `animate-fade-in` behind `prefers-reduced-motion: no-preference`
3. Replace `transition-all` with `transition-[width]`
4. Remove `transition-colors` from tab bar buttons on mobile
5. Use `hidden` CSS class for tab content switching instead of conditional rendering
6. Wrap SettingsPage in `React.memo`
7. Push vault sync subscriptions into child components
8. Guard `loadVoices()` with `navigator.onLine` check or lazy-load on user interaction
9. Add `content-visibility: auto` on scroll containers

### 2.2 Navigation Lag

| Issue | Location |
|-------|----------|
| No `-webkit-overflow-scrolling: touch` on scroll containers | `App.tsx:477` |
| No `will-change: transform` or GPU scroll hint | All scroll containers |
| No `overscroll-behavior: contain` | `App.tsx:477` |
| `scrollTo({ behavior: "auto" })` on every route change | `App.tsx:415-420` |
| All route-level pages lack `React.memo` | Library, Settings, Bookmarks, Annotations, Statistics, Vocabulary, Feeds |

### 2.3 Store Subscription Anti-patterns

**7 components subscribe to full `books` array** — re-render on any book change:

`Statistics`, `Bookmarks`, `Annotations`, `Library`, `Shelves`, `ReaderAnnotationsPanel`, `Settings` (StorageTab)

**5 components subscribe to full `annotations` array** — re-render on every highlight:

`Statistics`, `Bookmarks`, `Annotations`, `Settings` (StorageTab), `ArticleViewer`

**3 components subscribe to full `settings` object** — re-render on any setting change:

`Settings`, `Library`, `Shelves`

**Fixes:**

- `ReaderAnnotationsPanel` should use `useShallow(s => s.getBookAnnotations(bookId))` instead of full `books` + `annotations`
- `ArticleViewer` should use `getBookAnnotations(article.bookId)` selector
- Settings page should push subscriptions into per-tab child components
- StorageTab already has `memo()` but still subscribes to `books` and `annotations` — use `getState()` for one-shot reads

---

## 3. Scale Analysis: 5000+ Books

### 3.1 Book Memory: Cleanup on Close

**Verdict: YES — books release from memory properly.**

The `key={currentBookId}` on `ReaderViewport` (`Reader.tsx:2220`) forces React to unmount the entire reader tree on book switch, triggering the full destroy cycle:

1. `FoliateEngine.destroy()` — removes iframes, cancels animation frames, clears selection intervals, unsubscribes event listeners, nulls all internal refs
2. `PDFJsEngine` unmount effect — calls `page.cleanup()` on every loaded page, `PDFDocumentProxy.cleanup()`, clears text content cache, releases canvases
3. `useDocumentReader` cleanup — calls `engine.destroy()`, resets React state, nulls engine ref

No memory leak detected. The preloaded books (upcoming 3 books in `getBookBlob()`) remain in browser blob cache but are small.

### 3.2 What 5000 Books Plus Active Usage Looks Like

```
User: 5000 imported books, 1000 read, actively highlighting, 50 RSS feeds
─────────────────────────────────────────────────────────────
Domain              Count            Est. Size     Bounded?
─────────────────────────────────────────────────────────────
Books metadata      5,000 × 800B     4 MB          Yes (per book)
Books locations     1,000 × 50KB     50 MB         NO — UNBOUNDED
Annotations         100,000 × 400B   40 MB         No (grows with usage)
Vocabulary terms    5,000 × 400B     2 MB          No (grows with learning)
RSS articles        500 × 50KB       25 MB         Yes (capped at 500)
RSS feeds           50 × 200B        10 KB         Yes (trivial)
Collections         50 × 4KB         200 KB        Yes (trivial)
Tombstones          50,000 × 80B     4 MB          Yes (90-day GC)
Settings + stats    1 × 40KB         40 KB         Yes (pruned to 365 days)
─────────────────────────────────────────────────────────────
TOTAL (Zustand)                      125 MB
TOTAL (sync payload)                 125 MB  ←  entire blob sent every sync
─────────────────────────────────────────────────────────────
```

### 3.3 Critical Scaling Issues

#### P0: `book.locations` — 50MB and Unbounded

Every opened book stores foliate-js position data in `book.locations` (5-100KB per book). This field is **never stripped from persistence or sync**. After 1000 opened books: 50-100MB of JSON in one field. Every `partialize` call (every persist event) does `JSON.stringify` on the full 125MB blob.

**Fix**: Remove `locations` from the Zustand Book object. Store it per-book in SQLite as a BLOB. Read on book open, write on book close. Never touches Zustand or sync payloads.

#### P0: `addBooks()` O(n × m) Import Algorithm

Importing 5000 books does ~12.5 million `findIndex` comparisons via `findDuplicateBookIndex` (`store/index.ts:744,783`). UI freezes for seconds during bulk import.

**Fix**: Build a single lookup Map/Set before the loop for O(1) deduplication.

#### P0: Cover Restore Triggers 105 Re-renders

After rehydrate with 5000 books missing covers: ~105 `setState` calls (48-book batches), each doing O(n) `applyCoverLookupToBooks()`, triggering ~105 React re-renders. Library page flickers for seconds on startup.

**Fix**: Batch all cover updates into a single final `setState` after all batches complete.

#### P1: Annotations — 100K × Full-array O(n) Scans

At 100K annotations: every highlight creates `[...state.annotations, annotation]` — a full 40MB array copy. Every mutation invalidates the `annotationsByBookCache` WeakMap, forcing O(n) rebuild. `ReaderAnnotationsPanel` re-renders on ANY annotation change anywhere.

**Fix**: Store annotations per-book in SQLite. `getBookAnnotations(bookId)` queries SQLite, returns only that book's annotations. Panel subscribes to a per-book slice.

#### P1: Partialize Maps All Books Every Persist Event

`partialize` (`store/index.ts:1454`) does `books.map(strip coverPath)` over all 5000 books every time any store mutation triggers a persist. With the 350ms debounce, this runs ~3 times/second during active use.

**Fix**: Track dirty flags per-domain. Only re-serialize changed arrays.

#### P1: `JSON.stringify` Blocks Main Thread for 125MB

At full scale, the serialized Zustand JSON is 125MB. `JSON.stringify` takes ~500ms-1s on the main thread (blocking). This happens on every persist cycle and every sync provision.

**Fix**: The layered architecture (section 3.6) fixes this. Only viewport-sized metadata stays in Zustand.

#### P2: RSS Content Not Truncated in Sync Path

The persist `partialize` correctly caps articles at 50KB content / 500 count / 30-day age. But the sync path reads `useRssStore.getState().articles` directly — bypassing truncation. Freshly fetched articles with 200KB+ HTML are synced raw.

**Fix**: Apply the same 50KB truncation in `buildDomainsAndManifest` for the `rss_articles` domain.

#### P2: `searchBooks()` Uncached O(n) String Match

`store/index.ts:1392-1401` — direct `.filter()` with `.toLowerCase().includes()` on all books. No WeakMap cache unlike `getRecentBooks()`, `getFavoriteBooks()`, etc. At 5000 books: ~5ms per call. Acceptable but should be cached or pushed to SQLite.

#### P2: `addBookToCollection()` Uses O(n) `.some()` Instead of O(1) Lookup

`store/index.ts:1197` — `state.books.some((b) => b.id === bookId)` scans all books when `getBookLookup(books).has(bookId)` is O(1). Trivial latency but wrong pattern.

#### P2: Fuse.js Search at 5000 Items

`filtering.ts:32-56` — Fuse builds an n-gram index on all 5000 books (~20ms). Search queries are O(n) bitap algorithm (~10ms per query). Acceptable with 250ms debounce. At 10K+ books, switch to SQLite `LIKE '%query%'` with indexed columns.

### 3.4 What Scales Well (No Changes Needed)

| Domain | Why |
|--------|-----|
| Settings | Fixed 50 fields. `dailyActivity` pruned to 365 days (rehydrate) + 84 days (runtime). Max 40KB. |
| Collections | 50 collections × 4KB = 200KB. Book ID strings, negligible. |
| Deletion tombstones | 90-day GC prevents unbounded growth. Burst from bulk delete is temporary. |
| Vocabulary | 5000 terms × 400B = 2MB. Virtualized via @tanstack/react-virtual. `find()` dedup at 20K terms is ~2ms. |
| RSS feeds | 50 feeds × 200B = 10KB. Trivial. |
| RSS articles (persisted) | Capped at 500 articles × 50KB = 25MB. Age-based cleanup. |
| PDF.js engine | On-demand page loading, 90-page cache window, 3 concurrent renders. Library size independent. |
| @tanstack/react-virtual | Only ~20-30 DOM nodes visible. Handles 5000+ items effortlessly. |

### 3.5 Sync Payload at Scale

Full 9-domain snapshot for sync at extreme scale: **50-125MB JSON**. SHA-256 computed on all 9 domains every sync (WebCrypto, ~0.5-2s). Content hash comparison is dead for books (volatile `lastReadAt`/`progress`/`readingTime` make it never match). The hash optimization only works for domains that never change. Every sync is effectively a full bidirectional transfer.

**Fix**: Yjs delta-based sync transmits only changes, not full snapshots. A single annotation edit sends ~500 bytes instead of the full 125MB blob.

### 3.6 Target Architecture for 5000+ Books

```
┌─────────────────────────────────────────────────────┐
│                   Zustand (Viewport)                 │
│  BookMetadata[]  ~150KB   (only what's rendered)     │
│  CurrentBookAnnotations   (per-book, on demand)      │
│  SearchResults            (from SQLite query)        │
│  CollectionIds            (lightweight)              │
│  UI state                 (route, panel, sidebar)    │
│  Settings                 (fixed 40KB)               │
└──────────────────────┬──────────────────────────────┘
                       │   Tauri IPC (batched)
                       ▼
┌─────────────────────────────────────────────────────┐
│              SQLite (via r2d2 pool)                  │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ books        │  │ annotations  │  ← indexed,     │
│  │ (metadata)   │  │ (per book)   │    per-book      │
│  └──────────────┘  └──────────────┘    queries        │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ book_runtime │  │ covers       │  ← BLOBs, never  │
│  │ (progress)   │  │ (binary)     │    in JS state    │
│  └──────────────┘  └──────────────┘                  │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ book_locatio │  │ vocabulary   │  ← large data,   │
│  │ ns (BLOB)    │  │ (terms)      │    read on demand │
│  └──────────────┘  └──────────────┘                  │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ rss_articles │  │ kv_store     │  ← Zustand persist│
│  │ (truncated)  │  │ (fallback)   │    fallback       │
│  └──────────────┘  └──────────────┘                  │
│  PRAGMAs: WAL, 256MB mmap, 5s busy_timeout, 8MB cache│
└─────────────────────────────────────────────────────┘
```

Search/sort/filter happens in SQLite, not JavaScript. Zustand holds only what's visible. Book open: load metadata + locations + progress from SQLite in one batched query. Book close: write progress + locations back to SQLite. Annotations: per-book queries, 20 results max. RSS: SQLite enforces the content cap, not just the persist layer.

---

## 4. Database Architecture

### 4.1 Current Setup

**Engine**: SQLite via `rusqlite` v0.32 with `bundled` feature.  
**Connection model**: New `Connection::open()` per query — no pool, no reuse.  
**Schema**: 5 tables, zero indexes beyond implicit PKs. No migration system.  
**PRAGMAs**: WAL + NORMAL synchronous + foreign_keys — but not consistently applied.  
**Critical gaps**:

| Issue | Impact |
|-------|--------|
| No `PRAGMA busy_timeout` | Default 0ms = instant crash on lock conflict. Concurrent reads/writes from sync + persist + UI fail with `SQLITE_BUSY`. |
| New connection per query | 8 wasted SQL statements (5 CREATE TABLE + 3 PRAGMAs) overhead per Tauri IPC call. |
| Sync paths skip ALL PRAGMAs | Raw `Connection::open()` in `sync_commands.rs:1505` and `sync_server.rs:832,939,1104` — no WAL, no foreign keys, default journal mode (DELETE, slower). |
| Covers as base64 TEXT | `covers.data_url TEXT` stores base64 strings. 200KB image → 267KB in DB. BLOB would save 33%. |
| No indexes on query columns | `WHERE key LIKE 'prefix%'` does full table scans. |
| No connection pooling | Sequential `with_connection()` calls within same Tauri command open multiple connections serially. |

### 4.2 Fixes

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Add `PRAGMA busy_timeout = 5000` | 1 line | Prevents transient lock errors |
| 2 | Replace per-query `Connection::open()` with `r2d2::Pool` (4 connections) | ~30 lines | Eliminates per-query overhead, consistent PRAGMAs |
| 3 | Add performance PRAGMAs: `cache_size=-8000`, `mmap_size=268435456`, `temp_store=MEMORY`, `journal_size_limit=67108864` | 4 lines | 4× cache, mmap reads, no disk temp tables, bounded WAL |
| 4 | Route all `Connection::open()` through shared pool | ~10 lines | Sync paths get same PRAGMAs |
| 5 | Add migration system (version key in kv_store + ordered migrations) | ~30 lines | Schema evolution without ad-hoc ALTERs |
| 6 | Change `covers.data_url TEXT` → `covers.data BLOB` | ~5 lines | 33% storage savings |
| 7 | Add indexes on `books(title)`, `books(author)`, `covers(book_id)` | 3 statements | Future-proof for SQLite-based search |

### 4.3 Is Turso/libSQL Worth It?

**No.** Readest uses libSQL because they need the same SQL layer in browser (WASM) and native. Theorem already has a clean web/desktop split (localStorage vs SQLite via Tauri IPC). Adopting libSQL would be a major refactor with no benefit unless the app adds cloud sync/replication. SQLite with proper tuning (r2d2 pool + PRAGMAs) is more than sufficient for a single-user desktop reader.

---

## 5. Sync Correctness Bugs

### 5.1 Concurrent Merge Race (DATA CORRUPTION)

`runDeviceSync` (`sync-orchestrator.ts:593-688`) does NOT set `_isMerging` guard. `handleIncomingComplete` (`sync-orchestrator.ts:720-800`) does. If manual sync runs while incoming push-batch completes, **two `mergeIncomingData` calls execute concurrently** on same Zustand stores.

### 5.2 Deleted Vocabulary Terms Resurrect

`deleteVocabularyTerm` (`store/index.ts:1953`) creates NO tombstone. `TombstoneEntity` type lacks `"vocabulary"`. `mergeVocabulary` (`sync-import.ts:346-398`) ignores tombstones entirely.

### 5.3 Removed Collection Books Resurrect

`removeBookFromCollection` (`store/index.ts:1210`) creates NO tombstone. `mergeCollections` uses grow-only union for `bookIds`.

### 5.4 Settings Overwrite Each Other

`mergeSettings` (`sync-import.ts:544-549`) is whole-object LWW. If Device A changes font and Device B changes theme, one side's changes are **completely lost**. No per-key merge.

### 5.5 Annotation Timestamp Collision

`mergeAnnotations` (`sync-import.ts:257-262`) — equal timestamps → remote silently discarded. No explicit tiebreaker.

### 5.6 Incoming Data Gets Wiped

`set_sync_data` (`sync_commands.rs:375`) is a pointer swap. If `provisionSyncData` runs between push-batch arrival and `get_incoming_sync_data`, incoming data is lost.

### 5.7 Content Hash Never Matches (Dead Optimization)

Books domain includes `lastReadAt`, `progress`, `readingTime` — volatile fields that change every reading session. SHA-256 content_hash **never** matches between devices, making the hash-based Skip optimization useless for books.

### 5.8 Device Duplicates (Same Device Shows Twice)

Three bugs:
1. Android `read_machine_fingerprint()` returns `""` — `effective_fingerprint()` override exists but isn't used in `/pair`, QR generation, or `submit_pairing_code` (`sync_server.rs:449`, `sync_commands.rs:159,240`)
2. Windows fingerprint is always `""`
3. When `sync-identity.json` lost (app data clear), new `device_id` generated but old entry never deduped

---

## 6. Sync Architecture: Over-engineering

### 6.1 What We Built From Scratch

| Component | Lines | What it does |
|-----------|-------|-------------|
| Custom ChaCha20-Poly1305 encryption | `sync_crypto.rs` (633) | Per-message AEAD encryption + key exchange |
| Custom LWW merge functions | `sync-import.ts` (672) | Domain-specific merge for 9 data types |
| Custom HTTP sync server | `sync_server.rs` (1129) | 8 REST endpoints for sync protocol |
| Custom manifest/hash/version protocol | `sync_protocol.rs` (389) | DomainSnapshot, SyncManifest, SyncPlan types |
| Custom daemon | `sync-daemon/main.rs` (630) | Sidecar process with own HTTP server |
| Custom pairing protocol | spread across 3 files | QR codes, X25519, HKDF derivation |
| Custom file transfer with chunks | `sync_server.rs:960-1100` | 4 MiB chunks, per-chunk AEAD, SHA-256 |
| Custom JS auto-sync scheduler | `sync-orchestrator.ts:863-1036` | setInterval, visibility API, mutation debounce |
| Custom Rust background sync loop | `sync_commands.rs:1536-1681` | Tokio loop with data_version counter |
| Custom domain snapshot builder | `sync-orchestrator.ts:99-209` | Read 5 stores, JSON.stringify × 9, SHA-256 × 9 |
| **TOTAL** | **~5000+ lines** | **Custom sync system** |

### 6.2 What Yjs Replaces (~50 Lines of Bridge Code)

```ts
import * as Y from 'yjs'

const ydoc = new Y.Doc()
const yBooks = ydoc.getMap('books')
const yAnnotations = ydoc.getMap('annotations')
const ySettings = ydoc.getMap('settings')
// ... one Y.Map per domain

// Connect to peer
const provider = new WebsocketProvider('ws://peer-ip:port', 'theorem-sync', ydoc)

// Yjs → Zustand (automatic on peer changes)
yBooks.observe(() => {
  useLibraryStore.setState({ books: [...yBooks.values()] })
})

// Zustand → Yjs (wrap your setters)
function addBook(book) {
  yBooks.set(book.id, book) // auto-propagates, CRDT-resolved
}
```

### 6.3 What Yjs Gives for Free

- CRDT merging (no timestamp collisions, no data loss, no merge bugs)
- Delta-based sync (only changes transmitted, not full 125MB snapshots)
- Offline queue with automatic replay on reconnect
- Network-agnostic (WebSocket, WebRTC, broadcast channel)
- Rust implementation: `yrs` crate (27K weekly downloads, 94 dependent crates)
- Binary encoding (no base64 bloat, no JSON parse/stringify overhead)
- 17.8k GitHub stars. Used by Linear, AFFiNE, Jupyter, Relm4, etc.

### 6.4 Comparison: Existing Sync Solutions

| Solution | Fits Theorem? | Why |
|----------|--------------|-----|
| **Yjs** | **Best fit** | P2P-capable, no server, CRDT, Rust + JS, mature |
| **Automerge** | Good fit | Rust-native core, CRDT, smaller JS ecosystem |
| **Zero** (Rocicorp) | No | Requires cloud Postgres + zero-cache server |
| **ElectricSQL** | No | Requires Postgres server. Theorem is local-first. |
| **Replicache** | No | Maintenance mode, being replaced by Zero |

---

## 7. Sync Server Lifecycle

### 7.1 When the Server Starts

| Trigger | Starts? | Location |
|---------|---------|----------|
| App cold start, auto-sync ON | Yes (after 2s delay) | `App.tsx:332-378` |
| App cold start, auto-sync OFF | **No** — gate prevents start | `App.tsx:345` |
| Visit Settings with paired devices | Yes | `DeviceSync.tsx:258-283` |
| Visit Settings with zero devices | **No** — effect gate | `DeviceSync.tsx:260` |
| Click "Show Pairing QR" | Yes | `DeviceSync.tsx:293-322` |
| Submit pairing code | Yes | `DeviceSync.tsx:324-351` |
| Navigate away from Settings | Server **not** stopped | — |
| App closed | Daemon **not** killed (orphan) | — |

### 7.2 Daemon (Linux)

1. Daemon spawned as child process — never killed on app exit (orphan persists)
2. Orphan daemon binds port 43935 — in-app server falls back to random port on next launch
3. Daemon has `event_emitter: None` — incoming data from peers is lost
4. Three sync loops simultaneously: daemon (120s), JS timer (120s), Rust loop (300s)
5. `stopAutoSync()` never tells daemon about the toggle

### 7.3 Android Worker

1. `runBackgroundSync` JNI is **receive-only** — starts server, sleeps 180s, saves incoming data. Never pushes to peers.
2. Does NOT check `autoSyncEnabled`.
3. No foreground notification — Android kills it after a few minutes.

### 7.4 Fixes

1. Kill daemon on Tauri exit (`.kill_on_drop(true)` or `on_exit` hook)
2. When daemon is running, skip JS timer + Rust loop (single sync mechanism)
3. `stopAutoSync()` must also call `configureDaemon({ auto_sync_enabled: false })`
4. Android worker: add outbound `initiate_sync()` calls + foreground notification + check `autoSyncEnabled`

---

## 8. Remaining Gaps After Yjs

Yjs handles merge + sync + conflict resolution. These pieces remain custom:

### 8.1 Pairing & Device Identity

**Current**: Custom X25519 + HKDF + QR code + encrypted proof/ack challenge-response.

**Library**: [**magic-wormhole.rs**](https://github.com/magic-wormhole/magic-wormhole.rs) (1k stars, mature)

- Same "speak a code / scan a QR" pairing pattern
- Built-in: NAT traversal, direct P2P connections, file transfer, port forwarding
- Replaces: X25519 key exchange, HKDF derivation, encrypted proof/ack, QR encoding
- Used by: Warp (GNOME file transfer), Wyrmhole (Tauri GUI), Wormhole File Transfer (Android/Flutter)
- **Impact**: Eliminates pairing protocol (~300 lines) + file transfer chunking (~140 lines)

### 8.2 File Transfer (Large Books)

**Current**: Custom 4 MiB chunked transfer with per-chunk ChaCha20-Poly1305 AEAD + SHA-256 verification + base64 encoding. ~140 lines in `sync_server.rs`, ~210 lines in `sync_commands.rs`.

**Library**: **magic-wormhole.rs** has built-in file transfer with:
- Streaming, resume, integrity verification
- NAT traversal (works across routers without port forwarding)
- Direct P2P connections (no relay server needed)

**Alternative**: Keep the custom transfer but:
- Switch to binary encoding (no base64, save 33% bandwidth)
- Use `r2d2` pool for SQLite writes during file receive
- Add resume support for interrupted transfers

### 8.3 Background Scheduling

| Platform | Recommendation |
|----------|---------------|
| **Linux desktop** | `systemd` user service (`~/.config/systemd/user/theorem-sync.service`). Proper lifecycle, auto-restart, logging. Or keep child process with `kill_on_drop(true)`. |
| **macOS** | `launchd` plist in `~/Library/LaunchAgents` |
| **Windows** | Keep custom child process |
| **Android** | Keep WorkManager (it's the right choice). Fix: add foreground service notification, outbound sync, `autoSyncEnabled` check. |
| **All platforms** | The sync "daemon" is unnecessary with Yjs — Yjs maintains its own WebSocket connections inside the app process. Background scheduling is only needed for the initial connection setup, not for the sync loop itself. |

### 8.4 Store Bridge (Zustand ↔ Yjs)

No library needed — thin adapter (~50 lines):

```ts
// Yjs observe → Zustand update (auto-reactive)
const yAnnotations = ydoc.getMap('annotations')
yAnnotations.observe(() => {
  const annotations = [...yAnnotations.values()]
  useLibraryStore.setState({ annotations })
})

// Zustand mutate → Yjs update (wrap setters)
function addAnnotation(annotation) {
  yAnnotations.set(annotation.id, annotation)
  // option: also update Zustand for local reactivity before sync confirms
}
```

**Key insight**: The Y.Map type maps perfectly to the `{ id → object }` pattern used across all domains. Zero data transformation needed. The entire `sync-orchestrator.ts` (1087 lines) and `sync-import.ts` (672 lines) collapse to ~50 lines of bridge code.

---

## 9. Unnecessary Operations

### 9.1 Base64 Encoding Bloat

Every encrypted payload is base64-encoded (JSON string format), adding **33% size increase**. For a 5MB EPUB: 1.66MB pure encoding waste.

**Fix**: Transmit binary ciphertext as `application/octet-stream` instead of base64-inside-JSON. Or switch to Yjs which uses binary encoding natively.

### 9.2 SHA-256 on All 9 Domains Every Time

`sync-orchestrator.ts:143-149` — 9 `sha256Hex()` calls on every `buildDomainsAndManifest()`. Since volatile fields are in the books payload, the content_hash never matches between devices anyway. Dead computation.

### 9.3 `computeLatestDate` × 9 — Unused Field

`sync-orchestrator.ts:151-206` — 9 array iterations to compute `last_modified_at`. This field is **never used** in the sync protocol's decision-making.

### 9.4 `coverPath` Local FS Paths in Sync Payload

`sync-orchestrator.ts:128` — sends local filesystem paths that the peer can't resolve. Byte waste per book.

### 9.5 Cover Sizes Computed But Never Read

`sync_server.rs:892-898` — `resolve_cover_sizes()` SQLite query. Frontend ignores `cover_sizes` field.

### 9.6 `item_count` from Re-parsing JSON

`sync_server.rs:596-599` — Parses JSON back just to count array length. `DomainVersion.item_count` already exists.

### 9.7 `startSyncServer` Called 3× in Pairing Flow

`DeviceSync.tsx:300-322` — Three calls, all hit "already running" early return. Wasted lock acquisitions.

### 9.8 `provisionSyncData` Immediately Overwritten

`runDeviceSync` calls `provisionSyncData()` then immediately overwrites with `setSyncData()`.

### 9.9 `buildDomainsAndManifest` Thrice in One Sync Round

Called in `ensureResponderSyncReady` → `runDeviceSync` → after merge. Only the middle one matters.

### 9.10 GC Tombstone Check on Every Provision

`sync-orchestrator.ts:106-110` — Array rebuild + TTL filter on every provisioning call, even if no tombstones changed.

### 9.11 Paired Devices File Written on Every Sync

`sync_commands.rs:996-1004` — Full file write after every `initiate_sync`, even if only `last_sync_at` changed.

### 9.12 Unused Fields in Return Value

`buildDomainsAndManifest` returns unthawed store snapshots that most callers discard.

### 9.13 Manual ISO 8601 Formatter (57 Lines)

`sync_crypto.rs:169-226` — Hand-rolled leap-year calendar math. Use the `time` crate (2 lines).

### 9.14 No Schema Validation on Sync Data

No zod/valibot schemas. `mergeIncomingData` has 9 `try { JSON.parse(...) } catch {}` blocks that silently swallow malformed data from peers.

---

## 10. Library Reinvention Audit

### Should Replace

| Priority | Custom Code | Lines | Replace With | Stars | Benefit |
|----------|-------------|-------|-------------|-------|---------|
| **HIGH** | Entire custom sync | ~5000 | Yjs + `yrs` | 17.8k | CRDT merge, delta sync, binary encoding, all bugs fixed |
| **HIGH** | Pairing + file transfer | ~500 | `magic-wormhole.rs` | 1k | NAT traversal, resume, P2P file transfer |
| **HIGH** | No schema validation | ~500 (guards) | `zod` or `valibot` | 33k / 12k | Runtime validation of peer data, auto types |
| **HIGH** | Manual snake_case remap | ~50 | `serde(rename_all="camelCase")` | built-in | Zero TS remapping code |
| **HIGH** | Manual ISO 8601 | ~57 | `time` crate | 5.7k | 2-line replacement |
| **MED** | ContextMenu | 236 | `@radix-ui/react-context-menu` | 22k | Full a11y, keyboard nav |
| **MED** | Dropdown | 194 | `@radix-ui/react-select` | 22k | Arrow keys, type-to-select |
| **MED** | Modal | 238 | `@radix-ui/react-dialog` | 22k | Edge case a11y |
| **MED** | Keyboard shortcuts | 183 | `react-hotkeys-hook` | 5.6k | Scope management |
| **MED** | TokenBucket | 35 | `p-limit` | 8.2k | Standard rate limiter |
| **LOW** | Custom response cache | ~40 | `lru-cache` | 5.5k | TTL-aware caching |

### Should Keep (Justified Custom Code)

| Code | Why |
|------|-----|
| Rust EPUB pre-parser (332 lines) | Intentional performance optimization. Uses `quick-xml`. Parallel fast path over zip.js. |
| Custom persistence adapter (188 lines) | No Zustand adapter for Tauri SQLite + localStorage fallback. |
| `useDebounce` (17 lines) | Too small to justify dependency. |
| StarDict parser (589 lines) | No mature JS library for this niche format. |
| RSS feed extraction layer | Uses `fast-xml-parser`. Custom extraction handles real-world edge cases. |
| PDF metadata parser (145 lines) | Lightweight byte-scanning. Full `lopdf` would add significant compile time for simple metadata. |

### Dependencies Already Used Correctly

`@tanstack/react-virtual`, `@tauri-apps/api`, `@zip.js/zip.js`, `clsx`, `date-fns`, `fast-xml-parser`, `fflate`, `fuse.js`, `i18next`, `idb-keyval`, `lucide-react`, `markdown-it`, `pdfjs-dist`, `zustand`, `soundtouchjs`, `tailwind-merge`, `uuid`

---

## 11. Recommended Fixes

### P0 — Immediate

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | `tauri.conf.json`: `visible: false` + `window.show()` after React render | 1 line + 1 hook | Kills white flash |
| 2 | `index.html`: Add inline spinner inside `<div id="root">` | 5 lines | Kills blank screen |
| 3 | Remove `snap-x snap-mandatory snap-start` from settings tab bar | 3 classes | Fixes 80% mobile scroll lag |
| 4 | Replace `transition-all` with `transition-[width]` on progress bar | 1 class | Clean compositor |
| 5 | Batch 5 `sqlite_get_kv` into 1 `sqlite_batch_get_kv` on startup | ~30 lines Rust + TS | 5 IPCs → 1 |
| 6 | Strip `locations` from book persistence (store in SQLite BLOB) | ~30 lines | Prevents 50-100MB JSON catastrophe |
| 7 | Add `PRAGMA busy_timeout = 5000` | 1 line | No transient SQLITE_BUSY crashes |

### P1 — Sync Correctness

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 8 | Use `effective_fingerprint()` in `/pair`, QR gen, `submit_pairing_code` | 3 line changes | Fixes device duplicates |
| 9 | Add `_isMerging` guard to `runDeviceSync` | 3 lines | Fixes concurrent merge corruption |
| 10 | Add `"vocabulary"` to `TombstoneEntity`, tombstone in `deleteVocabularyTerm`, filter in `mergeVocabulary` | ~20 lines | Fixes deleted terms resurrecting |
| 11 | Per-key merge for settings | ~40 lines | Fixes settings overwrite |
| 12 | Add collection_book tombstones | ~15 lines | Fixes collection removal sync |
| 13 | Apply 50KB truncation to RSS articles in sync path | ~5 lines | Fixes raw HTML synced to peers |

### P2 — Performance

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 14 | Guard `animate-fade-in` behind `prefers-reduced-motion` | 1 media query | GPU layer savings |
| 15 | Use `hidden` CSS class for settings tab switching | ~10 lines | No DOM teardown on tab switch |
| 16 | `content-visibility: auto` on scroll containers | 1 CSS property | Off-screen not rendered |
| 17 | `-webkit-overflow-scrolling: touch` + `overscroll-behavior: contain` on main scroll | 2 properties | Native momentum scroll |
| 18 | `React.memo` on SettingsPage, ArticleViewer, BookReaderPage | 3 exports | No full re-renders |
| 19 | `ReaderAnnotationsPanel`: use per-book annotation selector | 2 lines | No re-render on unrelated highlight |
| 20 | Batch cover restore into single `setState` | ~15 lines | No 105-re-render cascade |
| 21 | Build lookup Map before `addBooks()` loop for O(1) dedup | ~10 lines | No 12.5M comparisons on import |
| 22 | Route all `Connection::open()` through `r2d2` pool | ~30 lines | Consistent PRAGMAs, no per-query overhead |
| 23 | Add performance PRAGMAs (mmap, cache_size, temp_store, journal_size_limit) | 4 lines | 4× cache, mmap reads |

### P3 — Architecture

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 24 | Kill daemon on Tauri exit | 1 line | No orphan daemon |
| 25 | Single sync mechanism when daemon running | ~10 lines | No triple-sync |
| 26 | Android worker: add outbound sync + foreground notification | ~30 lines | Worker actually syncs |
| 27 | `stopAutoSync()` → `configureDaemon({ auto_sync_enabled: false })` | 2 lines | Daemon respects toggle |
| 28 | Track explicit `useHasHydrated` state | ~15 lines | Clean startup UX |
| 29 | Add zod schemas for all 9 sync domains | ~200 lines | Safe peer data validation |

### P4 — Long-term

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 30 | Replace custom sync with Yjs (`yjs` + `yrs` + `y-websocket`) | ~2 weeks | Kills ~5000 lines, all sync bugs, delta sync |
| 31 | Replace pairing + file transfer with `magic-wormhole.rs` | ~1 week | NAT traversal, resume, P2P |
| 32 | Replace Modal + Dropdown + ContextMenu with Radix primitives | ~1 week | Production-grade a11y |
| 33 | Migrate book metadata + annotations to SQLite tables (from Zustand blob) | ~1 week | Instant startup at any scale |
| 34 | SQLite-based search replacing Fuse.js for 10K+ books | ~2 days | Indexed, 1ms queries |
| 35 | Use `time` crate + `serde(rename_all)` | 1 hour | Cleanup tech debt |

---

## 12. Resilient Sync: Offline + P2P + Network

### 12.1 The Problem

Current sync is LAN-only (HTTP on port 43935). Devices on different networks cannot sync. Offline changes have no queue — they're lost if not synced before closing. No peer discovery beyond hardcoded port scanning.

### 12.2 Yjs Fixes Offline Automatically

With Yjs:
- All edits go into the local `Y.Doc`. When offline, they accumulate as CRDT operations.
- `y-indexeddb` persists the Y.Doc to browser storage, surviving app restarts.
- On reconnect, the `y-sync` protocol exchanges State Vectors (summary of known ops) and sends only the missing operations.
- **Peers do NOT need to be online simultaneously.** A peer that goes offline and comes back gets caught up automatically.
- **Conflict resolution is automatic and deterministic.** Concurrent edits merge without data loss — no custom LWW merge functions, no timestamp tiebreakers.

### 12.3 Network Discovery

| Scope | Technology | Library (Rust) | Purpose |
|-------|-----------|----------------|---------|
| **LAN** | mDNS / Bonjour | `mdns-sd` (0.20.1) | Announce `_theorem-sync._tcp` service. Peers discover each other automatically. No QR needed for LAN. |
| **Internet P2P** | QUIC by public key | `iroh` (1.0.1) | Dial peers by ed25519 public key. Built-in relay (`iroh-relay`). QUIC-native multiplexed streams. |
| **Internet P2P** | WebRTC | `str0m` (0.21.0) | Sans-IO WebRTC. Pairs with STUN for NAT traversal. |
| **NAT traversal** | STUN | `stun` (0.17.1) | Discover public IP:port behind NAT. Free public servers: `stun:stun.l.google.com:19302` |
| **NAT traversal** | TURN relay | `coturn` (self-hosted) | Relay when direct P2P fails (~10-15% of symmetric NATs). |
| **NAT traversal** | UPnP | `igd` (0.12.1) | Open port on router for direct connections. Best-effort, not always available. |

### 12.4 Resilient Sync Architecture (Three-Tier Network)

```
┌─────────────────────────────────────────────────────────┐
│ Tier 1: LAN (zero config, always works on same network) │
│  mdns-sd announces _theorem-sync._tcp service            │
│  yrs over direct WebSocket (tokio-tungstenite + yrs-axum)│
│  Pairing via QR code (keep existing X25519 + HKDF)       │
│  No relay needed, sub-millisecond latency                │
├─────────────────────────────────────────────────────────┤
│ Tier 2: Internet P2P (automatic fallback)                │
│  iroh QUIC by ed25519 public key                         │
│  STUN (stun.l.google.com:19302) for NAT traversal        │
│  Self-hosted coturn for TURN relay (~10% of symmetric NAT)│
│  Works across any network, no port forwarding needed     │
├─────────────────────────────────────────────────────────┤
│ Tier 3: Cloud Relay (always available, future)           │
│  Cloudflare Durable Object holds canonical Y.Doc         │
│  Devices sync through DO when P2P unreachable            │
│  DO auth via device public key signature                 │
│  See NEW_FEATURES_ARCHITECTURE.md for full design        │
└─────────────────────────────────────────────────────────┘
```

### 12.5 Key Libraries

| Library | Lang | Stars | Purpose |
|---------|------|-------|---------|
| `yjs` + `yrs` | JS + Rust | 17.8k | CRDT engine |
| `y-indexeddb` | JS | — | Persist Y.Doc to IndexedDB |
| `y-websocket` | JS | — | WebSocket sync provider |
| `y-sync` + `yrs-axum` | Rust | — | Sync protocol for Rust yss |
| `mdns-sd` | Rust | 0.20.1 | LAN service discovery |
| `iroh` | Rust | 5k | P2P QUIC by public key + relay |
| `stun` | Rust | 0.17.1 | STUN protocol |
| `tokio-tungstenite` | Rust | 0.29.0 | WebSocket over Tokio |
| `libp2p` | Rust | 5k | Full P2P stack (if iroh is insufficient) |
| `postal-mime` | JS | — | Parse raw MIME email |
| `colord` | JS | 2KB | Color manipulation |
| `react-colorful` | JS | 2.8KB | Color picker component |

### 12.6 Why Not libp2p (Yet)

`libp2p` is the most complete P2P stack (TCP + QUIC + WebRTC transports, mDNS + Kademlia discovery, circuit relay, hole-punching). But it pulls 50+ crate dependencies and is heavy for a reader app. Start with the lighter alternatives:
- LAN: `mdns-sd` + direct WebSocket
- Internet: `iroh` QUIC by public key
- Only add `libp2p` if iroh's relay or transport options prove insufficient.

---

## Appendix A: Sync Architecture Comparison

```
CURRENT (3 redundant loops, broken):
┌─────────────┐   ┌──────────────┐   ┌──────────────┐
│  Daemon     │   │  Rust Loop   │   │  JS Timer    │
│  (120s)     │   │  (300s)      │   │  (120s)      │
│  Port 43935 │   │  In-process  │   │  setInterval │
└──────┬──────┘   └──────┬───────┘   └──────┬───────┘
       │                 │                   │
       └─── ALL THREE calling initiate_sync() ───┘
                  to SAME peer
       Full 9-domain snapshot (50-125MB) each time
       SHA-256 × 9 every provision
       Base64 bloat on all encrypted payloads

PROPOSED (Yjs + magic-wormhole):
┌──────────────────────────────────────────┐
│  Yjs CRDT Engine (in-app process)        │
│  ┌────────┐  ┌──────────┐  ┌─────────┐  │
│  │ Y.Map  │  │ Y.Map    │  │ Y.Map   │  │
│  │ books  │  │ annotat. │  │ settings│  │
│  └────────┘  └──────────┘  └─────────┘  │
│          WebSocket/WebRTC Provider       │
└──────────────────┬───────────────────────┘
                   │
      Delta sync (only changes, not full snapshots)
      Binary encoding (no base64, no JSON)
      CRDT merge (no conflicts, no data loss)
      Offline queue auto-replays on reconnect
      Single sync mechanism
```

## Appendix B: What Yjs Does NOT Replace

Yjs handles CRDT merge + delta sync perfectly. But it doesn't replace:

| Area | Why | Library |
|------|-----|---------|
| Device pairing identity | Yjs doesn't prescribe identity/auth | Keep current or use magic-wormhole |
| Large file transfer (>10MB) | Yjs docs state "document-sized data only" | magic-wormhole or custom HTTP streaming |
| Background scheduling | Yjs provider manages connections, not OS scheduling | Android WorkManager, systemd for desktop |
| Zustand → Yjs bridge | App-specific glue code | ~50 lines of custom adapter |
| Peer discovery on LAN | Yjs provider connects, doesn't discover | mDNS / SSDP or magic-wormhole discovery |
| Persistent CRDT storage | Yjs needs a storage adapter | `y-indexeddb` (browser) or `yrs-kvstore` (Rust) |
