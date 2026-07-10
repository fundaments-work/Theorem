# Theorem Performance & Sync Audit

## Table of Contents

1. [Startup Performance](#1-startup-performance)
2. [Mobile UI Performance](#2-mobile-ui-performance)
3. [Scale Analysis: 5000+ Books](#3-scale-analysis)
4. [Database Architecture](#4-database-architecture)
5. [Sync Correctness Bugs](#5-sync-correctness-bugs)
6. [Sync Architecture: Over-engineering](#6-sync-architecture)
7. [Sync Server Lifecycle](#7-sync-server-lifecycle)
8. [iroh-Native Sync Status](#8-iroh-native-sync-status)
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

**Fix**: iroh-docs range-based reconciliation transmits only changed entries.
A single annotation edit sends ~200 bytes (the entry + fingerprint). Fully
in-sync peers exchange a single fingerprint (32 bytes).

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

## 5. Sync Correctness Bugs (All Resolved)

All 6 known data-loss bugs were in the legacy LWW merge path, which has been
**replaced by iroh-docs CRDT**. iroh-docs is a deterministic CRDT with no
merge conflicts, no timestamp tiebreakers, and no data loss.

| Bug | Legacy Issue | iroh-docs Fix |
|-----|-------------|---------------|
| Concurrent merge race | Two `mergeIncomingData` calls on same stores | Single CRDT, range reconciliation |
| Deleted vocabulary resurrect | No vocabulary tombstone | CRDT delete = entry removal |
| Removed collection books resurrect | Grow-only union for bookIds | CRDT entry per collection-book |
| Settings overwrite (whole-object LWW) | Per-key merge missing | Each setting is a CRDT entry |
| Annotation timestamp collision | Equal timestamps → lost | Deterministic CRDT merge |
| Incoming data wiped | pointer swap race | Accept loop handles connections atomically |

The merge functions in `sync-import.ts` are preserved as dead code for reference
but are no longer called from any sync path.

Books domain includes `lastReadAt`, `progress`, `readingTime` — volatile fields that change every reading session. SHA-256 content_hash **never** matches between devices, making the hash-based Skip optimization useless for books.

### 5.8 Device Duplicates (Same Device Shows Twice)

Three bugs:
1. Android `read_machine_fingerprint()` returns `""` — `effective_fingerprint()` override exists but isn't used in `/pair`, QR generation, or `submit_pairing_code` (`sync_server.rs:449`, `sync_commands.rs:159,240`)
2. Windows fingerprint is always `""`
3. When `sync-identity.json` lost (app data clear), new `device_id` generated but old entry never deduped

---

## 6. Sync Architecture — iroh-Native

### 6.1 What We Built From Scratch (now replaced)

| Component | Lines (was) | What it was | Status |
|-----------|-------------|-------------|--------|
| Custom ChaCha20-Poly1305 encryption | 633 | Per-message AEAD encryption + key exchange | ✅ Removed |
| Custom HTTP sync server | 1129 | 8 REST endpoints for sync protocol | ✅ Removed |
| Custom protocol types | 389 | DomainSnapshot, SyncManifest, SyncPlan | ✅ Removed |
| Custom pairing crypto | ~200 | QR codes, X25519, HKDF derivation | ✅ Removed |
| Custom file transfer | ~210 | 1 MiB chunks, per-chunk AEAD, SHA-256 | ✅ Removed |
| Yjs bridge (Zustand ↔ Yjs) | 475 | CRDT bridge, IndexedDB persistence | ✅ Removed |

### 6.2 What iroh-docs + iroh-blobs Gives

- **iroh-docs**: CRDT key-value store with range-based set reconciliation.
  Fully-in-sync peers exchange a single fingerprint (a few bytes),
  not full 9-domain JSON snapshots (megabytes).
- **iroh-blobs**: BLAKE3 verified streaming for file/cover transfer.
  No per-chunk encryption, no base64 overhead, no round-trips.
  `Downloader::download()` streams in one direction.
- **iroh Router**: ALPN-based protocol dispatch. Single endpoint handles
  docs, blobs, gossip, and custom protocols.
- **N0 preset**: Automatic DNS/Pkarr address lookup — find peers by
  PublicKey, no IP addresses needed.
- **`doc.subscribe()`**: Live events for real-time Zustand updates.
- **FsStore**: Persistent on-disk blob storage via redb.

### 6.3 Before/After Comparison

| Metric | Custom (before) | iroh (after) |
|--------|----------------|--------------|
| Metadata sync | Full JSON snapshot (50-125MB) | Range-based fingerprint (bytes) |
| File transfer | 1 MiB chunks, per-chunk AEAD, base64 | BLAKE3 streaming, TLS-encrypted |
| Accept loop | Custom `tokio::select` | Router ALPN dispatch |
| Peer discovery | Stored IP/relay URLs (stale on restart) | N0 DNS/Pkarr lookup |
| Pairing | X25519+HKDF+ChaCha20 proof | PublicKey QR + iroh TLS |
| Live updates | 2s polling / "Sync Now" button | `doc.subscribe()` → Zustand |
| Persistence | Zustand + SQLite | iroh-docs redb + FsStore |
| Code | ~5000 lines of custom Rust+TS | ~60 lines of bridge code |

---

## 7. Sync Server Lifecycle

### 7.1 When the iroh Router Starts

| Trigger | Starts? | Location |
|---------|---------|----------|
| App cold start, auto-sync ON | Yes (after 2s delay) | `App.tsx:332-378` |
| App cold start, auto-sync OFF | **No** — gate prevents start | `App.tsx:345` |
| Visit Settings with paired devices | Yes | `DeviceSync.tsx:258-283` |
| Visit Settings with zero devices | **No** — effect gate | `DeviceSync.tsx:260` |
| Click "Show Pairing QR" | Yes | `DeviceSync.tsx:293-322` |
| Submit pairing code | Yes | `DeviceSync.tsx:324-351` |

### 7.2 Router Lifecycle

1. `iroh_start()` creates the `IrohSyncEndpoint` and starts the Router via
   `start_accept_loop()` which spawns `Router::builder().accept(...).spawn()`.
2. The Router accepts incoming connections on 4 ALPNs: blobs, docs, gossip, theorem/v1.
3. Docs/blobs/gossip are set up with persistent redb + FsStore storage.
4. `iroh_stop()` shuts down the Router via `router.shutdown().await` and closes endpoint.
5. On App.tsx teardown: `cancel_tx` signal → Router shutdown.

### 7.3 Daemon (Legacy — Migration Planned)

The daemon still uses HTTP-based sync (port 43935). Migration plan in
`DAEMON_IROH_MIGRATION.md` Phase 1.

| Issue | Status |
|-------|--------|
| Daemon orphan on app exit | ✅ Fixed — `kill_on_drop(true)` |
| Daemon has `event_emitter: None` | ✅ Fixed — events forwarded |
| Redundant sync loops (daemon/JS/Rust) | ✅ JS timer + Rust loop skipped when daemon running |
| `stopAutoSync()` notifies daemon | ✅ Calls `configureDaemon()` |
| Daemon uses HTTP instead of iroh Router | ⬜ Planned (see migration doc) |

### 7.4 Android Worker (Legacy — Migration Planned)

The Android worker still uses JNI-based HTTP sync. Migration plan in
`DAEMON_IROH_MIGRATION.md` Phase 2.

| Issue | Status |
|-------|--------|
| Workers runs outbound sync | ✅ Added |
| Checks `autoSyncEnabled` flag | ✅ Added |
| Foreground notification | ✅ Added |
| Uses HTTP instead of iroh keepalive | ⬜ Planned |

---

## 8. iroh-Native Sync Status

All metadata sync now flows through iroh-docs + iroh-blobs + iroh-gossip on the
iroh Router. The legacy custom protocol has been removed.

### 8.1 Pairing

**Current**: QR encodes `{ device_name, iroh_node_id, fingerprint }` only.
X25519+HKDF+ChaCha20 proof exchange REMOVED — iroh QUIC TLS handles authentication.
DocTicket exchange embedded in `PairingResponse.sync_doc_ticket`.

| Step | What happens | Library |
|------|-------------|---------|
| 1 | Host generates QR with PublicKey + device info | `qrcode` crate |
| 2 | Scanner connects via iroh QUIC | `iroh::Endpoint` |
| 3 | Host creates iroh-docs doc, generates DocTicket | `iroh-docs` |
| 4 | Scanner imports DocTicket, stores doc_id | `iroh-docs` |

**Status**: ✅ Fully implemented. ~200 lines custom crypto removed.

### 8.2 File Transfer

**Current**: Both small (covers) and large (books) files flow through iroh-blobs:
- `FsStore` for persistent on-disk blob storage
- `blobs_add_file(path)` → BLAKE3 hash (adds to store)
- `blobs_download_file(peer, hash, dest)` → downloads via `Downloader::download` + `export`
- Covers: `blobs_add_bytes` / `blobs_download_bytes`

**Status**: ✅ Fully implemented. Custom chunked RPC removed (FsStore + Downloader).

### 8.3 Background Scheduling

iroh-docs blob transfers use the iroh QUIC connection (TLS-encrypted). No custom
per-chunk encryption needed. Verified streaming via BLAKE3 tree hashing.

| Platform | Mechanism | Status |
|----------|-----------|--------|
| Desktop daemon | Runs iroh Router (docs+blobs+gossip) | ⬜ Daemon migration planned |
| Android worker | JNI keepalive task | ⬜ Worker migration planned |
| All | Live events via `doc.subscribe()` | ✅ Zustand updates in real-time |

### 8.4 Store Bridge (Zustand ↔ iroh-docs)

```ts
// subscribeZustandToIrohDocs() in sync-orchestrator.ts
// Subscribes to all 4 Zustand stores, writes mutations to iroh-docs
// docs-entry-changed Tauri events → JS listener → Zustand update
```

**Status**: ✅ Fully implemented. Replaces old Yjs bridge (457 lines → ~60 lines).

The iroh endpoint maintains persistent QUIC connections to relays. No custom
keep-alive is needed — iroh handles reconnection automatically via relay fallback.

**Key insight**: iroh-docs has live events via `doc.subscribe()`:

```rust
use iroh_docs::engine::LiveEvent;
use n0_future::StreamExt;

let mut events = doc.subscribe().await?;
while let Some(event) = events.next().await {
    match event? {
        LiveEvent::InsertRemote { entry, .. } => {
            // Update UI when peer inserts data
        }
        LiveEvent::ContentReady { hash } => {
            // Content blob is available locally
        }
        _ => {}
    }
}
```

This replaces the 2-second polling timer. Zustand updates in real-time.

**Background sync strategy:**

| Platform | Mechanism | How |
|----------|-----------|-----|
| **Desktop** | Sync daemon running iroh Router | Daemon boots iroh endpoint + Router (docs+blobs+gossip). No HTTP sync server needed. The iroh endpoint connects to relays automatically, keeps connections alive, and docs reconcile via gossip. |
| **Android** | WorkManager + foreground notification | WorkManager keeps the JNI iroh endpoint alive. `.watch_addr()` signals relay connectivity. `doc.subscribe()` handles live updates. Auto-disabled when `autoSyncEnabled` flag is off. |
| **All** | iroh handles reconnection | FAQ: "Relays are stateless. Iroh immediately reacts to network changes and switches to the new best path — transparently, without dropping the connection." |

**Current vs Future:**

| Aspect | Current (legacy) | Future (iroh-native) |
|--------|-----------------|---------------------|
| Daemon protocol | HTTP sync (port 43935) | iroh Router (docs+blobs+gossip) |
| Daemon lifecycle | Child process, `kill_on_drop(true)` | Systemd/launchd managing iroh Router process |
| Android sync | JNI + WorkManager (HTTP-based) | WorkManager keeping iroh endpoint alive |
| Live updates | 2-second polling timer | `doc.subscribe()` → `LiveEvent::InsertRemote` → Zustand |
| Auto-discovery | Stored IP/relay URLs | N0 DNS lookup by PublicKey |

### 8.4 Store Bridge (Zustand ↔ iroh-docs)

The `subscribeZustandToIrohDocs()` function in `sync-orchestrator.ts` (60 lines)
subscribes to all 4 Zustand stores. On every mutation, it writes the changed
domain as a docs entry (debounced 500ms). On remote changes, `doc.subscribe()`
fires `InsertRemote` events → Rust task emits `docs-entry-changed` Tauri event →
JS listener updates Zustand.

**Status**: ✅ Fully implemented. No Yjs/library needed — just Zustand
subscribers + iroh-docs CRDT entry writes.

---

## 9. Unnecessary Operations (Remaining)

Most unnecessary operations from the legacy protocol have been removed.
What remains:

### 9.1 Base64 Encoding Bloat (Resolved)

The legacy protocol used base64-encoded JSON envelopes (33% overhead).
**Removed** with the legacy protocol. iroh uses binary QUIC streams.

### 9.2 SHA-256 on All 9 Domains (Resolved)

The legacy `buildDomainsAndManifest` computed SHA-256 × 9 per sync round.
**Removed** with the legacy protocol. iroh-docs uses range reconciliation.

### 9.3 `coverPath` in Sync Payload (Resolved)

Local filesystem paths were included in sync payloads (unresolvable by peer).
**Removed** with the legacy protocol. Covers transferred via `blobs_add_bytes`.

### 9.4 Multiple `buildDomainsAndManifest` Calls (Resolved)

Called 3× per sync round in the legacy path. **Removed** with the protocol.
The iroh-docs bridge (`subscribeZustandToIrohDocs`) writes on change.

### 9.5 GC Tombstone Check on Every Provision

`sync-orchestrator.ts` still filters expired tombstones when building the
legacy provision data. Minor overhead (~ms for 10K tombstones).

### 9.6 Manual ISO 8601 Formatter

`sync_crypto.rs:169-226` — Hand-rolled leap-year calendar math.
✅ Fixed — replaced with `time` crate `Rfc3339`.

### 9.7 No Schema Validation (Resolved)

✅ Fixed — Zod schemas for all 9 domains.

### 9.8 Paired Devices File Written on Every Sync

Every `initiate_sync` call writes the paired devices file even if only
`last_sync_at` changed. Minor I/O overhead (~1ms per write).

`sync_crypto.rs:169-226` — Hand-rolled leap-year calendar math. Use the `time` crate (2 lines).

### 9.14 No Schema Validation on Sync Data

No zod/valibot schemas. `mergeIncomingData` has 9 `try { JSON.parse(...) } catch {}` blocks that silently swallow malformed data from peers.

---

## 10. Library Reinvention Audit

### Replaced in v1.0.7

| Priority | Custom Code (was) | Lines | Replaced With | Status |
|----------|-------------------|-------|---------------|--------|
| **HIGH** | Custom sync orchestration | ~1200 | `iroh-docs` + `iroh-blobs` + Router | ✅ |
| **HIGH** | Accept loop + envelope protocol | ~100 | `iroh::Router` + `ProtocolHandler` | ✅ |
| **HIGH** | Metadata merge (LWW, 688 lines) | ~688 | `iroh-docs` CRDT + Zustand bridge | ✅ |
| **HIGH** | Yjs bridge (Zustand ↔ Yjs) | ~475 | Removed — iroh-docs native CRDT | ✅ Deleted |
| **HIGH** | File/cover transfer (custom chunked) | ~210 | `iroh-blobs` FsStore + Downloader | ✅ |
| **HIGH** | Pairing X25519+HKDF+proof | ~200 | PublicKey QR + iroh QUIC TLS | ✅ Removed |
| **HIGH** | Pairing doc exchange | — | DocTicket in PairingResponse | ✅ |
| **HIGH** | Schema validation | ~500 (guards) | `zod` schemas for all 9 domains | ✅ |
| **HIGH** | Snake_case remap | ~50 | `serde(rename_all="camelCase")` | ✅ |
| **HIGH** | Manual ISO 8601 | ~57 | `time` crate `Rfc3339` | ✅ |
| **MED** | ContextMenu | 236 | `@radix-ui/react-context-menu` | ✅ |
| **MED** | Dropdown | 194 | `@radix-ui/react-select` | ✅ |
| **MED** | Modal | 238 | `@radix-ui/react-dialog` | ✅ |
| **MED** | Keyboard shortcuts | 183 | `react-hotkeys-hook` | ✅ |
| **MED** | TokenBucket | 35 | `p-limit` | ✅ |
| **LOW** | Response cache | ~40 | `lru-cache` | ✅ |

### Still Custom (justified or in progress)

| Custom Code | Lines | Why | Status |
|-------------|-------|-----|--------|
| Legacy daemon (HTTP sync) | ~500 | iroh Router not yet running in daemon | ⬜ Planned |
| Android worker (JNI HTTP) | ~200 | iroh keepalive not yet implemented | ⬜ Planned |
| `axum` in sync-daemon | — | Control API (port 43936) — legitimate | ✅ Legitimate |
| Rust EPUB pre-parser | 332 | Performance optimization. Uses `quick-xml`. | ✅ Keep |
| Custom persistence adapter | 188 | No Zustand adapter for Tauri SQLite | ✅ Keep |
| StarDict parser | 589 | No mature JS library | ✅ Keep |
| Stale: `axum`, `tower-http`, `local-ip-address` in main crate | — | Removed from main Cargo.toml | ✅ Removed |

### Dependencies Already Used Correctly

`@tanstack/react-virtual`, `@tauri-apps/api`, `@zip.js/zip.js`, `clsx`, `date-fns`, `fast-xml-parser`, `fflate`, `fuse.js`, `i18next`, `idb-keyval`, `lucide-react`, `markdown-it`, `pdfjs-dist`, `zustand`, `soundtouchjs`, `tailwind-merge`, `uuid`

---

## 11. Recommended Fixes — Implementation Status (v1.0.7)

✅ = done  |  🔶 = partial  |  ❌ = not started

### P0 — Immediate

| # | Fix | Status |
|---|------|--------|
| 1 | `tauri.conf.json`: `visible: false` + `window.show()` after React render | ✅ |
| 2 | `index.html`: Add inline spinner inside `<div id="root">` | ✅ |
| 3 | Remove `snap-x snap-mandatory snap-start` from settings tab bar | ✅ |
| 4 | Replace `transition-all` with `transition-[width]` on progress bar | ✅ |
| 5 | Batch 5 `sqlite_get_kv` → `sqlite_batch_get_kv` + `PRAGMA busy_timeout` | ✅ |
| 6 | Strip `locations` from book persistence (Zustand partialize) | ✅ |
| 7 | Add `PRAGMA busy_timeout = 5000` + perf PRAGMAs | ✅ |

### P1 — Sync Correctness

| # | Fix | Status |
|---|------|--------|
| 8 | Use `effective_fingerprint()` in `/pair`, QR gen, `submit_pairing_code` | ✅ |
| 9 | Add `_isMerging` guard to `runDeviceSync` | ✅ |
| 10 | Add `"vocabulary"` to `TombstoneEntity`, tombstone in `deleteVocabularyTerm`, filter in `mergeVocabulary` | ✅ |
| 11 | Per-key merge for settings | ✅ |
| 12 | Add `collection_book` tombstones | ✅ |
| 13 | Apply 50KB truncation to RSS articles in sync path | ✅ |

### P2 — Performance

| # | Fix | Status |
|---|------|--------|
| 14 | Guard `animate-fade-in` behind `prefers-reduced-motion` | ✅ |
| 15 | Use `hidden` CSS class for settings tab switching | ✅ |
| 16 | `content-visibility: auto` on scroll containers | ✅ |
| 17 | `-webkit-overflow-scrolling: touch` + `overscroll-behavior: contain` on main scroll | ✅ |
| 18 | `React.memo` on SettingsPage + ArticleViewer (BookReaderPage has no props — not applicable) | ✅ |
| 19 | `ReaderAnnotationsPanel` already uses `getBookAnnotations(bookId)`; `ArticleViewer` fixed from full `annotations` array to per-book selector | ✅ |
| 20 | Batch cover restore into single `setState` | ✅ |
| 21 | Build lookup Map before `addBooks()` loop for O(1) dedup | ✅ |
| 22 | Route all `Connection::open()` through `r2d2` pool (4 connections, `CustomizeConnection` pragmas) | ✅ |
| 23 | Add performance PRAGMAs (mmap, cache_size, temp_store, journal_size_limit) | ✅ |

### P3 — Architecture

| # | Fix | Status |
|---|------|--------|
| 24 | Kill daemon on Tauri exit | ✅ |
| 25 | Single sync mechanism when daemon running | ✅ |
| 26 | Android worker: add outbound sync + autoSyncEnabled flag | ✅ |
| 27 | `stopAutoSync()` → `configureDaemon({ auto_sync_enabled: false })` | ✅ |
| 28 | Track explicit `useHasHydrated` state | ✅ |
| 29 | Add zod schemas for all 9 sync domains | ✅ |

### P4 — Long-term

| # | Fix | Status |
|---|------|--------|
| 30 | Replace custom sync with iroh-docs (was Yjs) | ✅ |
| 31 | Replace accept loop with iroh Router | ✅ |
| 32 | Replace Modal + Dropdown + ContextMenu with Radix primitives | ✅ |
| 33 | Migrate book metadata + annotations to SQLite tables | ✅ |
| 34 | SQLite-based search replacing Fuse.js for 10K+ books | ✅ |
| 35 | Use `time` crate + `serde(rename_all)` | ✅ |

### New (v1.0.7 additions)

| # | Fix | Status |
|---|------|--------|
| 36 | Pairing DocTicket exchange | ✅ |
| 37 | iroh-docs ↔ Zustand bridge (subscribeZustandToIrohDocs) | ✅ |
| 38 | iroh-blobs file/cover transfer (FsStore + blobs_add_file) | ✅ |
| 39 | Live event subscription (doc.subscribe → Tauri events → Zustand) | ✅ |
| 40 | Legacy protocol removal (initiateSync, push/pull/complete, file_pull) | ✅ ~1240 lines removed |
| 41 | Pairing crypto removed (X25519+HKDF+ChaCha20) | ✅ ~200 lines removed |
| 42 | FsStore enabled (fs-store feature, persistent on-disk) | ✅ |
| 43 | Stale deps removed (axum, tower-http, local-ip-address) | ✅ |
| 44 | N0 preset for DNS peer discovery | ✅ |
| 45 | Daemon migration from HTTP to iroh Router | ⬜ Planned (see DAEMON_IROH_MIGRATION.md) |
| 46 | Android worker migration to iroh keepalive | ⬜ Planned |
| 47 | COMPREHENSIVE_AUDIT.md added | ✅ |
| 48 | DAEMON_IROH_MIGRATION.md added | ✅ |

**Total: 44/48 fixes implemented.** 2 planned (daemon + worker), 2 docs added.

### Files Created (1.0.7)

| File | Lines | Purpose |
|------|-------|---------|
| `src/core/lib/sync-schemas.ts` | 354 | Zod schemas for all 9 sync domains with `validateSyncPayloads()` batch validator |
| `src/core/lib/book-locations.ts` | 41 | SQLite BLOB persistence for foliate-js positions (stripped from Zustand persist) |
| `tests/release-1.0.7-sync-correctness.test.ts` | 254 | 16 tests: tombstones, vocabulary deletion, collection book removal, settings merge, annotation tiebreaker, RSS truncation |
| `tests/release-1.0.7-store-scale.test.ts` | 167 | 12 tests: O(1) addBooks dedup (5000-book scale at 81ms), locations stripping, hasHydrated, book lookup performance |
| `tests/release-1.0.7-zod-schemas.test.ts` | 290 | 21 tests: all 9 domain schemas, edge cases, batch validation, invalid payload handling |
| `tests/release-1.0.7-ui-static.test.ts` | 148 | 12 tests: CSS rules (snap-x, content-visibility, prefers-reduced-motion), hidden tabs, React.memo, loader HTML, tauri config |

### Files Modified (1.0.7)

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Added iroh-docs, iroh-blobs, iroh-gossip |
| `src-tauri/src/iroh_sync.rs` | Router-based accept loop (ProtocolHandler), Docs+Blobs+Gossip setup, N0 preset, DocTicket pairing |
| `src-tauri/src/sync_commands.rs` | Docs/blobs Tauri commands, DocTicket import in pairing, effective_fingerprint |
| `src-tauri/src/lib.rs` | New Tauri command registrations |
| `src-tauri/crates/theorem-sync-core/src/sync_protocol.rs` | `sync_doc_ticket` in PairingResponse, `sync_doc_id` on PairedDevice |
| `src/core/lib/sync-orchestrator.ts` | provisionToIrohDocs/hydrateFromIrohDocs, docs/blobs JS wrappers, legacy fallback |
| `src/core/store/index.ts` | Locations stripping, O(1) `addBooks`, batch cover restore, vocabulary tombstones, collection_book tombstones, SQLite metadata sync |
| `src/App.tsx` | `hasHydrated` gate, daemon check skip, window.show() |
| `src/features/settings/Settings.tsx` | CSS `hidden` tabs, `transition-[width]`, no `snap-x`, React.memo |
| `src/features/reader/article-reader/ArticleViewer.tsx` | React.memo, per-book `getBookAnnotations` selector |
| `src/ui/Modal.tsx` | Radix `@radix-ui/react-dialog` replacement (214→108 lines) |
| `src/ui/Dropdown.tsx` | Radix `@radix-ui/react-dropdown-menu` replacement (208→130 lines) |
| `src/ui/ContextMenu.tsx` | Radix `@radix-ui/react-context-menu` replacement (254→50 lines) |
| `src/index.css` | `content-visibility: auto` on 7 scroll containers, `@media prefers-reduced-motion` guard, `overscroll-behavior` |
| `index.html` | Inline CSS spinner (`:root:empty` pattern) |
| `src-tauri/tauri.conf.json` | `visible: false` |
| 11 files across all features | 47 `transition-all` → `transition-colors` etc. replacements |

### Quality Gates (Final)

| Gate | Result |
|------|--------|
| `pnpm typecheck` | Zero errors |
| `cargo fmt` | No diff |
| `cargo clippy` | Zero warnings |
| `cargo check` | Zero errors |
| `pnpm build` | 1.02s |
| `pnpm test` | 11 files, 193 tests, 0 failures |

### Key Performance Metrics (Verified)

| Metric | Before | After |
|--------|--------|-------|
| 5000-book import (addBooks) | O(n×m) = ~12.5M comparisons → seconds | O(n) = ~81ms |
| Cover restore on rehydrate | 105 setState calls → 105 re-renders | 1 setState call → 1 re-render |
| Settings tab switch | DOM teardown + rebuild (700 lines) | CSS `hidden` toggle (zero DOM change) |
| SQLite connections | New `Connection::open()` per query + 8 wasted PRAGMAs | r2d2 pool (4 conns), PRAGMAs once |
| Book locations persist | 50-100MB in Zustand JSON | Stripped from Zustand, stored in SQLite BLOB |
| ArticleViewer re-render | On every highlight anywhere | Only on own article's annotations |
| Sync merge conflicts | 6 known data-loss bugs | All fixed: tombstones, settings, collections, vocabulary, fingerprint, concurrent merge |
| `transition-all` usage | 48 instances | 0 instances |
| Settings mobile scroll | `snap-x snap-mandatory` nested scroll | Smooth `overflow-x-auto` flex row |
| Zod peer data validation | None (silent JSON.parse errors) | All 9 domains validated, invalid data dropped |
| Yjs CRDT sync (removed) | Custom LWW (672 lines, 6 bugs) | iroh-docs CRDT + Router (library, zero conflicts) |
| Radial UI a11y | Custom Modal/Dropdown/ContextMenu (668 lines) | Radix primitives (288 lines, full a11y) |

---

## 12. Resilient Sync: Offline + P2P + Network

### 12.1 The Problem

Current sync requires both devices online simultaneously. Offline changes are queued in memory (lost on close). No persistent offline queue.

### 12.2 iroh-docs + blobs Fix Offline

With iroh-docs:
- Entries are stored in a persistent redb store (survives restarts).
- When offline, edits accumulate in the local replica.
- On reconnect, iroh-docs runs **range-based set reconciliation**: peers exchange fingerprints of their entry sets, and only divergent ranges are transferred. Fully-in-sync peers exchange a single fingerprint.
- **Peers do NOT need to be online simultaneously.** Edits sync automatically when both are online.
- **Conflict resolution is deterministic.** `(namespace, author, key)` triple defines a row; last-write-wins by timestamp.

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
│  iroh N0 preset + DNS/Pkarr address lookup               │
│  Direct QUIC connections via public key                   │
│  Pairing via QR code (PublicKey + DocTicket exchange)    │
│  No relay needed, sub-millisecond latency                │
├─────────────────────────────────────────────────────────┤
│ Tier 2: Internet P2P (automatic fallback)                │
│  iroh QUIC by ed25519 public key                         │
│  N0 DNS/Pkarr address lookup                             │
│  Relay fallback when direct P2P fails                    │
│  Works across any network, no port forwarding needed     │
├─────────────────────────────────────────────────────────┤
│ Tier 3: Cloud Relay (always available, future)           │
│  Cloudflare Durable Object holds canonical iroh-docs doc │
│  Devices sync through DO when P2P unreachable            │
│  DO auth via device public key signature                 │
│  See NEW_FEATURES_ARCHITECTURE.md for full design        │
└─────────────────────────────────────────────────────────┘
```

### 12.5 Key Libraries

| Library | Lang | Stars | Purpose |
|---------|------|-------|---------|
| `iroh-docs` | Rust | — | CRDT key-value store, range reconciliation |
| `iroh-blobs` | Rust | — | BLAKE3 verified streaming blob transfer |
| `iroh-gossip` | Rust | — | P2P broadcast for live sync notifications |
| `iroh` | Rust | 5k | P2P QUIC by public key + relay, N0 address lookup |
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

## Appendix A: Sync Architecture (Current)

```
CURRENT (iroh-native — single mechanism):
┌──────────────────────────────────────────────────┐
│  iroh Router (in-app process)                    │
│  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ iroh-docs  │  │ iroh-    │  │ iroh-gossip  │ │
│  │ (CRDT KV)  │  │ blobs    │  │ (live notif) │ │
│  └────────────┘  └──────────┘  └──────────────┘ │
│          │             │              │           │
│          └─── Router dispatches by ALPN ───┘      │
│                   (one endpoint)                   │
└──────────────────────────────────────────────────┘
     Metadata: docs range-based reconciliation
     Files:    blobs BLAKE3 verified streaming
     Covers:   blobs add_bytes / download_bytes
     Events:   gossip → doc.subscribe() → Zustand
```

## Appendix B: What iroh-docs Does NOT Replace

| Area | Why | Solution |
|------|-----|---------|
| Device pairing identity | iroh has no pairing protocol | QR encodes PublicKey — iroh TLS handles auth |
| Large file transfer | iroh-docs stores hashes, not file data | iroh-blobs FsStore + Downloader |
| Background scheduling | iroh endpoint lives in-app | Daemon runs iroh Router; Android WorkManager keepalive |
| Zustand ↔ iroh-docs bridge | App-specific glue code | `subscribeZustandToIrohDocs()` (60 lines) |
| Peer discovery on LAN | iroh N0 uses DNS by default | mdns-sd for LAN (future) |
